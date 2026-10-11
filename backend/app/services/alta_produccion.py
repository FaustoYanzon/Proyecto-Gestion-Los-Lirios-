"""Consultas y reglas compartidas del módulo Alta de Producción: parámetros
configurables y saldos (uva en pasero, saldo de cosecha, numeración)."""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alta_produccion import (
    Bin,
    IngresoPasero,
    Lote,
    ParametroProduccion,
    Productor,
    Remito,
    RemitoLinea,
    TipoRemito,
    UbicacionPasero,
)
from app.models.parcela import Parcela, TipoParcela, VariedadUva
from app.models.produccion import DestinoCosecha, OrigenCosecha, RegistroCosecha
from app.schemas.alta_produccion import IngresoPaseroCreate
from app.services import mermas

# Destinos de cosecha que pueden ingresar al pasero (PASAS es histórico).
DESTINOS_PASA = {DestinoCosecha.pasas, DestinoCosecha.rama_pasa}

# Clave -> default. `tope_bines_lote` no tiene default: sin valor = sin tope
# (pendiente de definir con Fausto).
PARAMETROS_DEFAULT: dict[str, Decimal | None] = {
    "kg_por_ficha": Decimal("18"),
    "fichas_por_carro": Decimal("90"),
    "ratio_uva_pasa": Decimal("4"),
    "kg_nominal_bin": Decimal("350"),
    "tope_bines_lote": None,
}

PREFIJO_REMITO: dict[TipoRemito, str] = {
    TipoRemito.salida_fresco: "FRE",
    TipoRemito.salida_bodega: "BOD",
    TipoRemito.entrega_pasa: "PAS",
    TipoRemito.traslado_pasero: "TRA",
}


@dataclass(frozen=True)
class Parametros:
    kg_por_ficha: Decimal
    fichas_por_carro: int
    ratio_uva_pasa: Decimal
    kg_nominal_bin: Decimal
    tope_bines_lote: int | None


async def get_parametros(db: AsyncSession) -> Parametros:
    filas = (await db.execute(select(ParametroProduccion))).scalars().all()
    valores: dict[str, Decimal | None] = dict(PARAMETROS_DEFAULT)
    for fila in filas:
        if fila.clave in PARAMETROS_DEFAULT:
            valores[fila.clave] = fila.valor
    tope = valores["tope_bines_lote"]
    return Parametros(
        kg_por_ficha=valores["kg_por_ficha"],  # type: ignore[arg-type]
        fichas_por_carro=int(valores["fichas_por_carro"]),  # type: ignore[arg-type]
        ratio_uva_pasa=valores["ratio_uva_pasa"],  # type: ignore[arg-type]
        kg_nominal_bin=valores["kg_nominal_bin"],  # type: ignore[arg-type]
        tope_bines_lote=int(tope) if tope is not None else None,
    )


async def uva_ingresada(db: AsyncSession, pasero_id: str, variedad: VariedadUva) -> Decimal:
    total = await db.scalar(
        select(func.coalesce(func.sum(IngresoPasero.kg_real), 0)).where(
            IngresoPasero.pasero_id == pasero_id, IngresoPasero.variedad == variedad
        )
    )
    return Decimal(total)


async def pasa_levantada(db: AsyncSession, pasero_id: str, variedad: VariedadUva) -> Decimal:
    total = await db.scalar(
        select(func.coalesce(func.sum(Bin.kg_real), 0))
        .join(Lote, Lote.id == Bin.lote_id)
        .where(Bin.pasero_id == pasero_id, Lote.variedad == variedad)
    )
    return Decimal(total)


async def uva_consumida_pasero(db: AsyncSession, pasero_id: str, variedad: VariedadUva) -> Decimal:
    total = await db.scalar(
        select(func.coalesce(func.sum(Bin.uva_consumida_kg), 0))
        .join(Lote, Lote.id == Bin.lote_id)
        .where(Bin.pasero_id == pasero_id, Lote.variedad == variedad)
    )
    return Decimal(total)


async def uva_disponible(db: AsyncSession, pasero_id: str, variedad: VariedadUva) -> Decimal:
    """Uva fresca (kg de báscula) en el pasero para una variedad, menos la ya
    consumida por levantadas. El raqueo por ubicación queda para FASE 3."""
    return await uva_ingresada(db, pasero_id, variedad) - await uva_consumida_pasero(
        db, pasero_id, variedad
    )


