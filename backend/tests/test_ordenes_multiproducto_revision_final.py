"""Final review fixes of the multiproducto branch:

- M1: deleting a plan row that registros or orders still point at is a 409,
  not an IntegrityError 500.
- M2: PUT / DELETE of an order take the order lock (like confirm/deshacer)
  before checking whether anything was confirmed.
- M4: a legacy single-product PUT on a plan order keeps its round when the
  product does not change (it used to turn the order into `extra`).
"""
from __future__ import annotations

from sqlalchemy import select

from app.models.finanzas import Finca
from app.models.produccion import RegistroFitosanitario
from app.services import aplicaciones
from tests.test_ordenes_multiproducto_crear import _auth, _linea, _payload, _plan

_DESDE_PLAN = {"dias_carencia": 7, "dias_reingreso": 2, "fecha_planificada": "2026-10-15"}


async def _orden_desde_plan(client, headers, plan_id):
    resp = await client.post(
        "/ordenes-aplicacion/desde-plan",
        json={"plan_fitosanitario_id": plan_id, **_DESDE_PLAN},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── M1: borrar fila del plan con vínculos ────────────────────────────────────


async def test_borrar_fila_del_plan_con_registros_vinculados_da_409(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    await create_parcela(
        nombre="Potrero 1", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0,
    )
    plan_id = (await _plan(client, headers, insumo.id, ["flame"]))[0]["id"]
    orden = await _orden_desde_plan(client, headers, plan_id)
    item_id = orden["parcelas"][0]["id"]
    conf = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar", json={}, headers=headers,
    )
    assert conf.status_code == 200, conf.text
    vinculados = (
        await db_session.execute(
            select(RegistroFitosanitario.id).where(RegistroFitosanitario.plan_fitosanitario_id == plan_id)
        )
    ).scalars().all()
    assert len(vinculados) == 1

    resp = await client.delete(f"/plan-fitosanitario/{plan_id}", headers=headers)
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == (
        "Esta fila del plan ya tiene aplicaciones vinculadas; no se puede eliminar."
    )
    listado = await client.get("/plan-fitosanitario/?temporada=2026", headers=headers)
    assert [f["id"] for f in listado.json()] == [plan_id]


async def test_borrar_fila_del_plan_con_orden_vinculada_da_409(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    plan_id = (await _plan(client, headers, insumo.id, ["flame"]))[0]["id"]
    await _orden_desde_plan(client, headers, plan_id)

    resp = await client.delete(f"/plan-fitosanitario/{plan_id}", headers=headers)
    assert resp.status_code == 409, resp.text
    assert "órdenes de aplicación" in resp.json()["detail"]


async def test_borrar_fila_del_plan_sin_vinculos_sigue_funcionando(client, create_user, create_insumo):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    plan_id = (await _plan(client, headers, insumo.id, ["flame"]))[0]["id"]

    resp = await client.delete(f"/plan-fitosanitario/{plan_id}", headers=headers)
    assert resp.status_code == 204, resp.text


# ── M2: PUT / DELETE toman el lock de la orden ───────────────────────────────


def _espiar_lock(monkeypatch) -> list[str]:
    llamadas: list[str] = []
    original = aplicaciones.bloquear_orden

    async def espia(db, orden_id):
        llamadas.append(orden_id)
        await original(db, orden_id)

    monkeypatch.setattr("app.api.ordenes_aplicacion.bloquear_orden", espia)
    return llamadas


async def test_put_y_delete_bloquean_la_orden(
    client, monkeypatch, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    orden = (
        await client.post("/ordenes-aplicacion/", json=_payload([_linea(insumo.id)], [parcela.id]), headers=headers)
    ).json()
    llamadas = _espiar_lock(monkeypatch)

    put = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json={
            "objetivo": "Oidio", "fecha_planificada": "2026-10-20", "parcela_ids": [parcela.id],
            "lineas": [_linea(insumo.id, dosis=2.0)],
        },
        headers=headers,
    )
    assert put.status_code == 200, put.text
    assert llamadas == [orden["id"]]

    delete = await client.delete(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert delete.status_code == 204, delete.text
    assert llamadas == [orden["id"], orden["id"]]


async def test_put_y_delete_de_orden_inexistente_siguen_dando_404(client, monkeypatch, create_user):
    headers, _ = await _auth(client, create_user)
    llamadas = _espiar_lock(monkeypatch)
    body = {
        "objetivo": "Oidio", "fecha_planificada": "2026-10-20",
        "lineas": [_linea("no-existe")], "variedad": "flame",
    }

    assert (await client.put("/ordenes-aplicacion/no-existe", json=body, headers=headers)).status_code == 404
    assert (await client.delete("/ordenes-aplicacion/no-existe", headers=headers)).status_code == 404
    assert llamadas == ["no-existe", "no-existe"]


async def test_put_y_delete_con_confirmaciones_siguen_dando_409_tras_el_lock(
    client, monkeypatch, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(
        nombre="Potrero 1", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0,
    )
    orden = (
        await client.post("/ordenes-aplicacion/", json=_payload([_linea(insumo.id)], [parcela.id]), headers=headers)
    ).json()
    item_id = orden["parcelas"][0]["id"]
    conf = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar", json={}, headers=headers,
    )
    assert conf.status_code == 200, conf.text
    llamadas = _espiar_lock(monkeypatch)

    put = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json={
            "objetivo": "Oidio", "fecha_planificada": "2026-10-20", "parcela_ids": [parcela.id],
            "lineas": [_linea(insumo.id, dosis=2.0)],
        },
        headers=headers,
    )
    assert put.status_code == 409, put.text
    delete = await client.delete(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert delete.status_code == 409, delete.text
    assert llamadas == [orden["id"], orden["id"]]


# ── M4: body viejo sobre orden del plan conserva la ronda ────────────────────


def _body_viejo(insumo_id, parcela_id, **extra):
    body = {
        "variedad": "flame", "insumo_id": insumo_id, "dosis_por_ha": 2.0, "objetivo": "Oidio",
        "dias_carencia": 7, "dias_reingreso": 2, "fecha_planificada": "2026-10-20",
        "parcela_ids": [parcela_id],
    }
    body.update(extra)
    return body


async def test_put_body_viejo_mismo_insumo_conserva_la_ronda_del_plan(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    plan_id = (await _plan(client, headers, insumo.id, ["flame"], numero=3))[0]["id"]
    orden = await _orden_desde_plan(client, headers, plan_id)
    assert orden["origen"] == "plan"
    assert orden["lineas"][0]["numero_aplicacion"] == 3

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}", json=_body_viejo(insumo.id, parcela.id), headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["origen"] == "plan"
    assert body["lineas"][0]["numero_aplicacion"] == 3
    assert body["lineas"][0]["dosis_por_ha"] == 2.0
    assert body["plan_fitosanitario_id"] == plan_id


async def test_put_body_viejo_con_otro_insumo_deja_la_orden_extra(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    otro = await create_insumo(nombre="Mancozeb")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    plan_id = (await _plan(client, headers, insumo.id, ["flame"]))[0]["id"]
    orden = await _orden_desde_plan(client, headers, plan_id)

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}", json=_body_viejo(otro.id, parcela.id), headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # A different product is no longer the plan's round.
    assert body["origen"] == "extra"
    assert body["lineas"][0]["numero_aplicacion"] is None
    assert body["plan_fitosanitario_id"] is None
