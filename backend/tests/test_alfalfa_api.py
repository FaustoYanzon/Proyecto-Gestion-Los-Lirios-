"""Alfalfa inventory API (2026-11-17): HTTP flow, idempotency, roles, status codes."""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.models.alta_produccion import Comprador
from app.models.parcela import Parcela, TipoParcela
from app.models.user import UserRole

PASSWORD = "Password123!"


async def _login(client, create_user, email: str, role: UserRole) -> dict[str, str]:
    await create_user(email=email, password=PASSWORD, role=role)
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture
async def ctx(client, create_user, db_session):
    potrero = Parcela(nombre="Potrero 1", tipo=TipoParcela.potrero)
    comprador = Comprador(nombre="Forrajera del Valle")
    db_session.add_all([potrero, comprador])
    await db_session.commit()
    return {
        "potrero": potrero.id,
        "comprador": comprador.id,
        "h_enc": await _login(client, create_user, "enc@test.com", UserRole.encargado),
    }


def _alta(ctx, **over) -> dict:
    body = {
        "tipo": "alta",
        "fecha": "2026-11-17",
        "potrero_id": ctx["potrero"],
        "lineas": [{"producto": "fardo", "cantidad": "10"}],
    }
    body.update(over)
    return body


def _salida(ctx, **over) -> dict:
    body = {
        "tipo": "salida",
        "fecha": "2026-11-18",
        "comprador_id": ctx["comprador"],
        "lineas": [{"producto": "fardo", "cantidad": "4"}],
    }
    body.update(over)
    return body


async def test_flujo_alta_stock_salida_listado(client, ctx):
    h = ctx["h_enc"]
    r = await client.post("/alfalfa/documentos", json=_alta(ctx), headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["numero"].startswith("ALF-ALT-")

    r = await client.get("/alfalfa/stock", headers=h)
    assert r.status_code == 200
    fardo = next(s for s in r.json() if s["producto"] == "fardo")
    assert isinstance(fardo["unidades"], str) and Decimal(fardo["unidades"]) == Decimal("10")
    assert isinstance(fardo["kg"], str)

    r = await client.post("/alfalfa/documentos", json=_salida(ctx), headers=h)
    assert r.status_code == 201, r.text
    assert isinstance(r.json()["lineas"][0]["cantidad"], str)

    r = await client.get("/alfalfa/documentos", params={"tipo": "salida"}, headers=h)
    assert r.status_code == 200
    assert [d["tipo"] for d in r.json()] == ["salida"]
    assert len(r.json()[0]["lineas"]) == 1

    r = await client.get("/alfalfa/documentos", headers=h)
    assert [d["tipo"] for d in r.json()] == ["salida", "alta"]  # fecha desc


async def test_listado_filtros_y_limit(client, ctx):
    h = ctx["h_enc"]
    await client.post("/alfalfa/documentos", json=_alta(ctx), headers=h)
    await client.post("/alfalfa/documentos", json=_salida(ctx), headers=h)
    r = await client.get("/alfalfa/documentos", params={"fecha_desde": "2026-11-18"}, headers=h)
    assert [d["tipo"] for d in r.json()] == ["salida"]
    r = await client.get("/alfalfa/documentos", params={"fecha_hasta": "2026-11-17"}, headers=h)
    assert [d["tipo"] for d in r.json()] == ["alta"]
    r = await client.get("/alfalfa/documentos", params={"potrero_id": ctx["potrero"]}, headers=h)
    assert [d["tipo"] for d in r.json()] == ["alta"]
    r = await client.get("/alfalfa/documentos", params={"comprador_id": ctx["comprador"]}, headers=h)
    assert [d["tipo"] for d in r.json()] == ["salida"]
    r = await client.get("/alfalfa/documentos", params={"limit": 1, "skip": 1}, headers=h)
    assert [d["tipo"] for d in r.json()] == ["alta"]
    r = await client.get("/alfalfa/documentos", params={"limit": 201}, headers=h)
    assert r.status_code == 422


async def test_reintento_idempotente_200_mismo_id(client, ctx):
    h = ctx["h_enc"]
    body = _alta(ctx, idempotency_key=str(uuid.uuid4()))
    r1 = await client.post("/alfalfa/documentos", json=body, headers=h)
    r2 = await client.post("/alfalfa/documentos", json=body, headers=h)
    assert r1.status_code == 201
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]


