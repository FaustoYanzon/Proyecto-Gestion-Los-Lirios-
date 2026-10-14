"""Lotes de pasa: abrir, agregar bines (levantada) y cerrar.

Un lote es de una sola variedad; hay a lo sumo un lote abierto por
variedad+calidad (lotes en paralelo, uno por variedad en levantada). Cada bin
descuenta `kg x ratio_uva_pasa` de uva fresca del pasero indicado.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_up
from app.core.pdf_lote import (
    BinFilaPdf,
    DatosLotePdf,
    DatosTarjaPdf,
    generar_pdf_lote,
    generar_pdf_tarja,
)
from app.core.security import (
    LOTE_PDF_TOKEN_TTL_SECONDS,
    create_lote_pdf_token,
    decode_lote_pdf_token,
)
from app.models.alta_produccion import Bin, Deposito, EstadoLote, Lote
from app.models.parcela import Parcela, VariedadUva
from app.models.user import User
from app.schemas.alta_produccion import (
    BinCreate,
    BinResponse,
    LoteCierre,
    LoteCreate,
    LoteDetalleResponse,
    LoteResponse,
    RemitoPdfLinkResponse,
)
from app.services import mermas
from app.services.alta_produccion import (
    Parametros,
    deposito_unico_id,
    get_parametros,
    get_pasero_or_404,
    siguiente_numero_lote,
    tarja_bin,
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
        # El depósito es único y no se elige: se asigna solo.
        deposito_id=await deposito_unico_id(db),
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


def _variedad_label(variedad: VariedadUva) -> str:
    return str(getattr(variedad, "value", variedad)).replace("_", " ").title()


def _nro_bin(lote: Lote, bin_id: str) -> int:
    for i, b in enumerate(lote.bines, start=1):
        if b.id == bin_id:
            return i
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bin not found")


async def _pdf_tarja(db: AsyncSession, lote_id: str, bin_id: str) -> Response:
    lote = await _get_lote(db, lote_id)
    nro = _nro_bin(lote, bin_id)
    b = lote.bines[nro - 1]
    pdf = generar_pdf_tarja(
        DatosTarjaPdf(
            tarja=b.tarja,
            fecha=b.fecha,
            variedad=_variedad_label(lote.variedad),
            calidad=lote.calidad,
            temporada=lote.temporada,
            lote_numero=lote.numero,
            bin_numero=nro,
            bin_total=lote.tope_bines,
            kg=b.kg_real,
            observaciones=b.observaciones,
        )
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="tarja-{b.tarja}.pdf"'},
    )


async def _pdf_lote(db: AsyncSession, lote_id: str) -> Response:
    lote = await _get_lote(db, lote_id)
    if lote.estado != EstadoLote.cerrado:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La hoja del lote se imprime cuando el lote está completo (cerrado)",
        )
    params = await get_parametros(db)
    ids = {b.pasero_id for b in lote.bines}
    paseros = (
        {p.id: p.nombre for p in (await db.execute(select(Parcela).where(Parcela.id.in_(ids)))).scalars()}
        if ids
        else {}
    )
    deposito = await db.get(Deposito, lote.deposito_id) if lote.deposito_id else None
    cantidad = len(lote.bines)
    pdf = generar_pdf_lote(
        DatosLotePdf(
            variedad=_variedad_label(lote.variedad),
            calidad=lote.calidad,
            temporada=lote.temporada,
            numero=lote.numero,
            estado="Cerrado",
            deposito=deposito.nombre if deposito else None,
            abierto_el=lote.created_at.date(),
            cerrado_el=lote.closed_at.date() if lote.closed_at else None,
            tope_bines=lote.tope_bines,
            kg_total=lote.kg_total,
            kg_nominal_total=params.kg_nominal_bin * cantidad,
            merma_kg=mermas.merma_bines(cantidad, params.kg_nominal_bin, lote.kg_total),
            bines=[
                BinFilaPdf(
                    numero=i,
                    tarja=b.tarja,
                    fecha=b.fecha,
                    pasero=paseros.get(b.pasero_id, "–"),
                    kg=b.kg_real,
                    observaciones=b.observaciones,
                )
                for i, b in enumerate(lote.bines, start=1)
            ],
        )
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="lote-{lote.temporada}-{lote.numero}.pdf"'
        },
    )


# Estática ANTES de /{lote_id}. Sin Authorization: la autoriza el token firmado.
@router.get("/descarga/{token}")
async def descargar_pdf_firmado(token: str, db: AsyncSession = Depends(get_db)) -> Response:
    datos = decode_lote_pdf_token(token)
    if datos is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Link inválido o vencido")
    kind, lote_id, bin_id = datos
    if kind == "tarja" and bin_id:
        return await _pdf_tarja(db, lote_id, bin_id)
    return await _pdf_lote(db, lote_id)


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
            tarja=tarja_bin(lote, len(lote.bines) + 1),
            pasero_id=data.pasero_id,
            fecha=data.fecha or date.today(),
            kg_real=data.kg_real,
            observaciones=(data.observaciones or "").strip() or None,
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
    if lote.deposito_id is None:
        # Lotes viejos sin depósito: se les asigna el único. `data` se acepta
        # por compatibilidad pero el depósito ya no se elige.
        lote.deposito_id = await deposito_unico_id(db)
    _cerrar(lote)
    await db.flush()
    lote = await _get_lote(db, lote.id)
    return _lote_response(lote, await get_parametros(db))


@router.get("/{lote_id}/pdf")
async def pdf_lote(
    lote_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Response:
    """Hoja del lote con el listado de bines (solo lotes completos / cerrados)."""
    return await _pdf_lote(db, lote_id)


@router.get("/{lote_id}/bines/{bin_id}/tarja-pdf")
async def pdf_tarja(
    lote_id: str,
    bin_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Response:
    """Tarja del bin: media hoja A4 horizontal con los datos de los dos lados."""
    return await _pdf_tarja(db, lote_id, bin_id)


def _link(request: Request, token: str) -> RemitoPdfLinkResponse:
    path = f"/lotes-pasa/descarga/{token}"
    return RemitoPdfLinkResponse(
        path=path,
        url=f"{str(request.base_url).rstrip('/')}{path}",
        expires_in=LOTE_PDF_TOKEN_TTL_SECONDS,
    )


@router.post("/{lote_id}/pdf-link", response_model=RemitoPdfLinkResponse)
async def pdf_lote_link(
    lote_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RemitoPdfLinkResponse:
    """Link firmado de 5 min para abrir la hoja del lote desde mobile con Linking."""
    lote = await _get_lote(db, lote_id)
    return _link(request, create_lote_pdf_token("lote", lote.id))


@router.post("/{lote_id}/bines/{bin_id}/tarja-pdf-link", response_model=RemitoPdfLinkResponse)
async def pdf_tarja_link(
    lote_id: str,
    bin_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RemitoPdfLinkResponse:
    lote = await _get_lote(db, lote_id)
    _nro_bin(lote, bin_id)
    return _link(request, create_lote_pdf_token("tarja", lote.id, bin_id))
