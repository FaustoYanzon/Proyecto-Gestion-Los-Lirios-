"""Anulación (soft-cancel) de documentos. Un documento anulado nunca cuenta en
saldos ni stock, pero conserva su número y sigue visible en listados y PDF."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.alta_produccion import Lote, Remito, TipoRemito

_ANULABLES = (TipoRemito.entrega_pasa, TipoRemito.salida_fresco, TipoRemito.salida_bodega)


async def anular_remito(db: AsyncSession, remito_id: str, motivo: str, user_id: str) -> Remito:
    # Lock the remito row BEFORE reading anulado_at: a concurrent second
    # annulment waits here and then sees it already annulled (409), so the
    # lote balance is never restored twice.
    remito = (
        await db.execute(
            select(Remito)
            .options(selectinload(Remito.lineas), selectinload(Remito.comprobante_bodega))
            .where(Remito.id == remito_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if remito is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Remito no encontrado")
    if remito.anulado_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El remito ya está anulado")
    if remito.tipo not in _ANULABLES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Los traslados a pasero no se pueden anular",
        )
    if remito.tipo == TipoRemito.salida_bodega and remito.comprobante_bodega is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El remito tiene un comprobante de bodega cargado y no se puede anular",
        )

    if remito.tipo == TipoRemito.entrega_pasa:
        # Deterministic order (same as creation): concurrent operations on the
        # same lotes never deadlock.
        por_lote: dict[str, list] = {}
        for linea in remito.lineas:
            if linea.lote_id:
                por_lote.setdefault(linea.lote_id, []).append(linea)
        for lote_id in sorted(por_lote):
            lote = (
                await db.execute(select(Lote).where(Lote.id == lote_id).with_for_update())
            ).scalar_one()
            for linea in por_lote[lote_id]:
                lote.saldo_kg += linea.kg  # lote stays closed

    for linea in remito.lineas:
        linea.anulada = True
    remito.anulado_at = datetime.now(timezone.utc)
    remito.anulado_by = user_id
    remito.motivo_anulacion = motivo
    await db.flush()
    await db.refresh(remito)
    return remito
