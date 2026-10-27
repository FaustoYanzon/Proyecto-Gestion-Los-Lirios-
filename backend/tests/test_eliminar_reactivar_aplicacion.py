"""Eliminar vs. Reactivar una aplicación fitosanitaria que vino de una orden.

- Eliminar (DELETE /produccion/fitosanitarios/{id}) saca la aplicación del
  sistema: devuelve el stock, borra el registro y sus fotos y, si vino de una
  orden, también la saca de la orden (la válvula, la parcela si se queda sin
  válvulas, la orden entera si se queda sin parcelas). Nada queda pendiente.
- Reactivar (POST /produccion/fitosanitarios/{id}/reactivar) es lo que antes
  hacía borrar un registro de orden: la aplicación vuelve a pendiente en la
  orden para confirmarla de nuevo (para válvulas, igual que "deshacer").
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select

from app.models.finanzas import Finca
from app.models.insumo import MovimientoStock
from app.models.produccion import (
    FotoRegistroFitosanitario,
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrdenAplicacionValvula,
    RegistroFitosanitario,
)
from app.models.user import UserRole
from tests.test_orden_valvulas import (
    _auth,
    _orden_parral2,
    _payload_extra,
    _stock,
    _url,
    _url_deshacer,
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _url_reactivar(registro_id: str) -> str:
    return f"/produccion/fitosanitarios/{registro_id}/reactivar"


def _url_eliminar(registro_id: str) -> str:
    return f"/produccion/fitosanitarios/{registro_id}"


def _fake_uploads(monkeypatch) -> None:
    async def _fake_upload(raw, content_type, ident):
        return f"https://fotos.test/{ident}.jpg"

    monkeypatch.setattr("app.api.ordenes_aplicacion.upload_foto_orden_aplicacion", _fake_upload)


_FOTO = {"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}


async def _orden_por_parcelas(client, headers, create_insumo, create_parcela, superficies=(1.0, 2.0)):
    """Orden extra (dosis 2.0/ha) sobre potreros SIN válvulas: se confirman por
    parcela entera. Devuelve la orden, {nombre: fila parcela} y el insumo."""
    insumo = await create_insumo(nombre="Cobre", stock_actual=100.0)
    parcelas = [
        await create_parcela(
            nombre=f"Potrero {i + 1}", variedad="flame", finca=Finca.media_agua, superficie_ha=ha,
        )
        for i, ha in enumerate(superficies)
    ]
    resp = await client.post(
        "/ordenes-aplicacion/",
        json=_payload_extra(insumo.id, [p.id for p in parcelas]),
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    orden = resp.json()
    filas = {p["parcela_nombre"]: p["id"] for p in orden["parcelas"]}
    return orden, filas, insumo


async def _confirmar_parcela(client, headers, orden, fila_id) -> str:
    resp = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{fila_id}/confirmar", json={}, headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["registro_fitosanitario_id"]


async def _confirmar_valvula(client, headers, orden, fila_id, **body) -> str | None:
    body.setdefault("resultado", "completa")
    resp = await client.post(_url(orden, fila_id), json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["registro_fitosanitario_id"]


async def _orden(client, headers, orden_id):
    return await client.get(f"/ordenes-aplicacion/{orden_id}", headers=headers)


async def _count(db_session, columna) -> int:
    db_session.expire_all()
    return (await db_session.execute(select(func.count(columna)))).scalar_one()


async def _orden_dos_parrales_una_valvula(client, headers, create_insumo, create_parcela, create_valvula):
    """Orden sobre dos parrales con una sola válvula cada uno (1 ha y 2 ha)."""
    insumo = await create_insumo(nombre="Azufre", stock_actual=100.0)
    pa = await create_parcela(nombre="Parral A", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0)
    pb = await create_parcela(nombre="Parral B", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0)
    await create_valvula(parcela_id=pa.id, nombre="A1", superficie_ha=1.0)
    await create_valvula(parcela_id=pb.id, nombre="B1", superficie_ha=2.0)
    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [pa.id, pb.id]), headers=headers,
    )
    assert resp.status_code == 201, resp.text
    orden = resp.json()
    filas = {v["valvula_nombre"]: v["id"] for p in orden["parcelas"] for v in p["valvulas"]}
    return orden, filas, insumo


# ── Eliminar: registro que vino de una orden por parcela ─────────────────────


async def test_eliminar_registro_de_orden_de_una_parcela_borra_la_orden(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_por_parcelas(
        client, headers, create_insumo, create_parcela, superficies=(2.0,),
    )
    registro_id = await _confirmar_parcela(client, headers, orden, filas["Potrero 1"])
    assert await _stock(db_session, insumo) == 96.0

    resp = await client.delete(_url_eliminar(registro_id), headers=headers)
    assert resp.status_code == 204, resp.text

    assert (await client.get(f"/produccion/fitosanitarios/{registro_id}", headers=headers)).status_code == 404
    assert await _stock(db_session, insumo) == 100.0
    assert (await _orden(client, headers, orden["id"])).status_code == 404
    assert await _count(db_session, OrdenAplicacionParcela.id) == 0
    assert await _count(db_session, MovimientoStock.id) == 0


async def test_eliminar_registro_de_orden_de_dos_parcelas_con_la_otra_aplicada_queda_completada(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_por_parcelas(client, headers, create_insumo, create_parcela)
    r1 = await _confirmar_parcela(client, headers, orden, filas["Potrero 1"])
    await _confirmar_parcela(client, headers, orden, filas["Potrero 2"])
    assert await _stock(db_session, insumo) == 94.0  # 100 - (1 + 2 ha) x 2

    resp = await client.delete(_url_eliminar(r1), headers=headers)
    assert resp.status_code == 204, resp.text

    body = (await _orden(client, headers, orden["id"])).json()
    assert [p["parcela_nombre"] for p in body["parcelas"]] == ["Potrero 2"]
    assert body["parcelas"][0]["estado"] == "aplicada"
    assert body["estado"] == "completada"
    assert await _stock(db_session, insumo) == 96.0


async def test_eliminar_registro_de_orden_de_dos_parcelas_con_la_otra_pendiente_queda_pendiente(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_por_parcelas(client, headers, create_insumo, create_parcela)
    r1 = await _confirmar_parcela(client, headers, orden, filas["Potrero 1"])
    assert (await _orden(client, headers, orden["id"])).json()["estado"] == "en_curso"

    resp = await client.delete(_url_eliminar(r1), headers=headers)
    assert resp.status_code == 204, resp.text

    body = (await _orden(client, headers, orden["id"])).json()
    assert [(p["parcela_nombre"], p["estado"]) for p in body["parcelas"]] == [("Potrero 2", "pendiente")]
    assert body["estado"] == "pendiente"
    assert await _stock(db_session, insumo) == 100.0


# ── Eliminar: registro que vino de una válvula ───────────────────────────────


async def test_eliminar_registro_de_valvula_con_las_otras_aplicadas_cierra_parcela_y_orden(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    _fake_uploads(monkeypatch)
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])
    foto = await client.post(f"/ordenes-aplicacion/valvulas/{filas['22']}/fotos", files=_FOTO, headers=headers)
    assert foto.status_code == 201, foto.text
    assert await _stock(db_session, insumo) == 94.0  # 100 - (1 + 2 ha) x 2
    # 23 queda pendiente: la parcela todavía no cierra.
    assert (await _orden(client, headers, orden["id"])).json()["estado"] == "en_curso"
    await _confirmar_valvula(client, headers, orden, filas["23"])
    assert await _stock(db_session, insumo) == 88.0

    resp = await client.delete(_url_eliminar(r22), headers=headers)
    assert resp.status_code == 204, resp.text

    assert await _stock(db_session, insumo) == 92.0  # vuelven exactamente las 4 de la válvula 22
    db_session.expire_all()
    assert await db_session.get(OrdenAplicacionValvula, filas["22"]) is None
    assert await db_session.get(RegistroFitosanitario, r22) is None
    assert await _count(db_session, FotoRegistroFitosanitario.id) == 0
    body = (await _orden(client, headers, orden["id"])).json()
    assert [v["valvula_nombre"] for v in body["parcelas"][0]["valvulas"]] == ["21", "23"]
    assert body["parcelas"][0]["estado"] == "aplicada"
    assert body["estado"] == "completada"


async def test_eliminar_registro_de_valvula_que_dejaba_la_parcela_pendiente_la_cierra(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    """21 y 23 aplicadas, 22 aplicada y eliminada: lo que queda está todo aplicado."""
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])
    await _confirmar_valvula(client, headers, orden, filas["23"])
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])

    resp = await client.delete(_url_eliminar(r22), headers=headers)
    assert resp.status_code == 204, resp.text
    body = (await _orden(client, headers, orden["id"])).json()
    assert (body["estado"], body["parcelas"][0]["estado"]) == ("completada", "aplicada")


async def test_eliminar_registro_de_valvula_con_otras_pendientes_recalcula(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])

    resp = await client.delete(_url_eliminar(r22), headers=headers)
    assert resp.status_code == 204, resp.text

    body = (await _orden(client, headers, orden["id"])).json()
    valvulas = {v["valvula_nombre"]: v["estado"] for v in body["parcelas"][0]["valvulas"]}
    assert valvulas == {"21": "aplicada", "23": "pendiente"}
    assert body["parcelas"][0]["estado"] == "pendiente"
    assert body["estado"] == "en_curso"  # 21 sigue aplicada
    assert await _stock(db_session, insumo) == 98.0


async def test_eliminar_unico_registro_de_valvula_con_otras_pendientes_deja_la_orden_pendiente(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])

    assert (await client.delete(_url_eliminar(r22), headers=headers)).status_code == 204
    body = (await _orden(client, headers, orden["id"])).json()
    assert {v["valvula_nombre"] for v in body["parcelas"][0]["valvulas"]} == {"21", "23"}
    assert (body["estado"], body["parcelas"][0]["estado"]) == ("pendiente", "pendiente")
    assert await _stock(db_session, insumo) == 100.0


async def test_eliminar_unica_valvula_de_la_parcela_saca_la_parcela_de_la_orden(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_dos_parrales_una_valvula(
        client, headers, create_insumo, create_parcela, create_valvula,
    )
    ra = await _confirmar_valvula(client, headers, orden, filas["A1"])
    await _confirmar_valvula(client, headers, orden, filas["B1"])
    assert await _stock(db_session, insumo) == 94.0

    resp = await client.delete(_url_eliminar(ra), headers=headers)
    assert resp.status_code == 204, resp.text

    body = (await _orden(client, headers, orden["id"])).json()
    assert [p["parcela_nombre"] for p in body["parcelas"]] == ["Parral B"]
    assert body["estado"] == "completada"
    assert await _stock(db_session, insumo) == 96.0
    assert await _count(db_session, OrdenAplicacionParcela.id) == 1
    assert await _count(db_session, OrdenAplicacionValvula.id) == 1


async def test_eliminar_unica_valvula_de_la_unica_parcela_borra_la_orden_y_sus_fotos(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    _fake_uploads(monkeypatch)
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre", stock_actual=100.0)
    parcela = await create_parcela(nombre="Parral A", variedad="flame", finca=Finca.media_agua, superficie_ha=3.0)
    await create_valvula(parcela_id=parcela.id, nombre="A1", superficie_ha=3.0)
    orden = (await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [parcela.id]), headers=headers,
    )).json()
    fila = orden["parcelas"][0]["valvulas"][0]["id"]
    registro_id = await _confirmar_valvula(client, headers, orden, fila)
    for _ in range(2):
        r = await client.post(f"/ordenes-aplicacion/valvulas/{fila}/fotos", files=_FOTO, headers=headers)
        assert r.status_code == 201, r.text
    assert await _stock(db_session, insumo) == 94.0

    resp = await client.delete(_url_eliminar(registro_id), headers=headers)
    assert resp.status_code == 204, resp.text

    assert (await _orden(client, headers, orden["id"])).status_code == 404
    assert await _stock(db_session, insumo) == 100.0
    assert await _count(db_session, FotoRegistroFitosanitario.id) == 0
    assert await _count(db_session, OrdenAplicacionValvula.id) == 0
    assert await _count(db_session, OrdenAplicacionParcela.id) == 0
    assert await _count(db_session, OrdenAplicacion.id) == 0
    assert await _count(db_session, RegistroFitosanitario.id) == 0
    assert await _count(db_session, MovimientoStock.id) == 0


async def test_eliminar_registro_de_valvula_no_toca_las_fotos_de_otra_valvula_no_aplicada(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    _fake_uploads(monkeypatch)
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"], resultado="no_aplicada", observaciones="Caño roto")
    foto = await client.post(f"/ordenes-aplicacion/valvulas/{filas['21']}/fotos", files=_FOTO, headers=headers)
    assert foto.status_code == 201
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])

    assert (await client.delete(_url_eliminar(r22), headers=headers)).status_code == 204
    db_session.expire_all()
    restantes = (await db_session.execute(select(FotoRegistroFitosanitario))).scalars().all()
    assert [f.orden_valvula_id for f in restantes] == [filas["21"]]


async def test_eliminar_registro_de_orden_deja_auditoria_de_lo_que_saco(
    client, create_user, create_insumo, create_parcela, create_valvula, caplog,
):
    headers, user = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])

    with caplog.at_level("INFO", logger="app"):
        resp = await client.delete(_url_eliminar(r22), headers=headers)
    assert resp.status_code == 204, resp.text

    mensajes = [r.getMessage() for r in caplog.records if "fitosanitario eliminado" in r.getMessage()]
    assert len(mensajes) == 1
    assert r22 in mensajes[0]
    assert orden["id"] in mensajes[0]
    assert user.id in mensajes[0]
    assert f"orden_valvula_quitada={filas['22']}" in mensajes[0]
    assert "orden_parcela_quitada=None" in mensajes[0]  # 21 and 23 keep the parcela in
    assert "orden_eliminada=False" in mensajes[0]


async def test_eliminar_sigue_siendo_solo_gerencial(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])
    encargado, _u = await _auth(
        client, create_user, email="enc@test.com", role=UserRole.encargado, finca=Finca.media_agua,
    )
    assert (await client.delete(_url_eliminar(r22), headers=encargado)).status_code == 403


# ── Reactivar ────────────────────────────────────────────────────────────────


async def test_reactivar_registro_de_parcela_vuelve_a_pendiente(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_por_parcelas(
        client, headers, create_insumo, create_parcela, superficies=(1.0,),
    )
    registro_id = await _confirmar_parcela(client, headers, orden, filas["Potrero 1"])
    assert (await _orden(client, headers, orden["id"])).json()["estado"] == "completada"

    resp = await client.post(_url_reactivar(registro_id), headers=headers)
    assert resp.status_code == 204, resp.text

    detalle = (await _orden(client, headers, orden["id"])).json()
    assert detalle["estado"] == "pendiente"
    assert detalle["parcelas"][0]["estado"] == "pendiente"
    assert detalle["parcelas"][0]["registro_fitosanitario_id"] is None
    assert await _stock(db_session, insumo) == 100.0
    assert (await client.get(f"/produccion/fitosanitarios/{registro_id}", headers=headers)).status_code == 404

    # La parcela se puede volver a confirmar.
    nuevo = await _confirmar_parcela(client, headers, orden, filas["Potrero 1"])
    assert nuevo != registro_id
    assert (await _orden(client, headers, orden["id"])).json()["estado"] == "completada"


async def test_reactivar_registro_de_parcela_con_otra_aplicada_deja_en_curso(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_por_parcelas(client, headers, create_insumo, create_parcela)
    r1 = await _confirmar_parcela(client, headers, orden, filas["Potrero 1"])
    await _confirmar_parcela(client, headers, orden, filas["Potrero 2"])

    assert (await client.post(_url_reactivar(r1), headers=headers)).status_code == 204

    body = (await _orden(client, headers, orden["id"])).json()
    estados = {p["parcela_nombre"]: p["estado"] for p in body["parcelas"]}
    assert estados == {"Potrero 1": "pendiente", "Potrero 2": "aplicada"}
    assert body["estado"] == "en_curso"
    assert await _stock(db_session, insumo) == 96.0


async def test_reactivar_registro_de_valvula_equivale_a_deshacer(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    _fake_uploads(monkeypatch)
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"])
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"], observaciones="Faltó producto")
    await _confirmar_valvula(client, headers, orden, filas["23"])
    assert (await client.post(f"/ordenes-aplicacion/valvulas/{filas['22']}/revisar", headers=headers)).status_code == 204
    assert (await client.post(f"/ordenes-aplicacion/valvulas/{filas['22']}/fotos", files=_FOTO, headers=headers)).status_code == 201
    assert await _stock(db_session, insumo) == 88.0

    resp = await client.post(_url_reactivar(r22), headers=headers)
    assert resp.status_code == 204, resp.text

    assert await _stock(db_session, insumo) == 92.0
    db_session.expire_all()
    fila = await db_session.get(OrdenAplicacionValvula, filas["22"])
    assert fila is not None  # la válvula sigue en la orden, pendiente
    assert fila.estado.value == "pendiente"
    assert fila.resultado is None
    assert fila.responsable is None and fila.responsable_id is None
    assert fila.observaciones is None
    assert fila.confirmada_at is None
    assert fila.revisada_at is None and fila.revisada_por is None
    assert fila.registro_fitosanitario_id is None
    assert await db_session.get(RegistroFitosanitario, r22) is None
    assert await _count(db_session, FotoRegistroFitosanitario.id) == 0
    body = (await _orden(client, headers, orden["id"])).json()
    assert (body["estado"], body["parcelas"][0]["estado"]) == ("en_curso", "pendiente")

    # Igual que tras deshacer: se puede volver a confirmar.
    assert await _confirmar_valvula(client, headers, orden, filas["22"])
    body = (await _orden(client, headers, orden["id"])).json()
    assert (body["estado"], body["parcelas"][0]["estado"]) == ("completada", "aplicada")


async def test_reactivar_y_deshacer_dejan_la_misma_fila(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    """Misma orden, dos válvulas confirmadas igual: una se deshace y la otra se
    reactiva; ambas filas quedan idénticas en lo que importa."""
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await _confirmar_valvula(client, headers, orden, filas["21"], observaciones="Nota")
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"], observaciones="Nota")

    deshecha = await client.post(_url_deshacer(orden, filas["21"]), headers=headers)
    assert deshecha.status_code == 200, deshecha.text
    assert (await client.post(_url_reactivar(r22), headers=headers)).status_code == 204

    body = (await _orden(client, headers, orden["id"])).json()
    por_nombre = {v["valvula_nombre"]: v for v in body["parcelas"][0]["valvulas"]}
    campos = ("estado", "resultado", "responsable", "observaciones", "confirmada_at", "registro_fitosanitario_id")
    assert {c: por_nombre["22"][c] for c in campos} == {c: por_nombre["21"][c] for c in campos}
    assert {c: deshecha.json()[c] for c in campos} == {c: por_nombre["21"][c] for c in campos}
    assert body["estado"] == "pendiente"
    assert await _stock(db_session, insumo) == 100.0


async def test_reactivar_registro_manual_es_409(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(stock_actual=100.0)
    parcela = await create_parcela(nombre="Parral M", finca=Finca.media_agua, superficie_ha=5.0)
    creado = await client.post(
        "/produccion/fitosanitarios/",
        json={
            "fecha": "2026-09-08", "parcela_id": parcela.id, "insumo_id": insumo.id,
            "dosis_por_ha": 2.0, "motivo": "Preventivo", "dias_carencia": 7,
            "dias_reingreso": 2, "responsable": "Juan Perez",
        },
        headers=headers,
    )
    assert creado.status_code == 201, creado.text

    resp = await client.post(_url_reactivar(creado.json()["id"]), headers=headers)
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "Esta aplicación no viene de una orden: no hay nada que reactivar."
    assert await _stock(db_session, insumo) == 90.0
    assert await _count(db_session, RegistroFitosanitario.id) == 1


async def test_reactivar_inexistente_es_404(client, create_user):
    headers, _ = await _auth(client, create_user)
    assert (await client.post(_url_reactivar("no-existe"), headers=headers)).status_code == 404


async def test_reactivar_roles(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    r21 = await _confirmar_valvula(client, headers, orden, filas["21"])
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])

    regador, _u = await _auth(
        client, create_user, email="reg@test.com", role=UserRole.regador, finca=Finca.media_agua,
    )
    obrero, _u = await _auth(
        client, create_user, email="obr@test.com", role=UserRole.obrero, finca=Finca.media_agua,
    )
    ajeno, _u = await _auth(
        client, create_user, email="enc2@test.com", role=UserRole.encargado, finca=Finca.caucete,
    )
    propio, _u = await _auth(
        client, create_user, email="enc1@test.com", role=UserRole.encargado, finca=Finca.media_agua,
    )

    assert (await client.post(_url_reactivar(r21), headers=regador)).status_code == 403
    assert (await client.post(_url_reactivar(r21), headers=obrero)).status_code == 403
    assert (await client.post(_url_reactivar(r21), headers=ajeno)).status_code == 403
    assert await _stock(db_session, insumo) == 94.0  # nada se devolvió
    assert (await client.post(_url_reactivar(r21), headers=propio)).status_code == 204
    assert (await client.post(_url_reactivar(r22), headers=headers)).status_code == 204
    assert await _stock(db_session, insumo) == 100.0


async def test_reactivar_encargado_ajeno_sobre_registro_manual_da_403_no_409(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(stock_actual=100.0)
    parcela = await create_parcela(nombre="Parral M", finca=Finca.media_agua, superficie_ha=5.0)
    creado = await client.post(
        "/produccion/fitosanitarios/",
        json={
            "fecha": "2026-09-08", "parcela_id": parcela.id, "insumo_id": insumo.id,
            "dosis_por_ha": 2.0, "motivo": "Preventivo", "dias_carencia": 7,
            "dias_reingreso": 2, "responsable": "Juan Perez",
        },
        headers=headers,
    )
    ajeno, _u = await _auth(
        client, create_user, email="enc2@test.com", role=UserRole.encargado, finca=Finca.caucete,
    )
    resp = await client.post(_url_reactivar(creado.json()["id"]), headers=ajeno)
    assert resp.status_code == 403, resp.text


async def test_reactivar_dos_veces_da_404_y_devuelve_stock_una_vez(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    r22 = await _confirmar_valvula(client, headers, orden, filas["22"])

    assert (await client.post(_url_reactivar(r22), headers=headers)).status_code == 204
    # The registro no longer exists after the first call.
    assert (await client.post(_url_reactivar(r22), headers=headers)).status_code == 404
    assert await _stock(db_session, insumo) == 100.0


async def test_reactivar_deja_auditoria(
    client, create_user, create_insumo, create_parcela, caplog,
):
    headers, user = await _auth(client, create_user)
    orden, filas, _i = await _orden_por_parcelas(
        client, headers, create_insumo, create_parcela, superficies=(1.0,),
    )
    registro_id = await _confirmar_parcela(client, headers, orden, filas["Potrero 1"])

    with caplog.at_level("INFO", logger="app"):
        resp = await client.post(_url_reactivar(registro_id), headers=headers)
    assert resp.status_code == 204, resp.text

    mensajes = [r.getMessage() for r in caplog.records if "fitosanitario reactivado" in r.getMessage()]
    assert len(mensajes) == 1
    assert registro_id in mensajes[0]
    assert orden["id"] in mensajes[0]
    assert user.id in mensajes[0]


# ── orden_id en RegistroFitosanitarioResponse ────────────────────────────────


async def test_orden_id_en_todas_las_respuestas_de_registro(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    # Valve-born and parcel-born records, both confirmed today (carencia 7 días).
    orden_v, filas_v, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    r_valvula = await _confirmar_valvula(client, headers, orden_v, filas_v["21"])
    orden_p, filas_p, _i = await _orden_por_parcelas(
        client, headers, create_insumo, create_parcela, superficies=(1.0,),
    )
    r_parcela = await _confirmar_parcela(client, headers, orden_p, filas_p["Potrero 1"])
    parcela_manual = await create_parcela(nombre="Parral M", finca=Finca.media_agua, superficie_ha=1.0)
    payload_manual = {
        "fecha": date.today().isoformat(), "parcela_id": parcela_manual.id, "insumo_id": insumo.id,
        "dosis_por_ha": 1.0, "motivo": "Preventivo", "dias_carencia": 7, "dias_reingreso": 2,
        "responsable": "Juan Perez", "idempotency_key": "11111111-1111-1111-1111-111111111111",
    }

    creado = await client.post("/produccion/fitosanitarios/", json=payload_manual, headers=headers)
    assert creado.status_code == 201, creado.text
    assert creado.json()["orden_id"] is None
    r_manual = creado.json()["id"]
    # Idempotent replay returns the existing row through a different code path.
    replay = await client.post("/produccion/fitosanitarios/", json=payload_manual, headers=headers)
    assert replay.status_code == 201, replay.text
    assert (replay.json()["id"], replay.json()["orden_id"]) == (r_manual, None)

    esperado = {r_valvula: orden_v["id"], r_parcela: orden_p["id"], r_manual: None}

    for registro_id, orden_id in esperado.items():
        uno = await client.get(f"/produccion/fitosanitarios/{registro_id}", headers=headers)
        assert uno.status_code == 200, uno.text
        assert uno.json()["orden_id"] == orden_id
        editado = await client.put(
            f"/produccion/fitosanitarios/{registro_id}", json={"observaciones": "editado"}, headers=headers,
        )
        assert editado.status_code == 200, editado.text
        assert editado.json()["orden_id"] == orden_id

    listado = await client.get("/produccion/fitosanitarios/", headers=headers)
    assert listado.status_code == 200, listado.text
    assert {r["id"]: r["orden_id"] for r in listado.json()} == esperado

    carencia = await client.get("/produccion/fitosanitarios/alertas/carencia", headers=headers)
    assert carencia.status_code == 200, carencia.text
    assert {r["id"]: r["orden_id"] for r in carencia.json()} == esperado

    desde = (date.today() - timedelta(days=1)).isoformat()
    hasta = (date.today() + timedelta(days=1)).isoformat()
    vistos: dict[str, str | None] = {}
    for parcela_id in {orden_v["parcelas"][0]["parcela_id"], orden_p["parcelas"][0]["parcela_id"], parcela_manual.id}:
        historial = await client.get(
            f"/trazabilidad/parcela/{parcela_id}/historial",
            params={"desde": desde, "hasta": hasta}, headers=headers,
        )
        assert historial.status_code == 200, historial.text
        vistos.update({r["id"]: r["orden_id"] for r in historial.json()["fitosanitarios"]})
    assert vistos == esperado


async def test_editar_registro_de_orden_con_recalculo_de_stock_conserva_orden_id(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_por_parcelas(
        client, headers, create_insumo, create_parcela, superficies=(1.0,),
    )
    registro_id = await _confirmar_parcela(client, headers, orden, filas["Potrero 1"])

    editado = await client.put(
        f"/produccion/fitosanitarios/{registro_id}", json={"dosis_por_ha": 3.0}, headers=headers,
    )
    assert editado.status_code == 200, editado.text
    assert editado.json()["orden_id"] == orden["id"]
    assert float(editado.json()["cantidad_total"]) == 3.0
