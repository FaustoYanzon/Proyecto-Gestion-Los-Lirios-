"""POST /trabajadores/ rechaza un nombre que ya existe (activo), comparado
sin importar mayus/minus ni tildes -- defensa de servidor para que no se
puedan recrear los duplicados que normalizar_trabajadores.py fusiono.
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


async def test_crear_trabajador_nombre_duplicado_exacto_rechaza(client, create_user):
    headers = await _auth(client, create_user)
    resp1 = await client.post("/trabajadores/", json={"nombre_completo": "Jose Perez"}, headers=headers)
    assert resp1.status_code == 201

    resp2 = await client.post("/trabajadores/", json={"nombre_completo": "Jose Perez"}, headers=headers)
    assert resp2.status_code == 409


async def test_crear_trabajador_nombre_duplicado_con_tilde_y_mayusculas_rechaza(client, create_user):
    headers = await _auth(client, create_user)
    resp1 = await client.post("/trabajadores/", json={"nombre_completo": "José Pérez"}, headers=headers)
    assert resp1.status_code == 201

    resp2 = await client.post("/trabajadores/", json={"nombre_completo": "  jose perez  "}, headers=headers)
    assert resp2.status_code == 409
    assert "José Pérez" in resp2.json()["detail"]


async def test_crear_trabajador_nombre_duplicado_de_inactivo_permite(client, create_user):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    resp1 = await client.post("/trabajadores/", json={"nombre_completo": "Ana Gomez"}, headers=headers)
    assert resp1.status_code == 201
    trabajador_id = resp1.json()["id"]

    desactivar = await client.delete(f"/trabajadores/{trabajador_id}", headers=headers)
    assert desactivar.status_code == 204

    resp2 = await client.post("/trabajadores/", json={"nombre_completo": "Ana Gomez"}, headers=headers)
    assert resp2.status_code == 201
