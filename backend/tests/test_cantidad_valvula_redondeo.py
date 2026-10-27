"""Pins the per-line quantity rounding of order confirmations (half-even to
0.01 on exact decimals). The mobile app shows the same number before the
operator confirms (mobile/lib/cantidad.ts, self-check in
mobile/scripts/check-cantidad.mjs): change both together or not at all."""
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.api.ordenes_aplicacion import _calcular_cantidad_linea, _superficie_valvula


@pytest.mark.parametrize(
    ("dosis", "superficie", "esperado"),
    [
        (1.5, "2.3500", "3.52"),  # 3.525 -> half-even down
        (0.15, "2.3500", "0.35"),  # 0.3525
        (2.0, "1.0050", "2.01"),  # 2.010
        (1.5, "2.4500", "3.68"),  # 3.675 -> half-even up
        (1.25, "2.0000", "2.50"),
        (1e-7, "1", "0.00"),  # str(float) exponent form
    ],
)
def test_cantidad_por_valvula(dosis: float, superficie: str, esperado: str) -> None:
    # Valve surface is Numeric(8, 4): it reaches the helper as a Decimal.
    valvula = SimpleNamespace(nombre="V1", superficie_ha=Decimal(superficie))
    cantidad = _calcular_cantidad_linea(dosis, _superficie_valvula(valvula))
    assert cantidad == Decimal(esperado)
    assert str(cantidad) == esperado
