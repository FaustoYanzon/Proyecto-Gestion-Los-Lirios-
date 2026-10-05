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
