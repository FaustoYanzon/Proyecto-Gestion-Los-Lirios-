"""Riego a manto (2026-10-05): mismas valvulas como referencia de hasta donde
llega el agua, pero litros y mm al 40% del caudal de goteo.
Run with: pytest
"""
from __future__ import annotations

from app.models.user import UserRole


async def _auth(client, create_user, role: UserRole = UserRole.encargado):
    await create_user(email="encargado@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "encargado@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _payload(parcela_id: str, **extra) -> dict:
    return {
        "fecha": "2026-10-05",
        "parcela_id": parcela_id,
        "cabezal": "1",
        "valvula": "1,2",
        "inicio": "2026-10-05T08:00:00",
        "fin": "2026-10-05T18:00:00",
        "responsable": "Juan Perez",
        **extra,
    }


async def test_riego_sin_tipo_es_goteo(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    resp = await client.post("/produccion/riego/", json=_payload(parcela.id), headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["tipo"] == "goteo"
    assert data["litros_aplicados"] == 10 * 16_000 * 2
    assert data["mm_aplicados"] == 16.0


async def test_riego_manto_aplica_40_por_ciento(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    resp = await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["tipo"] == "manto"
    assert data["litros_aplicados"] == 10 * 6_400 * 2
    assert data["mm_aplicados"] == 6.4


async def test_cambiar_tipo_recalcula_mm(client, create_user, create_parcela):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela()
    creado = (await client.post("/produccion/riego/", json=_payload(parcela.id), headers=headers)).json()

    resp = await client.put(f"/produccion/riego/{creado['id']}", json={"tipo": "manto"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["mm_aplicados"] == 6.4
    assert resp.json()["litros_aplicados"] == 10 * 6_400 * 2


async def test_iniciar_y_terminar_manto(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    iniciado = await client.post(
        "/produccion/riego/iniciar",
        json={"parcela_id": parcela.id, "cabezal": "1", "valvula": "3", "tipo": "manto",
              "responsable": "Juan Perez"},
        headers=headers,
    )
    assert iniciado.status_code == 201
    assert iniciado.json()["tipo"] == "manto"

    inicio = iniciado.json()["inicio"].replace("Z", "+00:00")
    from datetime import datetime, timedelta
    fin = (datetime.fromisoformat(inicio) + timedelta(hours=5)).isoformat()
    terminado = await client.post(
        f"/produccion/riego/{iniciado.json()['id']}/terminar", json={"fin": fin}, headers=headers
    )

    assert terminado.status_code == 200
    assert terminado.json()["mm_aplicados"] == 3.2
    assert terminado.json()["litros_aplicados"] == 5 * 6_400


# --- Model rules: manto by surface (no DB) ---

from datetime import datetime, timezone  # noqa: E402

import pytest  # noqa: E402

from app.models.parcela import TipoRiego  # noqa: E402
from app.models.produccion import RegistroRiego  # noqa: E402


def _registro(**extra) -> RegistroRiego:
    return RegistroRiego(
        inicio=datetime(2026, 10, 5, 8, tzinfo=timezone.utc),
        fin=datetime(2026, 10, 5, 18, tzinfo=timezone.utc),
        **extra,
    )


def test_manto_nuevo_usa_factor_025_y_n_guardado() -> None:
    r = _registro(tipo=TipoRiego.manto, n_valvulas_manto=3, cabezal=None, valvula=None)
    assert r.litros_aplicados == 120_000.0
    assert r.mm_aplicados == 4.0
    assert r.n_valvulas == 3
    assert r.factor_aplicado == 0.25


def test_manto_historico_conserva_factor_04() -> None:
    r = _registro(tipo=TipoRiego.manto, valvula="1,2", n_valvulas_manto=None)
    assert r.litros_aplicados == 128_000.0
    assert r.mm_aplicados == 6.4
    assert r.n_valvulas == 2
    assert r.factor_aplicado == 0.4


def test_goteo_no_cambia() -> None:
    r = _registro(tipo=TipoRiego.goteo, valvula="1,2")
    assert r.litros_aplicados == 320_000.0
    assert r.mm_aplicados == 16.0
    assert r.factor_aplicado == 1.0


@pytest.mark.parametrize(
    "ha,esperado",
    [(3.0, 3), (2.3, 3), (2.85, 3), (1.0, 1), (0.4, 1), (3.0000000000000004, 3)],
)
def test_valvulas_manto_de(ha: float, esperado: int) -> None:
    assert RegistroRiego.valvulas_manto_de(ha) == esperado
