"""Shared helpers for tests that build OrdenAplicacion rows directly (without
going through the API). Since the multi-product model every order carries at
least one line (OrdenAplicacionInsumo); production code does not fall back to
the deprecated single-product columns when an order has none.
"""
from __future__ import annotations

from app.models.produccion import OrdenAplicacion, OrdenAplicacionInsumo


def add_linea_desde_shim(orden: OrdenAplicacion) -> OrdenAplicacionInsumo:
    """Append the order's single line, copied from its legacy shim columns."""
    linea = OrdenAplicacionInsumo(
        insumo_id=orden.insumo_id,
        dosis_por_ha=orden.dosis_por_ha,
        dias_carencia=orden.dias_carencia,
        dias_reingreso=orden.dias_reingreso,
        posicion=len(orden.lineas),
    )
    orden.lineas.append(linea)
    return linea
