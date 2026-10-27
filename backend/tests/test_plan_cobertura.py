"""Plan coverage by hectares from explicit links (RegistroFitosanitario.
plan_fitosanitario_id), replacing the old N-th-application heuristic.

Spec: docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md
("Cumplimiento del plan").
"""
from __future__ import annotations

from decimal import Decimal

from app.models.parcela import VariedadUva
from app.services.plan_cobertura import cobertura_por_parcela
from tests.helpers_plan import aplicar, auth, crear_plan, linea, registro_parcela_entera


async def _parral_tres_valvulas(create_parcela, create_valvula, nombre="Parral 2"):
    """6 ha parral with valves 21/22/23 of 1, 2 and 3 ha."""
    parcela = await create_parcela(nombre=nombre, variedad=VariedadUva.flame, superficie_ha=6.0)
    valvulas = [
        await create_valvula(parcela_id=parcela.id, nombre=nombre_v, orden=i, superficie_ha=ha)
        for i, (nombre_v, ha) in enumerate((("21", 1.0), ("22", 2.0), ("23", 3.0)), start=1)
    ]
    return parcela, valvulas


async def _cumplimiento(client, headers, **params) -> list[dict]:
    resp = await client.get(
        "/plan-fitosanitario/cumplimiento", params={"temporada": 2026, **params}, headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_sin_registros_todo_pendiente(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela, _v = await _parral_tres_valvulas(create_parcela, create_valvula)
    insumo = await create_insumo()
    planes = await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=1.5)

    coberturas = await cobertura_por_parcela(db_session, 2026)
    assert len(coberturas) == 1
    cob = coberturas[0]
    assert cob.plan_id == planes["flame"]
    assert cob.parcela_id == parcela.id
    assert cob.ha_parcela == Decimal("6")
    assert cob.ha_cubiertas == Decimal("0")

    fila = (await _cumplimiento(client, headers))[0]
    assert fila["estado"] == "pendiente"
    assert fila["porcentaje"] == 0
    assert fila["ha_total"] == 6.0
    assert fila["ha_cubiertas"] == 0.0
    assert fila["pendiente_ha"] == 6.0
    assert fila["pendiente_cantidad"] == 9.0
    assert fila["dosis_real_promedio"] is None
    assert fila["parcelas_total"] == 1
    assert fila["parcelas_aplicadas"] == 0


async def test_cubre_por_hectareas_de_valvulas_aplicadas(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela, (v21, _v22, v23) = await _parral_tres_valvulas(create_parcela, create_valvula)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=1.5)

    await aplicar(client, headers, [linea(insumo.id)], [parcela.id], valvula_ids=[v21.id, v23.id])

    (cob,) = await cobertura_por_parcela(db_session, 2026)
    assert cob.ha_cubiertas == Decimal("4")

    fila = (await _cumplimiento(client, headers))[0]
    assert fila["ha_cubiertas"] == 4.0
    assert fila["pendiente_ha"] == 2.0
    assert fila["pendiente_cantidad"] == 3.0
    assert fila["porcentaje"] == 67
    assert fila["estado"] == "parcial"
    assert fila["parcelas_aplicadas"] == 0


async def test_registro_de_parcela_entera_cubre_toda_la_parcela(
    client, db_session, create_user, create_parcela, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela = await create_parcela(nombre="Potrero 1", variedad=VariedadUva.flame, superficie_ha=5.0)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"])

    # No valves -> the order is confirmed for the whole parcel.
    await aplicar(client, headers, [linea(insumo.id)], [parcela.id])

    (cob,) = await cobertura_por_parcela(db_session, 2026)
    assert cob.ha_cubiertas == Decimal("5")

    fila = (await _cumplimiento(client, headers))[0]
    assert fila["estado"] == "completo"
    assert fila["porcentaje"] == 100
    assert fila["parcelas_aplicadas"] == 1
    assert fila["pendiente_ha"] == 0.0


async def test_dos_ordenes_misma_valvula_no_suman_dos_veces(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela, (v21, _v22, v23) = await _parral_tres_valvulas(create_parcela, create_valvula)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"])

    # A touch-up order repeats valve 23 for the same plan row.
    await aplicar(client, headers, [linea(insumo.id)], [parcela.id], valvula_ids=[v21.id, v23.id])
    await aplicar(client, headers, [linea(insumo.id)], [parcela.id], valvula_ids=[v23.id])

    (cob,) = await cobertura_por_parcela(db_session, 2026)
    assert cob.ha_cubiertas == Decimal("4")


async def test_parcela_entera_mas_valvulas_no_excede_total(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, user_id = await auth(client, create_user)
    parcela, valvulas = await _parral_tres_valvulas(create_parcela, create_valvula)
    insumo = await create_insumo()
    planes = await crear_plan(client, headers, insumo.id, ["flame"])

    await aplicar(client, headers, [linea(insumo.id)], [parcela.id])  # all three valves
    db_session.add(registro_parcela_entera(parcela.id, insumo.id, planes["flame"], user_id))
    await db_session.commit()

    (cob,) = await cobertura_por_parcela(db_session, 2026)
    assert cob.ha_cubiertas == Decimal("6")
    assert len(valvulas) == 3

    fila = (await _cumplimiento(client, headers))[0]
    assert fila["ha_cubiertas"] == 6.0
    assert fila["pendiente_ha"] == 0.0
    assert fila["porcentaje"] == 100


async def test_valvulas_que_suman_mas_que_la_parcela_se_topean(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    # Valve surfaces loaded larger than the parcel's (bad data): never above ha_parcela.
    parcela = await create_parcela(nombre="Parral 9", variedad=VariedadUva.flame, superficie_ha=2.0)
    await create_valvula(parcela_id=parcela.id, nombre="91", orden=1, superficie_ha=1.5)
    await create_valvula(parcela_id=parcela.id, nombre="92", orden=2, superficie_ha=1.5)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"])

    await aplicar(client, headers, [linea(insumo.id)], [parcela.id])

    (cob,) = await cobertura_por_parcela(db_session, 2026)
    assert cob.ha_cubiertas == Decimal("2")


async def test_registro_sin_plan_id_no_cubre(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, user_id = await auth(client, create_user)
    parcela, _v = await _parral_tres_valvulas(create_parcela, create_valvula)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"])

    # Off-plan order of the same product, plus a manual record: neither counts.
    await aplicar(client, headers, [linea(insumo.id, numero_aplicacion=None)], [parcela.id])
    db_session.add(registro_parcela_entera(parcela.id, insumo.id, None, user_id))
    await db_session.commit()

    (cob,) = await cobertura_por_parcela(db_session, 2026)
    assert cob.ha_cubiertas == Decimal("0")
    assert (await _cumplimiento(client, headers))[0]["estado"] == "pendiente"


async def test_dosis_distinta_igual_cubre_y_reporta_desvio(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela, (v21, _v22, v23) = await _parral_tres_valvulas(create_parcela, create_valvula)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=1.5)

    # 21 (1 ha) at 2.0 and 23 (3 ha) at 1.0 -> weighted (2*1 + 1*3) / 4 = 1.25.
    await aplicar(client, headers, [linea(insumo.id, dosis=2.0)], [parcela.id], valvula_ids=[v21.id])
    await aplicar(client, headers, [linea(insumo.id, dosis=1.0)], [parcela.id], valvula_ids=[v23.id])

    fila = (await _cumplimiento(client, headers))[0]
    assert fila["ha_cubiertas"] == 4.0
    assert fila["dosis_por_ha"] == 1.5
    assert fila["dosis_real_promedio"] == 1.25


async def test_parcela_sin_superficie_aporta_cero_y_no_rompe(
    client, db_session, create_user, create_parcela, create_insumo,
):
    headers, user_id = await auth(client, create_user)
    sin_sup = await create_parcela(nombre="Sin sup", variedad=VariedadUva.flame, superficie_ha=None)
    await create_parcela(nombre="Con sup", variedad=VariedadUva.flame, superficie_ha=4.0)
    insumo = await create_insumo()
    planes = await crear_plan(client, headers, insumo.id, ["flame"])
    db_session.add(registro_parcela_entera(sin_sup.id, insumo.id, planes["flame"], user_id))
    await db_session.commit()

    coberturas = {c.parcela_id: c for c in await cobertura_por_parcela(db_session, 2026)}
    assert coberturas[sin_sup.id].ha_parcela == Decimal("0")
    assert coberturas[sin_sup.id].ha_cubiertas == Decimal("0")

    fila = (await _cumplimiento(client, headers))[0]
    assert fila["ha_total"] == 4.0
    assert fila["parcelas_total"] == 2
    # Linked record on the no-surface parcel counts it as applied, not the empty one.
    assert fila["parcelas_aplicadas"] == 1
    assert fila["estado"] == "pendiente"


async def test_necesidad_stock_usa_hectareas_pendientes(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela, (v21, _v22, v23) = await _parral_tres_valvulas(create_parcela, create_valvula)
    insumo = await create_insumo(nombre="Vivando", stock_actual=10.0)
    await crear_plan(client, headers, insumo.id, ["flame"], numero_aplicacion=1, dosis_por_ha=1.5)
    await crear_plan(client, headers, insumo.id, ["flame"], numero_aplicacion=2, dosis_por_ha=0.5)

    # Round 1 covers 21+23 (4 ha) -> 2 ha pending * 1.5 = 3.0; round 2 all 6 ha * 0.5 = 3.0.
    await aplicar(client, headers, [linea(insumo.id)], [parcela.id], valvula_ids=[v21.id, v23.id])

    resp = await client.get("/plan-fitosanitario/necesidad-stock", params={"temporada": 2026}, headers=headers)
    assert resp.status_code == 200, resp.text
    item = next(i for i in resp.json() if i["insumo_id"] == insumo.id)
    assert item["cantidad_pendiente"] == 6.0
    # The application consumed 1.5 * 4 = 6 of the 10 in stock -> 4 left, 2 short.
    assert Decimal(item["stock_actual"]) == Decimal("4")
    assert item["faltante"] == 2.0
