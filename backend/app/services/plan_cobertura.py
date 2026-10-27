"""Coverage of the phytosanitary plan measured in hectares, from the explicit
link RegistroFitosanitario.plan_fitosanitario_id (replaces the old heuristic
that matched the N-th application of a product to the N-th planned round).

Unit of coverage: a valve (covers Valvula.superficie_ha) or the whole parcel
(record with orden_valvula_id NULL covers Parcela.superficie_ha). Per plan row
and parcel:
- any linked whole-parcel record -> the parcel is fully covered;
- otherwise the sum over DISTINCT valves with a linked record, so a touch-up
  order on the same valve does not count twice;
- always capped at the parcel surface (whole parcel + valves, or valve
  surfaces loaded larger than the parcel, never exceed it).

Only active parcels of the plan row's variety count; records without a plan
link (manual or off-plan) cover nothing. Null surfaces contribute 0 ha.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.parcela import Parcela, VariedadUva
from app.models.produccion import (
    OrdenAplicacionValvula,
    PlanFitosanitario,
    RegistroFitosanitario,
)
from app.models.valvula import Valvula

_ZERO = Decimal("0")


def _ha(value: float | Decimal | None) -> Decimal:
    """Surface as Decimal; null means unknown and contributes nothing."""
    # str() keeps Parcela.superficie_ha (a float column) from leaking binary noise.
    return Decimal(str(value)) if value is not None else _ZERO


@dataclass(frozen=True)
class CoberturaParcela:
    plan_id: str
    parcela_id: str
    ha_parcela: Decimal
    ha_cubiertas: Decimal
    # True when at least one linked record exists, even if it adds 0 ha (a
    # parcel or valve without surface): lets callers tell "applied, surface
    # unknown" from "not applied" when ha_parcela is 0.
    tiene_registros: bool = False


@dataclass(frozen=True)
class AnalisisPlan:
    """Plan rows of the season (insumo loaded), one coverage entry per
    (plan row x active parcel of its variety), and the hectare-weighted actual
    dose per plan row (only rows with linked records)."""
    planes: list[PlanFitosanitario]
    coberturas: list[CoberturaParcela]
    dosis_real_promedio: dict[str, Decimal] = field(default_factory=dict)


@dataclass
class _Acumulado:
    parcela_entera: bool = False
    valvulas: dict[str, Decimal] = field(default_factory=dict)
    # (weight in ha, dose) per linked record, for the weighted average.
    dosis: list[tuple[Decimal, Decimal]] = field(default_factory=list)


async def analizar_plan(
    db: AsyncSession, temporada: int, variedad: VariedadUva | None = None,
) -> AnalisisPlan:
    planes_stmt = (
        select(PlanFitosanitario)
        .options(selectinload(PlanFitosanitario.insumo))
        .where(PlanFitosanitario.temporada == temporada)
        .order_by(
            PlanFitosanitario.variedad,
            PlanFitosanitario.numero_aplicacion,
            PlanFitosanitario.insumo_id,
        )
    )
    if variedad is not None:
        planes_stmt = planes_stmt.where(PlanFitosanitario.variedad == variedad)
    planes = list((await db.execute(planes_stmt)).scalars().all())
    if not planes:
        return AnalisisPlan(planes=[], coberturas=[])

    parcelas = (
        await db.execute(
            select(Parcela)
            .where(
                Parcela.is_active.is_(True),
                Parcela.variedad.in_({p.variedad for p in planes}),
            )
            .order_by(Parcela.nombre, Parcela.id)
        )
    ).scalars().all()
    parcelas_por_variedad: dict[VariedadUva, list[Parcela]] = defaultdict(list)
    for parcela in parcelas:
        parcelas_por_variedad[parcela.variedad].append(parcela)

    # One query for every linked record of these plan rows; grouping in Python.
    filas = (
        await db.execute(
            select(
                RegistroFitosanitario.plan_fitosanitario_id,
                RegistroFitosanitario.parcela_id,
                RegistroFitosanitario.orden_valvula_id,
                RegistroFitosanitario.dosis_por_ha,
                OrdenAplicacionValvula.valvula_id,
                Valvula.superficie_ha,
            )
            .outerjoin(
                OrdenAplicacionValvula,
                OrdenAplicacionValvula.id == RegistroFitosanitario.orden_valvula_id,
            )
            .outerjoin(Valvula, Valvula.id == OrdenAplicacionValvula.valvula_id)
            .where(RegistroFitosanitario.plan_fitosanitario_id.in_([p.id for p in planes]))
        )
    ).all()

    superficie_parcela = {p.id: _ha(p.superficie_ha) for p in parcelas}
    acumulado: dict[tuple[str, str], _Acumulado] = defaultdict(_Acumulado)
    for plan_id, parcela_id, orden_valvula_id, dosis, valvula_id, sup_valvula in filas:
        if parcela_id not in superficie_parcela:
            # Inactive parcel, or a variety the plan row does not cover.
            continue
        acc = acumulado[(plan_id, parcela_id)]
        if orden_valvula_id is None:
            acc.parcela_entera = True
            peso = superficie_parcela[parcela_id]
        else:
            peso = _ha(sup_valvula)
            if valvula_id is not None:
                acc.valvulas[valvula_id] = peso
        acc.dosis.append((peso, Decimal(str(dosis))))

    coberturas: list[CoberturaParcela] = []
    dosis_real: dict[str, Decimal] = {}
    for plan in planes:
        pares: list[tuple[Decimal, Decimal]] = []
        for parcela in parcelas_por_variedad.get(plan.variedad, []):
            ha_parcela = superficie_parcela[parcela.id]
            acc = acumulado.get((plan.id, parcela.id))
            if acc is None:
                cubiertas = _ZERO
            elif acc.parcela_entera:
                cubiertas = ha_parcela
            else:
                cubiertas = min(sum(acc.valvulas.values(), _ZERO), ha_parcela)
            coberturas.append(
                CoberturaParcela(
                    plan_id=plan.id,
                    parcela_id=parcela.id,
                    ha_parcela=ha_parcela,
                    ha_cubiertas=cubiertas,
                    tiene_registros=acc is not None,
                )
            )
            if acc is not None:
                pares.extend(acc.dosis)
        if pares:
            dosis_real[plan.id] = _promedio_ponderado(pares)

    return AnalisisPlan(planes=planes, coberturas=coberturas, dosis_real_promedio=dosis_real)


def _promedio_ponderado(pares: list[tuple[Decimal, Decimal]]) -> Decimal:
    """Hectare-weighted mean dose; plain mean when every weight is 0 (records
    on units without surface still tell which dose was used)."""
    peso_total = sum((peso for peso, _d in pares), _ZERO)
    if peso_total > 0:
        return sum((peso * d for peso, d in pares), _ZERO) / peso_total
    return sum((d for _p, d in pares), _ZERO) / len(pares)


async def cobertura_por_parcela(
    db: AsyncSession, temporada: int, variedad: VariedadUva | None = None,
) -> list[CoberturaParcela]:
    """One entry per (plan row x active parcel of its variety)."""
    return (await analizar_plan(db, temporada, variedad)).coberturas