async def test_get_por_id_y_404(client, ctx):
    h = ctx["h_enc"]
    creado = (await client.post("/alfalfa/documentos", json=_alta(ctx), headers=h)).json()
    r = await client.get(f"/alfalfa/documentos/{creado['id']}", headers=h)
    assert r.status_code == 200 and r.json()["id"] == creado["id"]
    r = await client.get(f"/alfalfa/documentos/{uuid.uuid4()}", headers=h)
    assert r.status_code == 404


async def test_errores_422_404_409(client, ctx):
    h = ctx["h_enc"]
    # Schema violations: alta without potrero, fractional fardo, duplicate product.
    r = await client.post("/alfalfa/documentos", json=_alta(ctx, potrero_id=None), headers=h)
    assert r.status_code == 422
    r = await client.post(
        "/alfalfa/documentos",
        json=_alta(ctx, lineas=[{"producto": "fardo", "cantidad": "1.5"}]),
        headers=h,
    )
    assert r.status_code == 422
    # Service-level errors pass through.
    r = await client.post(
        "/alfalfa/documentos", json=_alta(ctx, potrero_id=str(uuid.uuid4())), headers=h
    )
    assert r.status_code == 404
    r = await client.post("/alfalfa/documentos", json=_salida(ctx), headers=h)
    assert r.status_code == 409


async def test_matriz_de_roles(client, create_user, ctx):
    rutas = [
        ("GET", "/alfalfa/stock", None),
        ("GET", "/alfalfa/documentos", None),
        ("POST", "/alfalfa/documentos", _alta(ctx)),
        ("GET", f"/alfalfa/documentos/{uuid.uuid4()}", None),
    ]
    for rol in (UserRole.encargado, UserRole.gerencial, UserRole.super_admin):
        h = await _login(client, create_user, f"{rol.value}@ok.com", rol)
        for metodo, url, body in rutas:
            r = await client.request(metodo, url, json=body, headers=h)
            assert r.status_code in (200, 201, 404), (rol, metodo, url, r.status_code)
            if url.endswith("/stock") or metodo == "POST":
                assert r.status_code != 403
    for rol in (UserRole.regador, UserRole.obrero):
        h = await _login(client, create_user, f"{rol.value}@no.com", rol)
        for metodo, url, body in rutas:
            r = await client.request(metodo, url, json=body, headers=h)
            assert r.status_code == 403, (rol, metodo, url, r.status_code)
    for metodo, url, body in rutas:
        r = await client.request(metodo, url, json=body)
        assert r.status_code == 401, (metodo, url, r.status_code)



async def test_salida_reintento_idempotente_200_mismo_id(client, ctx):
    h = ctx["h_enc"]
    await client.post("/alfalfa/documentos", json=_alta(ctx), headers=h)
    body = _salida(ctx, idempotency_key=str(uuid.uuid4()))
    r1 = await client.post("/alfalfa/documentos", json=body, headers=h)
    r2 = await client.post("/alfalfa/documentos", json=body, headers=h)
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 200, r2.text
    assert r1.json()["id"] == r2.json()["id"]


@pytest.mark.parametrize(
    "producto,cantidad",
    [("semilla", "0.001"), ("fardo", "1e15"), ("semilla", "1e15")],
)
async def test_cantidades_invalidas_422_nunca_500(client, ctx, producto, cantidad):
    r = await client.post(
        "/alfalfa/documentos",
        json=_alta(ctx, lineas=[{"producto": producto, "cantidad": cantidad}]),
        headers=ctx["h_enc"],
    )
    assert r.status_code == 422, r.text
