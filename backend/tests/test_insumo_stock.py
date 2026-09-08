"""Catálogo de Insumo (409 por nombre duplicado, igual criterio que
Trabajador) y descuento/reversión de stock al crear, editar y borrar un
RegistroFitosanitario -- ver plan `flickering-percolating-raven.md`.
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


# ── Duplicados de nombre ────────────────────────────────────────────────────

async def test_crear_insumo_nombre_duplicado_exacto_rechaza(client, create_user):
    headers = await _auth(client, create_user)
    resp1 = await client.post("/insumos/", json={"nombre": "Azufre Micro", "unidad": "kg"}, headers=headers)
    assert resp1.status_code == 201

    resp2 = await client.post("/insumos/", json={"nombre": "Azufre Micro", "unidad": "kg"}, headers=headers)
    assert resp2.status_code == 409


async def test_crear_insumo_nombre_duplicado_con_tilde_y_mayusculas_rechaza(client, create_user):
    headers = await _auth(client, create_user)
    resp1 = await client.post("/insumos/", json={"nombre": "Rimón Supra", "unidad": "lt"}, headers=headers)
    assert resp1.status_code == 201

    resp2 = await client.post("/insumos/", json={"nombre": "  rimon supra  ", "unidad": "lt"}, headers=headers)
    assert resp2.status_code == 409
    assert "Rimón Supra" in resp2.json()["detail"]


async def test_crear_insumo_nombre_duplicado_de_inactivo_permite(client, create_user):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    resp1 = await client.post("/insumos/", json={"nombre": "Vivando", "unidad": "lt"}, headers=headers)
    assert resp1.status_code == 201
    insumo_id = resp1.json()["id"]

    desactivar = await client.put(f"/insumos/{insumo_id}", json={"is_active": False}, headers=headers)
    assert desactivar.status_code == 200

    resp2 = await client.post("/insumos/", json={"nombre": "Vivando", "unidad": "lt"}, headers=headers)
    assert resp2.status_code == 201


# ── Descuento / reversión de stock ──────────────────────────────────────────

async def _crear_fito(client, headers, parcela_id: str, insumo_id: str, dosis_por_ha: float = 2.0):
    return await client.post(
        "/produccion/fitosanitarios/",
        json={
            "fecha": "2026-09-08",
            "parcela_id": parcela_id,
            "insumo_id": insumo_id,
            "dosis_por_ha": dosis_por_ha,
            "motivo": "Preventivo",
            "dias_carencia": 7,
            "dias_reingreso": 2,
            "responsable": "Juan Perez",
        },
        headers=headers,
    )


async def test_crear_fitosanitario_descuenta_stock_segun_hectareas(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=5.0)
    insumo = await create_insumo(stock_actual=100.0)

    resp = await _crear_fito(client, headers, parcela.id, insumo.id, dosis_por_ha=2.0)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert float(body["cantidad_total"]) == 10.0  # 2.0 lt/ha * 5 ha
    assert body["unidad"] == insumo.unidad.value
    assert body["producto_nombre"] == insumo.nombre

    verificar = await client.get(f"/insumos/{insumo.id}", headers=headers)
    assert float(verificar.json()["stock_actual"]) == 90.0


async def test_editar_dosis_ajusta_stock_sin_duplicar_descuento(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=5.0)
    insumo = await create_insumo(stock_actual=100.0)

    creado = await _crear_fito(client, headers, parcela.id, insumo.id, dosis_por_ha=2.0)
    registro_id = creado.json()["id"]
    assert float((await client.get(f"/insumos/{insumo.id}", headers=headers)).json()["stock_actual"]) == 90.0

    editado = await client.put(
        f"/produccion/fitosanitarios/{registro_id}", json={"dosis_por_ha": 4.0}, headers=headers,
    )
    assert editado.status_code == 200, editado.text
    assert float(editado.json()["cantidad_total"]) == 20.0  # 4.0 lt/ha * 5 ha

    verificar = await client.get(f"/insumos/{insumo.id}", headers=headers)
    assert float(verificar.json()["stock_actual"]) == 80.0  # 100 - 20, no 100 - 10 - 20


async def test_borrar_fitosanitario_revierte_stock(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=5.0)
    insumo = await create_insumo(stock_actual=100.0)

    creado = await _crear_fito(client, headers, parcela.id, insumo.id, dosis_por_ha=2.0)
    registro_id = creado.json()["id"]
    assert float((await client.get(f"/insumos/{insumo.id}", headers=headers)).json()["stock_actual"]) == 90.0

    borrar = await client.delete(f"/produccion/fitosanitarios/{registro_id}", headers=headers)
    assert borrar.status_code == 204

    verificar = await client.get(f"/insumos/{insumo.id}", headers=headers)
    assert float(verificar.json()["stock_actual"]) == 100.0


async def test_crear_fitosanitario_sin_hectareas_en_parcela_rechaza(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=None)
    insumo = await create_insumo(stock_actual=100.0)

    resp = await _crear_fito(client, headers, parcela.id, insumo.id)
    assert resp.status_code == 422


async def test_reposicion_de_stock_suma_al_insumo(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(stock_actual=50.0)

    resp = await client.post(
        f"/insumos/{insumo.id}/movimientos",
        json={"tipo": "ingreso", "cantidad": 25.0, "fecha": "2026-09-08"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text

    verificar = await client.get(f"/insumos/{insumo.id}", headers=headers)
    assert float(verificar.json()["stock_actual"]) == 75.0
