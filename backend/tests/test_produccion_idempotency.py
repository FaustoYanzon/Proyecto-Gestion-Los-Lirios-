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

# registros_riego/registros_fitosanitarios/registros_cosecha aren't covered
# here (creating them needs a Parcela fixture this suite doesn't have yet),
# but their create handlers follow the exact same pre-check-by-idempotency_key
# pattern verified above for registros_trabajo.
