"""Órdenes de aplicación: el ingeniero/encargado genera una orden (desde una
línea del PlanFitosanitario, o suelta/"extra") con insumo, dosis, carencia y
parcelas ya fijados; un operario con su propio usuario confirma qué parral
aplicó. Confirmar crea el RegistroFitosanitario real (descuento de stock
incluido) -- ver app/api/ordenes_aplicacion.py.
"""
from __future__ import annotations

from app.models.finanzas import Finca
from app.models.user import UserRole


async def _auth(client, create_user, **kwargs):
    kwargs.setdefault("email", "user@test.com")
    kwargs.setdefault("password", "Password123!")
    user = await create_user(**kwargs)
    resp = await client.post(
        "/auth/login",
        data={"username": user.email, "password": kwargs["password"]},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, user


async def test_crear_orden_desde_plan_incluye_toda_la_variedad(client, create_user, create_insumo, create_parcela):
    headers, _ = await _auth(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    insumo = await create_insumo(nombre="Azufre", unidad="kg")
    p1 = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0)
    p2 = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua, superficie_ha=3.0)
    await create_parcela(nombre="Parral Bonarda", variedad="bonarda", finca=Finca.media_agua)

    plan = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026, "variedades": ["flame"], "numero_aplicacion": 1,
            "mes": 10, "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.5,
        },
        headers=headers,
    )
    plan_id = plan.json()[0]["id"]

    resp = await client.post(
        "/ordenes-aplicacion/desde-plan",
        json={
            "plan_fitosanitario_id": plan_id,
            "dias_carencia": 7,
            "dias_reingreso": 2,
            "fecha_planificada": "2026-10-15",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["origen"] == "plan"
    assert body["estado"] == "pendiente"
    assert body["insumo_nombre"] == "Azufre"
    assert {p["parcela_id"] for p in body["parcelas"]} == {p1.id, p2.id}


async def test_crear_orden_extra_con_parcelas_especificas(client, create_user, create_insumo, create_parcela):
    headers, _ = await _auth(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    insumo = await create_insumo(nombre="Cobre")
    p1 = await create_parcela(nombre="Parral A", variedad="syrah", finca=Finca.media_agua)
    await create_parcela(nombre="Parral B", variedad="syrah", finca=Finca.media_agua)

    resp = await client.post(
        "/ordenes-aplicacion/",
        json={
            "temporada": 2026,
            "variedad": "syrah",
            "insumo_id": insumo.id,
            "dosis_por_ha": 2.0,
            "objetivo": "Botritis",
            "dias_carencia": 5,
            "dias_reingreso": 1,
            "fecha_planificada": "2026-11-01",
            "parcela_ids": [p1.id],
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["origen"] == "extra"
    assert [p["parcela_id"] for p in body["parcelas"]] == [p1.id]


async def test_parcela_de_otra_variedad_en_orden_extra_rechaza(client, create_user, create_insumo, create_parcela):
    headers, _ = await _auth(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    insumo = await create_insumo()
    otra = await create_parcela(nombre="Parral Malbec", variedad="bonarda")

    resp = await client.post(
        "/ordenes-aplicacion/",
        json={
            "temporada": 2026, "variedad": "syrah", "insumo_id": insumo.id,
            "dosis_por_ha": 1.0, "objetivo": "Test", "dias_carencia": 1, "dias_reingreso": 1,
            "fecha_planificada": "2026-11-01", "parcela_ids": [otra.id],
        },
        headers=headers,
    )
    assert resp.status_code == 422


async def test_obrero_no_puede_crear_ordenes(client, create_user, create_insumo):
    headers, _ = await _auth(client, create_user, email="obrero@test.com", role=UserRole.obrero)
    insumo = await create_insumo()
    resp = await client.post(
        "/ordenes-aplicacion/",
        json={
            "temporada": 2026, "variedad": "syrah", "insumo_id": insumo.id,
            "dosis_por_ha": 1.0, "objetivo": "Test", "dias_carencia": 1, "dias_reingreso": 1,
            "fecha_planificada": "2026-11-01",
        },
        headers=headers,
    )
    assert resp.status_code == 403


async def _crear_orden_extra(client, headers, insumo_id, parcela_id, variedad="syrah", dosis=2.0):
    resp = await client.post(
        "/ordenes-aplicacion/",
        json={
            "temporada": 2026, "variedad": variedad, "insumo_id": insumo_id,
            "dosis_por_ha": dosis, "objetivo": "Botritis", "dias_carencia": 5, "dias_reingreso": 1,
            "fecha_planificada": "2026-11-01", "parcela_ids": [parcela_id],
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_operario_confirma_aplicacion_crea_registro_y_descuenta_stock(
    client, create_user, create_insumo, create_parcela,
):
    headers_ger, _ = await _auth(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    insumo = await create_insumo(nombre="Cobre", stock_actual=50.0)
    parcela = await create_parcela(nombre="Parral A", variedad="syrah", finca=Finca.media_agua, superficie_ha=4.0)
    orden = await _crear_orden_extra(client, headers_ger, insumo.id, parcela.id, dosis=2.0)
    item_id = orden["parcelas"][0]["id"]

    headers_op, _ = await _auth(
        client, create_user, email="operario@test.com", role=UserRole.obrero, finca=Finca.media_agua,
    )
    resp = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar",
        json={"observaciones": "Aplicado sin problemas"},
        headers=headers_op,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["estado"] == "aplicada"
    registro_id = body["registro_fitosanitario_id"]
    assert registro_id

    registro = await client.get(f"/produccion/fitosanitarios/{registro_id}", headers=headers_ger)
    assert registro.status_code == 200
    r = registro.json()
    assert r["dosis_por_ha"] == 2.0
    assert float(r["cantidad_total"]) == 8.0  # 2.0 dosis * 4.0 ha
    assert r["observaciones"] == "Aplicado sin problemas"
    assert r["insumo_id"] == insumo.id

    insumo_actual = await client.get(f"/insumos/{insumo.id}", headers=headers_ger)
    assert float(insumo_actual.json()["stock_actual"]) == 42.0  # 50 - 8

    orden_detalle = await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers_ger)
    assert orden_detalle.json()["estado"] == "completada"


async def test_confirmar_dos_veces_la_misma_parcela_rechaza(client, create_user, create_insumo, create_parcela):
    headers_ger, _ = await _auth(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    insumo = await create_insumo()
    parcela = await create_parcela(nombre="Parral A", variedad="syrah", finca=Finca.media_agua)
    orden = await _crear_orden_extra(client, headers_ger, insumo.id, parcela.id)
    item_id = orden["parcelas"][0]["id"]

    headers_op, _ = await _auth(
        client, create_user, email="operario@test.com", role=UserRole.obrero, finca=Finca.media_agua,
    )
    primero = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar", json={}, headers=headers_op,
    )
    assert primero.status_code == 200

    segundo = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar", json={}, headers=headers_op,
    )
    assert segundo.status_code == 409


async def test_operario_de_otra_finca_no_puede_confirmar(client, create_user, create_insumo, create_parcela):
    headers_ger, _ = await _auth(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    insumo = await create_insumo()
    parcela = await create_parcela(nombre="Parral A", variedad="syrah", finca=Finca.caucete)
    orden = await _crear_orden_extra(client, headers_ger, insumo.id, parcela.id)
    item_id = orden["parcelas"][0]["id"]

    headers_op, _ = await _auth(
        client, create_user, email="operario@test.com", role=UserRole.obrero, finca=Finca.media_agua,
    )
    resp = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar", json={}, headers=headers_op,
    )
    assert resp.status_code == 403


async def test_pendientes_solo_muestra_parcelas_de_la_finca_del_operario(
    client, create_user, create_insumo, create_parcela,
):
    headers_ger, _ = await _auth(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    insumo = await create_insumo()
    parcela_ma = await create_parcela(nombre="Parral MA", variedad="syrah", finca=Finca.media_agua)
    parcela_ca = await create_parcela(nombre="Parral CA", variedad="syrah", finca=Finca.caucete)
    await _crear_orden_extra(client, headers_ger, insumo.id, parcela_ma.id)
    await _crear_orden_extra(client, headers_ger, insumo.id, parcela_ca.id)

    headers_op, _ = await _auth(
        client, create_user, email="operario@test.com", role=UserRole.obrero, finca=Finca.media_agua,
    )
    resp = await client.get("/ordenes-aplicacion/pendientes", headers=headers_op)
    assert resp.status_code == 200
    parcelas_vistas = {p["parcela_id"] for orden in resp.json() for p in orden["parcelas"]}
    assert parcelas_vistas == {parcela_ma.id}


async def test_responsable_se_resuelve_desde_trabajador_vinculado(
    client, create_user, create_insumo, create_parcela,
):
    headers_ger, _ = await _auth(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    insumo = await create_insumo()
    parcela = await create_parcela(nombre="Parral A", variedad="syrah", finca=Finca.media_agua)
    orden = await _crear_orden_extra(client, headers_ger, insumo.id, parcela.id)
    item_id = orden["parcelas"][0]["id"]

    trabajador_resp = await client.post(
        "/trabajadores/", json={"nombre_completo": "Juan Operario"}, headers=headers_ger,
    )
    assert trabajador_resp.status_code == 201
    trabajador_id = trabajador_resp.json()["id"]

    headers_op, _ = await _auth(
        client, create_user, email="operario@test.com", role=UserRole.obrero,
        finca=Finca.media_agua, trabajador_id=trabajador_id,
    )
    resp = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar", json={}, headers=headers_op,
    )
    assert resp.status_code == 200
    registro_id = resp.json()["registro_fitosanitario_id"]

    registro = await client.get(f"/produccion/fitosanitarios/{registro_id}", headers=headers_ger)
    assert registro.json()["responsable_id"] == trabajador_id
