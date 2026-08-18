"""Tests para GET /produccion/valvulas.

Catalogo real de valvulas (poblado desde el GeoJSON via scripts/seed_valvulas.py,
ver backend/app/models/valvula.py) que reemplaza las listas hardcodeadas de
frontend/mobile. El cabezal es un atributo de la valvula, no de la parcela --
una misma parcela puede tener valvulas en cabezales distintos (caso real:
Parral 2).
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


async def test_list_valvulas_filtra_por_parcela(client, create_user, create_parcela, create_valvula):
    headers = await _auth(client, create_user)
    parral2 = await create_parcela(nombre="Parral 2")
    parral6 = await create_parcela(nombre="Parral 6")
    await create_valvula(parcela_id=parral2.id, nombre="21", cabezal=2, orden=1, lon=-68.394)
    await create_valvula(parcela_id=parral2.id, nombre="22", cabezal=1, orden=2, lon=-68.393)
    await create_valvula(parcela_id=parral6.id, nombre="61", cabezal=2, orden=1, lon=-68.398)

    resp = await client.get(f"/produccion/valvulas?parcela_id={parral2.id}", headers=headers)
    assert resp.status_code == 200
    nombres = [v["nombre"] for v in resp.json()]
    assert nombres == ["21", "22"]  # ordenadas por `orden` (oeste->este)


async def test_list_valvulas_una_parcela_puede_tener_mas_de_un_cabezal(
    client, create_user, create_parcela, create_valvula,
):
    """Caso real: Parral 2 tiene valvulas alimentadas por 2 cabezales distintos."""
    headers = await _auth(client, create_user)
    parral2 = await create_parcela(nombre="Parral 2")
    await create_valvula(parcela_id=parral2.id, nombre="21", cabezal=2, orden=1)
    await create_valvula(parcela_id=parral2.id, nombre="22", cabezal=1, orden=2)
    await create_valvula(parcela_id=parral2.id, nombre="23", cabezal=1, orden=3)

    resp = await client.get(f"/produccion/valvulas?parcela_id={parral2.id}", headers=headers)
    cabezales = {v["nombre"]: v["cabezal"] for v in resp.json()}
    assert cabezales == {"21": 2, "22": 1, "23": 1}


async def test_list_valvulas_filtra_por_cabezal(client, create_user, create_parcela, create_valvula):
    headers = await _auth(client, create_user)
    parral2 = await create_parcela(nombre="Parral 2")
    await create_valvula(parcela_id=parral2.id, nombre="21", cabezal=2, orden=1)
    await create_valvula(parcela_id=parral2.id, nombre="22", cabezal=1, orden=2)

    resp = await client.get("/produccion/valvulas?cabezal=2", headers=headers)
    nombres = [v["nombre"] for v in resp.json()]
    assert nombres == ["21"]


async def test_list_valvulas_requiere_autenticacion(client):
    resp = await client.get("/produccion/valvulas")
    assert resp.status_code == 401
