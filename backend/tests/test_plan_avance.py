"""Monthly plan progress (services/plan_avance + GET /plan-fitosanitario/avance).

Spec: docs/superpowers/specs/2026-10-28-plan-mensual-avance-design.md (section 3).
Records are inserted directly with chosen dates so months and seasons are
deterministic; one test goes through a real order to check the valve weight.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.api.lotes_pasa import temporada_de
from app.models.parcela import VariedadUva
from app.models.produccion import RegistroFitosanitario
from app.services.plan_avance import (
    EstadoAvance,
    calcular_avance,
    estado_parcela,
    rango_mes,
)
from tests.helpers_plan import aplicar, auth, crear_plan, linea


async def _registro(
    db, user_id, parcela_id, insumo_id, fecha: date, dosis: float, valvula_id: str | None = None,
) -> None:
    db.add(
        RegistroFitosanitario(
            fecha=fecha, parcela_id=parcela_id, producto_nombre="Producto", dosis_por_ha=dosis,
            insumo_id=insumo_id, motivo="Oidio", dias_carencia=7, dias_reingreso=2,
            fecha_habilitacion_cosecha=fecha + timedelta(days=7),
            fecha_habilitacion_reingreso=fecha + timedelta(days=2),
            responsable="Juan Perez", valvula_id=valvula_id, created_by=user_id,
        )
    )
    await db.commit()


async def _escenario(client, create_user, create_parcela, create_valvula, create_insumo, dosis=2.0):
    """6 ha flame parral with valves of 1/2/3 ha and a plan of `dosis`/ha in Oct 2026."""
    headers, user_id = await auth(client, create_user)
    parcela = await create_parcela(nombre="Parral 2", variedad=VariedadUva.flame, superficie_ha=6.0)
    valvulas = [
        await create_valvula(parcela_id=parcela.id, nombre=n, orden=i, superficie_ha=ha)
        for i, (n, ha) in enumerate((("21", 1.0), ("22", 2.0), ("23", 3.0)), start=1)
    ]
    insumo = await create_insumo(nombre="Mancozeb")
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=dosis, mes=10)
    return headers, user_id, parcela, valvulas, insumo


def test_estado_parcela_bordes_de_la_banda():
    plan = Decimal("2")
    assert estado_parcela(Decimal("0"), plan) == EstadoAvance.pendiente
    assert estado_parcela(Decimal("1.89"), plan) == EstadoAvance.bajo
    assert estado_parcela(Decimal("1.9"), plan) == EstadoAvance.ok  # exactly 95 %
    assert estado_parcela(Decimal("2.1"), plan) == EstadoAvance.ok  # exactly 105 %
    assert estado_parcela(Decimal("2.11"), plan) == EstadoAvance.exceso


def test_rango_mes_respeta_la_campania():
    assert rango_mes(2026, 10) == (date(2026, 10, 1), date(2026, 11, 1))
    assert rango_mes(2026, 12) == (date(2026, 12, 1), date(2027, 1, 1))
    assert rango_mes(2026, 4) == (date(2027, 4, 1), date(2027, 5, 1))


async def test_parcela_entera_ok(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 20), 2.0)

    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.estado == EstadoAvance.ok
    assert item.dosis_plan == Decimal("2")
    assert item.porcentaje == Decimal("100")
    assert item.parcelas[0].dosis_aplicada == Decimal("2")


async def test_valvulas_parciales_da_bajo(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, valvulas, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    # One 1 ha valve out of 6 ha at full dose: 1/6 of the target.
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 20), 2.0, valvulas[0].id)
    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.estado == EstadoAvance.bajo
    assert item.parcelas[0].dosis_aplicada == Decimal("2") * Decimal("1") / Decimal("6")
    assert item.porcentaje < Decimal("20")


async def test_retoque_suma_y_da_exceso(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 5), 2.0)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 25), 1.0)
    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.estado == EstadoAvance.exceso
    assert item.parcelas[0].dosis_aplicada == Decimal("3")


async def test_producto_ajeno_es_no_planificado_y_el_planificado_queda_pendiente(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    otro = await create_insumo(nombre="Azufre")
    await _registro(db_session, uid, parcela.id, otro.id, date(2026, 10, 20), 3.0)

    items = await calcular_avance(db_session, 2026, 10)
    por_producto = {i.insumo_nombre: i for i in items}
    assert por_producto["Mancozeb"].estado == EstadoAvance.pendiente
    assert por_producto["Azufre"].estado == EstadoAvance.no_planificado
    assert por_producto["Azufre"].dosis_plan is None
    assert por_producto["Azufre"].porcentaje is None
    assert items[-1].insumo_nombre == "Azufre"  # unplanned rows go last


async def test_registro_a_mano_sin_vinculo_cuenta(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 1), 2.0)  # plan link stays null
    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.estado == EstadoAvance.ok


async def test_dos_filas_mismo_producto_y_mes_suman_objetivo(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo, dosis=1.0)
    await crear_plan(client, headers, insumo.id, ["flame"], numero_aplicacion=2, dosis_por_ha=1.0, mes=10)
    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.dosis_plan == Decimal("2")


async def test_limite_30_abril_1_mayo_cambia_de_temporada(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    await crear_plan(client, headers, insumo.id, ["flame"], numero_aplicacion=2, dosis_por_ha=2.0, mes=4, temporada=2026)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2027, 4, 30), 2.0)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2027, 5, 1), 2.0)

    [abril] = await calcular_avance(db_session, 2026, 4)
    assert abril.estado == EstadoAvance.ok  # 30/apr belongs to season 2026
    assert abril.parcelas[0].dosis_aplicada == Decimal("2")
    assert temporada_de(date(2027, 5, 1)) == 2027
    # The 1/may record is not in any 2026 month.
    todo = await calcular_avance(db_session, 2026)
    assert all(i.parcelas[0].dosis_aplicada <= Decimal("2") for i in todo if i.mes == 4)


async def test_parcela_sin_superficie_no_divide_por_cero(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid = await auth(client, create_user)
    parcela = await create_parcela(nombre="Sin ha", variedad=VariedadUva.flame, superficie_ha=None)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=2.0, mes=10)
    [vacio] = await calcular_avance(db_session, 2026, 10)
    assert vacio.estado == EstadoAvance.pendiente

    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 10), 2.0)
    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.estado == EstadoAvance.ok  # mean dose of the records
    assert item.ha_total == Decimal("0")


async def test_valvula_sin_superficie_pesa_cero(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid = await auth(client, create_user)
    parcela = await create_parcela(nombre="P", variedad=VariedadUva.flame, superficie_ha=6.0)
    valvula = await create_valvula(parcela_id=parcela.id, nombre="9", superficie_ha=None)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=2.0, mes=10)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 10), 2.0, valvula.id)
    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.estado == EstadoAvance.pendiente


async def test_parcela_inactiva_y_otra_variedad_ignoradas(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    otra = await create_parcela(nombre="Bonarda", variedad=VariedadUva.bonarda, superficie_ha=5.0)
    await _registro(db_session, uid, otra.id, insumo.id, date(2026, 10, 10), 2.0)
    parcela.is_active = False
    db_session.add(parcela)
    await db_session.commit()
    items = await calcular_avance(db_session, 2026, 10)
    # No active flame parcel left: the plan row has nothing to apply; bonarda
    # has no plan row, so its record is unplanned.
    assert [(i.variedad, i.estado) for i in items] == [(VariedadUva.bonarda, EstadoAvance.no_planificado)]


async def test_insumo_id_null_ignorado(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    await _registro(db_session, uid, parcela.id, None, date(2026, 10, 10), 2.0)
    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.estado == EstadoAvance.pendiente


async def test_prioridad_bajo_sobre_exceso_en_agregado(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    otra = await create_parcela(nombre="Parral 3", variedad=VariedadUva.flame, superficie_ha=4.0)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 10), 4.0)  # exceso
    await _registro(db_session, uid, otra.id, insumo.id, date(2026, 10, 10), 1.0)  # bajo
    [item] = await calcular_avance(db_session, 2026, 10)
    assert item.estado == EstadoAvance.bajo
    assert {p.estado for p in item.parcelas} == {EstadoAvance.exceso, EstadoAvance.bajo}


async def test_registro_de_orden_por_valvula_usa_su_superficie(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _uid = await auth(client, create_user)
    parcela = await create_parcela(nombre="Parral 2", variedad=VariedadUva.flame, superficie_ha=6.0)
    valvulas = [
        await create_valvula(parcela_id=parcela.id, nombre=n, orden=i, superficie_ha=ha)
        for i, (n, ha) in enumerate((("21", 1.0), ("22", 2.0), ("23", 3.0)), start=1)
    ]
    insumo = await create_insumo()
    hoy = date.today()
    await crear_plan(
        client, headers, insumo.id, ["flame"], dosis_por_ha=3.0, mes=hoy.month, temporada=temporada_de(hoy),
    )
    # Real order over the 2 ha valve only, confirmed today.
    await aplicar(client, headers, [linea(insumo.id, 3.0)], [parcela.id], [valvulas[1].id])

    [item] = await calcular_avance(db_session, temporada_de(hoy), hoy.month)
    assert item.parcelas[0].dosis_aplicada == Decimal("3") * Decimal("2") / Decimal("6")
    assert item.estado == EstadoAvance.bajo


async def test_avance_endpoint_filtra_mes_y_variedad(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid, parcela, _v, insumo = await _escenario(
        client, create_user, create_parcela, create_valvula, create_insumo)
    await crear_plan(client, headers, insumo.id, ["flame"], numero_aplicacion=2, dosis_por_ha=1.0, mes=11)
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 20), 2.0)

    todo = await client.get("/plan-fitosanitario/avance", params={"temporada": 2026}, headers=headers)
    assert todo.status_code == 200, todo.text
    assert [i["mes"] for i in todo.json()] == [10, 11]  # campaign order

    octubre = await client.get(
        "/plan-fitosanitario/avance", params={"temporada": 2026, "mes": 10, "variedad": "flame"}, headers=headers,
    )
    [item] = octubre.json()
    assert item["estado"] == "ok"
    assert item["insumo_nombre"] == "Mancozeb"
    assert Decimal(item["porcentaje"]) == Decimal("100")
    assert item["parcelas"][0]["nombre"] == "Parral 2"

    vacio = await client.get(
        "/plan-fitosanitario/avance", params={"temporada": 2026, "variedad": "bonarda"}, headers=headers,
    )
    assert vacio.json() == []


async def test_registro_sin_plan_con_dosis_cero_no_rompe_el_avance(
    client, db_session, create_user, create_parcela, create_insumo,
):
    headers, uid = await auth(client, create_user)
    parcela = await create_parcela(nombre="Parral 5", variedad=VariedadUva.flame, superficie_ha=3.0)
    insumo = await create_insumo(nombre="Azufre")
    await _registro(db_session, uid, parcela.id, insumo.id, date(2026, 10, 5), 0.0)
    resp = await client.get("/plan-fitosanitario/avance", params={"temporada": 2026}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == []
