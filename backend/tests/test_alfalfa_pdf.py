"""Alfalfa numbered PDF (2026-11-17): content type, no-store, 404 and roles."""
from __future__ import annotations

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
        "h_reg": await _login(client, create_user, "reg@test.com", UserRole.regador),
    }


async def _crear(client, ctx, body: dict) -> str:
    r = await client.post("/alfalfa/documentos", json=body, headers=ctx["h_enc"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _assert_pdf(r) -> None:
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["content-disposition"].startswith("inline;")


async def test_pdf_alta(client, ctx):
    doc_id = await _crear(client, ctx, {
        "tipo": "alta",
        "fecha": "2026-11-17",
        "potrero_id": ctx["potrero"],
        "lineas": [{"producto": "fardo", "cantidad": "10"}, {"producto": "rollo", "cantidad": "3"}],
    })
    r = await client.get(f"/alfalfa/documentos/{doc_id}/pdf", headers=ctx["h_enc"])
    _assert_pdf(r)


async def test_pdf_salida(client, ctx):
    await _crear(client, ctx, {
        "tipo": "alta",
        "fecha": "2026-11-17",
        "potrero_id": ctx["potrero"],
        "lineas": [{"producto": "fardo", "cantidad": "10"}],
    })
    doc_id = await _crear(client, ctx, {
        "tipo": "salida",
        "fecha": "2026-11-18",
        "comprador_id": ctx["comprador"],
        "vehiculo_patente": "AB123CD",
        "lineas": [{"producto": "fardo", "cantidad": "4"}],
    })
    r = await client.get(f"/alfalfa/documentos/{doc_id}/pdf", headers=ctx["h_enc"])
    _assert_pdf(r)


async def test_pdf_inexistente_404(client, ctx):
    r = await client.get("/alfalfa/documentos/no-existe/pdf", headers=ctx["h_enc"])
    assert r.status_code == 404


async def test_pdf_regador_403(client, ctx):
    r = await client.get("/alfalfa/documentos/cualquiera/pdf", headers=ctx["h_reg"])
    assert r.status_code == 403
