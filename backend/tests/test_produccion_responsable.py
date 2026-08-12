"""Tests for responsable_id on RegistroRiego / RegistroFitosanitario.

Extiende a Riego y Fitosanitarios el mismo patrón de trabajador_id que ya
tenía Tareas desde el 2026-08-05: si el cliente manda un responsable_id
válido, el backend lo valida contra el catálogo de Trabajador y sincroniza
el campo `responsable` (texto denormalizado) con su nombre completo.
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


async def _crear_trabajador(client, headers, nombre: str) -> str:
    resp = await client.post("/trabajadores/", json={"nombre_completo": nombre}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


# --- registros_riego -----------------------------------------------------------


async def test_riego_iniciar_con_responsable_id_sincroniza_nombre(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    trabajador_id = await _crear_trabajador(client, headers, "Juan Perez")

    resp = await client.post(
        "/produccion/riego/iniciar",
        json={
            "parcela_id": parcela.id,
            "cabezal": "C1",
            "valvula": "V1",
            # nombre distinto a propósito -- el backend debe pisarlo con el
            # nombre real del Trabajador vinculado, no quedarse con este.
            "responsable": "nombre viejo sin actualizar",
            "responsable_id": trabajador_id,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["responsable"] == "Juan Perez"
    assert resp.json()["responsable_id"] == trabajador_id


async def test_riego_con_responsable_id_inexistente_da_404(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()

    resp = await client.post(
        "/produccion/riego/",
        json={
            "fecha": "2026-08-12",
            "parcela_id": parcela.id,
            "cabezal": "C1",
            "valvula": "V1",
            "inicio": "2026-08-12T08:00:00",
            "fin": "2026-08-12T10:00:00",
            "responsable": "Alguien",
            "responsable_id": "no-existe",
        },
        headers=headers,
    )
    assert resp.status_code == 404


# --- registros_fitosanitarios ---------------------------------------------------


async def test_fitosanitario_con_responsable_id_sincroniza_nombre(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    trabajador_id = await _crear_trabajador(client, headers, "Maria Lopez")

    resp = await client.post(
        "/produccion/fitosanitarios/",
        json={
            "fecha": "2026-08-12",
            "parcela_id": parcela.id,
            "producto_nombre": "Cobre",
            "dosis_lt_ha": 1.5,
            "motivo": "Preventivo",
            "dias_carencia": 7,
            "dias_reingreso": 2,
            "responsable": "nombre viejo sin actualizar",
            "responsable_id": trabajador_id,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["responsable"] == "Maria Lopez"
    assert resp.json()["responsable_id"] == trabajador_id
