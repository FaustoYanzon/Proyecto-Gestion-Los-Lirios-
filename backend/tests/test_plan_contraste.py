"""POST /plan-fitosanitario/contraste and the monthly stock need.

Spec: docs/superpowers/specs/2026-10-28-plan-mensual-avance-design.md (section 4).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models.parcela import VariedadUva
from app.services.plan_avance import pendiente_por_insumo
from tests.helpers_plan import auth, crear_plan
from tests.test_plan_avance import _registro


async def _contraste(client, headers, parcelas, lineas, fecha="2026-10-15") -> list[dict]:
    resp = await client.post(
        "/plan-fitosanitario/contraste",
        json={"fecha": fecha, "parcelas": parcelas, "lineas": lineas}, headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _parral_con_plan(client, create_user, create_parcela, create_valvula, create_insumo, dosis=2.0):
    headers, uid = await auth(client, create_user)
    parcela = await create_parcela(nombre="Parral 2", variedad=VariedadUva.flame, superficie_ha=6.0)
    valvulas = [
        await create_valvula(parcela_id=parcela.id, nombre=n, orden=i, superficie_ha=ha)
        for i, (n, ha) in enumerate((("21", 1.0), ("22", 2.0), ("23", 3.0)), start=1)
    ]
    insumo = await create_insumo(nombre="Mancozeb")
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=dosis, mes=10)
    return headers, uid, parcela, valvulas, insumo


async def test_contraste_en_plan_con_proyeccion_100(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _u, parcela, _v, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    [linea] = await _contraste(
        client, headers, [{"parcela_id": parcela.id}], [{"insumo_id": insumo.id, "dosis_por_ha": 2.0}])
    [var] = linea["variedades"]
    assert var["estado"] == "en_plan"
    assert Decimal(var["dosis_plan"]) == Decimal("2")
    assert Decimal(var["porcentaje_proyectado"]) == Decimal("100")


async def test_contraste_suma_lo_ya_aplicado_y_excede_sobre_105(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 5), 1.0)
    [linea] = await _contraste(
        client, headers, [{"parcela_id": parcela.id}], [{"insumo_id": insumo.id, "dosis_por_ha": 1.2}])
    [var] = linea["variedades"]
    assert Decimal(var["dosis_aplicada_promedio"]) == Decimal("1")
    assert Decimal(var["porcentaje_proyectado"]) == Decimal("110")  # (1.0 + 1.2) / 2
    assert var["estado"] == "excede"


async def test_contraste_fuera_del_plan_para_producto_ajeno(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _u, parcela, _v, _insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    azufre = await create_insumo(nombre="Azufre")
    [linea] = await _contraste(
        client, headers, [{"parcela_id": parcela.id}], [{"insumo_id": azufre.id, "dosis_por_ha": 3.0}])
    [var] = linea["variedades"]
    assert var["estado"] == "fuera_del_plan"
    assert var["dosis_plan"] is None
    assert var["porcentaje_proyectado"] is None


async def test_contraste_pondera_por_valvulas_elegidas(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _u, parcela, valvulas, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    # Only the 2 ha valve: projected dose over the whole parcel is 2 * 2 / 6.
    [linea] = await _contraste(
        client, headers, [{"parcela_id": parcela.id, "valvula_ids": [valvulas[1].id]}],
        [{"insumo_id": insumo.id, "dosis_por_ha": 2.0}])
    [var] = linea["variedades"]
    assert Decimal(var["dosis_proyectada_promedio"]).quantize(Decimal("0.0001")) == Decimal("0.6667")
    assert var["estado"] == "en_plan"  # below target is not "excede"


async def test_contraste_varias_variedades_una_entrada_por_variedad(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _u, parcela, _v, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    bonarda = await create_parcela(nombre="Parral 9", variedad=VariedadUva.bonarda, superficie_ha=4.0)
    [linea] = await _contraste(
        client, headers, [{"parcela_id": parcela.id}, {"parcela_id": bonarda.id}],
        [{"insumo_id": insumo.id, "dosis_por_ha": 2.0}])
    estados = {v["variedad"]: v["estado"] for v in linea["variedades"]}
    assert estados == {"bonarda": "fuera_del_plan", "flame": "en_plan"}


async def test_contraste_usa_el_mes_de_la_fecha(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _u, parcela, _v, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    [linea] = await _contraste(
        client, headers, [{"parcela_id": parcela.id}], [{"insumo_id": insumo.id, "dosis_por_ha": 2.0}],
        fecha="2026-11-02")
    assert linea["variedades"][0]["estado"] == "fuera_del_plan"  # the plan is for October


async def test_necesidad_excluye_meses_cerrados(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _u, _p, _v, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    # October target: 2/ha over 6 ha = 12.
    assert await pendiente_por_insumo(db_session, 2026, date(2026, 10, 20)) == {insumo.id: Decimal("12")}
    assert await pendiente_por_insumo(db_session, 2026, date(2026, 11, 1)) == {}
    assert await pendiente_por_insumo(db_session, 2025, date(2026, 11, 1)) == {}


async def test_necesidad_temporada_futura_cuenta_todo(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _u, _p, _v, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    assert await pendiente_por_insumo(db_session, 2026, date(2026, 4, 1)) == {insumo.id: Decimal("12")}


async def test_necesidad_exceso_de_una_parcela_no_compensa_otra(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    await create_parcela(nombre="Parral 3", variedad=VariedadUva.flame, superficie_ha=4.0)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 5), 4.0)  # double on 6 ha
    pendiente = await pendiente_por_insumo(db_session, 2026, date(2026, 10, 20))
    assert pendiente == {insumo.id: Decimal("8")}  # only Parral 3 (2/ha x 4 ha) is missing


async def test_necesidad_forma_de_respuesta_no_cambia(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _u, _p, _v, insumo = await _parral_con_plan(
        client, create_user, create_parcela, create_valvula, create_insumo)
    resp = await client.get("/plan-fitosanitario/necesidad-stock", params={"temporada": 2026}, headers=headers)
    assert resp.status_code == 200, resp.text
    # Today's date decides whether October is still open; the shape is what matters.
    for item in resp.json():
        assert set(item) == {
            "insumo_id", "insumo_nombre", "unidad", "cantidad_pendiente", "stock_actual", "faltante",
        }
