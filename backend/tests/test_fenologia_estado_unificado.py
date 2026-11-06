"""Fenologia estado-actual reads the per-variedad store (EstadoVariedadCampana),
the same one behind /estado-campana/actual. CicloCampana (per parcela) no
longer drives it.
Run with: pytest
"""
from __future__ import annotations

from datetime import date, timedelta

from app.api.produccion import UMBRAL_VIGENCIA_MANUAL_DIAS, _campana_actual
from app.core import ciclo_campana
from app.models.parcela import VariedadUva
from app.models.produccion import EstadoCampana
from app.models.user import UserRole


async def _auth(client, create_user) -> dict:
    await create_user(email="g@test.com", password="Password123!", role=UserRole.gerencial)
    resp = await client.post(
        "/auth/login", data={"username": "g@test.com", "password": "Password123!"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _otro_estado(auto: EstadoCampana) -> EstadoCampana:
    return next(e for e in EstadoCampana if e != auto)


async def _setup(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    await create_parcela(nombre="P1", variedad=VariedadUva.syrah)
    await create_parcela(nombre="P2", variedad=VariedadUva.bonarda)
    return headers


def _por_variedad(items: list[dict]) -> dict[str, dict]:
    return {i["variedad"]: i for i in items}


async def test_override_store_b_drives_fenologia(client, create_user, create_parcela):
    headers = await _setup(client, create_user, create_parcela)
    hoy = date.today()
    auto = ciclo_campana.calcular_estado_actual(hoy)
    manual = _otro_estado(auto)

    resp = await client.post(
        "/produccion/estado-campana/",
        json={
            "variedad": "syrah",
            "anio": _campana_actual(hoy),
            "estado_campana": manual.value,
            "fecha_confirmacion": hoy.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 201

    fen = _por_variedad((await client.get("/produccion/fenologia/estado-actual", headers=headers)).json())
    assert fen["syrah"]["estado_fenologico"] == manual.value
    assert fen["syrah"]["fase"] == manual.value
    assert fen["syrah"]["fuente"] == "manual"
    assert fen["syrah"]["fecha_confirmacion"] == hoy.isoformat()
    assert fen["bonarda"]["estado_fenologico"] == auto.value
    assert fen["bonarda"]["fuente"] == "automatico"

    # Same answer as the estado-campana endpoint.
    ec = _por_variedad((await client.get("/produccion/estado-campana/actual", headers=headers)).json())
    assert ec["syrah"]["estado_campana"] == fen["syrah"]["estado_fenologico"]
    assert ec["bonarda"]["estado_campana"] == fen["bonarda"]["estado_fenologico"]


async def test_old_ciclo_campana_row_is_ignored(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(nombre="P1", variedad=VariedadUva.syrah)
    hoy = date.today()
    auto = ciclo_campana.calcular_estado_actual(hoy)

    resp = await client.post(
        "/produccion/campana/",
        json={
            "parcela_id": parcela.id,
            "anio": _campana_actual(hoy),
            "estado_fenologico": _otro_estado(auto).value,
            "fecha_estado": hoy.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 201

    fen = _por_variedad((await client.get("/produccion/fenologia/estado-actual", headers=headers)).json())
    assert fen["syrah"]["estado_fenologico"] == auto.value
    assert fen["syrah"]["fuente"] == "automatico"
    assert fen["syrah"]["fecha_confirmacion"] is None


async def test_stale_override_falls_back_to_automatic(client, create_user, create_parcela):
    headers = await _setup(client, create_user, create_parcela)
    hoy = date.today()
    auto = ciclo_campana.calcular_estado_actual(hoy)
    vieja = hoy - timedelta(days=UMBRAL_VIGENCIA_MANUAL_DIAS + 1)

    resp = await client.post(
        "/produccion/estado-campana/",
        json={
            "variedad": "syrah",
            "anio": _campana_actual(hoy),
            "estado_campana": _otro_estado(auto).value,
            "fecha_confirmacion": vieja.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 201

    fen = _por_variedad((await client.get("/produccion/fenologia/estado-actual", headers=headers)).json())
    assert fen["syrah"]["estado_fenologico"] == auto.value
    assert fen["syrah"]["fuente"] == "automatico"
