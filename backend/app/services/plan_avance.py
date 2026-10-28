"""Monthly progress of the phytosanitary plan: target dose per hectare by
(variety, month, product) against what was actually applied in that calendar
month, regardless of how the record was created (order or manual entry).

Spec: docs/superpowers/specs/2026-10-28-plan-mensual-avance-design.md (section 3).

Applied dose of a parcel = sum(weight * dose) / parcel hectares, where the
weight is the surface of the record's valve (or the whole parcel when the record
has no valve). Touch-ups on the same valve add up on purpose: it is product
really sprayed, so it can show as over-application.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.insumo import Insumo
from app.models.parcela import Parcela, VariedadUva
from app.models.produccion import PlanFitosanitario, RegistroFitosanitario
from app.models.valvula import Valvula

TOLERANCIA = Decimal("0.05")
_ZERO = Decimal("0")
_CIEN = Decimal("100")


class EstadoAvance(str, Enum):
    pendiente = "pendiente"
    bajo = "bajo"
    ok = "ok"
    exceso = "exceso"
    no_planificado = "no_planificado"


@dataclass(frozen=True)
class AvanceParcela:
    parcela_id: str
    nombre: str
    ha: Decimal
    dosis_aplicada: Decimal
    porcentaje: Decimal | None
    estado: EstadoAvance


@dataclass(frozen=True)
class AvanceClave:
    variedad: VariedadUva
    mes: int
    insumo_id: str
    insumo_nombre: str
    unidad: str | None
    dosis_plan: Decimal | None
    dosis_aplicada_promedio: Decimal
    porcentaje: Decimal | None
    estado: EstadoAvance
    ha_total: Decimal
    parcelas: list[AvanceParcela] = field(default_factory=list)


def orden_campania(mes: int) -> int:
    """Position of a calendar month in the campaign (May=0 ... April=11)."""
    return (mes - 5) % 12


def rango_mes(temporada: int, mes: int) -> tuple[date, date]:
    """[start, end) of month `mes` of the May->April season `temporada`."""
    anio = temporada if mes >= 5 else temporada + 1
    fin = date(anio + 1, 1, 1) if mes == 12 else date(anio, mes + 1, 1)
    return date(anio, mes, 1), fin


def estado_parcela(dosis_aplicada: Decimal, dosis_plan: Decimal) -> EstadoAvance:
    """Band of +-TOLERANCIA around the target is 'ok' (rounding and mixes)."""
    if dosis_aplicada <= 0:
        return EstadoAvance.pendiente
    if dosis_aplicada < dosis_plan * (1 - TOLERANCIA):
        return EstadoAvance.bajo
    if dosis_aplicada > dosis_plan * (1 + TOLERANCIA):
        return EstadoAvance.exceso
    return EstadoAvance.ok


def _ha(value: float | Decimal | None) -> Decimal:
    # str() keeps float columns from leaking binary noise into Decimal.
    return Decimal(str(value)) if value is not None else _ZERO


async def _dosis_por_grupo(
    db: AsyncSession, desde: date, hasta: date, parcelas: dict[str, Parcela],
) -> dict[tuple[str, int, str], Decimal]:
    """(parcela_id, calendar month, insumo_id) -> applied dose over the whole
    parcel, for records dated in [desde, hasta)."""
    if not parcelas:
        return {}
    filas = (
        await db.execute(
            select(
                RegistroFitosanitario.parcela_id,
                RegistroFitosanitario.fecha,
                RegistroFitosanitario.insumo_id,
                RegistroFitosanitario.dosis_por_ha,
                RegistroFitosanitario.valvula_id,
                Valvula.superficie_ha,
            )
            .outerjoin(Valvula, Valvula.id == RegistroFitosanitario.valvula_id)
            .where(
                RegistroFitosanitario.parcela_id.in_(list(parcelas)),
                # Free-text products (no insumo) cannot be matched to the plan.
                RegistroFitosanitario.insumo_id.is_not(None),
                RegistroFitosanitario.fecha >= desde,
                RegistroFitosanitario.fecha < hasta,
            )
        )
    ).all()

    grupos: dict[tuple[str, int, str], list[tuple[Decimal, Decimal]]] = defaultdict(list)
    for parcela_id, fecha, insumo_id, dosis, valvula_id, sup_valvula in filas:
        ha_parcela = _ha(parcelas[parcela_id].superficie_ha)
        peso = _ha(sup_valvula) if valvula_id is not None else ha_parcela
        grupos[(parcela_id, fecha.month, insumo_id)].append((peso, Decimal(str(dosis))))

    resultado: dict[tuple[str, int, str], Decimal] = {}
    for (parcela_id, mes, insumo_id), pares in grupos.items():
        ha_parcela = _ha(parcelas[parcela_id].superficie_ha)
        if ha_parcela > 0:
            resultado[(parcela_id, mes, insumo_id)] = sum((p * d for p, d in pares), _ZERO) / ha_parcela
        else:
            # No surface to weigh with: the mean dose still says what was used.
            resultado[(parcela_id, mes, insumo_id)] = sum((d for _p, d in pares), _ZERO) / len(pares)
    return resultado


async def dosis_aplicada_por_parcela(
    db: AsyncSession, temporada: int, mes: int, parcela_ids: Iterable[str],
) -> dict[tuple[str, str], Decimal]:
    """(parcela_id, insumo_id) -> applied dose over the whole parcel in the month."""
    ids = list(parcela_ids)
    if not ids:
        return {}
    parcelas = {
        p.id: p for p in (await db.execute(select(Parcela).where(Parcela.id.in_(ids)))).scalars()
    }
    desde, hasta = rango_mes(temporada, mes)
    grupos = await _dosis_por_grupo(db, desde, hasta, parcelas)
    return {(pid, insumo_id): dosis for (pid, _m, insumo_id), dosis in grupos.items()}


def _agregar(parcelas: list[AvanceParcela], dosis_plan: Decimal | None) -> tuple[Decimal, Decimal, Decimal | None, EstadoAvance]:
    """-> (ha_total, ha-weighted applied dose, percentage, aggregated state)."""
    ha_total = sum((p.ha for p in parcelas), _ZERO)
    if ha_total > 0:
        promedio = sum((p.dosis_aplicada * p.ha for p in parcelas), _ZERO) / ha_total
    else:
        promedio = sum((p.dosis_aplicada for p in parcelas), _ZERO) / len(parcelas)
    if dosis_plan is None:
        return ha_total, promedio, None, EstadoAvance.no_planificado
    estados = {p.estado for p in parcelas}
    if estados == {EstadoAvance.pendiente}:
        estado = EstadoAvance.pendiente
    elif estados & {EstadoAvance.pendiente, EstadoAvance.bajo}:
        # Missing product outranks surplus elsewhere: it is the actionable one.
        estado = EstadoAvance.bajo
    elif EstadoAvance.exceso in estados:
        estado = EstadoAvance.exceso
    else:
        estado = EstadoAvance.ok
    return ha_total, promedio, promedio / dosis_plan * _CIEN, estado


async def calcular_avance(
    db: AsyncSession, temporada: int, mes: int | None = None, variedad: VariedadUva | None = None,
) -> list[AvanceClave]:
    planes_stmt = (
        select(PlanFitosanitario)
        .options(selectinload(PlanFitosanitario.insumo))
        .where(PlanFitosanitario.temporada == temporada)
    )
    if mes is not None:
        planes_stmt = planes_stmt.where(PlanFitosanitario.mes == mes)
    if variedad is not None:
        planes_stmt = planes_stmt.where(PlanFitosanitario.variedad == variedad)
    planes = (await db.execute(planes_stmt)).scalars().all()

    # Target dose per key: rows of the same product in the same month add up.
    objetivo: dict[tuple[VariedadUva, int, str], Decimal] = defaultdict(Decimal)
    nombres: dict[str, tuple[str, str | None]] = {}
    for plan in planes:
        objetivo[(plan.variedad, plan.mes, plan.insumo_id)] += Decimal(str(plan.dosis_por_ha))
        nombres[plan.insumo_id] = (plan.insumo.nombre, getattr(plan.insumo.unidad, "value", plan.insumo.unidad))

    parcelas_stmt = select(Parcela).where(Parcela.is_active.is_(True), Parcela.variedad.is_not(None))
    if variedad is not None:
        parcelas_stmt = parcelas_stmt.where(Parcela.variedad == variedad)
    parcelas = {p.id: p for p in (await db.execute(parcelas_stmt.order_by(Parcela.nombre, Parcela.id))).scalars()}
    por_variedad: dict[VariedadUva, list[Parcela]] = defaultdict(list)
    for parcela in parcelas.values():
        por_variedad[parcela.variedad].append(parcela)

    if mes is not None:
        desde, hasta = rango_mes(temporada, mes)
    else:
        desde, hasta = date(temporada, 5, 1), date(temporada + 1, 5, 1)
    dosis = await _dosis_por_grupo(db, desde, hasta, parcelas)

    # Products applied with no plan row for that variety and month.
    sin_plan: set[tuple[VariedadUva, int, str]] = set()
    for (parcela_id, m, insumo_id) in dosis:
        clave = (parcelas[parcela_id].variedad, m, insumo_id)
        if clave not in objetivo:
            sin_plan.add(clave)
    faltantes = {i for _v, _m, i in sin_plan} - nombres.keys()
    if faltantes:
        for insumo in (await db.execute(select(Insumo).where(Insumo.id.in_(faltantes)))).scalars():
            nombres[insumo.id] = (insumo.nombre, getattr(insumo.unidad, "value", insumo.unidad))

    resultado: list[AvanceClave] = []
    for (var, m, insumo_id), dosis_plan in objetivo.items():
        filas = [
            AvanceParcela(
                parcela_id=p.id, nombre=p.nombre, ha=_ha(p.superficie_ha),
                dosis_aplicada=(d := dosis.get((p.id, m, insumo_id), _ZERO)),
                porcentaje=d / dosis_plan * _CIEN, estado=estado_parcela(d, dosis_plan),
            )
            for p in por_variedad.get(var, [])
        ]
        if not filas:
            continue  # nothing to apply: no active parcel of this variety
        ha_total, promedio, porcentaje, estado = _agregar(filas, dosis_plan)
        nombre, unidad = nombres[insumo_id]
        resultado.append(AvanceClave(var, m, insumo_id, nombre, unidad, dosis_plan, promedio, porcentaje, estado, ha_total, filas))

    for (var, m, insumo_id) in sin_plan:
        filas = [
            AvanceParcela(p.id, p.nombre, _ha(p.superficie_ha), d, None, EstadoAvance.no_planificado)
            for p in por_variedad.get(var, [])
            if (d := dosis.get((p.id, m, insumo_id), _ZERO)) > 0
        ]
        ha_total, promedio, porcentaje, estado = _agregar(filas, None)
        nombre, unidad = nombres[insumo_id]
        resultado.append(AvanceClave(var, m, insumo_id, nombre, unidad, None, promedio, porcentaje, estado, ha_total, filas))

    resultado.sort(key=lambda a: (a.variedad.value, orden_campania(a.mes), a.dosis_plan is None, a.insumo_nombre))
    return resultado
