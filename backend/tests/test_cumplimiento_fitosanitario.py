"""Cumplimiento del Plan Fitosanitario (plan vs. aplicado por vínculo explícito
`plan_fitosanitario_id`, medido en hectáreas) y necesidad de insumos vs. stock.

Replaces the old N-th-application heuristic: each test keeps its original
intent but builds the applications through linked orders.
"""
from __future__ import annotations

from app.models.parcela import VariedadUva
from tests.helpers_plan import aplicar, auth, crear_plan, linea


async def _cumplimiento(client, headers, **params) -> list[dict]:
    resp = await client.get(
        "/plan-fitosanitario/cumplimiento", params={"temporada": 2026, **params}, headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _necesidad(client, headers) -> dict[str, dict]:
    resp = await client.get(
        "/plan-fitosanitario/necesidad-stock", params={"temporada": 2026}, headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return {i["insumo_id"]: i for i in resp.json()}


async def test_fila_sin_aplicacion_real_queda_pendiente(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    await create_parcela(variedad=VariedadUva.flame, superficie_ha=5.0)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=2.0)

    fila = (await _cumplimiento(client, headers))[0]
    assert fila["estado"] == "pendiente"
    assert fila["porcentaje"] == 0
    assert fila["parcelas_aplicadas"] == 0
    assert fila["parcelas_total"] == 1
    assert fila["ha_total"] == 5.0
    assert fila["pendiente_cantidad"] == 10.0


async def test_todas_las_parcelas_aplicadas_queda_completo(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.flame, superficie_ha=5.0)
    p2 = await create_parcela(nombre="P2", variedad=VariedadUva.flame, superficie_ha=5.0)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=2.0)

    await aplicar(client, headers, [linea(insumo.id, dosis=2.0)], [p1.id, p2.id])

    fila = (await _cumplimiento(client, headers))[0]
    assert fila["estado"] == "completo"
    assert fila["porcentaje"] == 100
    assert fila["parcelas_aplicadas"] == 2
    assert fila["parcelas_total"] == 2
    assert fila["ha_cubiertas"] == 10.0


async def test_rondas_repetidas_se_cubren_por_su_vinculo(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.bonarda, superficie_ha=5.0)
    await create_parcela(nombre="P2", variedad=VariedadUva.bonarda, superficie_ha=5.0)
    insumo = await create_insumo(nombre="Azufre Micro")

    await crear_plan(client, headers, insumo.id, ["bonarda"], numero_aplicacion=1, dosis_por_ha=2.0)
    await crear_plan(client, headers, insumo.id, ["bonarda"], numero_aplicacion=2, mes=12, dosis_por_ha=3.0)

    # P1 gets both rounds (each order points at its own round); P2 none.
    await aplicar(client, headers, [linea(insumo.id, dosis=2.0, numero_aplicacion=1)], [p1.id])
    await aplicar(client, headers, [linea(insumo.id, dosis=3.0, numero_aplicacion=2)], [p1.id])

    filas = sorted(
        await _cumplimiento(client, headers, variedad="bonarda"), key=lambda f: f["numero_aplicacion"],
    )
    assert len(filas) == 2
    ronda1, ronda2 = filas
    # The round-2 record must not count for round 1 too.
    for ronda in (ronda1, ronda2):
        assert ronda["parcelas_aplicadas"] == 1
        assert ronda["parcelas_total"] == 2
        assert ronda["estado"] == "parcial"
        assert ronda["porcentaje"] == 50

    # Pending: P2 missed both rounds -> 2.0*5 + 3.0*5 = 25.0
    assert (await _necesidad(client, headers))[insumo.id]["cantidad_pendiente"] == 25.0


async def test_ronda_aplicada_fuera_de_orden_cubre_su_propia_ronda(
    client, create_user, create_parcela, create_insumo,
):
    """What the heuristic got wrong: applying round 2 first used to fill round 1."""
    headers, _ = await auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.bonarda, superficie_ha=5.0)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["bonarda"], numero_aplicacion=1)
    await crear_plan(client, headers, insumo.id, ["bonarda"], numero_aplicacion=2, mes=12)

    await aplicar(client, headers, [linea(insumo.id, numero_aplicacion=2)], [p1.id])

    filas = {f["numero_aplicacion"]: f for f in await _cumplimiento(client, headers)}
    assert filas[1]["estado"] == "pendiente"
    assert filas[2]["estado"] == "completo"


async def test_necesidad_baja_a_cero_cuando_todo_aplicado(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.syrah, superficie_ha=4.0)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["syrah"], dosis_por_ha=2.0)
    await aplicar(client, headers, [linea(insumo.id, dosis=2.0)], [p1.id])

    assert insumo.id not in await _necesidad(client, headers)


async def test_faltante_se_calcula_contra_stock_actual(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    await create_parcela(variedad=VariedadUva.fiesta, superficie_ha=10.0)
    insumo_bajo_stock = await create_insumo(nombre="Vivando", stock_actual=5.0)
    insumo_stock_sobra = await create_insumo(nombre="Karathane", stock_actual=1000.0)

    # 3.0 lt/ha * 10 ha = 30 pending -- against stock 5 -> 25 short
    await crear_plan(client, headers, insumo_bajo_stock.id, ["fiesta"], dosis_por_ha=3.0)
    # 1.0 lt/ha * 10 ha = 10 pending -- against stock 1000 -> nothing short
    await crear_plan(client, headers, insumo_stock_sobra.id, ["fiesta"], dosis_por_ha=1.0)

    items = await _necesidad(client, headers)
    assert items[insumo_bajo_stock.id]["cantidad_pendiente"] == 30.0
    assert items[insumo_bajo_stock.id]["faltante"] == 25.0
    assert items[insumo_stock_sobra.id]["cantidad_pendiente"] == 10.0
    assert items[insumo_stock_sobra.id]["faltante"] == 0.0
