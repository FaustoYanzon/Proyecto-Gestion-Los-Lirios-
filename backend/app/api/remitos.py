"""Remitos: consulta/PDF de todos los tipos, alta manual solo de entrega de pasa, y
comprobante INV (SUV + kg recibidos) que concilia un remito a bodega.

- salida_fresco / salida_bodega / traslado_pasero: nacen únicamente del despacho de
  cosecha (`POST /produccion/cosecha/despacho`); acá solo se consultan y se imprimen.
- entrega_pasa: cada línea descuenta del saldo de un `Lote` cerrado
  (entregas parciales) y se crea con `POST /remitos/`.
"""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_estricto
from app.core.pdf_remito import DatosRemitoPdf, generar_pdf_remito
from app.core.security import (
    REMITO_PDF_TOKEN_TTL_SECONDS,
    create_remito_pdf_token,
    decode_remito_pdf_token,
)
from app.models.alta_produccion import (
    Bin,
    Comprador,
    ComprobanteBodega,
    EstadoLote,
    IngresoPasero,
    Lote,
    Productor,
    UbicacionPasero,
    Remito,
    RemitoLinea,
    TipoRemito,
)
from app.models.parcela import Parcela
from app.models.produccion import OrigenCosecha
from app.models.user import User
from app.schemas.alta_produccion import (
    ComprobanteBodegaCreate,
    ComprobanteBodegaResponse,
    RemitoCreate,
    RemitoLineaResponse,
    RemitoPdfLinkResponse,
    RemitoResponse,
)
from app.services.alta_produccion import siguiente_numero_remito

router = APIRouter(prefix="/remitos", tags=["Remitos"])

_LOAD_OPTS = (
    selectinload(Remito.lineas).selectinload(RemitoLinea.lote),
    selectinload(Remito.lineas).selectinload(RemitoLinea.bin),
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
    if linea.bin is not None:
        resp.tarja = linea.bin.tarja
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


async def _destinatarios(db: AsyncSession, remitos: list[Remito]) -> dict[str, str]:
    """Nombre de comprador / pasero por id (2 queries para todos los remitos).
    Los ids son UUID, así que comparten un solo diccionario."""
    comprador_ids = {r.comprador_id for r in remitos if r.comprador_id}
    pasero_ids = {r.pasero_id for r in remitos if r.pasero_id}
    nombres: dict[str, str] = {}
    if comprador_ids:
        nombres.update(dict((await db.execute(
            select(Comprador.id, Comprador.nombre).where(Comprador.id.in_(comprador_ids))
        )).all()))
    if pasero_ids:
        nombres.update(dict((await db.execute(
            select(Parcela.id, Parcela.nombre).where(Parcela.id.in_(pasero_ids))
        )).all()))
    return nombres


def _remito_response(
    remito: Remito, origenes: dict[str, str], destinatarios: dict[str, str] | None = None
) -> RemitoResponse:
    comprobante = remito.comprobante_bodega
    destinatarios = destinatarios or {}
    return RemitoResponse(
        id=remito.id,
        tipo=remito.tipo,
        numero=remito.numero,
        fecha=remito.fecha,
        comprador_id=remito.comprador_id,
        pasero_id=remito.pasero_id,
        comprador_nombre=destinatarios.get(remito.comprador_id) if remito.comprador_id else None,
        pasero_nombre=destinatarios.get(remito.pasero_id) if remito.pasero_id else None,
        kg_total=remito.kg_total,
        vehiculo_patente=remito.vehiculo_patente,
        observaciones=remito.observaciones,
        created_at=remito.created_at,
        lineas=[_linea_response(linea, origenes) for linea in remito.lineas],
        comprobante_bodega=_comprobante_response(comprobante, remito) if comprobante else None,
    )


async def remito_response_completo(db: AsyncSession, remito_id: str) -> RemitoResponse:
    """Remito recién creado/leído con líneas, labels y destinatario."""
    remito = await _get_remito(db, remito_id)
    return _remito_response(
        remito, await _origenes_cosecha(db, [remito]), await _destinatarios(db, [remito])
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
    pasero_id: str | None = Query(None),
    desde: date | None = Query(None),
    hasta: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_estricto),
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
    if pasero_id:
        stmt = stmt.where(Remito.pasero_id == pasero_id)
    if desde:
        stmt = stmt.where(Remito.fecha >= desde)
    if hasta:
        stmt = stmt.where(Remito.fecha <= hasta)
    remitos = list((await db.execute(stmt)).scalars().all())
    origenes = await _origenes_cosecha(db, remitos)
    destinatarios = await _destinatarios(db, remitos)
    return [_remito_response(r, origenes, destinatarios) for r in remitos]


@router.post("/", response_model=RemitoResponse, status_code=status.HTTP_201_CREATED)
async def create_remito(
    data: RemitoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> RemitoResponse:
    if data.tipo != TipoRemito.entrega_pasa:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Los remitos de fresco, bodega y traslado a pasero se generan con "
            "POST /produccion/cosecha/despacho; acá solo se crean entregas de pasa",
        )
    if await db.get(Comprador, data.comprador_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprador not found")

    # Entrega por bin: cada línea es un bin/bolsón y sus kg son su peso real.
    for linea in data.lineas:
        if linea.bin_id is None or linea.lote_id is not None or linea.cosecha_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Una entrega de pasa se arma por bines: cada línea lleva solo bin_id",
            )
    bin_ids = [linea.bin_id for linea in data.lineas]
    if len(set(bin_ids)) != len(bin_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Hay bines repetidos en la entrega"
        )
    bines = {
        b.id: b for b in (await db.execute(select(Bin).where(Bin.id.in_(bin_ids)))).scalars().all()
    }
    faltantes = [i for i in bin_ids if i not in bines]
    if faltantes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bin {faltantes[0]} not found")

    # Orden determinístico: dos remitos sobre los mismos lotes no se traban.
    lotes: dict[str, Lote] = {}
    for lote_id in sorted({b.lote_id for b in bines.values()}):
        lote = (
            await db.execute(select(Lote).where(Lote.id == lote_id).with_for_update())
        ).scalar_one()
        if lote.estado != EstadoLote.cerrado:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Solo se entrega pasa de lotes cerrados"
            )
        lotes[lote_id] = lote

    ya_entregados = (
        await db.execute(select(RemitoLinea.bin_id).where(RemitoLinea.bin_id.in_(bin_ids)))
    ).scalars().all()
    if ya_entregados:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El bin {bines[ya_entregados[0]].tarja} ya fue entregado",
        )

    lineas: list[RemitoLinea] = []
    for bin_id in bin_ids:
        b = bines[bin_id]
        lotes[b.lote_id].saldo_kg -= b.kg_real
        lineas.append(RemitoLinea(lote_id=b.lote_id, bin_id=b.id, kg=b.kg_real))

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
        kg_total=sum((linea.kg for linea in lineas), Decimal("0")),
        vehiculo_patente=data.vehiculo_patente,
        observaciones=data.observaciones,
        created_by=current_user.id,
        lineas=lineas,
    )
    db.add(remito)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe el remito {numero} de tipo {data.tipo.value}, o un bin ya fue entregado",
        ) from exc
    return await remito_response_completo(db, remito.id)



