"""Órdenes multiproducto: Deshacer, Reactivar y Eliminar actúan sobre la
válvula (o la parcela entera) completa, es decir sobre todos sus registros
(uno por producto), aunque se invoquen con uno solo de ellos desde la web.

Spec: docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select

from app.models.finanzas import Finca
from app.models.produccion import (
    FotoRegistroFitosanitario,
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrdenAplicacionValvula,
    RegistroFitosanitario,
)
from app.services.aplicaciones import registros_de_fila
from tests.test_ordenes_multiproducto_confirmar import (
    _auth,
    _count_movimientos,
    _crear_orden,
    _linea,
    _registros,
    _stock,
    _tres_insumos,
    _url_parcela,
    _url_valvula,
)

_FOTO = {"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}


def _fake_uploads(monkeypatch) -> None:
    async def _fake_upload(raw, content_type, ident):
        return f"https://fotos.test/{ident}.jpg"

    monkeypatch.setattr("app.api.ordenes_aplicacion.upload_foto_orden_aplicacion", _fake_upload)


def _url_deshacer(orden, fila_id):
    return f"/ordenes-aplicacion/{orden['id']}/valvulas/{fila_id}/deshacer"


def _url_reactivar(registro_id: str) -> str:
    return f"/produccion/fitosanitarios/{registro_id}/reactivar"


def _url_eliminar(registro_id: str) -> str:
    return f"/produccion/fitosanitarios/{registro_id}"


async def _fotos(db_session) -> list[FotoRegistroFitosanitario]:
    db_session.expire_all()
    return list((await db_session.execute(select(FotoRegistroFitosanitario))).scalars().all())


async def _orden_parral(
    client, headers, create_insumo, create_parcela, create_valvula, valvulas=(("21", 2.0),),
):
    """Orden de 3 productos (1.5, 2.0 y 0.15 /ha) sobre un parral con válvulas.
    Devuelve la orden, {nombre válvula: fila id} y los insumos."""
    insumos = await _tres_insumos(create_insumo)
    parcela = await create_parcela(
        nombre="Parral 2", variedad="flame", finca=Finca.media_agua, superficie_ha=5.0,
    )
    for nombre, ha in valvulas:
        await create_valvula(parcela_id=parcela.id, nombre=nombre, superficie_ha=ha)
    lineas = [_linea(i.id, dosis=d) for i, d in zip(insumos, (1.5, 2.0, 0.15))]
    orden = await _crear_orden(client, headers, lineas, [parcela.id])
    filas = {v["valvula_nombre"]: v["id"] for v in orden["parcelas"][0]["valvulas"]}
    return orden, filas, insumos


async def _orden_potrero(client, headers, create_insumo, create_parcela):
    """Orden de 3 productos sobre un potrero SIN válvulas (2 ha): se confirma
    por parcela entera."""
    insumos = await _tres_insumos(create_insumo)
    parcela = await create_parcela(
        nombre="Potrero 3", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0,
    )
    lineas = [_linea(i.id, dosis=d) for i, d in zip(insumos, (1.5, 2.0, 0.15))]
    orden = await _crear_orden(client, headers, lineas, [parcela.id])
    return orden, orden["parcelas"][0]["id"], insumos


async def _confirmar_valvula(client, headers, orden, fila_id) -> None:
    resp = await client.post(_url_valvula(orden, fila_id), json={"resultado": "completa"}, headers=headers)
    assert resp.status_code == 200, resp.text


async def _registros_de_valvula(db_session, fila_id) -> list[RegistroFitosanitario]:
    return [r for r in await _registros(db_session) if r.orden_valvula_id == fila_id]


async def _assert_stock_inicial(db_session, insumos) -> None:
    for insumo in insumos:
        assert await _stock(db_session, insumo) == Decimal("100")


# ── Deshacer ─────────────────────────────────────────────────────────────────


async def test_deshacer_valvula_devuelve_stock_de_todos_los_productos(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumos = await _orden_parral(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])
    assert len(await _registros(db_session)) == 3

    resp = await client.post(_url_deshacer(orden, filas["21"]), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["registro_fitosanitario_id"] is None

    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0
    await _assert_stock_inicial(db_session, insumos)
    fila = await db_session.get(OrdenAplicacionValvula, filas["21"])
    assert fila.estado.value == "pendiente"
    assert fila.registro_fitosanitario_id is None
    orden_db = await db_session.get(OrdenAplicacion, orden["id"])
    assert orden_db.estado.value == "pendiente"


async def test_doble_deshacer_da_409_y_no_devuelve_stock_dos_veces(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumos = await _orden_parral(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])

    assert (await client.post(_url_deshacer(orden, filas["21"]), headers=headers)).status_code == 200
    segundo = await client.post(_url_deshacer(orden, filas["21"]), headers=headers)
    assert segundo.status_code == 409, segundo.text
    assert "todavía no fue confirmada" in segundo.json()["detail"]

    await _assert_stock_inicial(db_session, insumos)
    assert await _count_movimientos(db_session) == 0


async def test_deshacer_borra_fotos_de_la_valvula(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    _fake_uploads(monkeypatch)
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral(
        client, headers, create_insumo, create_parcela, create_valvula,
        valvulas=(("21", 2.0), ("22", 1.0)),
    )
    await _confirmar_valvula(client, headers, orden, filas["21"])
    await _confirmar_valvula(client, headers, orden, filas["22"])
    for fila in ("21", "21", "22"):
        r = await client.post(f"/ordenes-aplicacion/valvulas/{filas[fila]}/fotos", files=_FOTO, headers=headers)
        assert r.status_code == 201, r.text
    # A stray photo hanging from a non-first product registro of the valve
    # (no orden_valvula_id) must go too, or it would block the delete (FK).
    fila21 = await db_session.get(OrdenAplicacionValvula, filas["21"])
    await db_session.refresh(fila21)
    shim = fila21.registro_fitosanitario_id  # read before _registros expires the session
    segundo = next(
        r for r in await _registros_de_valvula(db_session, filas["21"])
        if r.id != shim
    )
    db_session.add(FotoRegistroFitosanitario(
        registro_fitosanitario_id=segundo.id, url="https://fotos.test/x.jpg",
        created_by=segundo.created_by,
    ))
    await db_session.commit()

    resp = await client.post(_url_deshacer(orden, filas["21"]), headers=headers)
    assert resp.status_code == 200, resp.text

    restantes = await _fotos(db_session)
    assert len(restantes) == 1
    assert restantes[0].orden_valvula_id == filas["22"]
    assert len(await _registros_de_valvula(db_session, filas["22"])) == 3


# ── Reactivar ────────────────────────────────────────────────────────────────


async def test_reactivar_un_registro_reactiva_toda_la_valvula(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumos = await _orden_parral(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])
    fila = await db_session.get(OrdenAplicacionValvula, filas["21"])
    await db_session.refresh(fila)
    shim = fila.registro_fitosanitario_id  # read before _registros expires the session
    # Act on a product that is NOT the legacy shim one.
    todos = [r.id for r in await _registros(db_session)]
    otro = next(r for r in await _registros(db_session) if r.id != shim)

    resp = await client.post(_url_reactivar(otro.id), headers=headers)
    assert resp.status_code == 204, resp.text

    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0
    await _assert_stock_inicial(db_session, insumos)
    fila = await db_session.get(OrdenAplicacionValvula, filas["21"])
    assert fila.estado.value == "pendiente"
    assert fila.registro_fitosanitario_id is None
    # A second call on any sibling finds nothing: no double refund.
    for registro_id in todos:
        assert (await client.post(_url_reactivar(registro_id), headers=headers)).status_code == 404
    await _assert_stock_inicial(db_session, insumos)


async def test_reactivar_parcela_entera_con_n_registros(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela,
):
    _fake_uploads(monkeypatch)
    headers, _ = await _auth(client, create_user)
    orden, item_id, insumos = await _orden_potrero(client, headers, create_insumo, create_parcela)
    resp = await client.post(_url_parcela(orden, item_id), json={}, headers=headers)
    assert resp.status_code == 200, resp.text
    primero = resp.json()["registro_fitosanitario_id"]
    foto = await client.post(f"/ordenes-aplicacion/parcelas/{item_id}/fotos", files=_FOTO, headers=headers)
    assert foto.status_code == 201, foto.text
    otro = next(r for r in await _registros(db_session) if r.id != primero)

    resp = await client.post(_url_reactivar(otro.id), headers=headers)
    assert resp.status_code == 204, resp.text

    assert await _registros(db_session) == []
    assert await _fotos(db_session) == []
    assert await _count_movimientos(db_session) == 0
    await _assert_stock_inicial(db_session, insumos)
    item = await db_session.get(OrdenAplicacionParcela, item_id)
    assert item.estado.value == "pendiente"
    assert item.registro_fitosanitario_id is None
    orden_db = await db_session.get(OrdenAplicacion, orden["id"])
    assert orden_db.estado.value == "pendiente"


# ── Eliminar ─────────────────────────────────────────────────────────────────


async def test_eliminar_un_registro_saca_toda_la_valvula_de_la_orden(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    _fake_uploads(monkeypatch)
    headers, _ = await _auth(client, create_user)
    orden, filas, insumos = await _orden_parral(
        client, headers, create_insumo, create_parcela, create_valvula,
        valvulas=(("21", 2.0), ("22", 1.0)),
    )
    await _confirmar_valvula(client, headers, orden, filas["21"])
    await _confirmar_valvula(client, headers, orden, filas["22"])
    r = await client.post(f"/ordenes-aplicacion/valvulas/{filas['21']}/fotos", files=_FOTO, headers=headers)
    assert r.status_code == 201, r.text
    fila = await db_session.get(OrdenAplicacionValvula, filas["21"])
    await db_session.refresh(fila)
    shim = fila.registro_fitosanitario_id  # read before _registros expires the session
    otro = next(
        r for r in await _registros_de_valvula(db_session, filas["21"])
        if r.id != shim
    )

    resp = await client.delete(_url_eliminar(otro.id), headers=headers)
    assert resp.status_code == 204, resp.text

    db_session.expire_all()
    assert await db_session.get(OrdenAplicacionValvula, filas["21"]) is None
    assert await _registros_de_valvula(db_session, filas["21"]) == []
    assert len(await _registros_de_valvula(db_session, filas["22"])) == 3
    assert await _fotos(db_session) == []
    assert await _count_movimientos(db_session) == 3
    # Only valve 22 (1 ha) stays discounted.
    for insumo, dosis in zip(insumos, ("1.5", "2.0", "0.15")):
        assert await _stock(db_session, insumo) == Decimal("100") - Decimal(dosis)
    body = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
    assert [v["valvula_nombre"] for v in body["parcelas"][0]["valvulas"]] == ["22"]
    assert body["parcelas"][0]["estado"] == "aplicada"
    assert body["estado"] == "completada"


async def test_eliminar_unica_valvula_borra_parcela_y_orden(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula, caplog,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumos = await _orden_parral(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])
    registro = (await _registros(db_session))[2]

    with caplog.at_level("INFO", logger="app"):
        resp = await client.delete(_url_eliminar(registro.id), headers=headers)
    assert resp.status_code == 204, resp.text

    db_session.expire_all()
    assert await db_session.get(OrdenAplicacion, orden["id"]) is None
    assert await _registros(db_session) == []
    assert await _count_movimientos(db_session) == 0
    await _assert_stock_inicial(db_session, insumos)
    mensajes = [r.getMessage() for r in caplog.records if "fitosanitario eliminado" in r.getMessage()]
    assert len(mensajes) == 1
    assert "registros_eliminados=3" in mensajes[0]
    assert "orden_eliminada=True" in mensajes[0]


async def test_eliminar_parcela_entera_con_n_registros(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela,
):
    _fake_uploads(monkeypatch)
    headers, _ = await _auth(client, create_user)
    insumos = await _tres_insumos(create_insumo)
    potreros = [
        await create_parcela(nombre=f"Potrero {i}", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0)
        for i in (1, 2)
    ]
    lineas = [_linea(i.id, dosis=d) for i, d in zip(insumos, (1.5, 2.0, 0.15))]
    orden = await _crear_orden(client, headers, lineas, [p.id for p in potreros])
    items = {p["parcela_nombre"]: p["id"] for p in orden["parcelas"]}
    for item_id in items.values():
        resp = await client.post(_url_parcela(orden, item_id), json={}, headers=headers)
        assert resp.status_code == 200, resp.text
    item1 = await db_session.get(OrdenAplicacionParcela, items["Potrero 1"])
    await db_session.refresh(item1)
    primero = item1.registro_fitosanitario_id
    foto = await client.post(f"/ordenes-aplicacion/parcelas/{items['Potrero 1']}/fotos", files=_FOTO, headers=headers)
    assert foto.status_code == 201, foto.text
    otro = next(
        r for r in await _registros(db_session)
        if r.orden_parcela_id == items["Potrero 1"] and r.id != primero
    )

    resp = await client.delete(_url_eliminar(otro.id), headers=headers)
    assert resp.status_code == 204, resp.text

    db_session.expire_all()
    assert await db_session.get(OrdenAplicacionParcela, items["Potrero 1"]) is None
    restantes = await _registros(db_session)
    assert len(restantes) == 3
    assert {r.orden_parcela_id for r in restantes} == {items["Potrero 2"]}
    assert await _fotos(db_session) == []
    assert await _count_movimientos(db_session) == 3
    for insumo, cantidad in zip(insumos, ("3.00", "4.00", "0.30")):
        assert await _stock(db_session, insumo) == Decimal("100") - Decimal(cantidad)
    orden_db = await db_session.get(OrdenAplicacion, orden["id"])
    assert orden_db.estado.value == "completada"


# ── registros_de_fila ────────────────────────────────────────────────────────


async def test_registros_de_fila_parcela_excluye_los_de_sus_valvulas(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])
    db_session.expire_all()
    fila = await db_session.get(OrdenAplicacionValvula, filas["21"])
    item = await db_session.get(OrdenAplicacionParcela, orden["parcelas"][0]["id"])

    assert len(await registros_de_fila(db_session, fila_valvula=fila)) == 3
    # Valve registros also carry orden_parcela_id: the whole-parcel query must skip them.
    assert await registros_de_fila(db_session, item=item) == []
