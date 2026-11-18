"""Signed short-lived PDF link for alfalfa documents (mobile opens it via Linking)."""
from __future__ import annotations

import pytest

from app.core.security import create_alfalfa_pdf_token, create_remito_pdf_token
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
    db_session.add(potrero)
    await db_session.commit()
    h_admin = await _login(client, create_user, "adm@test.com", UserRole.super_admin)
    r = await client.post(
        "/alfalfa/documentos",
        json={
            "tipo": "alta",
            "fecha": "2026-11-17",
            "potrero_id": potrero.id,
            "lineas": [{"producto": "fardo", "cantidad": "10"}],
        },
        headers=h_admin,
    )
    assert r.status_code == 201, r.text
    return {
        "doc_id": r.json()["id"],
        "h_admin": h_admin,
        "h_reg": await _login(client, create_user, "reg@test.com", UserRole.regador),
    }


async def test_pdf_link_abre_el_pdf_sin_authorization(client, ctx):
    r = await client.post(f"/alfalfa/documentos/{ctx['doc_id']}/pdf-link", headers=ctx["h_admin"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["expires_in"] == 300
    assert body["url"].endswith(body["path"])
    pdf = await client.get(body["path"])
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")


async def test_token_de_remito_no_abre_alfalfa(client, ctx):
    token = create_remito_pdf_token(ctx["doc_id"])
    assert (await client.get(f"/alfalfa/descarga/{token}")).status_code == 401


async def test_token_de_acceso_no_abre_alfalfa(client, ctx):
    bearer = ctx["h_admin"]["Authorization"].removeprefix("Bearer ")
    assert (await client.get(f"/alfalfa/descarga/{bearer}")).status_code == 401


async def test_token_vencido_da_401(client, ctx):
    token = create_alfalfa_pdf_token(ctx["doc_id"], ttl_seconds=-1)
    assert (await client.get(f"/alfalfa/descarga/{token}")).status_code == 401


async def test_pdf_link_de_documento_anulado_sigue_abriendo(client, ctx):
    a = await client.post(
        f"/alfalfa/documentos/{ctx['doc_id']}/anular",
        json={"motivo": "Error de carga"},
        headers=ctx["h_admin"],
    )
    assert a.status_code == 200, a.text
    link = await client.post(f"/alfalfa/documentos/{ctx['doc_id']}/pdf-link", headers=ctx["h_admin"])
    assert link.status_code == 200
    pdf = await client.get(link.json()["path"])
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")


async def test_pdf_link_exige_encargado_o_superior(client, ctx):
    r = await client.post(f"/alfalfa/documentos/{ctx['doc_id']}/pdf-link", headers=ctx["h_reg"])
    assert r.status_code == 403


async def test_pdf_link_documento_inexistente_404(client, ctx):
    r = await client.post("/alfalfa/documentos/no-existe/pdf-link", headers=ctx["h_admin"])
    assert r.status_code == 404