# ── PDF (comprobante interno de entrega) ─────────────────────────────────────

PARA_TIPO_LABEL: dict[TipoRemito, str] = {
    TipoRemito.salida_fresco: "Comprador",
    TipoRemito.salida_bodega: "Bodega",
    TipoRemito.entrega_pasa: "Comprador",
    TipoRemito.traslado_pasero: "Pasero",
}
PARA_DESTINO_LABEL: dict[TipoRemito, str] = {
    TipoRemito.salida_fresco: "Venta a comprador",
    TipoRemito.salida_bodega: "Bodega",
    TipoRemito.entrega_pasa: "Entrega de pasa",
    TipoRemito.traslado_pasero: "Traslado a pasero",
}


def _titulo(texto: str | None) -> str | None:
    return texto.replace("_", " ").title() if texto else None


async def _datos_pdf(db: AsyncSession, remito: Remito) -> DatosRemitoPdf:
    origenes = await _origenes_cosecha(db, [remito])
    destinatarios = await _destinatarios(db, [remito])
    cosechas = {ln.cosecha.id: ln.cosecha for ln in remito.lineas if ln.cosecha is not None}

    propio, de_nombre, variedad = True, "Varios orígenes", None
    temporada = remito.fecha.year if remito.fecha.month >= 5 else remito.fecha.year - 1
    extra: dict[str, str | None] = {"cuadrilla": None, "acarreo": None, "n_ciu": None}
    cosecha = next(iter(cosechas.values())) if len(cosechas) == 1 else None
    if cosecha is not None:
        propio = cosecha.origen == OrigenCosecha.propio
        de_nombre = origenes.get(cosecha.id) or cosecha.proveedor_tercero or "—"
        variedad = _titulo(cosecha.variedad)
        temporada = cosecha.temporada
        extra = {"cuadrilla": cosecha.cuadrilla, "acarreo": cosecha.acarreo, "n_ciu": cosecha.n_ciu}

    lineas: list[tuple[date, str, Decimal]] = []
    for linea in remito.lineas:
        if linea.lote is not None:
            detalle = _lote_label(linea.lote)
            if linea.bin is not None:
                detalle += f" · Tarja {linea.bin.tarja}"
        elif linea.cosecha is not None:
            partes = [
                p for p in (
                    _titulo(linea.cosecha.variedad),
                    origenes.get(linea.cosecha.id) or linea.cosecha.proveedor_tercero,
                ) if p
            ]
            detalle = " · ".join(partes) or "Cosecha"
        else:
            detalle = "—"
        lineas.append((remito.fecha, detalle, linea.kg))

    es_pasero = remito.tipo == TipoRemito.traslado_pasero
    carros: int | None = None
    fichas: int | None = None
    carro_incompleto = False
    ubicacion: str | None = None
    if es_pasero and cosecha is not None:
        ingreso = (
            await db.execute(select(IngresoPasero).where(IngresoPasero.cosecha_id == cosecha.id))
        ).scalars().first()
        if ingreso is not None:
            carros, fichas = ingreso.carros, ingreso.fichas
            carro_incompleto = ingreso.carro_incompleto
            if ingreso.ubicacion_id:
                ub = await db.get(UbicacionPasero, ingreso.ubicacion_id)
                if ub is not None:
                    ubicacion = f"Hilera {ub.hilera} · Parte {ub.parte}"

    return DatosRemitoPdf(
        numero=remito.numero,
        fecha=remito.fecha,
        kg_total=remito.kg_total,
        origen_propio=propio,
        de_nombre=de_nombre,
        variedad=variedad,
        temporada=temporada,
        para_tipo_label=PARA_TIPO_LABEL[remito.tipo],
        para_nombre=destinatarios.get(remito.pasero_id or remito.comprador_id or ""),
        destino_label=PARA_DESTINO_LABEL[remito.tipo],
        es_pasero=es_pasero,
        lineas=lineas,
        carros=carros,
        fichas=fichas,
        carro_incompleto=carro_incompleto,
        ubicacion=ubicacion,
        vehiculo_patente=remito.vehiculo_patente,
        cuadrilla=extra["cuadrilla"],
        acarreo=extra["acarreo"],
        n_ciu=extra["n_ciu"],
        observaciones=remito.observaciones,
    )


