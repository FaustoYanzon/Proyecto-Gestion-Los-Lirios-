"""Cleanup planning of duplicated plan rows (pure function, no DB)."""
from __future__ import annotations

from datetime import datetime, timezone

from app.services.plan_duplicados import FilaPlan, planear_limpieza


def _fila(id_: str, *, dosis: float = 1.5, mes: int = 11, objetivo: str = "Oidio",
          dia: int = 1, variedad: str = "flame", ronda: int = 4, insumo: str = "ins-1") -> FilaPlan:
    return FilaPlan(
        id=id_, temporada=2026, variedad=variedad, numero_aplicacion=ronda, insumo_id=insumo,
        mes=mes, objetivo=objetivo, dosis_por_ha=dosis,
        created_at=datetime(2026, 9, dia, tzinfo=timezone.utc),
    )


def test_duplicado_identico_conserva_la_fila_mas_vieja():
    plan = planear_limpieza([_fila("b", dia=5), _fila("a", dia=1)], referenciadas=set())
    assert [(g.conservar, g.borrar) for g in plan.limpiar] == [("a", ("b",))]
    assert plan.ids_a_borrar == ["b"]
    assert plan.revisar == []


def test_grupo_sin_duplicados_no_se_toca():
    plan = planear_limpieza([_fila("a"), _fila("b", variedad="syrah")], referenciadas=set())
    assert plan.limpiar == [] and plan.revisar == []


def test_filas_distintas_se_reportan_y_no_se_borran():
    plan = planear_limpieza([_fila("a"), _fila("b", dosis=2.0)], referenciadas=set())
    assert plan.limpiar == []
    assert [(c, r) for c, _f, r in plan.revisar] == [
        ((2026, "flame", 4, "ins-1"), "filas distintas (mes, objetivo o dosis)")
    ]


def test_la_fila_referenciada_se_conserva_aunque_sea_la_mas_nueva():
    plan = planear_limpieza([_fila("a", dia=1), _fila("b", dia=9)], referenciadas={"b"})
    assert [(g.conservar, g.borrar) for g in plan.limpiar] == [("b", ("a",))]


def test_mas_de_una_referenciada_va_a_revision_manual():
    plan = planear_limpieza([_fila("a"), _fila("b")], referenciadas={"a", "b"})
    assert plan.limpiar == []
    assert plan.revisar[0][2] == "más de una fila referenciada por órdenes"


def test_tres_filas_iguales_borra_dos_y_es_idempotente():
    filas = [_fila("c", dia=3), _fila("a", dia=1), _fila("b", dia=2)]
    plan = planear_limpieza(filas, referenciadas=set())
    assert plan.limpiar[0].conservar == "a"
    assert sorted(plan.ids_a_borrar) == ["b", "c"]
    restantes = [f for f in filas if f.id not in set(plan.ids_a_borrar)]
    assert planear_limpieza(restantes, referenciadas=set()).limpiar == []


def test_grupos_distintos_se_resuelven_por_separado():
    filas = [_fila("a1"), _fila("a2"), _fila("b1", ronda=5), _fila("b2", ronda=5, dosis=9.0)]
    plan = planear_limpieza(filas, referenciadas=set())
    assert [g.clave[2] for g in plan.limpiar] == [4]
    assert [c[2] for c, _f, _r in plan.revisar] == [5]
