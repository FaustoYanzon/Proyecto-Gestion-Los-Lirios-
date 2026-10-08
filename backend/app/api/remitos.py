"""Remitos de salida (fresco / bodega) y de entrega de pasa, más el
comprobante INV (SUV + kg recibidos) que concilia un remito a bodega.

- salida_fresco / salida_bodega: cada línea descuenta de un `RegistroCosecha`.
- entrega_pasa: cada línea descuenta del saldo de un `Lote` cerrado
  (entregas parciales).
"""
from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_up
from app.models.alta_produccion import (
    Comprador,
    ComprobanteBodega,
    EstadoLote,
    Lote,
    Productor,
    Remito,
    RemitoLinea,
    TipoRemito,
)
from app.models.parcela import Parcela
from app.models.produccion import DestinoCosecha, RegistroCosecha
from app.models.user import User
from app.schemas.alta_produccion import (
    ComprobanteBodegaCreate,
    ComprobanteBodegaResponse,
    RemitoCreate,
    RemitoLineaResponse,
    RemitoResponse,
)
from app.services.alta_produccion import saldo_cosecha, siguiente_numero_remito

router = APIRouter(prefix="/remitos", tags=["Remitos"])

DESTINOS_POR_TIPO: dict[TipoRemito, set[DestinoCosecha]] = {
    TipoRemito.salida_fresco: {DestinoCosecha.mercado_interno, DestinoCosecha.exportacion},
    TipoRemito.salida_bodega: {DestinoCosecha.bodega},
}


_LOAD_OPTS = (
    selectinload(Remito.lineas).selectinload(RemitoLinea.lote),
    selectinload(Remito.lineas).selectinload(RemitoLinea.cosecha),
    selectinload(Remito.comprobante_bodega),
)


def _comprobante_response(comprobante: ComprobanteBodega, remito: Remito) -> ComprobanteBodegaResponse:
    return ComprobanteBodegaResponse(
        id=comprobante.id,
        remito_id=comprobante.remito_id,
        numero_suv=comprobante.numero_suv,
        kg_recibidos=comprobante.kg_recibidos,
        fecha=comprobante.fecha,
        observaciones=comprobante.observaciones,
        diferencia_kg=comprobante.kg_recibidos - remito.kg_total,
        created_at=comprobante.created_at,
    )


def _lote_label(lote: Lote) -> str:
    return f"{lote.temporada} · {lote.variedad.value} · {lote.calidad} · N°{lote.numero}"


def _linea_response(linea: RemitoLinea, origenes: dict[str, str]) -> RemitoLineaResponse:
    resp = RemitoLineaResponse.model_validate(linea)
    if linea.lote is not None:
        resp.lote_label = _lote_label(linea.lote)
    if linea.cosecha is not None:
        partes = [linea.cosecha.fecha.isoformat()]
        if linea.cosecha.variedad:
            partes.append(linea.cosecha.variedad)
        origen = origenes.get(linea.cosecha.id) or linea.cosecha.proveedor_tercero
        if origen:
            partes.append(origen)
        resp.cosecha_label = " · ".join(partes)
    return resp


async def _origenes_cosecha(db: AsyncSession, remitos: list[Remito]) -> dict[str, str]:
    """Nombre de parcela (o productor) por cosecha, con 2 queries para todos los remitos."""
    cosechas = {
        linea.cosecha.id: linea.cosecha
        for r in remitos
        for linea in r.lineas
        if linea.cosecha is not None
    }
    parcela_ids = {c.parcela_id for c in cosechas.values() if c.parcela_id}
    productor_ids = {c.productor_id for c in cosechas.values() if c.productor_id}
    parcelas: dict[str, str] = {}
    productores: dict[str, str] = {}
    if parcela_ids:
        parcelas = dict((await db.execute(
            select(Parcela.id, Parcela.nombre).where(Parcela.id.in_(parcela_ids))
        )).all())
    if productor_ids:
        productores = dict((await db.execute(
            select(Productor.id, Productor.nombre).where(Productor.id.in_(productor_ids))
        )).all())
    origenes: dict[str, str] = {}
    for cid, c in cosechas.items():
        nombre = parcelas.get(c.parcela_id) if c.parcela_id else None
        nombre = nombre or (productores.get(c.productor_id) if c.productor_id else None)
        if nombre:
            origenes[cid] = nombre
    return origenes


def _remito_response(remito: Remito, origenes: dict[str, str]) -> RemitoResponse:
    comprobante = remito.comprobante_bodega
    return RemitoResponse(
        id=remito.id,
        tipo=remito.tipo,
        numero=remito.numero,
        fecha=remito.fecha,
        comprador_id=remito.comprador_id,
        kg_total=remito.kg_total,
        vehiculo_patente=remito.vehiculo_patente,
        observaciones=remito.observaciones,
        created_at=remito.created_at,
        lineas=[_linea_response(linea, origenes) for linea in remito.lineas],
        comprobante_bodega=_comprobante_response(comprobante, remito) if comprobante else None,
    )


