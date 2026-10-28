"""How an order being drafted fits the monthly plan, per product line and variety
(spec 2026-10-28-plan-mensual-avance, section 4: POST /plan-fitosanitario/contraste).

Read-only: it projects what the plan progress would be if the order were
applied on the selected area, without creating anything.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.lotes_pasa import temporada_de
from app.models.parcela import Parcela, VariedadUva
from app.models.produccion import PlanFitosanitario
from app.models.valvula import Valvula
from app.services.plan_avance import TOLERANCIA, _ha, dosis_aplicada_por_parcela

_ZERO = Decimal("0")
_CIEN = Decimal("100")


class EstadoContraste(str, Enum):
    en_plan = "en_plan"
    excede = "excede"
    fuera_del_plan = "fuera_del_plan"


@dataclass(frozen=True)
class ParcelaElegida:
    parcela_id: str
    # Empty = the whole parcel; otherwise only these valves are sprayed.
    valvula_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class LineaContraste:
    insumo_id: str
    dosis_por_ha: Decimal


@dataclass(frozen=True)
class ResultadoVariedad:
    variedad: VariedadUva
    estado: EstadoContraste
    dosis_plan: Decimal | None
    dosis_aplicada_promedio: Decimal
    dosis_proyectada_promedio: Decimal
    porcentaje_proyectado: Decimal | None


@dataclass(frozen=True)
class ResultadoLinea:
    insumo_id: str
    variedades: list[ResultadoVariedad]


async def calcular_contraste(
    db: AsyncSession, fecha: date, parcelas: list[ParcelaElegida], lineas: list[LineaContraste],
) -> list[ResultadoLinea]:
    temporada, mes = temporada_de(fecha), fecha.month
    por_id = {
        p.id: p
        for p in (
            await db.execute(
                select(Parcela).where(
                    Parcela.id.in_([e.parcela_id for e in parcelas]),
                    Parcela.is_active.is_(True),
                    Parcela.variedad.is_not(None),
                )
            )
        ).scalars()
    }
    elegidas = [e for e in parcelas if e.parcela_id in por_id]

    # Surface actually sprayed per chosen parcel: the selected valves, or all of it.
    valvula_ids = {v for e in elegidas for v in e.valvula_ids}
    sup_valvula: dict[tuple[str, str], Decimal] = {}
    if valvula_ids:
        for vid, pid, ha in (
            await db.execute(
                select(Valvula.id, Valvula.parcela_id, Valvula.superficie_ha).where(Valvula.id.in_(valvula_ids))
            )
        ).all():
            sup_valvula[(pid, vid)] = _ha(ha)
    ha_sel = {
        e.parcela_id: (
            sum((sup_valvula.get((e.parcela_id, v), _ZERO) for v in e.valvula_ids), _ZERO)
            if e.valvula_ids else _ha(por_id[e.parcela_id].superficie_ha)
        )
        for e in elegidas
    }

    aplicado = await dosis_aplicada_por_parcela(db, temporada, mes, ha_sel.keys())

    variedades = {por_id[e.parcela_id].variedad for e in elegidas}
    objetivo: dict[tuple[VariedadUva, str], Decimal] = defaultdict(Decimal)
    if variedades and lineas:
        for plan in (
            await db.execute(
                select(PlanFitosanitario).where(
                    PlanFitosanitario.temporada == temporada,
                    PlanFitosanitario.mes == mes,
                    PlanFitosanitario.variedad.in_(variedades),
                    PlanFitosanitario.insumo_id.in_({ln.insumo_id for ln in lineas}),
                )
            )
        ).scalars():
            objetivo[(plan.variedad, plan.insumo_id)] += Decimal(str(plan.dosis_por_ha))

    resultado: list[ResultadoLinea] = []
    for ln in lineas:
        filas: list[ResultadoVariedad] = []
        for var in sorted(variedades, key=lambda v: v.value):
            pares: list[tuple[Decimal, Decimal, Decimal]] = []  # (weight, applied, projected)
            for e in elegidas:
                parcela = por_id[e.parcela_id]
                if parcela.variedad != var:
                    continue
                ha_p, sel = _ha(parcela.superficie_ha), ha_sel[e.parcela_id]
                d_p = aplicado.get((e.parcela_id, ln.insumo_id), _ZERO)
                # A parcel without surface cannot be weighed: assume the full dose.
                incremento = ln.dosis_por_ha * sel / ha_p if ha_p > 0 else ln.dosis_por_ha
                pares.append((sel, d_p, d_p + incremento))
            peso_total = sum((w for w, _a, _p in pares), _ZERO)
            if peso_total > 0:
                aplicada = sum((w * a for w, a, _p in pares), _ZERO) / peso_total
                proyectada = sum((w * p for w, _a, p in pares), _ZERO) / peso_total
            else:
                aplicada = sum((a for _w, a, _p in pares), _ZERO) / len(pares)
                proyectada = sum((p for _w, _a, p in pares), _ZERO) / len(pares)

            dosis_plan = objetivo.get((var, ln.insumo_id))
            if dosis_plan is None:
                estado, pct = EstadoContraste.fuera_del_plan, None
            else:
                pct = proyectada / dosis_plan * _CIEN
                estado = (
                    EstadoContraste.excede if proyectada > dosis_plan * (1 + TOLERANCIA)
                    else EstadoContraste.en_plan
                )
            filas.append(ResultadoVariedad(var, estado, dosis_plan, aplicada, proyectada, pct))
        resultado.append(ResultadoLinea(ln.insumo_id, filas))
    return resultado
