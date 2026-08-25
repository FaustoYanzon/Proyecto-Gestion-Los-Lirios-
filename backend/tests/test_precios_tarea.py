"""Maestro de precios por tarea -- CRUD y los 2 índices únicos parciales
(uno para reglas específicas de parcela, otro para la regla general con
parcela_id NULL, ver backend/app/models/precio_tarea.py).
"""
from __future__ import annotations

from app.models.user import UserRole


async def _auth(client, create_user, role: UserRole = UserRole.gerencial):
    await create_user(email="gerencial@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "gerencial@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_crear_y_listar_precio_general(client, create_user):
    headers = await _auth(client, create_user)
    resp = await client.post(
        "/precios-tarea/",
        json={"temporada": 2026, "tarea": "Poda", "unidad_medida": "dias", "precio_unitario": "5000"},
        headers=headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["parcela_id"] is None
    assert body["parcela_nombre"] is None

    listado = await client.get("/precios-tarea/?temporada=2026", headers=headers)
    assert len(listado.json()) == 1


async def test_crear_precio_especifico_de_parcela(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(nombre="Parral Test")

    resp = await client.post(
        "/precios-tarea/",
        json={
            "temporada": 2026, "tarea": "Cosecha", "parcela_id": parcela.id,
            "unidad_medida": "cajas", "precio_unitario": "1200",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["parcela_nombre"] == "Parral Test"


async def test_precio_especifico_duplicado_da_409(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    payload = {
        "temporada": 2026, "tarea": "Cosecha", "parcela_id": parcela.id,
        "unidad_medida": "cajas", "precio_unitario": "1200",
    }
    primero = await client.post("/precios-tarea/", json=payload, headers=headers)
    assert primero.status_code == 201

    segundo = await client.post("/precios-tarea/", json=payload, headers=headers)
    assert segundo.status_code == 409


async def test_precio_general_duplicado_da_409(client, create_user):
    headers = await _auth(client, create_user)
    payload = {"temporada": 2026, "tarea": "Riego", "unidad_medida": "dias", "precio_unitario": "3000"}
    primero = await client.post("/precios-tarea/", json=payload, headers=headers)
    assert primero.status_code == 201

    segundo = await client.post("/precios-tarea/", json=payload, headers=headers)
    assert segundo.status_code == 409


async def test_misma_tarea_distinta_unidad_no_choca(client, create_user):
    headers = await _auth(client, create_user)
    a = await client.post(
        "/precios-tarea/",
        json={"temporada": 2026, "tarea": "Poda", "unidad_medida": "dias", "precio_unitario": "5000"},
        headers=headers,
    )
    b = await client.post(
        "/precios-tarea/",
        json={"temporada": 2026, "tarea": "Poda", "unidad_medida": "plantas", "precio_unitario": "150"},
        headers=headers,
    )
    assert a.status_code == 201
    assert b.status_code == 201


async def test_misma_tarea_general_y_especifica_conviven(client, create_user, create_parcela):
    """El fallback: puede haber una regla general (parcela_id null) y una
    específica para el mismo tarea/temporada/unidad al mismo tiempo -- son
    índices distintos, no chocan entre sí."""
    headers = await _auth(client, create_user)
    parcela = await create_parcela()

    general = await client.post(
        "/precios-tarea/",
        json={"temporada": 2026, "tarea": "Cosecha", "unidad_medida": "cajas", "precio_unitario": "1000"},
        headers=headers,
    )
    especifico = await client.post(
        "/precios-tarea/",
        json={
            "temporada": 2026, "tarea": "Cosecha", "parcela_id": parcela.id,
            "unidad_medida": "cajas", "precio_unitario": "1500",
        },
        headers=headers,
    )
    assert general.status_code == 201
    assert especifico.status_code == 201


async def test_misma_temporada_distinta_no_choca(client, create_user):
    headers = await _auth(client, create_user)
    payload_2026 = {"temporada": 2026, "tarea": "Poda", "unidad_medida": "dias", "precio_unitario": "5000"}
    payload_2027 = {"temporada": 2027, "tarea": "Poda", "unidad_medida": "dias", "precio_unitario": "6000"}
    a = await client.post("/precios-tarea/", json=payload_2026, headers=headers)
    b = await client.post("/precios-tarea/", json=payload_2027, headers=headers)
    assert a.status_code == 201
    assert b.status_code == 201

    # El precio de la campaña vieja no se pisa al crear el de la nueva.
    listado = await client.get("/precios-tarea/?tarea=Poda", headers=headers)
    precios = {p["temporada"]: float(p["precio_unitario"]) for p in listado.json()}
    assert precios[2026] == 5000.0
    assert precios[2027] == 6000.0


async def test_update_precio(client, create_user):
    headers = await _auth(client, create_user)
    creado = await client.post(
        "/precios-tarea/",
        json={"temporada": 2026, "tarea": "Poda", "unidad_medida": "dias", "precio_unitario": "5000"},
        headers=headers,
    )
    precio_id = creado.json()["id"]

    actualizado = await client.put(
        f"/precios-tarea/{precio_id}", json={"precio_unitario": "5500"}, headers=headers
    )
    assert actualizado.status_code == 200
    assert float(actualizado.json()["precio_unitario"]) == 5500.0


async def test_delete_precio(client, create_user):
    headers = await _auth(client, create_user)
    creado = await client.post(
        "/precios-tarea/",
        json={"temporada": 2026, "tarea": "Poda", "unidad_medida": "dias", "precio_unitario": "5000"},
        headers=headers,
    )
    precio_id = creado.json()["id"]

    borrado = await client.delete(f"/precios-tarea/{precio_id}", headers=headers)
    assert borrado.status_code == 204

    listado = await client.get("/precios-tarea/", headers=headers)
    assert listado.json() == []


async def test_encargado_puede_leer_pero_no_crear(client, create_user):
    headers = await _auth(client, create_user, role=UserRole.encargado)

    listado = await client.get("/precios-tarea/", headers=headers)
    assert listado.status_code == 200

    creado = await client.post(
        "/precios-tarea/",
        json={"temporada": 2026, "tarea": "Poda", "unidad_medida": "dias", "precio_unitario": "5000"},
        headers=headers,
    )
    assert creado.status_code == 403


async def test_precio_con_parcela_inexistente_da_404(client, create_user):
    headers = await _auth(client, create_user)
    resp = await client.post(
        "/precios-tarea/",
        json={
            "temporada": 2026, "tarea": "Cosecha", "parcela_id": "no-existe",
            "unidad_medida": "cajas", "precio_unitario": "1200",
        },
        headers=headers,
    )
    assert resp.status_code == 404
