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


def test_potrero_3_se_carga_como_excepcion_y_no_pisa_ningun_cuadrante():
    """Las válvulas 31 y 32 (Potrero 3, 2,20 ha) no tienen cuadrante: Fausto confirmó
    repartirlas 1,10 ha cada una (2026-10-23). Una excepción jamás reemplaza a un cuadrante real."""
    mod = _load()
    superficies = mod.superficies_por_valvula()
    assert superficies["31"] == Decimal("1.1000")
    assert superficies["32"] == Decimal("1.1000")
    assert not set(mod.EXCEPCIONES_HA) & set(mod.superficies_de_cuadrantes())
