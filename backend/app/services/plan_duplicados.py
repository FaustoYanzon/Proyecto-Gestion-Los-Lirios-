"""Pure planning of the cleanup of duplicated plan rows.

A plan row is identified by (temporada, variedad, numero_aplicacion, insumo_id).
The order-line resolution picks one row per key, so a second row with the same
key can never be covered and its round card would never disappear. This module
decides which duplicates are safe to delete. The one-shot CLI that applied it
(limpiar_duplicados_plan.py, run on prod 2026-10-27) was removed with the order/plan
link columns; see git history.

Rules (conservative on purpose, a wrong delete is hard to undo):
- Only groups whose rows are identical in (mes, objetivo, dosis_por_ha) are
  cleaned; the oldest row (then the smallest id) is kept.
- A row referenced by an order is never deleted and is preferred as the one
  to keep. More than one referenced row in a group -> manual review.
- Groups whose rows differ are reported, never touched.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class FilaPlan:
    id: str
    temporada: int
    variedad: str
    numero_aplicacion: int
    insumo_id: str
    mes: int
    objetivo: str
    dosis_por_ha: float
    created_at: datetime


@dataclass(frozen=True)
class GrupoLimpieza:
    clave: tuple[int, str, int, str]
    conservar: str
    borrar: tuple[str, ...]


@dataclass
class PlanLimpieza:
    limpiar: list[GrupoLimpieza] = field(default_factory=list)
    revisar: list[tuple[tuple[int, str, int, str], list[FilaPlan], str]] = field(default_factory=list)

    @property
    def ids_a_borrar(self) -> list[str]:
        return [i for g in self.limpiar for i in g.borrar]


def planear_limpieza(filas: list[FilaPlan], referenciadas: set[str]) -> PlanLimpieza:
    grupos: dict[tuple[int, str, int, str], list[FilaPlan]] = {}
    for f in filas:
        grupos.setdefault((f.temporada, f.variedad, f.numero_aplicacion, f.insumo_id), []).append(f)

    plan = PlanLimpieza()
    for clave in sorted(grupos):
        miembros = grupos[clave]
        if len(miembros) < 2:
            continue
        contenido = {(f.mes, f.objetivo, f.dosis_por_ha) for f in miembros}
        if len(contenido) > 1:
            plan.revisar.append((clave, miembros, "filas distintas (mes, objetivo o dosis)"))
            continue
        usadas = [f for f in miembros if f.id in referenciadas]
        if len(usadas) > 1:
            plan.revisar.append((clave, miembros, "más de una fila referenciada por órdenes"))
            continue
        # Referenced row first, then oldest, then smallest id.
        orden = sorted(miembros, key=lambda f: (f.id not in referenciadas, f.created_at, f.id))
        plan.limpiar.append(
            GrupoLimpieza(clave=clave, conservar=orden[0].id, borrar=tuple(f.id for f in orden[1:]))
        )
    return plan
