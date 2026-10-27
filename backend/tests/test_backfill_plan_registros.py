"""One-off backfill of RegistroFitosanitario.plan_fitosanitario_id for manual
historical records (no order), using the old N-th-application heuristic.

Spec: docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md
("Migración + backfill", step 4). Pure function, no DB.
"""
from __future__ import annotations

from datetime import date

from app.services.plan_backfill import (
    PlanRow,
    RegistroRow,
    analizar_backfill,
    asignar_plan_a_registros,
)

FLAME = "flame"
SULTANINA = "sultanina"
INSUMO_A = "insumo-a"
INSUMO_B = "insumo-b"


def _plan(plan_id: str, numero: int, insumo_id: str = INSUMO_A, variedad: str = FLAME,
          temporada: int = 2026) -> PlanRow:
    return PlanRow(
        id=plan_id, temporada=temporada, variedad=variedad,
        insumo_id=insumo_id, numero_aplicacion=numero,
    )


def _reg(reg_id: str, fecha: date, parcela_id: str = "p1", insumo_id: str | None = INSUMO_A,
         plan_id: str | None = None, orden_parcela_id: str | None = None) -> RegistroRow:
    return RegistroRow(
        id=reg_id, fecha=fecha, parcela_id=parcela_id, insumo_id=insumo_id,
        plan_fitosanitario_id=plan_id, orden_parcela_id=orden_parcela_id,
    )


def test_n_esima_aplicacion_cubre_n_esima_ronda():
    # Rounds listed out of order on purpose: numero_aplicacion drives the order.
    planes = [_plan("plan-3", 3), _plan("plan-1", 1), _plan("plan-2", 2)]
    parcelas = {FLAME: ["p1", "p2"]}
    registros = [
        _reg("r-p1-oct", date(2026, 10, 1)),
        _reg("r-p1-ago", date(2026, 8, 1)),
        _reg("r-p2-sep", date(2026, 9, 1), parcela_id="p2"),
        # Same parcel, other insumo: has no plan row -> not assigned.
        _reg("r-p1-b", date(2026, 8, 2), insumo_id=INSUMO_B),
    ]

    asignaciones = asignar_plan_a_registros(planes, parcelas, registros)

    assert asignaciones == {
        "r-p1-ago": "plan-1",
        "r-p1-oct": "plan-2",
        "r-p2-sep": "plan-1",
    }


def test_registros_con_plan_id_no_se_tocan():
    planes = [_plan("plan-1", 1), _plan("plan-2", 2)]
    parcelas = {FLAME: ["p1"]}
    registros = [
        # Already linked (e.g. from an order) to round 1: it keeps it, and the
        # manual record after it takes the next free round.
        _reg("r-linked", date(2026, 8, 1), plan_id="plan-1", orden_parcela_id="op-1"),
        _reg("r-manual", date(2026, 9, 1)),
        # Linked manual record (no order) is never reassigned either.
        _reg("r-linked-manual", date(2026, 10, 1), plan_id="plan-2"),
    ]

    resultado = analizar_backfill(planes, parcelas, registros)

    assert "r-linked" not in resultado.asignaciones
    assert "r-linked-manual" not in resultado.asignaciones
    # Both rounds already claimed in p1 -> nothing free for the manual one.
    assert resultado.asignaciones == {}
    assert resultado.omitidos["ya_vinculado"] == ["r-linked", "r-linked-manual"]
    assert resultado.omitidos["excede_rondas"] == ["r-manual"]


def test_registro_con_orden_sin_plan_no_se_asigna():
    # Off-plan order line (extra): has an order, stays extra.
    planes = [_plan("plan-1", 1)]
    registros = [_reg("r-orden", date(2026, 8, 1), orden_parcela_id="op-1")]

    resultado = analizar_backfill(planes, {FLAME: ["p1"]}, registros)

    assert resultado.asignaciones == {}
    assert resultado.omitidos["con_orden"] == ["r-orden"]


def test_registro_de_otra_temporada_no_se_asigna():
    planes = [_plan("plan-1", 1, temporada=2026)]
    registros = [
        _reg("r-abr-2026", date(2026, 4, 30)),   # campaign 2025
        _reg("r-may-2027", date(2027, 5, 1)),    # campaign 2027
        _reg("r-may-2026", date(2026, 5, 1)),    # campaign 2026, first day
    ]

    resultado = analizar_backfill(planes, {FLAME: ["p1"]}, registros)

    assert resultado.asignaciones == {"r-may-2026": "plan-1"}
    assert resultado.omitidos["fuera_de_temporada"] == ["r-abr-2026", "r-may-2027"]


def test_parcela_sin_variedad_no_se_asigna():
    planes = [_plan("plan-1", 1)]
    registros = [
        _reg("r-sin-variedad", date(2026, 8, 1), parcela_id="p-sin-variedad"),
        _reg("r-otra-variedad", date(2026, 8, 1), parcela_id="p-sult"),
    ]

    resultado = analizar_backfill(planes, {FLAME: ["p1"], SULTANINA: ["p-sult"]}, registros)

    assert resultado.asignaciones == {}
    assert resultado.omitidos["sin_variedad"] == ["r-sin-variedad"]
    # Sultanina has no plan row for this insumo.
    assert resultado.omitidos["sin_plan"] == ["r-otra-variedad"]


