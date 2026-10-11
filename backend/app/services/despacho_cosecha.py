"""Despacho de cosecha ("De -> Para"): un único alta transaccional que crea el
`RegistroCosecha` y, según el destino, un `Remito` (bodega -> BOD, comprador ->
FRE, pasero -> TRA) y, para pasero, el `IngresoPasero`.

No hace commit: lo hace `get_db`. Cualquier error levanta `HTTPException` y la
sesión se descarta entera (no queda cosecha sin remito)."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alta_produccion import (
    Comprador,
    IngresoPasero,
    Productor,
    Remito,
    RemitoLinea,
    TipoRemito,
)
from app.models.parcela import Parcela, TipoParcela, VariedadUva
from app.models.produccion import (
    CultivoCosecha,
    DestinoCosecha,
    OrigenCosecha,
    RegistroCosecha,
)
from app.schemas.alta_produccion import (
    DespachoCosechaCreate,
    IngresoPaseroCreate,
    ParaDespacho,
)
from app.services.alta_produccion import (
    get_pasero_or_404,
    registrar_ingreso_pasero,
    siguiente_numero_remito,
)

# Destino de `RegistroCosecha` según el "Para". PROVISIONAL: "comprador" se
# registra como MI (mercado interno); la distinción mercado interno /
# exportación está en stand-by (a definir con Fausto). Para pasero se usa
# RAMA_PASA: PASAS queda solo para el histórico.
DESTINO_COSECHA_POR_PARA: dict[ParaDespacho, DestinoCosecha] = {
    ParaDespacho.bodega: DestinoCosecha.bodega,
    ParaDespacho.comprador: DestinoCosecha.mercado_interno,
    ParaDespacho.pasero: DestinoCosecha.rama_pasa,
}

TIPO_REMITO_POR_PARA: dict[ParaDespacho, TipoRemito] = {
    ParaDespacho.bodega: TipoRemito.salida_bodega,
    ParaDespacho.comprador: TipoRemito.salida_fresco,
    ParaDespacho.pasero: TipoRemito.traslado_pasero,
}

CENTAVO = Decimal("0.01")


@dataclass
class ResultadoDespacho:
    cosecha: RegistroCosecha
    remito: Remito
    ingreso: IngresoPasero | None


def _422(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def calcular_kg(data: DespachoCosechaCreate) -> Decimal:
    """Mismo criterio que `RegistroCosecha`: kg directo, o envases, o bruto - tara."""
    if data.kg_total is not None:
        kg = data.kg_total
    elif data.cantidad_envases is not None and data.peso_unitario_kg is not None:
        kg = data.cantidad_envases * data.peso_unitario_kg
    else:
        kg = data.bruto_kg - data.tara_kg  # type: ignore[operator]
    kg = kg.quantize(CENTAVO, rounding=ROUND_HALF_UP)
    if kg <= 0:
        raise _422("El peso a despachar debe ser mayor a cero (revisá bruto y tara)")
    if kg > Decimal("999999999999.99"):
        raise _422("El peso es demasiado grande")
    return kg


async def _buscar_por_key(db: AsyncSession, key: str) -> RegistroCosecha | None:
    return (
        await db.execute(select(RegistroCosecha).where(RegistroCosecha.idempotency_key == key))
    ).scalars().first()


def _conflicto_payload() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Esa clave de idempotencia ya se usó con otros datos",
    )


async def _resultado_existente(
    db: AsyncSession, cosecha: RegistroCosecha, data: DespachoCosechaCreate
) -> ResultadoDespacho:
    """Reenvío con la misma idempotency_key: devuelve lo ya creado, siempre que
    el payload coincida con lo persistido (fecha, para/destino, parcela o
    productor, kg, comprador o pasero). Si no, 409: la clave es de otro envío."""
    remito = (
        await db.execute(
            select(Remito)
            .join(RemitoLinea, RemitoLinea.remito_id == Remito.id)
            .where(RemitoLinea.cosecha_id == cosecha.id)
            .order_by(Remito.created_at)
        )
    ).scalars().first()
    if remito is None:
        # Cosecha creada por POST /cosecha/ con esa key: no hay despacho que devolver.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La idempotency_key ya fue usada por un alta de cosecha sin despacho",
        )
    kg_guardado = Decimal(str(cosecha.kg_total)).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    coincide = (
        cosecha.fecha == data.fecha
        and cosecha.destino == DESTINO_COSECHA_POR_PARA[data.para]
        and remito.tipo == TIPO_REMITO_POR_PARA[data.para]
        and cosecha.origen == data.origen
        and cosecha.parcela_id == data.parcela_id
        and cosecha.productor_id == data.productor_id
        and cosecha.comprador_id == data.comprador_id
        and remito.pasero_id == (data.pasero_id if data.para == ParaDespacho.pasero else None)
        and calcular_kg(data) == kg_guardado
    )
    if not coincide:
        raise _conflicto_payload()
    ingreso = (
        await db.execute(select(IngresoPasero).where(IngresoPasero.cosecha_id == cosecha.id))
    ).scalars().first()
    return ResultadoDespacho(cosecha=cosecha, remito=remito, ingreso=ingreso)


async def registrar_despacho(
    db: AsyncSession, data: DespachoCosechaCreate, user_id: str
) -> ResultadoDespacho:
    if data.idempotency_key:
        existente = await _buscar_por_key(db, data.idempotency_key)
        if existente is not None:
            return await _resultado_existente(db, existente, data)

    # ── DE ──
    parcela: Parcela | None = None
    productor: Productor | None = None
    if data.origen == OrigenCosecha.propio:
        if data.productor_id is not None:
            raise _422("Un despacho de origen propio no lleva productor: indicá el parral")
        if data.parcela_id is None:
            raise _422("Un despacho de origen propio requiere parcela_id (parral)")
        parcela = await db.get(Parcela, data.parcela_id)
        if parcela is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcela not found")
        if parcela.tipo != TipoParcela.parral or not parcela.is_active:
            raise _422("El origen propio debe ser un parral activo")
        variedad: VariedadUva | None = data.variedad or parcela.variedad
        if variedad is None:
            raise _422("El parral no tiene variedad cargada: indicá la variedad")
    else:
        if data.para != ParaDespacho.pasero:
            raise _422("La cosecha de terceros solo puede ir al pasero")
        if data.parcela_id is not None:
            raise _422("Un despacho de terceros no lleva parcela: indicá el productor")
        if data.productor_id is None:
            raise _422("Un despacho de origen tercero requiere productor_id")
        productor = await db.get(Productor, data.productor_id)
        if productor is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Productor not found")
        if data.variedad is None:
            raise _422("Un despacho de origen tercero requiere la variedad")
        variedad = data.variedad

    # ── PARA ──
    comprador: Comprador | None = None
    if data.para == ParaDespacho.pasero:
        if data.pasero_id is None:
            raise _422("Un despacho al pasero requiere pasero_id")
        if data.comprador_id is not None:
            raise _422("Un despacho al pasero no lleva comprador")
        await get_pasero_or_404(db, data.pasero_id)
    else:
        if data.pasero_id is not None or data.ubicacion_id is not None:
            raise _422("pasero_id y ubicacion_id solo aplican a un despacho al pasero")
        if data.comprador_id is None:
            etiqueta = "la bodega" if data.para == ParaDespacho.bodega else "el comprador"
            raise _422(f"Indicá {etiqueta} (comprador_id)")
        comprador = await db.get(Comprador, data.comprador_id)
        if comprador is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprador not found")

    kg = calcular_kg(data)

    # ── Cosecha ──
    cosecha = RegistroCosecha(
        fecha=data.fecha,
        parcela_id=parcela.id if parcela else None,
        cultivo=CultivoCosecha.vid,
        variedad=variedad.value,
        origen=data.origen,
        proveedor_tercero=productor.nombre if productor else None,
        productor_id=productor.id if productor else None,
        n_remito=data.n_remito,
        n_ciu=data.n_ciu,
        destino=DESTINO_COSECHA_POR_PARA[data.para],
        comprador=comprador.nombre if comprador else None,
        comprador_id=comprador.id if comprador else None,
        cuadrilla=data.cuadrilla,
        acarreo=data.acarreo,
        vehiculo_patente=data.vehiculo_patente,
        tipo_envase=data.tipo_envase,
        cantidad_envases=float(data.cantidad_envases) if data.cantidad_envases is not None else None,
        peso_unitario_kg=float(data.peso_unitario_kg) if data.peso_unitario_kg is not None else None,
        bruto_kg=float(data.bruto_kg) if data.bruto_kg is not None else None,
        tara_kg=float(data.tara_kg) if data.tara_kg is not None else None,
        kg_total=float(kg),
        imagen_remito_url=data.imagen_remito_url,
        observaciones=data.observaciones,
        idempotency_key=data.idempotency_key,
        created_by=user_id,
    )
    try:
        # SAVEPOINT: si pierde la carrera con otro envío de la misma
        # idempotency_key, solo se descarta este INSERT y la sesión sigue viva.
        async with db.begin_nested():
            db.add(cosecha)
            await db.flush()
    except IntegrityError as exc:
        existente = await _buscar_por_key(db, data.idempotency_key) if data.idempotency_key else None
        if existente is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No se pudo registrar el despacho; reintentá",
            ) from exc
        # El otro envío ya quedó commiteado: devolver lo suyo (201), no un 409.
        return await _resultado_existente(db, existente, data)

    # ── Remito (una línea) ──
    tipo = TIPO_REMITO_POR_PARA[data.para]
    numero = await siguiente_numero_remito(db, tipo)
    remito = Remito(
        tipo=tipo,
        numero=numero,
        fecha=data.fecha,
        comprador_id=comprador.id if comprador else None,
        pasero_id=data.pasero_id if data.para == ParaDespacho.pasero else None,
        kg_total=kg,
        vehiculo_patente=data.vehiculo_patente,
        observaciones=data.observaciones,
        created_by=user_id,
        lineas=[RemitoLinea(cosecha_id=cosecha.id, kg=kg)],
    )
    db.add(remito)
    if cosecha.n_remito is None:
        cosecha.n_remito = numero

    # ── Ingreso al pasero ──
    ingreso: IngresoPasero | None = None
    try:
        await db.flush()
        if data.para == ParaDespacho.pasero:
            ingreso = await registrar_ingreso_pasero(
                db,
                IngresoPaseroCreate(
                    fecha=data.fecha,
                    pasero_id=data.pasero_id,  # type: ignore[arg-type]
                    variedad=variedad,
                    # Se pesa una sola vez, al salir del parral.
                    kg_real=kg,
                    carros=data.carros,
                    carro_incompleto=data.carro_incompleto,
                    origen=data.origen,
                    productor_id=productor.id if productor else None,
                    ubicacion_id=data.ubicacion_id,
                    cosecha_id=cosecha.id,
                    observaciones=data.observaciones,
                ),
                user_id,
                desde_despacho=True,
            )
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El despacho ya fue registrado o el número de remito se repite; reintentá",
        ) from exc

    await db.refresh(cosecha)
    await db.refresh(remito)
    return ResultadoDespacho(cosecha=cosecha, remito=remito, ingreso=ingreso)
