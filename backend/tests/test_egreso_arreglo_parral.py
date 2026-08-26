"""Cubre la clasificación financiera de "Arreglo Parral"/"Arreglo Riego":
estas tareas no son mano de obra sino inversión/reparación cargada a través
del mecanismo de Tarea, así que su Egreso generado debe usar
TipoEgreso.repuestos_reparacion (no sueldos_personal), y ese Egreso debe
re-clasificarse solo si se edita la tarea de un registro ya cargado.
"""
from __future__ import annotations

from app.models.user import UserRole


async def _auth(client, create_user, role: UserRole = UserRole.gerencial):
    await create_user(email="gerencial@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "gerencial@test.com", "password": "Password123!"},
    )
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _egreso_vinculado(client, headers) -> dict:
    listado = await client.get("/finanzas/egresos/", headers=headers)
    egresos = [e for e in listado.json() if e["fuente"] == "trabajo_diario"]
    assert len(egresos) == 1
    return egresos[0]


async def test_arreglo_parral_genera_egreso_repuestos_reparacion(client, create_user):
    headers = await _auth(client, create_user)
    payload = {
        "fecha": "2026-08-25",
        "trabajador_nombre": "Juan Perez",
        "tarea": "Arreglo Parral",
        "cantidad": "1",
        "unidad_medida": "dias",
        "precio_unitario": "500000",
    }
    resp = await client.post("/produccion/trabajo/", json=payload, headers=headers)
    assert resp.status_code == 201

    egreso = await _egreso_vinculado(client, headers)
    assert egreso["tipo"] == "repuestos_reparacion"
    assert egreso["clasificacion"] == "rep_repuestos_parral"


async def test_arreglo_riego_genera_egreso_repuestos_reparacion(client, create_user):
    headers = await _auth(client, create_user)
    payload = {
        "fecha": "2026-08-25",
        "trabajador_nombre": "Juan Perez",
        "tarea": "Arreglo Riego",
        "cantidad": "1",
        "unidad_medida": "dias",
        "precio_unitario": "300000",
    }
    resp = await client.post("/produccion/trabajo/", json=payload, headers=headers)
    assert resp.status_code == 201

    egreso = await _egreso_vinculado(client, headers)
    assert egreso["tipo"] == "repuestos_reparacion"
    assert egreso["clasificacion"] == "rep_repuestos_riego"


async def test_tarea_normal_sigue_generando_sueldos_obreros(client, create_user):
    headers = await _auth(client, create_user)
    payload = {
        "fecha": "2026-08-25",
        "trabajador_nombre": "Juan Perez",
        "tarea": "Jornal Comun",
        "cantidad": "1",
        "unidad_medida": "dias",
        "precio_unitario": "30000",
    }
    resp = await client.post("/produccion/trabajo/", json=payload, headers=headers)
    assert resp.status_code == 201

    egreso = await _egreso_vinculado(client, headers)
    assert egreso["tipo"] == "sueldos_personal"
    assert egreso["clasificacion"] == "obreros"


async def test_editar_tarea_reclasifica_egreso_vinculado(client, create_user):
    headers = await _auth(client, create_user)
    payload = {
        "fecha": "2026-08-25",
        "trabajador_nombre": "Juan Perez",
        "tarea": "Jornal Comun",
        "cantidad": "1",
        "unidad_medida": "dias",
        "precio_unitario": "30000",
    }
    resp = await client.post("/produccion/trabajo/", json=payload, headers=headers)
    registro_id = resp.json()["id"]

    egreso_antes = await _egreso_vinculado(client, headers)
    assert egreso_antes["tipo"] == "sueldos_personal"

    put_resp = await client.put(
        f"/produccion/trabajo/{registro_id}",
        json={"tarea": "Arreglo Parral"},
        headers=headers,
    )
    assert put_resp.status_code == 200

    egreso_despues = await _egreso_vinculado(client, headers)
    assert egreso_despues["tipo"] == "repuestos_reparacion"
    assert egreso_despues["clasificacion"] == "rep_repuestos_parral"