async def _pdf_response(db: AsyncSession, remito_id: str) -> Response:
    remito = await _get_remito(db, remito_id)
    pdf = generar_pdf_remito(await _datos_pdf(db, remito))
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="remito-{remito.numero}.pdf"',
            "Cache-Control": "no-store",
        },
    )


# Estática ANTES de /{remito_id}. Sin Authorization: la autoriza el token firmado.
@router.get("/descarga/{token}")
async def descargar_pdf_firmado(token: str, db: AsyncSession = Depends(get_db)) -> Response:
    remito_id = decode_remito_pdf_token(token)
    if remito_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Link inválido o vencido")
    return await _pdf_response(db, remito_id)


@router.get("/{remito_id}", response_model=RemitoResponse)
async def get_remito(
    remito_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_estricto),
) -> RemitoResponse:
    return await remito_response_completo(db, remito_id)


@router.post(
    "/{remito_id}/comprobante-bodega",
    response_model=ComprobanteBodegaResponse,
    status_code=status.HTTP_201_CREATED,
)
async def cargar_comprobante_bodega(
    remito_id: str,
    data: ComprobanteBodegaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
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


@router.get("/{remito_id}/pdf")
async def pdf_remito(
    remito_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_estricto),
) -> Response:
    return await _pdf_response(db, remito_id)


@router.post("/{remito_id}/pdf-link", response_model=RemitoPdfLinkResponse)
async def pdf_link_remito(
    remito_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_estricto),
) -> RemitoPdfLinkResponse:
    """Link firmado de vida corta (5 min, solo lectura de este remito) para
    abrir el PDF desde mobile con Linking, sin header Authorization."""
    remito = await _get_remito(db, remito_id)
    path = f"/remitos/descarga/{create_remito_pdf_token(remito.id)}"
    return RemitoPdfLinkResponse(
        path=path,
        url=f"{str(request.base_url).rstrip('/')}{path}",
        expires_in=REMITO_PDF_TOKEN_TTL_SECONDS,
    )
