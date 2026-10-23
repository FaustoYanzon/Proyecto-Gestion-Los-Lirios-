"""Cálculo de superficie de los cuadrantes de riego (scripts/cargar_superficie_valvulas.py)."""
from __future__ import annotations

import importlib.util
import math
from decimal import Decimal
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "cargar_superficie_valvulas.py"


def _load():
    spec = importlib.util.spec_from_file_location("cargar_superficie_valvulas", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _cuadrado(lat: float, lon: float, lado_m: float) -> list[list[float]]:
    dlat = lado_m / 111_320.0
    dlon = lado_m / (111_320.0 * math.cos(math.radians(lat)))
    return [
        [lon, lat], [lon + dlon, lat], [lon + dlon, lat + dlat],
        [lon, lat + dlat], [lon, lat],
    ]


def test_area_ha_cuadrado_100m():
    area = _load().area_ha(_cuadrado(-33.0, -68.4, 100.0))
    assert isinstance(area, Decimal)
    assert abs(area - Decimal("1.0")) < Decimal("0.01")


def test_area_ha_no_depende_del_sentido_del_anillo():
    anillo = _cuadrado(-33.0, -68.4, 200.0)
    mod = _load()
    assert mod.area_ha(anillo) == mod.area_ha(list(reversed(anillo)))
