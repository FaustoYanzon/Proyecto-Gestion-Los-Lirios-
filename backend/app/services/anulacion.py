"""Anulación (soft-cancel) de documentos. Un documento anulado nunca cuenta en
saldos ni stock, pero conserva su número y sigue visible en listados y PDF."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.alfalfa import DocumentoAlfalfa, TipoDocumentoAlfalfa
from app.models.alta_produccion import Lote, Remito, TipoRemito
from app.services.alfalfa import get_deposito_alfa, stock_alfalfa

# Only pasa deliveries for now: annulling FRE/BOD would free a cosecha balance
# that cannot be re-dispatched, and the cosecha keeps its comprador/kg/n_remito.
_ANULABLES = (TipoRemito.entrega_pasa,)


async def anular_remito(db: AsyncSession, remito_id: str, motivo: str, user_id: str) -> Remito:
    # Lock the remito row BEFORE reading anulado_at: a concurrent second
    # annulment waits here and then sees it already annulled (409), so the
    # lote balance is never restored twice.
    remito = (
        await db.execute(
            select(Remito)
            .options(selectinload(Remito.lineas))
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
            detail="Solo se pueden anular las entregas de pasa",
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


async def anular_documento_alfalfa(
    db: AsyncSession, documento_id: str, motivo: str, user_id: str
) -> DocumentoAlfalfa:
    # Lock the Alfalfa depot BEFORE reading the document: stock is derived (no
    # row of its own), so this serializes against concurrent salidas and other
    # annulments, and a second annulment of the same document sees it as done.
    await get_deposito_alfa(db, for_update=True)
    documento = (
        await db.execute(
            select(DocumentoAlfalfa)
            .options(selectinload(DocumentoAlfalfa.lineas))
            .where(DocumentoAlfalfa.id == documento_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if documento is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado")
    if documento.anulado_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El documento ya está anulado")

    if documento.tipo == TipoDocumentoAlfalfa.alta:
        # Current stock already excludes annulled docs; removing this alta must
        # not leave any product negative in units or kg.
        stock = {s.producto: s for s in await stock_alfalfa(db)}
        for linea in documento.lineas:
            actual = stock[linea.producto]
            unidades = actual.unidades - linea.cantidad
            kg = actual.kg - linea.kg
            if unidades < 0 or kg < 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"No se puede anular: el stock de {linea.producto.value} quedaría en "
                        f"{unidades.normalize():f} unidades y {kg.normalize():f} kg "
                        "(hay salidas que dependen de este alta)"
                    ),
                )

    documento.anulado_at = datetime.now(timezone.utc)
    documento.anulado_by = user_id
    documento.motivo_anulacion = motivo
    await db.flush()
    await db.refresh(documento)
    return documento