async def saldos_cosecha(db: AsyncSession, cosechas: Sequence[RegistroCosecha]) -> dict[str, Decimal]:
    """Saldo (kg sin despachar) de varias cosechas con DOS queries agregadas.
    Única fuente de verdad: la usan el 409 de remitos y `saldo_kg`.

    saldo = kg_total - kg en líneas de remito FRE/BOD - kg ingresados al pasero
    (ingresos vinculados por `cosecha_id`). Las líneas de remitos TRA NO
    descuentan: el traslado a pasero se descuenta una sola vez, vía el
    `IngresoPasero` que lo acompaña (contarlo en ambos lados duplicaría)."""
    if not cosechas:
        return {}
    ids = [c.id for c in cosechas]
    filas = await db.execute(
        select(RemitoLinea.cosecha_id, func.coalesce(func.sum(RemitoLinea.kg), 0))
        .join(Remito, Remito.id == RemitoLinea.remito_id)
        .where(RemitoLinea.cosecha_id.in_(ids), Remito.tipo != TipoRemito.traslado_pasero)
        .group_by(RemitoLinea.cosecha_id)
    )
    despachado = {cid: Decimal(kg) for cid, kg in filas.all()}
    filas_ing = await db.execute(
        select(IngresoPasero.cosecha_id, func.coalesce(func.sum(IngresoPasero.kg_real), 0))
        .where(IngresoPasero.cosecha_id.in_(ids))
        .group_by(IngresoPasero.cosecha_id)
    )
    ingresado = {cid: Decimal(kg) for cid, kg in filas_ing.all()}
    # kg_total del histórico es Float: pasa por str para no arrastrar ruido binario.
    return {
        c.id: (
            Decimal(str(c.kg_total)) - despachado.get(c.id, Decimal("0")) - ingresado.get(c.id, Decimal("0"))
        ).quantize(Decimal("0.01"))
        for c in cosechas
    }


async def remitos_por_cosecha(
    db: AsyncSession, cosechas: Sequence[RegistroCosecha]
) -> dict[str, tuple[str, str]]:
    """Remito más reciente (por `Remito.created_at`) con alguna línea de cada
    cosecha, en UNA query. Devuelve {cosecha_id: (remito_id, remito_numero)};
    las cosechas sin remitos (históricas) no aparecen."""
    if not cosechas:
        return {}
    filas = await db.execute(
        select(RemitoLinea.cosecha_id, Remito.id, Remito.numero)
        .join(Remito, Remito.id == RemitoLinea.remito_id)
        .where(RemitoLinea.cosecha_id.in_([c.id for c in cosechas]))
        .order_by(Remito.created_at.asc(), Remito.id.asc())
    )
    # Orden ascendente: la última fila de cada cosecha es el remito más reciente.
    return {cid: (rid, numero) for cid, rid, numero in filas.all()}


async def saldo_cosecha(db: AsyncSession, cosecha: RegistroCosecha) -> Decimal:
    """Kg de un registro de cosecha que todavía no salieron en un remito."""
    return (await saldos_cosecha(db, [cosecha]))[cosecha.id]


async def siguiente_numero_lote(
    db: AsyncSession, temporada: int, variedad: VariedadUva, calidad: int
) -> int:
    maximo = await db.scalar(
        select(func.coalesce(func.max(Lote.numero), 0)).where(
            Lote.temporada == temporada, Lote.variedad == variedad, Lote.calidad == calidad
        )
    )
    return int(maximo) + 1


async def siguiente_numero_remito(db: AsyncSession, tipo: TipoRemito) -> str:
    # Dos altas simultáneas del mismo tipo calcularían el mismo número. En
    # Postgres se serializa por tipo con un lock de transacción (se libera solo
    # al commit/rollback), así el segundo cuenta recién cuando el primero
    # terminó y el operario no ve un 409. En SQLite (tests) no hace falta.
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:clave))"),
            {"clave": f"remito_numero:{tipo.value}"},
        )
    cantidad = await db.scalar(select(func.count()).select_from(Remito).where(Remito.tipo == tipo))
    secuencia = int(cantidad) + 1
    while True:
        numero = f"{PREFIJO_REMITO[tipo]}-{secuencia:06d}"
        existe = await db.scalar(
            select(func.count()).select_from(Remito).where(Remito.tipo == tipo, Remito.numero == numero)
        )
        if not existe:
            return numero
        secuencia += 1


