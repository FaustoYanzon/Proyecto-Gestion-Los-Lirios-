"""Lotes de pasa: abrir, agregar bines (levantada) y cerrar.

Un lote es de una sola variedad; hay a lo sumo un lote abierto por
variedad+calidad (lotes en paralelo, uno por variedad en levantada). Cada bin
descuenta `kg x ratio_uva_pasa` de uva fresca del pasero indicado.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_up
from app.api.pasero import get_pasero_or_404
from app.models.alta_produccion import Bin, Deposito, EstadoLote, Lote
from app.models.parcela import VariedadUva
from app.models.user import User
from app.schemas.alta_produccion import (
    BinCreate,
    BinResponse,
    LoteCierre,
    LoteCreate,
    LoteDetalleResponse,
    LoteResponse,
)
from app.services import mermas
from app.services.alta_produccion import (
    Parametros,
    get_parametros,
    siguiente_numero_lote,
    uva_disponible,
)

router = APIRouter(prefix="/lotes-pasa", tags=["Lotes de pasa"])


def temporada_de(fecha: date) -> int:
    """Campaña mayo -> abril (NO año calendario)."""
    return fecha.year if fecha.month >= 5 else fecha.year - 1


def _lote_response(lote: Lote, params: Parametros) -> LoteResponse:
    cantidad = len(lote.bines)
    return LoteResponse(
        id=lote.id,
        temporada=lote.temporada,
        variedad=lote.variedad,
        calidad=lote.calidad,
        numero=lote.numero,
        estado=lote.estado,
        deposito_id=lote.deposito_id,
        kg_total=lote.kg_total,
        saldo_kg=lote.saldo_kg,
        tope_bines=lote.tope_bines,
        cantidad_bines=cantidad,
        merma_bines_kg=mermas.merma_bines(cantidad, params.kg_nominal_bin, lote.kg_total),
        created_at=lote.created_at,
        closed_at=lote.closed_at,
    )


async def _get_lote(db: AsyncSession, lote_id: str, for_update: bool = False) -> Lote:
    stmt = select(Lote).options(selectinload(Lote.bines)).where(Lote.id == lote_id)
    if for_update:
        stmt = stmt.with_for_update()
    lote = (await db.execute(stmt)).scalar_one_or_none()
    if lote is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lote not found")
    return lote


async def _validar_deposito(db: AsyncSession, deposito_id: str | None) -> None:
    if deposito_id is not None and await db.get(Deposito, deposito_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deposito not found")


def _cerrar(lote: Lote) -> None:
    lote.estado = EstadoLote.cerrado
    lote.closed_at = datetime.now(timezone.utc)


@router.get("/", response_model=list[LoteResponse])
async def list_lotes(
    estado: EstadoLote | None = Query(None),
    variedad: VariedadUva | None = Query(None),
    temporada: int | None = Query(None),
    con_saldo: bool = Query(False, description="Solo lotes con saldo > 0"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[LoteResponse]:
    stmt = (
        select(Lote)
        .options(selectinload(Lote.bines))
        .order_by(Lote.temporada.desc(), Lote.variedad, Lote.calidad, Lote.numero)
    )
    if estado:
        stmt = stmt.where(Lote.estado == estado)
    if variedad:
        stmt = stmt.where(Lote.variedad == variedad)
    if temporada is not None:
        stmt = stmt.where(Lote.temporada == temporada)
    if con_saldo:
        stmt = stmt.where(Lote.saldo_kg > 0)
    params = await get_parametros(db)
    return [_lote_response(lote, params) for lote in (await db.execute(stmt)).scalars().all()]


@router.post("/", response_model=LoteResponse, status_code=status.HTTP_201_CREATED)
async def abrir_lote(
    data: LoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> LoteResponse:
    await _validar_deposito(db, data.deposito_id)
    abierto = await db.scalar(
        select(Lote).where(
            Lote.variedad == data.variedad,
            Lote.calidad == data.calidad,
            Lote.estado == EstadoLote.abierto,
        )
    )
    if abierto is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya hay un lote abierto de {data.variedad.value} calidad {data.calidad} "
            f"(n° {abierto.numero}); cerralo antes de abrir otro",
        )
    params = await get_parametros(db)
    temporada = temporada_de(data.fecha or date.today())
    lote = Lote(
        temporada=temporada,
        variedad=data.variedad,
        calidad=data.calidad,
        numero=await siguiente_numero_lote(db, temporada, data.variedad, data.calidad),
        deposito_id=data.deposito_id,
        kg_total=Decimal("0"),
        saldo_kg=Decimal("0"),
        tope_bines=params.tope_bines_lote,
        created_by=current_user.id,
    )
    db.add(lote)
    try:
        await db.flush()
    except IntegrityError as exc:
        # Carrera con otra apertura: salta el único (variedad, calidad) abierto
        # o el número correlativo repetido.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Otro usuario abrió un lote de esa variedad y calidad al mismo tiempo; reintentá",
        ) from exc
    lote = await _get_lote(db, lote.id)
    return _lote_response(lote, params)


@router.get("/{lote_id}", response_model=LoteDetalleResponse)
async def get_lote(
    lote_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> LoteDetalleResponse:
    lote = await _get_lote(db, lote_id)
    params = await get_parametros(db)
    base = _lote_response(lote, params)
    return LoteDetalleResponse(
        **base.model_dump(), bines=[BinResponse.model_validate(b) for b in lote.bines]
    )


@router.post("/{lote_id}/bines", response_model=LoteResponse, status_code=status.HTTP_201_CREATED)
async def agregar_bin(
    lote_id: str,
    data: BinCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> LoteResponse:
    lote = await _get_lote(db, lote_id, for_update=True)
    if lote.estado != EstadoLote.abierto:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El lote está cerrado")
    if lote.tope_bines is not None and len(lote.bines) >= lote.tope_bines:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El lote alcanzó el tope de {lote.tope_bines} bines",
        )
    # Lock del pasero: dos lotes (calidad 1 y 2) de la misma variedad no pueden
    # consumir a la vez la misma uva.
    await get_pasero_or_404(db, data.pasero_id, for_update=True)

    params = await get_parametros(db)
    disponible = await uva_disponible(db, data.pasero_id, lote.variedad)
    maxima = mermas.pasa_maxima(disponible, params.ratio_uva_pasa)
    if data.kg_real > maxima:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No se puede levantar {data.kg_real} kg de pasa: con {disponible} kg de uva "
            f"disponible ({params.ratio_uva_pasa}:1) el máximo es {maxima} kg",
        )

    lote.bines.append(
        Bin(
            pasero_id=data.pasero_id,
            fecha=data.fecha or date.today(),
            kg_real=data.kg_real,
            uva_consumida_kg=mermas.uva_consumida(data.kg_real, params.ratio_uva_pasa),
        )
    )
    lote.kg_total += data.kg_real
    lote.saldo_kg += data.kg_real
    # Se cierra solo al llegar al tope (lo que ocurra primero con agotar la variedad).
    if lote.tope_bines is not None and len(lote.bines) >= lote.tope_bines:
        _cerrar(lote)
    await db.flush()
    lote = await _get_lote(db, lote.id)
    return _lote_response(lote, params)


@router.post("/{lote_id}/cerrar", response_model=LoteResponse)
async def cerrar_lote(
    lote_id: str,
    data: LoteCierre | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> LoteResponse:
    lote = await _get_lote(db, lote_id, for_update=True)
    if lote.estado != EstadoLote.abierto:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El lote ya está cerrado")
    if not lote.bines:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="No se puede cerrar un lote sin bines"
        )
    if data is not None and data.deposito_id is not None:
        await _validar_deposito(db, data.deposito_id)
        lote.deposito_id = data.deposito_id
    _cerrar(lote)
    await db.flush()
    lote = await _get_lote(db, lote.id)
    return _lote_response(lote, await get_parametros(db))
