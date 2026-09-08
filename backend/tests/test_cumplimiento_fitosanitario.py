"""Cumplimiento del Plan Fitosanitario (matching automático real vs. plan,
por orden cronológico cuando el mismo insumo tiene varias rondas) y
necesidad de insumos vs. stock. Ver plan `flickering-percolating-raven.md`.
"""
from __future__ import annotations

from app.models.parcela import VariedadUva
from app.models.user import UserRole


async def _auth(client, create_user, role: UserRole = UserRole.gerencial, email: str = "ger@test.com"):
    await create_user(email=email, password="Password123!", role=role)
    resp = await client.post("/auth/login", data={"username": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _crear_plan(client, headers, insumo_id, variedades, numero_aplicacion, mes, dosis_por_ha, temporada=2026):
    resp = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": temporada,
            "variedades": variedades,
            "numero_aplicacion": numero_aplicacion,
            "mes": mes,
            "insumo_id": insumo_id,
            "objetivo": "Oidio",
            "dosis_por_ha": dosis_por_ha,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _crear_fito(client, headers, parcela_id, insumo_id, fecha, dosis_por_ha=2.0):
    resp = await client.post(
        "/produccion/fitosanitarios/",
        json={
            "fecha": fecha,
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
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_fila_sin_aplicacion_real_queda_pendiente(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user)
    await create_parcela(variedad=VariedadUva.flame, superficie_ha=5.0)
    insumo = await create_insumo()
    await _crear_plan(client, headers, insumo.id, ["flame"], 1, 10, 2.0)

    resp = await client.get("/plan-fitosanitario/cumplimiento", params={"temporada": 2026}, headers=headers)
    assert resp.status_code == 200, resp.text
    fila = resp.json()[0]
    assert fila["estado"] == "pendiente"
    assert fila["porcentaje"] == 0
    assert fila["parcelas_aplicadas"] == 0
    assert fila["parcelas_total"] == 1


async def test_todas_las_parcelas_aplicadas_queda_completo(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.flame, superficie_ha=5.0)
    p2 = await create_parcela(nombre="P2", variedad=VariedadUva.flame, superficie_ha=5.0)
    insumo = await create_insumo()
    await _crear_plan(client, headers, insumo.id, ["flame"], 1, 10, 2.0)

    await _crear_fito(client, headers, p1.id, insumo.id, "2026-10-05")
    await _crear_fito(client, headers, p2.id, insumo.id, "2026-10-06")

    resp = await client.get("/plan-fitosanitario/cumplimiento", params={"temporada": 2026}, headers=headers)
    fila = resp.json()[0]
    assert fila["estado"] == "completo"
    assert fila["porcentaje"] == 100
    assert fila["parcelas_aplicadas"] == 2
    assert fila["parcelas_total"] == 2


async def test_rondas_repetidas_se_cubren_por_orden_cronologico(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.bonarda, superficie_ha=5.0)
    p2 = await create_parcela(nombre="P2", variedad=VariedadUva.bonarda, superficie_ha=5.0)
    insumo = await create_insumo(nombre="Azufre Micro")

    await _crear_plan(client, headers, insumo.id, ["bonarda"], 1, 10, 2.0)  # ronda 1
    await _crear_plan(client, headers, insumo.id, ["bonarda"], 2, 12, 3.0)  # ronda 2

    # P1 tiene las dos aplicaciones reales (cubre ronda 1 y 2); P2 no tiene ninguna.
    await _crear_fito(client, headers, p1.id, insumo.id, "2026-10-05")
    await _crear_fito(client, headers, p1.id, insumo.id, "2026-12-05")

    resp = await client.get(
        "/plan-fitosanitario/cumplimiento", params={"temporada": 2026, "variedad": "bonarda"}, headers=headers,
    )
    filas = sorted(resp.json(), key=lambda f: f["numero_aplicacion"])
    assert len(filas) == 2

    ronda1, ronda2 = filas
    # La 2da aplicación real de P1 no debe contarse dos veces para la ronda 1.
    assert ronda1["parcelas_aplicadas"] == 1
    assert ronda1["parcelas_total"] == 2
    assert ronda1["estado"] == "parcial"
    assert ronda2["parcelas_aplicadas"] == 1
    assert ronda2["parcelas_total"] == 2
    assert ronda2["estado"] == "parcial"

    # Necesidad pendiente: P2 no aplicó ninguna ronda -> 2.0*5 + 3.0*5 = 25.0 ha-dosis pendientes
    necesidad = await client.get("/plan-fitosanitario/necesidad-stock", params={"temporada": 2026}, headers=headers)
    item = next(i for i in necesidad.json() if i["insumo_id"] == insumo.id)
    assert item["cantidad_pendiente"] == 25.0


async def test_necesidad_baja_a_cero_cuando_todo_aplicado(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.syrah, superficie_ha=4.0)
    insumo = await create_insumo()
    await _crear_plan(client, headers, insumo.id, ["syrah"], 1, 10, 2.0)
    await _crear_fito(client, headers, p1.id, insumo.id, "2026-10-05")

    resp = await client.get("/plan-fitosanitario/necesidad-stock", params={"temporada": 2026}, headers=headers)
    assert all(i["insumo_id"] != insumo.id for i in resp.json())


async def test_faltante_se_calcula_contra_stock_actual(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user)
    await create_parcela(variedad=VariedadUva.fiesta, superficie_ha=10.0)
    insumo_bajo_stock = await create_insumo(nombre="Vivando", stock_actual=5.0)
    insumo_stock_sobra = await create_insumo(nombre="Karathane", stock_actual=1000.0)

    # 3.0 lt/ha * 10 ha = 30 pendientes -- contra stock 5 -> falta 25
    await _crear_plan(client, headers, insumo_bajo_stock.id, ["fiesta"], 1, 10, 3.0)
    # 1.0 lt/ha * 10 ha = 10 pendientes -- contra stock 1000 -> no falta nada
    await _crear_plan(client, headers, insumo_stock_sobra.id, ["fiesta"], 1, 10, 1.0)

    resp = await client.get("/plan-fitosanitario/necesidad-stock", params={"temporada": 2026}, headers=headers)
    items = {i["insumo_id"]: i for i in resp.json()}

    assert items[insumo_bajo_stock.id]["cantidad_pendiente"] == 30.0
    assert items[insumo_bajo_stock.id]["faltante"] == 25.0
    assert items[insumo_stock_sobra.id]["cantidad_pendiente"] == 10.0
    assert items[insumo_stock_sobra.id]["faltante"] == 0.0
