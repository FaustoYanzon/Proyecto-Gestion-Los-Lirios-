"""Shared helpers for tests that build OrdenAplicacion rows directly (without
going through the API). Every order carries at least one line
(OrdenAplicacionInsumo); the single-product columns no longer exist.
"""
from __future__ import annotations

from app.models.produccion import OrdenAplicacion, OrdenAplicacionInsumo


def add_linea(
    orden: OrdenAplicacion,
    insumo_id: str,
    dosis_por_ha: float = 1.0,
    dias_carencia: int = 7,
    dias_reingreso: int = 2,
) -> OrdenAplicacionInsumo:
    """Append a product line to the order (position = current line count)."""
    linea = OrdenAplicacionInsumo(
        insumo_id=insumo_id,
        dosis_por_ha=dosis_por_ha,
        dias_carencia=dias_carencia,
        dias_reingreso=dias_reingreso,
        posicion=len(orden.lineas),
    )
    orden.lineas.append(linea)
    return linea


# Single-product fields removed from the order payload; must never come back.
SHIM_FIELDS = (
    "origen", "variedad", "insumo_id", "insumo_nombre", "insumo_unidad",
    "dosis_por_ha", "dias_carencia", "dias_reingreso",
)
