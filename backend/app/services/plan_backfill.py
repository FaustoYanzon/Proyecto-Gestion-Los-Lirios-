"""One-off backfill of RegistroFitosanitario.plan_fitosanitario_id for the
historical manual records (loaded from the Fitosanitarios form, without an
order), so the hectare-based plan coverage (app.services.plan_cobertura) also
counts the applications made before records were linked explicitly.

Pure logic, no DB: the CLI in scripts/migracion/backfill_plan_registros.py
loads the rows, calls `analizar_backfill` and writes the result.

Rule (the heuristic Task 6 removed from /plan-fitosanitario/cumplimiento):
within a campaign (May 1 .. Apr 30), the N-th application of an insumo in a
parcel, in chronological order, covers the N-th planned round
(numero_aplicacion ascending) of that insumo for the parcel's variety.

Details that make it safe to run on live data, and to run twice:
- Only records with insumo_id, without an order (orden_parcela_id NULL) and
  without plan_fitosanitario_id are candidates. Linked records are never
  touched; order records without a plan link are off-plan extras and stay so.
- Rounds already claimed in a parcel by a linked record (from an order or a
  previous run) are skipped, and the candidates take the remaining rounds in
  order. Hence a second run assigns nothing new: every free round left has no
  unassigned candidate before it.
- A manual record with valvula_id set but no orden_valvula_id is treated as a
  whole-parcel application (the valve is informative only; there is no order
  valve to tie it to). The coverage service already reads it that way.
- Several candidate records of the same insumo on the same day in one parcel
  (e.g. loaded once per valve) are ONE application: they all take the same
  round instead of burning the next ones.
- Records whose parcel has no variety, whose campaign has no plan, whose
  variety+insumo has no plan row, or beyond the planned rounds stay unlinked
  (extra) and are reported under `omitidos`.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

# Reasons a record is left without a plan link, in evaluation order.
MOTIVOS_OMISION: tuple[str, ...] = (
    "sin_insumo",
    "ya_vinculado",
    "con_orden",
    "sin_variedad",
    "fuera_de_temporada",
    "sin_plan",
    "excede_rondas",
)


@dataclass(frozen=True)
class PlanRow:
    id: str
    temporada: int
    variedad: str
    insumo_id: str
    numero_aplicacion: int


@dataclass(frozen=True)
class RegistroRow:
    id: str
    fecha: date
    parcela_id: str
    insumo_id: str | None
    plan_fitosanitario_id: str | None
    orden_parcela_id: str | None


@dataclass
class BackfillResult:
    # registro_id -> plan_id
    asignaciones: dict[str, str] = field(default_factory=dict)
    # motivo -> registro ids (sorted by fecha, id)
    omitidos: dict[str, list[str]] = field(
        default_factory=lambda: {motivo: [] for motivo in MOTIVOS_OMISION}
    )


def temporada_de(fecha: date) -> int:
    """Campaign of a date: May..Dec belong to that year, Jan..Apr to the previous one."""
    return fecha.year if fecha.month >= 5 else fecha.year - 1


def analizar_backfill(
    planes: list[PlanRow],
    parcelas_por_variedad: dict[str, list[str]],
    registros: list[RegistroRow],
) -> BackfillResult:
    """Assign plan rows to the candidate records and explain every record left out.

    `registros` must include the already-linked records of the same parcels and
    campaigns: they mark which rounds are taken.
    """
    resultado = BackfillResult()

    variedad_de_parcela: dict[str, str] = {}
    for variedad, parcela_ids in parcelas_por_variedad.items():
        for parcela_id in parcela_ids:
            variedad_de_parcela[parcela_id] = str(variedad)

    rondas: dict[tuple[int, str, str], list[PlanRow]] = defaultdict(list)
    for plan in planes:
        rondas[(plan.temporada, str(plan.variedad), plan.insumo_id)].append(plan)
    for filas in rondas.values():
        filas.sort(key=lambda p: (p.numero_aplicacion, p.id))
    temporadas_con_plan = {plan.temporada for plan in planes}

    ordenados = sorted(registros, key=lambda r: (r.fecha, r.id))

    # Rounds already taken per parcel, from any linked record.
    tomadas: dict[str, set[str]] = defaultdict(set)
    for r in ordenados:
        if r.plan_fitosanitario_id is not None:
            tomadas[r.parcela_id].add(r.plan_fitosanitario_id)

    # (temporada, parcela, insumo) -> fecha -> candidate record ids
    candidatos: dict[tuple[int, str, str], dict[date, list[str]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for r in ordenados:
        if r.insumo_id is None:
            resultado.omitidos["sin_insumo"].append(r.id)
        elif r.plan_fitosanitario_id is not None:
            resultado.omitidos["ya_vinculado"].append(r.id)
        elif r.orden_parcela_id is not None:
            resultado.omitidos["con_orden"].append(r.id)
        elif r.parcela_id not in variedad_de_parcela:
            resultado.omitidos["sin_variedad"].append(r.id)
        elif temporada_de(r.fecha) not in temporadas_con_plan:
            resultado.omitidos["fuera_de_temporada"].append(r.id)
        elif (temporada_de(r.fecha), variedad_de_parcela[r.parcela_id], r.insumo_id) not in rondas:
            resultado.omitidos["sin_plan"].append(r.id)
        else:
            candidatos[(temporada_de(r.fecha), r.parcela_id, r.insumo_id)][r.fecha].append(r.id)

    excedentes: list[tuple[date, str]] = []
    for (temporada, parcela_id, insumo_id), por_fecha in candidatos.items():
        libres = [
            plan
            for plan in rondas[(temporada, variedad_de_parcela[parcela_id], insumo_id)]
            if plan.id not in tomadas[parcela_id]
        ]
        for indice, fecha in enumerate(sorted(por_fecha)):
            ids = por_fecha[fecha]
            if indice < len(libres):
                for registro_id in ids:
                    resultado.asignaciones[registro_id] = libres[indice].id
            else:
                excedentes.extend((fecha, registro_id) for registro_id in ids)
    resultado.omitidos["excede_rondas"] = [rid for _f, rid in sorted(excedentes)]

    return resultado


def asignar_plan_a_registros(
    planes: list[PlanRow],
    parcelas_por_variedad: dict[str, list[str]],
    registros: list[RegistroRow],
) -> dict[str, str]:
    """registro_id -> plan_id for the records the backfill links (see module docstring)."""
    return analizar_backfill(planes, parcelas_por_variedad, registros).asignaciones
