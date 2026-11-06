"""Orden de aplicación: flag `fuera_de_plan` (no cuenta para el cumplimiento
del plan mensual). Spec: docs/superpowers/specs/
2026-11-05-orden-fuera-de-plan-y-aplicadas-mobile-design.md, sección A.
"""
from __future__ import annotations

from app.models.finanzas import Finca
from app.models.user import UserRole


async def _auth(client, create_user) -> dict[str, str]:
    user = await create_user(email="ger@test.com", password="Password123!", role=UserRole.gerencial)
    resp = await client.post(
        "/auth/login", data={"username": user.email, "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _payload(insumo_id: str, parcela_id: str, **extra) -> dict:
    return {
        "temporada": 2026,
        "variedad": "syrah",
        "objetivo": "Botritis",
        "fecha_planificada": "2026-11-01",
        "parcela_ids": [parcela_id],
        "lineas": [
            {"insumo_id": insumo_id, "dosis_por_ha": 2.0, "dias_carencia": 5, "dias_reingreso": 1}
        ],
        **extra,
    }


def _put_payload(insumo_id: str, parcela_id: str, fuera: bool) -> dict:
    body = _payload(insumo_id, parcela_id, fuera_de_plan=fuera)
    body.pop("temporada")
    return body


async def _setup(client, create_user, create_insumo, create_parcela):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(
        nombre="Parral A", variedad="syrah", finca=Finca.media_agua, superficie_ha=1.0,
    )
    return headers, insumo, parcela


async def test_crear_orden_sin_campo_es_del_plan(client, create_user, create_insumo, create_parcela):
    headers, insumo, parcela = await _setup(client, create_user, create_insumo, create_parcela)

    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload(insumo.id, parcela.id), headers=headers,
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["fuera_de_plan"] is False


async def test_crear_orden_fuera_de_plan(client, create_user, create_insumo, create_parcela):
    headers, insumo, parcela = await _setup(client, create_user, create_insumo, create_parcela)

    resp = await client.post(
        "/ordenes-aplicacion/",
        json=_payload(insumo.id, parcela.id, fuera_de_plan=True),
        headers=headers,
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["fuera_de_plan"] is True
    got = await client.get(f"/ordenes-aplicacion/{resp.json()['id']}", headers=headers)
    assert got.json()["fuera_de_plan"] is True


async def test_put_cambia_fuera_de_plan_sin_confirmaciones(
    client, create_user, create_insumo, create_parcela,
):
    headers, insumo, parcela = await _setup(client, create_user, create_insumo, create_parcela)
    orden = (
        await client.post(
            "/ordenes-aplicacion/", json=_payload(insumo.id, parcela.id), headers=headers,
        )
    ).json()

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json=_put_payload(insumo.id, parcela.id, True),
        headers=headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["fuera_de_plan"] is True
    got = await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert got.json()["fuera_de_plan"] is True


async def test_put_con_valvula_confirmada_no_cambia_fuera_de_plan(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, insumo, parcela = await _setup(client, create_user, create_insumo, create_parcela)
    await create_valvula(parcela_id=parcela.id, nombre="11", superficie_ha=1.0)
    orden = (
        await client.post(
            "/ordenes-aplicacion/", json=_payload(insumo.id, parcela.id), headers=headers,
        )
    ).json()
    fila = orden["parcelas"][0]["valvulas"][0]
    conf = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/valvulas/{fila['id']}/confirmar",
        json={"resultado": "completa"}, headers=headers,
    )
    assert conf.status_code == 200, conf.text

    resp = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json=_put_payload(insumo.id, parcela.id, True),
        headers=headers,
    )

    assert resp.status_code == 409
    got = await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert got.json()["fuera_de_plan"] is False


async def test_put_sin_campo_conserva_fuera_de_plan(
    client, create_user, create_insumo, create_parcela,
):
    headers, insumo, parcela = await _setup(client, create_user, create_insumo, create_parcela)
    orden = (
        await client.post(
            "/ordenes-aplicacion/",
            json=_payload(insumo.id, parcela.id, fuera_de_plan=True),
            headers=headers,
        )
    ).json()
    body = _put_payload(insumo.id, parcela.id, True)
    body.pop("fuera_de_plan")  # old web clients never send it

    resp = await client.put(f"/ordenes-aplicacion/{orden['id']}", json=body, headers=headers)

    assert resp.status_code == 200, resp.text
    got = await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert got.json()["fuera_de_plan"] is True
