"""Regression tests for the 2026-07-29 duplicate-tasks incident.

The client-side useRef guards (2026-07-17, 2026-07-27) don't cover a user
manually resubmitting a form seconds after a slow response, once the guard
has already reset — the actual mechanism behind that incident. These tests
lock in the two fixes: idempotency_key dedup on the 4 production models, and
the defensive rejection of a repeated trabajador name within one masivo
carga. Run with: pytest
"""
from __future__ import annotations

from app.models.user import UserRole


async def _token(client, create_user, role: UserRole = UserRole.encargado) -> str:
    await create_user(email="encargado@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "encargado@test.com", "password": "Password123!"},
    )
    return resp.json()["access_token"]


async def _auth(client, create_user, role: UserRole = UserRole.encargado):
    token = await _token(client, create_user, role)
    return {"Authorization": f"Bearer {token}"}


# --- registros_trabajo ---------------------------------------------------------


async def test_trabajo_masivo_retried_with_same_key_does_not_duplicate(client, create_user):
    headers = await _auth(client, create_user)
    payload = {
        "fecha": "2026-07-29",
        "tarea": "Poda",
        "unidad_medida": "dias",
        "precio_unitario": "1000",
        "trabajadores": [{"trabajador_nombre": "Juan Perez", "cantidad": "1"}],
        "idempotency_key": "test-key-trabajo-masivo-1",
    }
    first = await client.post("/produccion/trabajo/masivo", json=payload, headers=headers)
    second = await client.post("/produccion/trabajo/masivo", json=payload, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert [r["id"] for r in first.json()] == [r["id"] for r in second.json()]

    listado = await client.get("/produccion/trabajo/", headers=headers)
    assert len(listado.json()) == 1


async def test_trabajo_masivo_rejects_repeated_worker_in_same_carga(client, create_user):
    headers = await _auth(client, create_user)
    payload = {
        "fecha": "2026-07-29",
        "tarea": "Poda",
        "unidad_medida": "dias",
        "precio_unitario": "1000",
        "trabajadores": [
            {"trabajador_nombre": "Juan Perez", "cantidad": "1"},
            {"trabajador_nombre": "juan perez", "cantidad": "2"},  # same name, different case/qty
        ],
    }
    resp = await client.post("/produccion/trabajo/masivo", json=payload, headers=headers)
    assert resp.status_code == 400

    listado = await client.get("/produccion/trabajo/", headers=headers)
    assert len(listado.json()) == 0


async def test_trabajo_single_retried_with_same_key_does_not_duplicate(client, create_user):
    headers = await _auth(client, create_user)
    payload = {
        "fecha": "2026-07-29",
        "trabajador_nombre": "Maria Lopez",
        "tarea": "Verde",
        "cantidad": "1",
        "unidad_medida": "dias",
        "precio_unitario": "1000",
        "idempotency_key": "test-key-trabajo-single-1",
    }
    first = await client.post("/produccion/trabajo/", json=payload, headers=headers)
    second = await client.post("/produccion/trabajo/", json=payload, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    listado = await client.get("/produccion/trabajo/", headers=headers)
    assert len(listado.json()) == 1


# --- registros_riego ---------------------------------------------------------


async def test_riego_retried_with_same_key_does_not_duplicate(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    payload = {
        "fecha": "2026-07-29",
        "parcela_id": parcela.id,
        "cabezal": "C1",
        "valvula": "V1",
        "inicio": "2026-07-29T08:00:00",
        "fin": "2026-07-29T10:00:00",
        "responsable": "Juan Perez",
        "idempotency_key": "test-key-riego-1",
    }
    first = await client.post("/produccion/riego/", json=payload, headers=headers)
    second = await client.post("/produccion/riego/", json=payload, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    listado = await client.get("/produccion/riego/", headers=headers)
    assert len(listado.json()) == 1


async def test_riego_iniciar_retried_with_same_key_does_not_duplicate(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    payload = {
        "parcela_id": parcela.id,
        "cabezal": "C1",
        "valvula": "V1",
        "responsable": "Juan Perez",
        "idempotency_key": "test-key-riego-iniciar-1",
    }
    first = await client.post("/produccion/riego/iniciar", json=payload, headers=headers)
    second = await client.post("/produccion/riego/iniciar", json=payload, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    listado = await client.get("/produccion/riego/en-curso", headers=headers)
    assert len(listado.json()) == 1


# --- registros_fitosanitarios -------------------------------------------------


async def test_fitosanitario_retried_with_same_key_does_not_duplicate(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    payload = {
        "fecha": "2026-07-29",
        "parcela_id": parcela.id,
        "producto_nombre": "Cobre",
        "dosis_lt_ha": 1.5,
        "motivo": "Preventivo",
        "dias_carencia": 7,
        "dias_reingreso": 2,
        "responsable": "Juan Perez",
        "idempotency_key": "test-key-fito-1",
    }
    first = await client.post("/produccion/fitosanitarios/", json=payload, headers=headers)
    second = await client.post("/produccion/fitosanitarios/", json=payload, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    listado = await client.get("/produccion/fitosanitarios/", headers=headers)
    assert len(listado.json()) == 1


# --- registros_cosecha ---------------------------------------------------------


async def test_cosecha_retried_with_same_key_does_not_duplicate(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    payload = {
        "fecha": "2026-07-29",
        "parcela_id": parcela.id,
        "destino": "MI",
        "kg_total": 500,
        "idempotency_key": "test-key-cosecha-1",
    }
    first = await client.post("/produccion/cosecha/", json=payload, headers=headers)
    second = await client.post("/produccion/cosecha/", json=payload, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    listado = await client.get("/produccion/cosecha/", headers=headers)
    assert len(listado.json()) == 1
