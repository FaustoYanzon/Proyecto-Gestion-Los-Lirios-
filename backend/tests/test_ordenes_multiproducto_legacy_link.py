"""Registros written by the OLD backend after the multiproducto migration ran.

Railway runs `alembic upgrade head && uvicorn`, so the old container keeps
serving for a while on the new schema. It confirms a valve (or a whole parcel)
writing only the legacy `registro_fitosanitario_id` on the order row and
leaving `registro.orden_valvula_id` / `orden_parcela_id` NULL. Deshacer,
Reactivar and Eliminar must still find that registro (refund the stock once,
delete it) and never 500.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select, update

from app.models.finanzas import Finca
from app.models.produccion import (
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrdenAplicacionValvula,
    RegistroFitosanitario,
)
from tests.test_ordenes_multiproducto_confirmar import (
    _auth,
    _count_movimientos,
    _crear_orden,
    _linea,
    _registros,
    _stock,
    _url_parcela,
    _url_valvula,
)
from tests.test_ordenes_multiproducto_deshacer import (
    _url_deshacer,
    _url_eliminar,
    _url_reactivar,
)

_DOSIS = Decimal("1.5")


async def _como_backend_viejo(db_session) -> str:
    """Strip the new links from every registro, as the old code would have
    written them. Returns the (single) registro id."""
    await db_session.execute(
        update(RegistroFitosanitario).values(
            orden_valvula_id=None, orden_parcela_id=None, orden_insumo_id=None,
        )
    )
    await db_session.commit()
    registros = await _registros(db_session)
    assert len(registros) == 1
    return registros[0].id


async def _valvula_legacy(client, db_session, headers, create_insumo, create_parcela, create_valvula):
    """Single-product order on a parral with one 2 ha valve, confirmed the
    legacy way. Returns (orden, fila_id, insumo, registro_id)."""
    insumo = await create_insumo(nombre="Super folpan", unidad="kg")
    parcela = await create_parcela(
        nombre="Parral 2", variedad="flame", finca=Finca.media_agua, superficie_ha=5.0,
    )
    await create_valvula(parcela_id=parcela.id, nombre="21", superficie_ha=2.0)
    orden = await _crear_orden(client, headers, [_linea(insumo.id, dosis=float(_DOSIS))], [parcela.id])
    fila_id = orden["parcelas"][0]["valvulas"][0]["id"]
    resp = await client.post(_url_valvula(orden, fila_id), json={"resultado": "completa"}, headers=headers)
    assert resp.status_code == 200, resp.text
    registro_id = await _como_backend_viejo(db_session)
    fila = await db_session.get(OrdenAplicacionValvula, fila_id)
    assert fila.registro_fitosanitario_id == registro_id  # only the legacy link remains
    assert await _stock(db_session, insumo) == Decimal("97.0")
    return orden, fila_id, insumo, registro_id


async def _potrero_legacy(client, db_session, headers, create_insumo, create_parcela):
    """Single-product order on a 2 ha potrero without valves, confirmed whole
    the legacy way. Returns (orden, item_id, insumo, registro_id)."""
    insumo = await create_insumo(nombre="Super folpan", unidad="kg")
    parcela = await create_parcela(
        nombre="Potrero 3", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0,
    )
    orden = await _crear_orden(client, headers, [_linea(insumo.id, dosis=float(_DOSIS))], [parcela.id])
    item_id = orden["parcelas"][0]["id"]
    resp = await client.post(_url_parcela(orden, item_id), json={}, headers=headers)
    assert resp.status_code == 200, resp.text
    registro_id = await _como_backend_viejo(db_session)
    item = await db_session.get(OrdenAplicacionParcela, item_id)
    assert item.registro_fitosanitario_id == registro_id
    return orden, item_id, insumo, registro_id


async def _assert_reconfirmar_descuenta_una_vez(client, db_session, headers, orden, fila_id, insumo):
    resp = await client.post(_url_valvula(orden, fila_id), json={"resultado": "completa"}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert len(await _registros(db_session)) == 1
    assert await _count_movimientos(db_session) == 1
    assert await _stock(db_session, insumo) == Decimal("97.0")


async def test_orden_id_resuelve_registro_con_vinculo_legacy(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, _f, _i, registro_id = await _valvula_legacy(
        client, db_session, headers, create_insumo, create_parcela, create_valvula,
    )
    orden_id = (
        await db_session.execute(
            select(RegistroFitosanitario.orden_id).where(RegistroFitosanitario.id == registro_id)
        )
    ).scalar_one()
    assert orden_id == orden["id"]


async def test_deshacer_valvula_legacy_devuelve_stock_y_borra_registro(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, fila_id, insumo, _r = await _valvula_legacy(
        client, db_session, headers, create_insumo, create_parcela, create_valvula,
    )

    resp = await client.post(_url_deshacer(orden, fila_id), headers=headers)
    assert resp.status_code == 200, resp.text

    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0
    assert await _stock(db_session, insumo) == Decimal("100")
    fila = await db_session.get(OrdenAplicacionValvula, fila_id)
    assert fila.estado.value == "pendiente"
    assert fila.registro_fitosanitario_id is None
    await _assert_reconfirmar_descuenta_una_vez(client, db_session, headers, orden, fila_id, insumo)


async def test_reactivar_valvula_legacy_desde_el_registro(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, fila_id, insumo, registro_id = await _valvula_legacy(
        client, db_session, headers, create_insumo, create_parcela, create_valvula,
    )

    resp = await client.post(_url_reactivar(registro_id), headers=headers)
    assert resp.status_code == 204, resp.text

    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0
    assert await _stock(db_session, insumo) == Decimal("100")
    fila = await db_session.get(OrdenAplicacionValvula, fila_id)
    assert fila.estado.value == "pendiente"
    await _assert_reconfirmar_descuenta_una_vez(client, db_session, headers, orden, fila_id, insumo)


async def test_eliminar_valvula_legacy_desde_el_registro_saca_la_orden(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, fila_id, insumo, registro_id = await _valvula_legacy(
        client, db_session, headers, create_insumo, create_parcela, create_valvula,
    )

    resp = await client.delete(_url_eliminar(registro_id), headers=headers)
    assert resp.status_code == 204, resp.text

    db_session.expire_all()
    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0
    assert await _stock(db_session, insumo) == Decimal("100")
    assert await db_session.get(OrdenAplicacionValvula, fila_id) is None
    # Its only valve left, so the parcel and the order go too.
    assert await db_session.get(OrdenAplicacion, orden["id"]) is None


async def test_reactivar_parcela_entera_legacy(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    orden, item_id, insumo, registro_id = await _potrero_legacy(
        client, db_session, headers, create_insumo, create_parcela,
    )

    resp = await client.post(_url_reactivar(registro_id), headers=headers)
    assert resp.status_code == 204, resp.text

    assert await _registros(db_session) == []
    assert await _stock(db_session, insumo) == Decimal("100")
    item = await db_session.get(OrdenAplicacionParcela, item_id)
    assert item.estado.value == "pendiente"
    assert item.registro_fitosanitario_id is None

    resp = await client.post(_url_parcela(orden, item_id), json={}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert await _count_movimientos(db_session) == 1
    assert await _stock(db_session, insumo) == Decimal("97.0")


async def test_eliminar_parcela_entera_legacy(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    orden, item_id, insumo, registro_id = await _potrero_legacy(
        client, db_session, headers, create_insumo, create_parcela,
    )

    resp = await client.delete(_url_eliminar(registro_id), headers=headers)
    assert resp.status_code == 204, resp.text

    db_session.expire_all()
    assert await _registros(db_session) == []
    assert await _stock(db_session, insumo) == Decimal("100")
    assert await db_session.get(OrdenAplicacionParcela, item_id) is None
    assert await db_session.get(OrdenAplicacion, orden["id"]) is None
