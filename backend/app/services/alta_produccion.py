"""Consultas y reglas compartidas del módulo Alta de Producción: parámetros
configurables y saldos (uva en pasero, saldo de cosecha, numeración)."""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alta_produccion import (
    Bin,
    IngresoPasero,
    Lote,
    ParametroProduccion,
    Remito,
    RemitoLinea,
    TipoRemito,
)
from app.models.parcela import VariedadUva
from app.models.produccion import RegistroCosecha

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
    """Saldo (kg sin despachar en remitos) de varias cosechas con UNA query
    agregada. Única fuente de verdad: la usan el 409 de remitos y `saldo_kg`."""
    if not cosechas:
        return {}
    ids = [c.id for c in cosechas]
    filas = await db.execute(
        select(RemitoLinea.cosecha_id, func.coalesce(func.sum(RemitoLinea.kg), 0))
        .where(RemitoLinea.cosecha_id.in_(ids))
        .group_by(RemitoLinea.cosecha_id)
    )
    despachado = {cid: Decimal(kg) for cid, kg in filas.all()}
    # kg_total del histórico es Float: pasa por str para no arrastrar ruido binario.
    return {
        c.id: (Decimal(str(c.kg_total)) - despachado.get(c.id, Decimal("0"))).quantize(Decimal("0.01"))
        for c in cosechas
    }


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
