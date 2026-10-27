"""Órdenes multiproducto: crear, editar y eliminar órdenes con varias líneas
(productos) y varias variedades, más compatibilidad con el body viejo de un
solo producto.

Spec: docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md
"""
from __future__ import annotations

from datetime import date

from app.core import push
from app.models.finanzas import Finca
from app.models.parcela import VariedadUva
from app.models.produccion import (
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrigenOrdenAplicacion,
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


def _linea(insumo_id, dosis=1.0, numero_aplicacion=None, **extra):
    linea = {
        "insumo_id": insumo_id, "dosis_por_ha": dosis, "dias_carencia": 7,
        "dias_reingreso": 2, "numero_aplicacion": numero_aplicacion,
    }
    linea.update(extra)
    return linea


def _payload(lineas, parcela_ids, **extra):
    body = {
        "temporada": 2026, "objetivo": "Curación tintos", "fecha_planificada": "2026-10-15",
        "lineas": lineas, "parcela_ids": parcela_ids,
    }
    body.update(extra)
    return body


async def _cuatro_insumos(create_insumo):
    return [
        await create_insumo(nombre="Super folpan", unidad="kg"),
        await create_insumo(nombre="Mancozeb", unidad="kg"),
        await create_insumo(nombre="Oxicloruro", unidad="kg"),
        await create_insumo(nombre="Oponente", unidad="lt"),
    ]


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
    return resp.json()


def _recorder(monkeypatch):
    llamadas: list[dict] = []

    async def fake(titulo, cuerpo, user_ids=None, data=None, session_factory=None):
        llamadas.append({"titulo": titulo, "cuerpo": cuerpo})

    monkeypatch.setattr("app.api.ordenes_aplicacion.notificar_tokens", fake)
    return llamadas


# ── Crear ─────────────────────────────────────────────────────────────────────


async def test_crea_orden_con_4_lineas_y_2_variedades(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _cuatro_insumos(create_insumo)
    # "malbec" is not a VariedadUva value: two real varieties stand in for it.
    flame = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0)
    syrah = await create_parcela(nombre="Parral 9", variedad="syrah", finca=Finca.media_agua, superficie_ha=5.0)

    lineas = [_linea(i.id, dosis=d) for i, d in zip(insumos, (1.5, 2.0, 1.0, 0.15))]
    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload(lineas, [flame.id, syrah.id]), headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body["lineas"]) == 4
    assert [l["insumo_nombre"] for l in body["lineas"]] == [
        "Super folpan", "Mancozeb", "Oxicloruro", "Oponente",
    ]
    assert body["lineas"][3]["insumo_unidad"] == "lt"
    assert body["lineas"][3]["dosis_por_ha"] == 0.15
    assert set(body["variedades"]) == {"flame", "syrah"}
    assert body["origen"] == "extra"
    # Legacy shim: first line + variety of the largest parcel.
    assert body["insumo_id"] == insumos[0].id
    assert body["insumo_nombre"] == "Super folpan"
    assert body["dosis_por_ha"] == 1.5
    assert body["variedad"] == "syrah"
    assert {p["parcela_id"] for p in body["parcelas"]} == {flame.id, syrah.id}


async def test_origen_plan_si_alguna_linea_tiene_numero_aplicacion(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _cuatro_insumos(create_insumo)
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    plan = await _plan(client, headers, insumos[1].id, ["flame"], numero=3)

    lineas = [_linea(insumos[0].id), _linea(insumos[1].id, numero_aplicacion=3)]
    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload(lineas, [parcela.id]), headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["origen"] == "plan"
    assert [l["numero_aplicacion"] for l in body["lineas"]] == [None, 3]
    # First line is off-plan: the legacy plan link stays empty.
    assert body["plan_fitosanitario_id"] is None
    assert plan[0]["id"]


async def test_numero_aplicacion_sin_ronda_en_plan_da_422(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _cuatro_insumos(create_insumo)
    flame = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    # The round exists, but for another variety and for another product.
    await _plan(client, headers, insumos[0].id, ["syrah"], numero=2)
    await _plan(client, headers, insumos[1].id, ["flame"], numero=2)

    resp = await client.post(
        "/ordenes-aplicacion/",
        json=_payload([_linea(insumos[0].id, numero_aplicacion=2)], [flame.id]),
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "ronda 2" in resp.text


async def test_insumo_repetido_da_422(client, create_user, create_insumo, create_parcela):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)

    resp = await client.post(
        "/ordenes-aplicacion/",
        json=_payload([_linea(insumo.id), _linea(insumo.id, dosis=2.0)], [parcela.id]),
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "repetido" in resp.text


async def test_lineas_vacias_da_422(client, create_user, create_parcela):
    headers, _ = await _auth(client, create_user)
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)

    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload([], [parcela.id]), headers=headers,
    )
    assert resp.status_code == 422, resp.text


async def test_sin_parcelas_ni_variedad_da_422(client, create_user, create_insumo):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")

    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload([_linea(insumo.id)], None), headers=headers,
    )
    assert resp.status_code == 422, resp.text


