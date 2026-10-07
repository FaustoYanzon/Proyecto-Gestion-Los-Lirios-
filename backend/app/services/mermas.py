"""Cálculo de mermas del módulo Alta de Producción. Funciones puras (sin DB)
para poder testearlas directo; las cantidades siempre `Decimal`."""
from __future__ import annotations

from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal

CENTAVO = Decimal("0.01")


def _q(valor: Decimal) -> Decimal:
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def kg_teorico_ingreso(fichas: int, kg_por_ficha: Decimal) -> Decimal:
    """Kg teóricos de un ingreso al pasero (fichas x kg por ficha)."""
    return _q(Decimal(fichas) * kg_por_ficha)


def merma_ingreso(kg_teorico: Decimal, kg_real: Decimal) -> Decimal:
    """Merma de un ingreso al pasero: teórico - báscula. Positiva = merma;
    negativa = la báscula pesó más de lo esperado."""
    return _q(kg_teorico - kg_real)


def uva_consumida(kg_pasa: Decimal, ratio_uva_pasa: Decimal) -> Decimal:
    """Uva fresca que se descuenta del pasero al levantar `kg_pasa`."""
    return _q(kg_pasa * ratio_uva_pasa)


def pasa_maxima(uva_disponible: Decimal, ratio_uva_pasa: Decimal) -> Decimal:
    """Pasa máxima que se puede levantar con la uva disponible."""
    if ratio_uva_pasa <= 0:
        raise ValueError("El ratio uva/pasa debe ser mayor a cero")
    # Hacia abajo: nunca se promete más pasa que la que alcanza la uva.
    return (uva_disponible / ratio_uva_pasa).quantize(CENTAVO, rounding=ROUND_DOWN)


def merma_bines(cantidad_bines: int, kg_nominal_bin: Decimal, kg_real: Decimal) -> Decimal:
    """Diferencia entre el peso nominal de los bines (cantidad x nominal) y lo
    que realmente pesaron. Positiva = pesaron menos que el nominal."""
    return _q(Decimal(cantidad_bines) * kg_nominal_bin - kg_real)


def balance_levantada(
    uva_ingresada_kg: Decimal, pasa_levantada_kg: Decimal, ratio_uva_pasa: Decimal
) -> dict[str, Decimal]:
    """Cierra el balance uva fresca -> pasa de un pasero/variedad.

    `pasa_esperada` es lo que la fórmula 4:1 prevé para toda la uva ingresada;
    `diferencia_pasa` = levantada - esperada (negativa mientras falte levantar
    o si el rendimiento real fue peor que el teórico).
    """
    pasa_esperada = pasa_maxima(uva_ingresada_kg, ratio_uva_pasa)
    uva_consumida_kg = uva_consumida(pasa_levantada_kg, ratio_uva_pasa)
    return {
        "uva_ingresada_kg": _q(uva_ingresada_kg),
        "uva_consumida_kg": uva_consumida_kg,
        "uva_disponible_kg": _q(uva_ingresada_kg - uva_consumida_kg),
        "pasa_levantada_kg": _q(pasa_levantada_kg),
        "pasa_esperada_kg": pasa_esperada,
        "diferencia_pasa_kg": _q(pasa_levantada_kg - pasa_esperada),
    }