async def _get_remito(db: AsyncSession, remito_id: str) -> Remito:
    remito = (
        await db.execute(
            select(Remito)
            .options(*_LOAD_OPTS)
            .where(Remito.id == remito_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if remito is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Remito not found")
    return remito


@router.get("/", response_model=list[RemitoResponse])
async def list_remitos(
    tipo: TipoRemito | None = Query(None),
    comprador_id: str | None = Query(None),
    desde: date | None = Query(None),
    hasta: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[RemitoResponse]:
    stmt = (
        select(Remito)
        .options(*_LOAD_OPTS)
        .order_by(Remito.fecha.desc(), Remito.created_at.desc())
    )
    if tipo:
        stmt = stmt.where(Remito.tipo == tipo)
    if comprador_id:
        stmt = stmt.where(Remito.comprador_id == comprador_id)
    if desde:
        stmt = stmt.where(Remito.fecha >= desde)
    if hasta:
        stmt = stmt.where(Remito.fecha <= hasta)
    remitos = list((await db.execute(stmt)).scalars().all())
    origenes = await _origenes_cosecha(db, remitos)
    return [_remito_response(r, origenes) for r in remitos]


@router.post("/", response_model=RemitoResponse, status_code=status.HTTP_201_CREATED)
async def create_remito(
    data: RemitoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> RemitoResponse:
    if await db.get(Comprador, data.comprador_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprador not found")

    entrega_pasa = data.tipo == TipoRemito.entrega_pasa
    for linea in data.lineas:
        if entrega_pasa and (linea.lote_id is None or linea.cosecha_id is not None):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Una entrega de pasa descuenta de lotes: cada línea lleva solo lote_id",
            )
        if not entrega_pasa and (linea.cosecha_id is None or linea.lote_id is not None):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Una salida de fresco/bodega descuenta de cosecha: cada línea lleva solo cosecha_id",
            )

    # Total pedido por fuente (una misma fuente puede repetirse en varias líneas).
    pedido: dict[str, Decimal] = defaultdict(Decimal)
    for linea in data.lineas:
        pedido[linea.lote_id if entrega_pasa else linea.cosecha_id] += linea.kg  # type: ignore[index]

    if entrega_pasa:
        # Orden determinístico: dos remitos sobre los mismos lotes no se traban.
        for lote_id, kg in sorted(pedido.items()):
            lote = (
                await db.execute(select(Lote).where(Lote.id == lote_id).with_for_update())
            ).scalar_one_or_none()
            if lote is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Lote {lote_id} not found")
            if lote.estado != EstadoLote.cerrado:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="Solo se entrega pasa de lotes cerrados"
                )
            if kg > lote.saldo_kg:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"El lote {lote.numero} tiene saldo {lote.saldo_kg} kg; se piden {kg} kg",
                )
            lote.saldo_kg -= kg
    else:
        for cosecha_id, kg in sorted(pedido.items()):
            # Lock de la cosecha: su saldo es derivado (suma de líneas), así que
            # sin esto dos remitos simultáneos despachan más de lo cosechado.
            cosecha = (
                await db.execute(
                    select(RegistroCosecha).where(RegistroCosecha.id == cosecha_id).with_for_update()
                )
            ).scalar_one_or_none()
            if cosecha is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail=f"Registro de cosecha {cosecha_id} not found"
                )
            if cosecha.destino not in DESTINOS_POR_TIPO[data.tipo]:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"La cosecha tiene destino {cosecha.destino.value}, "
                    f"incompatible con un remito {data.tipo.value}",
                )
            saldo = await saldo_cosecha(db, cosecha)
            if kg > saldo:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"La cosecha tiene {saldo} kg sin despachar; se piden {kg} kg",
                )

    numero = data.numero or await siguiente_numero_remito(db, data.tipo)
    duplicado = await db.scalar(
        select(Remito.id).where(Remito.tipo == data.tipo, Remito.numero == numero)
    )
    if duplicado is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Ya existe el remito {numero} de tipo {data.tipo.value}"
        )

    remito = Remito(
        tipo=data.tipo,
        numero=numero,
        fecha=data.fecha,
        comprador_id=data.comprador_id,
        kg_total=sum((linea.kg for linea in data.lineas), Decimal("0")),
        vehiculo_patente=data.vehiculo_patente,
        observaciones=data.observaciones,
        created_by=current_user.id,
        lineas=[
            RemitoLinea(lote_id=linea.lote_id, cosecha_id=linea.cosecha_id, kg=linea.kg)
            for linea in data.lineas
        ],
    )
    db.add(remito)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Ya existe el remito {numero} de tipo {data.tipo.value}"
        ) from exc
    creado = await _get_remito(db, remito.id)
    return _remito_response(creado, await _origenes_cosecha(db, [creado]))


@router.get("/{remito_id}", response_model=RemitoResponse)
async def get_remito(
    remito_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RemitoResponse:
    remito = await _get_remito(db, remito_id)
    return _remito_response(remito, await _origenes_cosecha(db, [remito]))


@router.post(
    "/{remito_id}/comprobante-bodega",
    response_model=ComprobanteBodegaResponse,
    status_code=status.HTTP_201_CREATED,
)
async def cargar_comprobante_bodega(
    remito_id: str,
    data: ComprobanteBodegaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> ComprobanteBodegaResponse:
    remito = await _get_remito(db, remito_id)
    if remito.tipo != TipoRemito.salida_bodega:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El comprobante INV solo aplica a remitos de salida a bodega",
        )
    if remito.comprobante_bodega is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="El remito ya tiene un comprobante cargado"
        )
    comprobante = ComprobanteBodega(
        remito_id=remito.id,
        numero_suv=data.numero_suv,
        kg_recibidos=data.kg_recibidos,
        fecha=data.fecha,
        observaciones=data.observaciones,
        created_by=current_user.id,
    )
    db.add(comprobante)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="El remito ya tiene un comprobante cargado"
        ) from exc
    await db.refresh(comprobante)
    return _comprobante_response(comprobante, remito)
