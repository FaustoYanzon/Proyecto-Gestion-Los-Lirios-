"""Volumetric irrigation compliance, shared by every endpoint that reports it.

Why volumes: each RegistroRiego stores `mm_aplicados` = hours x 1.6 (x manto
factor) as the depth over the ONE hectare of that valve, not over the whole
parcela. Summing it across the valves of a parcela inflates compliance (4 valves
x 24 h = 153.6 "mm" vs 38.4 expected = 400 %) although it is physically ONE
standard riego. Comparing litres (applied) against litres (expected for the
parcela surface) removes that distortion.
"""

from __future__ import annotations

from app.core import ciclo_campana
from app.models.produccion import RegistroRiego

# 1 mm over 1 ha = 10 m3 = 10 000 L.
LITROS_POR_MM_HA: float = 10_000.0


def litros_de_registro(
    duracion_horas: float | None,
    tipo: object,
    valvula: str | None,
    n_valvulas_manto: int | None,
) -> float:
    """Litres delivered by one riego record (0.0 while it is still in progress).

    Same formula as RegistroRiego.litros_aplicados, usable on raw columns so SQL
    rows do not need to be hydrated into ORM objects.
    """
    if duracion_horas is None:
        return 0.0
    return (
        duracion_horas
        * RegistroRiego.LITROS_POR_HORA_VALVULA
        * RegistroRiego.factor_caudal(tipo, n_valvulas_manto)
        * RegistroRiego.contar_valvulas(valvula, n_valvulas_manto)
    )


def _superficie_valida(superficie_ha: float | None) -> bool:
    return superficie_ha is not None and superficie_ha > 0


def litros_por_riego_estandar(superficie_ha: float | None) -> float | None:
    """Litres of ONE standard riego (38.4 mm) over the whole parcela."""
    if not _superficie_valida(superficie_ha):
        return None
    return ciclo_campana.MM_POR_RIEGO_ESTANDAR * superficie_ha * LITROS_POR_MM_HA


def litros_esperados(riegos_esperados: float, superficie_ha: float | None) -> float | None:
    """Expected litres = riegos x 38.4 mm x surface x 10 000; None without surface."""
    por_riego = litros_por_riego_estandar(superficie_ha)
    return None if por_riego is None else riegos_esperados * por_riego


def lamina_mm(litros: float, superficie_ha: float | None) -> float | None:
    """Equivalent depth (mm) spread over the whole parcela."""
    if not _superficie_valida(superficie_ha):
        return None
    return litros / (superficie_ha * LITROS_POR_MM_HA)


def riegos_equivalentes(litros: float, superficie_ha: float | None) -> float | None:
    """How many standard riegos of the whole parcela the litres represent."""
    por_riego = litros_por_riego_estandar(superficie_ha)
    return None if por_riego is None else litros / por_riego


def cumplimiento_pct(
    litros: float, riegos_esperados: float, superficie_ha: float | None,
) -> float | None:
    """Applied / expected x 100; None without surface or without expected riegos."""
    esperados = litros_esperados(riegos_esperados, superficie_ha)
    if not esperados:
        return None
    return litros / esperados * 100
