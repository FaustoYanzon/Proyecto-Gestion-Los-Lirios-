"""Órdenes multiproducto: confirmar una válvula o una parcela crea un
RegistroFitosanitario (y un movimiento de stock) por cada línea de la orden,
vinculado a la fila del plan de la variedad de la parcela.

Spec: docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.models.finanzas import Finca
from app.models.insumo import Insumo, MovimientoStock
from app.models.produccion import (
    OrdenAplicacionParcela,
    OrdenAplicacionValvula,
    RegistroFitosanitario,
)
from app.models.user import UserRole


async def _auth(client, create_user, **kwargs):
    kwargs.setdefault("email", "ger@test.com")
    kwargs.setdefault("password", "Password123!")
    kwargs.setdefault("role", UserRole.gerencial)
    user = await create_user(**kwargs)
    resp = await client.post(
        "/auth/login", data={"username": user.email, "password": kwargs["password"]},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, user


def _linea(insumo_id, dosis=1.0, numero_aplicacion=None, dias_carencia=7, dias_reingreso=2):
    return {
        "insumo_id": insumo_id, "dosis_por_ha": dosis, "dias_carencia": dias_carencia,
        "dias_reingreso": dias_reingreso, "numero_aplicacion": numero_aplicacion,
    }


async def _crear_orden(client, headers, lineas, parcela_ids, **extra):
    body = {
        "temporada": 2026, "objetivo": "Curación", "fecha_planificada": "2026-10-15",
        "lineas": lineas, "parcela_ids": parcela_ids,
    }
    body.update(extra)
    resp = await client.post("/ordenes-aplicacion/", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _plan(client, headers, insumo_id, variedades, numero=1, dosis=1.5):
    resp = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026, "variedades": variedades, "numero_aplicacion": numero,
            "mes": 10, "insumo_id": insumo_id, "objetivo": "Oidio", "dosis_por_ha": dosis,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return {fila["variedad"]: fila["id"] for fila in resp.json()}


async def _tres_insumos(create_insumo):
    return [
        await create_insumo(nombre="Super folpan", unidad="kg"),
        await create_insumo(nombre="Mancozeb", unidad="kg"),
        await create_insumo(nombre="Oponente", unidad="lt"),
    ]


async def _stock(db_session, insumo) -> Decimal:
    fresco = await db_session.get(Insumo, insumo.id)
    await db_session.refresh(fresco)
    return Decimal(str(fresco.stock_actual))


async def _registros(db_session) -> list[RegistroFitosanitario]:
    db_session.expire_all()
    return list(
        (await db_session.execute(select(RegistroFitosanitario))).scalars().all()
    )


async def _count_movimientos(db_session) -> int:
    return (await db_session.execute(select(func.count(MovimientoStock.id)))).scalar_one()


def _url_valvula(orden, fila_id):
    return f"/ordenes-aplicacion/{orden['id']}/valvulas/{fila_id}/confirmar"


def _url_parcela(orden, item_id):
    return f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar"


async def _orden_valvula_tres_lineas(
    client, headers, create_insumo, create_parcela, create_valvula, superficie_valvula=2.0,
):
    insumos = await _tres_insumos(create_insumo)
    parcela = await create_parcela(
        nombre="Parral 2", variedad="flame", finca=Finca.media_agua, superficie_ha=5.0,
    )
    await create_valvula(parcela_id=parcela.id, nombre="21", superficie_ha=superficie_valvula)
    lineas = [
        _linea(insumos[0].id, dosis=1.5, dias_carencia=7, dias_reingreso=1),
        _linea(insumos[1].id, dosis=2.0, dias_carencia=21, dias_reingreso=2),
        _linea(insumos[2].id, dosis=0.15, dias_carencia=3, dias_reingreso=0),
    ]
    orden = await _crear_orden(client, headers, lineas, [parcela.id])
    fila_id = orden["parcelas"][0]["valvulas"][0]["id"]
    return orden, fila_id, insumos, parcela


# ── Válvula ──────────────────────────────────────────────────────────────────


async def test_confirmar_valvula_crea_un_registro_por_linea_con_stock(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, fila_id, insumos, parcela = await _orden_valvula_tres_lineas(
        client, headers, create_insumo, create_parcela, create_valvula,
    )

    resp = await client.post(_url_valvula(orden, fila_id), json={"resultado": "completa"}, headers=headers)
    assert resp.status_code == 200, resp.text

    registros = await _registros(db_session)
    assert len(registros) == 3
    por_insumo = {r.insumo_id: r for r in registros}
    esperado = {
        insumos[0].id: Decimal("3.00"),
        insumos[1].id: Decimal("4.00"),
        insumos[2].id: Decimal("0.30"),
    }
    lineas = {l["insumo_id"]: l["id"] for l in orden["lineas"]}
    for insumo in insumos:
        registro = por_insumo[insumo.id]
        assert registro.cantidad_total == esperado[insumo.id]
        assert registro.producto_nombre == insumo.nombre
        assert registro.unidad == insumo.unidad
        assert registro.parcela_id == parcela.id
        assert registro.orden_valvula_id == fila_id
        assert registro.orden_parcela_id == orden["parcelas"][0]["id"]
        assert registro.orden_insumo_id == lineas[insumo.id]
        assert registro.plan_fitosanitario_id is None
        assert await _stock(db_session, insumo) == Decimal("100") - esperado[insumo.id]
    assert await _count_movimientos(db_session) == 3

    # Legacy shim: the row (and the response) point at the first line's registro.
    primero = por_insumo[insumos[0].id]
    assert resp.json()["registro_fitosanitario_id"] == primero.id
    fila = await db_session.get(OrdenAplicacionValvula, fila_id)
    await db_session.refresh(fila)
    assert fila.registro_fitosanitario_id == primero.id


async def test_confirmar_con_valvula_sin_superficie_da_422_y_no_deja_nada(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, fila_id, insumos, _p = await _orden_valvula_tres_lineas(
        client, headers, create_insumo, create_parcela, create_valvula, superficie_valvula=None,
    )

    resp = await client.post(_url_valvula(orden, fila_id), json={"resultado": "completa"}, headers=headers)
    assert resp.status_code == 422, resp.text

    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0
    for insumo in insumos:
        assert await _stock(db_session, insumo) == Decimal("100")
    fila = await db_session.get(OrdenAplicacionValvula, fila_id)
    await db_session.refresh(fila)
    assert fila.estado.value == "pendiente"


async def test_confirmar_dos_veces_da_409_y_descuenta_una_vez(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, fila_id, insumos, _p = await _orden_valvula_tres_lineas(
        client, headers, create_insumo, create_parcela, create_valvula,
    )
    url = _url_valvula(orden, fila_id)

    assert (await client.post(url, json={"resultado": "completa"}, headers=headers)).status_code == 200
    segundo = await client.post(url, json={"resultado": "completa"}, headers=headers)
    assert segundo.status_code == 409, segundo.text

    assert len(await _registros(db_session)) == 3
    assert await _count_movimientos(db_session) == 3
    assert await _stock(db_session, insumos[0]) == Decimal("97.00")
    assert await _stock(db_session, insumos[1]) == Decimal("96.00")
    assert await _stock(db_session, insumos[2]) == Decimal("99.70")


async def test_no_aplicada_no_crea_registros(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, fila_id, insumos, _p = await _orden_valvula_tres_lineas(
        client, headers, create_insumo, create_parcela, create_valvula,
    )

    resp = await client.post(
        _url_valvula(orden, fila_id),
        json={"resultado": "no_aplicada", "observaciones": "Se cortó el agua"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["registro_fitosanitario_id"] is None
    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0
    for insumo in insumos:
        assert await _stock(db_session, insumo) == Decimal("100")


async def test_carencia_de_cada_registro_es_la_de_su_linea(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, fila_id, insumos, _p = await _orden_valvula_tres_lineas(
        client, headers, create_insumo, create_parcela, create_valvula,
    )

    resp = await client.post(_url_valvula(orden, fila_id), json={"resultado": "completa"}, headers=headers)
    assert resp.status_code == 200, resp.text

    por_insumo = {r.insumo_id: r for r in await _registros(db_session)}
    for insumo, carencia, reingreso in zip(insumos, (7, 21, 3), (1, 2, 0)):
        registro = por_insumo[insumo.id]
        assert registro.dias_carencia == carencia
        assert registro.dias_reingreso == reingreso
        assert registro.fecha_habilitacion_cosecha == registro.fecha + timedelta(days=carencia)
        assert registro.fecha_habilitacion_reingreso == registro.fecha + timedelta(days=reingreso)
    assert {r.fecha for r in por_insumo.values()} == {date.today()}


# ── Parcela entera ───────────────────────────────────────────────────────────


async def test_confirmar_parcela_sin_valvulas_crea_n_registros(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _tres_insumos(create_insumo)
    parcela = await create_parcela(
        nombre="Potrero 3", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0,
    )
    lineas = [_linea(i.id, dosis=d) for i, d in zip(insumos, (1.5, 2.0, 0.15))]
    orden = await _crear_orden(client, headers, lineas, [parcela.id])
    item_id = orden["parcelas"][0]["id"]

    resp = await client.post(_url_parcela(orden, item_id), json={}, headers=headers)
    assert resp.status_code == 200, resp.text

    registros = await _registros(db_session)
    assert len(registros) == 3
    por_insumo = {r.insumo_id: r for r in registros}
    for insumo, cantidad in zip(insumos, ("3.00", "4.00", "0.30")):
        registro = por_insumo[insumo.id]
        assert registro.cantidad_total == Decimal(cantidad)
        assert registro.orden_parcela_id == item_id
        assert registro.orden_valvula_id is None
        assert registro.valvula_id is None
        assert await _stock(db_session, insumo) == Decimal("100") - Decimal(cantidad)
    assert await _count_movimientos(db_session) == 3

    primero = por_insumo[insumos[0].id]
    assert resp.json()["registro_fitosanitario_id"] == primero.id
    item = await db_session.get(OrdenAplicacionParcela, item_id)
    await db_session.refresh(item)
    assert item.registro_fitosanitario_id == primero.id


async def test_confirmar_parcela_sin_superficie_da_422_y_no_deja_nada(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _tres_insumos(create_insumo)
    parcela = await create_parcela(
        nombre="Potrero 3", variedad="flame", finca=Finca.media_agua, superficie_ha=None,
    )
    lineas = [_linea(i.id) for i in insumos]
    orden = await _crear_orden(client, headers, lineas, [parcela.id])

    resp = await client.post(_url_parcela(orden, orden["parcelas"][0]["id"]), json={}, headers=headers)
    assert resp.status_code == 422, resp.text
    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0


# ── Vínculo con el plan ──────────────────────────────────────────────────────


async def test_registro_vincula_fila_del_plan_segun_variedad_de_la_parcela(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _tres_insumos(create_insumo)
    flame = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0)
    syrah = await create_parcela(nombre="Parral 9", variedad="syrah", finca=Finca.media_agua, superficie_ha=3.0)
    plan = await _plan(client, headers, insumos[0].id, ["flame", "syrah"], numero=2)
    lineas = [_linea(insumos[0].id, dosis=1.5, numero_aplicacion=2), _linea(insumos[1].id)]
    orden = await _crear_orden(client, headers, lineas, [flame.id, syrah.id])

    for item in orden["parcelas"]:
        resp = await client.post(_url_parcela(orden, item["id"]), json={}, headers=headers)
        assert resp.status_code == 200, resp.text

    registros = await _registros(db_session)
    assert len(registros) == 4
    con_plan = {r.parcela_id: r.plan_fitosanitario_id for r in registros if r.insumo_id == insumos[0].id}
    assert con_plan == {flame.id: plan["flame"], syrah.id: plan["syrah"]}
    # The off-plan line never links to a plan row.
    assert all(r.plan_fitosanitario_id is None for r in registros if r.insumo_id == insumos[1].id)


async def test_linea_sin_fila_de_plan_para_la_variedad_deja_plan_id_nulo(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _tres_insumos(create_insumo)
    flame = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0)
    syrah = await create_parcela(nombre="Parral 9", variedad="syrah", finca=Finca.media_agua, superficie_ha=3.0)
    # The plan covers only flame for round 1.
    plan = await _plan(client, headers, insumos[0].id, ["flame"], numero=1)
    orden = await _crear_orden(
        client, headers, [_linea(insumos[0].id, numero_aplicacion=1)], [flame.id, syrah.id],
    )

    for item in orden["parcelas"]:
        resp = await client.post(_url_parcela(orden, item["id"]), json={}, headers=headers)
        assert resp.status_code == 200, resp.text

    por_parcela = {r.parcela_id: r.plan_fitosanitario_id for r in await _registros(db_session)}
    assert por_parcela == {flame.id: plan["flame"], syrah.id: None}
