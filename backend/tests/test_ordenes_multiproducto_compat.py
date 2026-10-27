"""Órdenes multiproducto: "a revisar" con la lista de productos, filtros que
miran las parcelas (no la variedad shim) y compatibilidad con los clientes
viejos de un solo producto (web y mobile actuales).

Spec: docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md
"""
from __future__ import annotations

from sqlalchemy import select

from app.models.finanzas import Finca
from app.models.produccion import RegistroFitosanitario
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


def _linea(insumo_id, dosis=1.0, numero_aplicacion=None):
    return {
        "insumo_id": insumo_id, "dosis_por_ha": dosis, "dias_carencia": 7,
        "dias_reingreso": 2, "numero_aplicacion": numero_aplicacion,
    }


async def _crear_orden(client, headers, lineas, parcela_ids, **extra):
    body = {
        "temporada": 2026, "objetivo": "Curación tintos", "fecha_planificada": "2026-10-15",
        "lineas": lineas, "parcela_ids": parcela_ids,
    }
    body.update(extra)
    resp = await client.post("/ordenes-aplicacion/", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _body_viejo(insumo_id, parcela_ids, **extra):
    # Exact shape the current web/mobile clients send (one product, top level).
    body = {
        "temporada": 2026, "variedad": "flame", "insumo_id": insumo_id, "dosis_por_ha": 2.0,
        "objetivo": "Oidio", "dias_carencia": 7, "dias_reingreso": 2,
        "fecha_planificada": "2026-10-15", "parcela_ids": parcela_ids,
    }
    body.update(extra)
    return body


def _url_valvula(orden, fila_id):
    return f"/ordenes-aplicacion/{orden['id']}/valvulas/{fila_id}/confirmar"


def _fila_de(orden, parcela_id):
    item = next(p for p in orden["parcelas"] if p["parcela_id"] == parcela_id)
    return item["valvulas"][0]["id"]


# ── A revisar ─────────────────────────────────────────────────────────────────


async def test_a_revisar_lista_todos_los_productos(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    folpan = await create_insumo(nombre="Super folpan", unidad="kg")
    mancozeb = await create_insumo(nombre="Mancozeb", unidad="kg")
    oponente = await create_insumo(nombre="Oponente", unidad="lt")
    flame = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0)
    # Larger parcel: the order's shim variety is syrah, not flame.
    syrah = await create_parcela(nombre="Parral 9", variedad="syrah", finca=Finca.media_agua, superficie_ha=6.0)
    await create_valvula(parcela_id=flame.id, nombre="11", superficie_ha=2.0)
    await create_valvula(parcela_id=syrah.id, nombre="91", superficie_ha=6.0)
    orden = await _crear_orden(
        client, headers,
        [_linea(folpan.id, 1.5), _linea(mancozeb.id, 2.0), _linea(oponente.id, 0.15)],
        [flame.id, syrah.id],
    )
    assert orden["variedad"] == "syrah"

    r = await client.post(
        _url_valvula(orden, _fila_de(orden, flame.id)),
        json={"resultado": "no_aplicada", "observaciones": "Se cortó el agua"}, headers=headers,
    )
    assert r.status_code == 200, r.text

    resp = await client.get("/ordenes-aplicacion/a-revisar", headers=headers)
    assert resp.status_code == 200, resp.text
    [fila] = resp.json()
    assert fila["valvula_nombre"] == "11"
    assert fila["productos"] == [
        {"insumo_id": folpan.id, "insumo_nombre": "Super folpan", "dosis_por_ha": 1.5},
        {"insumo_id": mancozeb.id, "insumo_nombre": "Mancozeb", "dosis_por_ha": 2.0},
        {"insumo_id": oponente.id, "insumo_nombre": "Oponente", "dosis_por_ha": 0.15},
    ]
    # Shim for old clients: first line.
    assert fila["insumo_id"] == folpan.id
    assert fila["insumo_nombre"] == "Super folpan"
    assert fila["dosis_por_ha"] == 1.5
    # Variety of the valve's own parcel, not the order's shim.
    assert fila["variedad"] == "flame"


async def test_a_revisar_parcela_sin_variedad_usa_la_variedad_de_la_orden(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    sin_variedad = await create_parcela(nombre="Parral 3", variedad=None, finca=Finca.media_agua, superficie_ha=1.0)
    flame = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0)
    await create_valvula(parcela_id=sin_variedad.id, nombre="31", superficie_ha=1.0)
    orden = await _crear_orden(client, headers, [_linea(insumo.id)], [sin_variedad.id, flame.id])

    r = await client.post(
        _url_valvula(orden, _fila_de(orden, sin_variedad.id)),
        json={"resultado": "no_aplicada", "observaciones": "Viento"}, headers=headers,
    )
    assert r.status_code == 200, r.text

    [fila] = (await client.get("/ordenes-aplicacion/a-revisar", headers=headers)).json()
    assert fila["variedad"] == "flame"
    assert [p["insumo_nombre"] for p in fila["productos"]] == ["Azufre"]


# ── Cliente viejo ─────────────────────────────────────────────────────────────


async def test_cliente_viejo_flujo_completo(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre", unidad="kg")
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua, superficie_ha=3.0)
    await create_valvula(parcela_id=parcela.id, nombre="21", superficie_ha=1.5)
    regador, _u = await _auth(
        client, create_user, email="reg@test.com", role=UserRole.regador, finca=Finca.media_agua,
    )

    creada = await client.post("/ordenes-aplicacion/", json=_body_viejo(insumo.id, [parcela.id]), headers=headers)
    assert creada.status_code == 201, creada.text

    pendientes = await client.get("/ordenes-aplicacion/pendientes", headers=regador)
    assert pendientes.status_code == 200, pendientes.text
    [orden] = pendientes.json()
    # Fields the current mobile build reads.
    assert orden["insumo_id"] == insumo.id
    assert orden["insumo_nombre"] == "Azufre"
    assert orden["insumo_unidad"] == "kg"
    assert orden["dosis_por_ha"] == 2.0
    assert orden["variedad"] == "flame"
    fila_id = orden["parcelas"][0]["valvulas"][0]["id"]

    conf = await client.post(_url_valvula(orden, fila_id), json={"resultado": "completa"}, headers=regador)
    assert conf.status_code == 200, conf.text
    registro_id = conf.json()["registro_fitosanitario_id"]
    assert registro_id is not None

    db_session.expire_all()
    registros = (await db_session.execute(select(RegistroFitosanitario))).scalars().all()
    assert [r.id for r in registros] == [registro_id]
    assert registros[0].insumo_id == insumo.id


async def test_pendientes_filtra_por_finca_con_lineas(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    folpan = await create_insumo(nombre="Super folpan")
    mancozeb = await create_insumo(nombre="Mancozeb")
    media_agua = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    caucete = await create_parcela(nombre="Parral 40", variedad="syrah", finca=Finca.caucete)
    await _crear_orden(
        client, headers, [_linea(folpan.id), _linea(mancozeb.id)], [media_agua.id, caucete.id],
    )
    reg_ma, _a = await _auth(client, create_user, email="ma@test.com", role=UserRole.regador, finca=Finca.media_agua)
    reg_ca, _b = await _auth(client, create_user, email="ca@test.com", role=UserRole.regador, finca=Finca.caucete)
    reg_lm, _c = await _auth(client, create_user, email="lm@test.com", role=UserRole.regador, finca=Finca.los_mimbres)

    [vista_ma] = (await client.get("/ordenes-aplicacion/pendientes", headers=reg_ma)).json()
    assert [p["parcela_id"] for p in vista_ma["parcelas"]] == [media_agua.id]
    assert [l["insumo_nombre"] for l in vista_ma["lineas"]] == ["Super folpan", "Mancozeb"]

    [vista_ca] = (await client.get("/ordenes-aplicacion/pendientes", headers=reg_ca)).json()
    assert [p["parcela_id"] for p in vista_ca["parcelas"]] == [caucete.id]
    assert len(vista_ca["lineas"]) == 2

    assert (await client.get("/ordenes-aplicacion/pendientes", headers=reg_lm)).json() == []

    todo = (await client.get("/ordenes-aplicacion/pendientes", headers=headers)).json()
    assert {p["parcela_id"] for p in todo[0]["parcelas"]} == {media_agua.id, caucete.id}


async def test_put_body_viejo_sobre_orden_de_varias_lineas_da_409(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    folpan = await create_insumo(nombre="Super folpan")
    mancozeb = await create_insumo(nombre="Mancozeb")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    orden = await _crear_orden(client, headers, [_linea(folpan.id), _linea(mancozeb.id)], [parcela.id])

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}", json=_body_viejo(folpan.id, [parcela.id]), headers=headers,
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == (
        "Esta orden tiene varios productos; actualizá la app/la web para editarla."
    )
    # Nothing was dropped.
    again = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
    assert [l["insumo_nombre"] for l in again["lineas"]] == ["Super folpan", "Mancozeb"]


async def test_put_body_viejo_sobre_orden_de_una_linea_sigue_funcionando(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    folpan = await create_insumo(nombre="Super folpan")
    azufre = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    orden = await _crear_orden(client, headers, [_linea(folpan.id)], [parcela.id])

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json=_body_viejo(azufre.id, [parcela.id], dosis_por_ha=3.0, dias_carencia=10),
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [l["insumo_id"] for l in body["lineas"]] == [azufre.id]
    assert body["dosis_por_ha"] == 3.0
    assert body["dias_carencia"] == 10


async def test_put_body_nuevo_sobre_orden_de_varias_lineas_no_se_bloquea(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    folpan = await create_insumo(nombre="Super folpan")
    mancozeb = await create_insumo(nombre="Mancozeb")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    orden = await _crear_orden(client, headers, [_linea(folpan.id), _linea(mancozeb.id)], [parcela.id])

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json={
            "objetivo": "Oidio", "fecha_planificada": "2026-10-20", "parcela_ids": [parcela.id],
            # Top-level insumo_id next to `lineas` is NOT the legacy shape.
            "insumo_id": folpan.id, "lineas": [_linea(mancozeb.id)],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert [l["insumo_nombre"] for l in resp.json()["lineas"]] == ["Mancozeb"]


# ── Listado por variedad ──────────────────────────────────────────────────────


async def test_listado_filtra_por_cualquier_variedad_de_las_parcelas(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    flame_a = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0)
    flame_b = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0)
    syrah = await create_parcela(nombre="Parral 9", variedad="syrah", finca=Finca.media_agua, superficie_ha=8.0)
    bonarda = await create_parcela(nombre="Parral 20", variedad="bonarda", finca=Finca.media_agua)
    # Shim variety syrah; two flame parcels must not duplicate the order.
    mixta = await _crear_orden(client, headers, [_linea(insumo.id)], [flame_a.id, flame_b.id, syrah.id])
    sola = await _crear_orden(client, headers, [_linea(insumo.id)], [bonarda.id])

    async def _ids(variedad):
        resp = await client.get(
            "/ordenes-aplicacion/", params={"temporada": 2026, "variedad": variedad}, headers=headers,
        )
        assert resp.status_code == 200, resp.text
        return [o["id"] for o in resp.json()]

    assert await _ids("flame") == [mixta["id"]]
    assert await _ids("syrah") == [mixta["id"]]
    assert await _ids("bonarda") == [sola["id"]]
    assert await _ids("red_globe") == []