async def get_pasero_or_404(db: AsyncSession, pasero_id: str, for_update: bool = False) -> Parcela:
    """`for_update` serializa las levantadas sobre el mismo pasero: la uva
    disponible es un saldo derivado, no una columna con su propio lock."""
    if for_update:
        pasero = (
            await db.execute(select(Parcela).where(Parcela.id == pasero_id).with_for_update())
        ).scalar_one_or_none()
    else:
        pasero = await db.get(Parcela, pasero_id)
    if pasero is None or pasero.tipo != TipoParcela.pasero:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pasero not found")
    return pasero


async def registrar_ingreso_pasero(
    db: AsyncSession, data: IngresoPaseroCreate, user_id: str, desde_despacho: bool = False
) -> IngresoPasero:
    """Valida y crea un `IngresoPasero` (flush + refresh, sin commit). Lo usan
    `POST /pasero/ingresos` y el despacho de cosecha.

    `desde_despacho=True`: el despacho crea la cosecha y el ingreso juntos y el
    ingreso ES el descuento de ese saldo, así que no se valida el saldo. Un
    ingreso manual vinculado (`cosecha_id`) sí exige saldo suficiente."""
    await get_pasero_or_404(db, data.pasero_id)

    if data.origen == OrigenCosecha.tercero and data.productor_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Un ingreso de origen tercero requiere productor_id",
        )
    if data.productor_id is not None and await db.get(Productor, data.productor_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Productor not found")
    if data.ubicacion_id is not None:
        ubicacion = await db.get(UbicacionPasero, data.ubicacion_id)
        if ubicacion is None or ubicacion.pasero_id != data.pasero_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La ubicación no pertenece al pasero indicado",
            )
    if data.cosecha_id is not None:
        cosecha = await db.get(RegistroCosecha, data.cosecha_id)
        if cosecha is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registro de cosecha not found")
        if cosecha.destino not in DESTINOS_PASA:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"La cosecha tiene destino {cosecha.destino.value}: solo una cosecha "
                "destinada a pasa puede ingresar al pasero",
            )
        if not desde_despacho:
            # Lock de la cosecha: el saldo es derivado, sin esto dos ingresos
            # simultáneos pasarían ambos la validación.
            await db.execute(
                select(RegistroCosecha.id).where(RegistroCosecha.id == cosecha.id).with_for_update()
            )
            saldo = await saldo_cosecha(db, cosecha)
            if saldo < data.kg_real:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"La cosecha tiene {saldo} kg sin despachar; el ingreso es de {data.kg_real} kg",
                )

    params = await get_parametros(db)
    if data.carro_incompleto:
        if data.fichas is not None:
            fichas = data.fichas
        else:
            try:
                fichas = mermas.fichas_estimadas(data.kg_real, params.kg_por_ficha)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="El parámetro kg_por_ficha debe ser mayor a cero para estimar las fichas",
                ) from exc
        # Sin carro completo no hay teórico contra qué medir: no hay merma.
        kg_teorico = data.kg_real
        merma_kg = Decimal("0.00")
    else:
        fichas = data.fichas if data.fichas is not None else data.carros * params.fichas_por_carro
        kg_teorico = mermas.kg_teorico_ingreso(fichas, params.kg_por_ficha)
        merma_kg = mermas.merma_ingreso(kg_teorico, data.kg_real)

    ingreso = IngresoPasero(
        fecha=data.fecha,
        pasero_id=data.pasero_id,
        ubicacion_id=data.ubicacion_id,
        cosecha_id=data.cosecha_id,
        variedad=data.variedad,
        origen=data.origen,
        productor_id=data.productor_id,
        carros=data.carros,
        fichas=fichas,
        kg_teorico=kg_teorico,
        kg_real=data.kg_real,
        merma_kg=merma_kg,
        carro_incompleto=data.carro_incompleto,
        observaciones=data.observaciones,
        created_by=user_id,
    )
    db.add(ingreso)
    await db.flush()
    await db.refresh(ingreso)
    return ingreso