def test_mas_aplicaciones_que_rondas():
    planes = [_plan("plan-1", 1), _plan("plan-2", 2)]
    registros = [
        _reg("r1", date(2026, 8, 1)),
        _reg("r2", date(2026, 9, 1)),
        _reg("r3", date(2026, 10, 1)),
    ]

    resultado = analizar_backfill(planes, {FLAME: ["p1"]}, registros)

    assert resultado.asignaciones == {"r1": "plan-1", "r2": "plan-2"}
    assert resultado.omitidos["excede_rondas"] == ["r3"]


def test_sin_insumo_no_se_asigna():
    resultado = analizar_backfill(
        [_plan("plan-1", 1)], {FLAME: ["p1"]}, [_reg("r-libre", date(2026, 8, 1), insumo_id=None)],
    )

    assert resultado.asignaciones == {}
    assert resultado.omitidos["sin_insumo"] == ["r-libre"]


def test_mismo_dia_cuenta_como_una_aplicacion():
    # Two manual records of the same insumo on the same day in one parcel (e.g.
    # loaded per valve) are one application: both take round 1, round 2 stays free.
    planes = [_plan("plan-1", 1), _plan("plan-2", 2)]
    registros = [
        _reg("r-v1", date(2026, 8, 1)),
        _reg("r-v2", date(2026, 8, 1)),
        _reg("r-sep", date(2026, 9, 1)),
    ]

    asignaciones = asignar_plan_a_registros(planes, {FLAME: ["p1"]}, registros)

    assert asignaciones == {"r-v1": "plan-1", "r-v2": "plan-1", "r-sep": "plan-2"}


def test_idempotente():
    planes = [_plan("plan-1", 1), _plan("plan-2", 2)]
    parcelas = {FLAME: ["p1", "p2"]}
    registros = [
        _reg("r1", date(2026, 8, 1)),
        _reg("r2", date(2026, 9, 1)),
        _reg("r3", date(2026, 10, 1)),  # beyond the planned rounds
        _reg("r4", date(2026, 8, 5), parcela_id="p2"),
    ]

    primera = asignar_plan_a_registros(planes, parcelas, registros)
    assert primera == {"r1": "plan-1", "r2": "plan-2", "r4": "plan-1"}

    # Simulate the write, then run again over the updated rows.
    aplicados = [
        RegistroRow(
            id=r.id, fecha=r.fecha, parcela_id=r.parcela_id, insumo_id=r.insumo_id,
            plan_fitosanitario_id=primera.get(r.id, r.plan_fitosanitario_id),
            orden_parcela_id=r.orden_parcela_id,
        )
        for r in registros
    ]
    assert asignar_plan_a_registros(planes, parcelas, aplicados) == {}


def test_reintento_tras_grupo_partido_reusa_la_ronda():
    # A partial --apply committed r-v1 (plan-1) but not its same-day sibling
    # r-v2 nor r-sep. The retry must reproduce the original assignment.
    planes = [_plan("plan-1", 1), _plan("plan-2", 2)]
    registros = [
        _reg("r-v1", date(2026, 8, 1), plan_id="plan-1"),
        _reg("r-v2", date(2026, 8, 1)),
        _reg("r-sep", date(2026, 9, 1)),
    ]

    asignaciones = asignar_plan_a_registros(planes, {FLAME: ["p1"]}, registros)

    assert asignaciones == {"r-v2": "plan-1", "r-sep": "plan-2"}


def test_manual_mismo_dia_que_registro_de_orden_no_consume_ronda():
    # Transition: the operator confirmed the order in mobile and someone also
    # loaded it by hand the same day. The manual one is a duplicate: skipped,
    # and round 2 stays free for the next real application.
    planes = [_plan("plan-1", 1), _plan("plan-2", 2)]
    registros = [
        _reg("r-orden", date(2026, 8, 1), plan_id="plan-1", orden_parcela_id="op-1"),
        _reg("r-man", date(2026, 8, 1)),
        _reg("r-sep", date(2026, 9, 1)),
    ]

    resultado = analizar_backfill(planes, {FLAME: ["p1"]}, registros)

    assert resultado.asignaciones == {"r-sep": "plan-2"}
    assert resultado.omitidos["duplicado_de_vinculado"] == ["r-man"]


def test_mismo_dia_que_vinculados_con_rondas_distintas_se_omite():
    # Two manual linked records of the same day on different rounds: the plan
    # id of the candidate cannot be determined.
    planes = [_plan("plan-1", 1), _plan("plan-2", 2)]
    registros = [
        _reg("r-a", date(2026, 8, 1), plan_id="plan-1"),
        _reg("r-b", date(2026, 8, 1), plan_id="plan-2"),
        _reg("r-c", date(2026, 8, 1)),
    ]

    resultado = analizar_backfill(planes, {FLAME: ["p1"]}, registros)

    assert resultado.asignaciones == {}
    assert resultado.omitidos["duplicado_de_vinculado"] == ["r-c"]


def test_reporta_parcelas_con_candidato_anterior_a_ronda_tomada():
    # Round 1 was linked from an order in September; the August manual record
    # takes the free round 2 (explicit links win) and the parcel is reported.
    planes = [_plan("plan-1", 1), _plan("plan-2", 2)]
    registros = [
        _reg("r-orden", date(2026, 9, 1), plan_id="plan-1", orden_parcela_id="op-1"),
        _reg("r-ago", date(2026, 8, 1)),
        _reg("r-p2", date(2026, 8, 1), parcela_id="p2"),
    ]

    resultado = analizar_backfill(planes, {FLAME: ["p1", "p2"]}, registros)

    assert resultado.asignaciones == {"r-ago": "plan-2", "r-p2": "plan-1"}
    assert resultado.fuera_de_orden == [("p1", INSUMO_A)]