async def test_variedad_sin_parcelas_toma_toda_la_variedad(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    p1 = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    p2 = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)
    await create_parcela(nombre="Parral 9", variedad="syrah", finca=Finca.media_agua)

    resp = await client.post(
        "/ordenes-aplicacion/",
        json=_payload([_linea(insumo.id)], None, variedad="flame"),
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    assert {p["parcela_id"] for p in resp.json()["parcelas"]} == {p1.id, p2.id}


async def test_body_viejo_un_producto_sigue_funcionando(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)
    # Same shape as tests/test_orden_valvulas.py::_payload_extra.
    body = {
        "temporada": 2026, "variedad": "flame", "insumo_id": insumo.id, "dosis_por_ha": 2.0,
        "objetivo": "Oidio", "dias_carencia": 7, "dias_reingreso": 2,
        "fecha_planificada": "2026-10-15", "parcela_ids": [parcela.id],
    }

    resp = await client.post("/ordenes-aplicacion/", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert len(data["lineas"]) == 1
    assert data["lineas"][0]["insumo_id"] == insumo.id
    assert data["lineas"][0]["dosis_por_ha"] == 2.0
    assert data["lineas"][0]["numero_aplicacion"] is None
    assert data["insumo_id"] == insumo.id
    assert data["insumo_nombre"] == "Azufre"
    assert data["dias_carencia"] == 7
    assert data["variedad"] == "flame"
    assert data["origen"] == "extra"


async def test_desde_plan_sigue_funcionando(client, create_user, create_insumo, create_parcela):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    plan = await _plan(client, headers, insumo.id, ["flame"], numero=4, dosis=1.5)

    resp = await client.post(
        "/ordenes-aplicacion/desde-plan",
        json={
            "plan_fitosanitario_id": plan[0]["id"], "dias_carencia": 7,
            "dias_reingreso": 2, "fecha_planificada": "2026-10-15",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["origen"] == "plan"
    assert body["plan_fitosanitario_id"] == plan[0]["id"]
    assert len(body["lineas"]) == 1
    assert body["lineas"][0]["numero_aplicacion"] == 4
    assert body["lineas"][0]["insumo_id"] == insumo.id
    assert body["lineas"][0]["dosis_por_ha"] == 1.5
    assert [p["parcela_id"] for p in body["parcelas"]] == [parcela.id]


# ── Editar / eliminar ─────────────────────────────────────────────────────────


async def test_put_edita_orden_del_plan_sin_confirmaciones(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _cuatro_insumos(create_insumo)
    p1 = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    p2 = await create_parcela(nombre="Parral 9", variedad="syrah", finca=Finca.media_agua)
    plan = await _plan(client, headers, insumos[0].id, ["flame"], numero=1)
    orden = (
        await client.post(
            "/ordenes-aplicacion/desde-plan",
            json={
                "plan_fitosanitario_id": plan[0]["id"], "dias_carencia": 7,
                "dias_reingreso": 2, "fecha_planificada": "2026-10-15",
            },
            headers=headers,
        )
    ).json()
    linea_original_id = orden["lineas"][0]["id"]

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json={
            "objetivo": "Curación tintos", "fecha_planificada": "2026-10-20",
            "parcela_ids": [p1.id, p2.id],
            "lineas": [
                _linea(insumos[0].id, dosis=2.5, numero_aplicacion=1),
                _linea(insumos[2].id, dosis=1.0),
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["origen"] == "plan"
    assert [l["insumo_nombre"] for l in body["lineas"]] == ["Super folpan", "Oxicloruro"]
    # Same product keeps its line (updated in place, no unique clash).
    assert body["lineas"][0]["id"] == linea_original_id
    assert body["lineas"][0]["dosis_por_ha"] == 2.5
    assert body["dosis_por_ha"] == 2.5
    assert set(body["variedades"]) == {"flame", "syrah"}
    assert {p["parcela_id"] for p in body["parcelas"]} == {p1.id, p2.id}

    again = await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert len(again.json()["lineas"]) == 2


async def test_put_cambia_insumo_y_dosis_reemplaza_lineas(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _cuatro_insumos(create_insumo)
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    orden = (
        await client.post(
            "/ordenes-aplicacion/",
            json=_payload([_linea(insumos[0].id), _linea(insumos[1].id)], [parcela.id]),
            headers=headers,
        )
    ).json()

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json={
            "objetivo": "Oidio", "fecha_planificada": "2026-10-20", "parcela_ids": [parcela.id],
            "lineas": [_linea(insumos[3].id, dosis=0.2)],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [l["insumo_nombre"] for l in body["lineas"]] == ["Oponente"]
    assert body["insumo_id"] == insumos[3].id
    assert body["insumo_nombre"] == "Oponente"
    assert body["dosis_por_ha"] == 0.2


async def test_put_body_viejo_un_producto(client, create_user, create_insumo, create_parcela):
    # On a one-line order; on a multi-line order the old body is a 409
    # (tests/test_ordenes_multiproducto_compat.py).
    headers, _ = await _auth(client, create_user)
    insumos = await _cuatro_insumos(create_insumo)
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    orden = (
        await client.post(
            "/ordenes-aplicacion/",
            json=_payload([_linea(insumos[0].id)], [parcela.id]),
            headers=headers,
        )
    ).json()

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json={
            "variedad": "flame", "insumo_id": insumos[2].id, "dosis_por_ha": 3.0,
            "objetivo": "Oidio", "dias_carencia": 10, "dias_reingreso": 3,
            "fecha_planificada": "2026-11-20", "parcela_ids": [parcela.id],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [l["insumo_id"] for l in body["lineas"]] == [insumos[2].id]
    assert body["dias_carencia"] == 10


async def test_put_con_valvula_ids_recorta_las_valvulas_de_la_orden(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)
    valvulas = [
        await create_valvula(parcela_id=parcela.id, nombre=n, orden=i + 1, superficie_ha=1.0)
        for i, n in enumerate(("21", "22", "23"))
    ]
    orden = (
        await client.post(
            "/ordenes-aplicacion/", json=_payload([_linea(insumo.id)], [parcela.id]), headers=headers,
        )
    ).json()
    assert len(orden["parcelas"][0]["valvulas"]) == 3

    body = {
        "objetivo": "Oidio", "fecha_planificada": "2026-10-20", "parcela_ids": [parcela.id],
        "lineas": [_linea(insumo.id)], "valvula_ids": [valvulas[1].id],
    }
    resp = await client.put(f"/ordenes-aplicacion/{orden['id']}", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    assert [v["valvula_nombre"] for v in resp.json()["parcelas"][0]["valvulas"]] == ["22"]

    body["valvula_ids"] = [valvulas[0].id, valvulas[1].id]
    resp = await client.put(f"/ordenes-aplicacion/{orden['id']}", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    assert [v["valvula_nombre"] for v in resp.json()["parcelas"][0]["valvulas"]] == ["21", "22"]


async def test_delete_orden_del_plan_sin_confirmaciones(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    plan = await _plan(client, headers, insumo.id, ["flame"])
    orden = (
        await client.post(
            "/ordenes-aplicacion/desde-plan",
            json={
                "plan_fitosanitario_id": plan[0]["id"], "dias_carencia": 7,
                "dias_reingreso": 2, "fecha_planificada": "2026-10-15",
            },
            headers=headers,
        )
    ).json()

    resp = await client.delete(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert resp.status_code == 204, resp.text
    assert (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).status_code == 404


async def test_put_y_delete_bloqueados_si_hay_confirmaciones(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumos = await _cuatro_insumos(create_insumo)
    parcela = await create_parcela(
        nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0,
    )
    orden = (
        await client.post(
            "/ordenes-aplicacion/",
            json=_payload([_linea(insumos[0].id), _linea(insumos[1].id)], [parcela.id]),
            headers=headers,
        )
    ).json()
    item_id = orden["parcelas"][0]["id"]
    conf = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar", json={}, headers=headers,
    )
    assert conf.status_code == 200, conf.text

    editar = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json={
            "objetivo": "Oidio", "fecha_planificada": "2026-10-20", "parcela_ids": [parcela.id],
            "lineas": [_linea(insumos[0].id)],
        },
        headers=headers,
    )
    assert editar.status_code == 409, editar.text
    borrar = await client.delete(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert borrar.status_code == 409, borrar.text


# ── Lectura / shim ────────────────────────────────────────────────────────────


async def test_get_orden_multivariedad_devuelve_variedad_valida(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    chica = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0)
    grande = await create_parcela(nombre="Parral 9", variedad="bonarda", finca=Finca.media_agua, superficie_ha=8.0)
    # Unknown area counts as zero, never wins and never breaks the shim.
    sin_ha = await create_parcela(nombre="Parral 10", variedad="syrah", finca=Finca.media_agua, superficie_ha=None)
    orden = (
        await client.post(
            "/ordenes-aplicacion/",
            json=_payload([_linea(insumo.id)], [chica.id, grande.id, sin_ha.id]),
            headers=headers,
        )
    ).json()

    resp = await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["variedad"] == "bonarda"
    assert set(body["variedades"]) == {"flame", "bonarda", "syrah"}
    listado = await client.get("/ordenes-aplicacion/", params={"temporada": 2026}, headers=headers)
    assert listado.json()[0]["variedad"] == "bonarda"


async def test_confirmar_orden_sin_lineas_da_409(
    client, db_session, create_user, create_insumo, create_parcela,
):
    """Defensive path: an order without lines (should not exist after the
    backfill) refuses to confirm instead of creating a record with no line."""
    headers, user = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 1", variedad="flame", finca=Finca.media_agua)
    orden = OrdenAplicacion(
        temporada=2026, origen=OrigenOrdenAplicacion.extra, variedad=VariedadUva.flame,
        insumo_id=insumo.id, dosis_por_ha=1.0, objetivo="Oidio", dias_carencia=7,
        dias_reingreso=2, fecha_planificada=date(2026, 10, 15), created_by=user.id,
    )
    item = OrdenAplicacionParcela(parcela_id=parcela.id)
    orden.parcelas.append(item)
    db_session.add(orden)
    await db_session.commit()

    resp = await client.post(
        f"/ordenes-aplicacion/{orden.id}/parcelas/{item.id}/confirmar", json={}, headers=headers,
    )
    assert resp.status_code == 409, resp.text
    assert "no tiene productos" in resp.text


# ── Push ──────────────────────────────────────────────────────────────────────


async def test_push_orden_una_linea_texto_igual_que_antes(
    client, monkeypatch, create_user, create_insumo, create_parcela,
):
    llamadas = _recorder(monkeypatch)
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)

    r = await client.post(
        "/ordenes-aplicacion/", json=_payload([_linea(insumo.id)], [parcela.id]), headers=headers,
    )
    assert r.status_code == 201, r.text
    await push.esperar_avisos()
    assert [c["cuerpo"] for c in llamadas] == ["Azufre · Parral 2"]


async def test_push_orden_varias_lineas(
    client, monkeypatch, create_user, create_insumo, create_parcela,
):
    llamadas = _recorder(monkeypatch)
    headers, _ = await _auth(client, create_user)
    insumos = await _cuatro_insumos(create_insumo)
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)

    r = await client.post(
        "/ordenes-aplicacion/",
        json=_payload([_linea(i.id) for i in insumos], [parcela.id]),
        headers=headers,
    )
    assert r.status_code == 201, r.text
    await push.esperar_avisos()
    assert [c["cuerpo"] for c in llamadas] == ["Super folpan +3 más · Parral 2"]
