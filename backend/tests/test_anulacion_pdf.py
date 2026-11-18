"""ANULADO mark in the remito and alfalfa PDFs (2026-11-17)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO

from pypdf import PdfReader

from app.core.pdf_alfalfa import DatosAlfalfaPdf, generar_pdf_alfalfa, render_alfalfa_html
from app.core.pdf_remito import DatosRemitoPdf, anulado_el_local, generar_pdf_remito, render_remito_html
from app.models.parcela import Parcela, TipoParcela, VariedadUva
from app.models.user import UserRole

PASSWORD = "Password123!"
MOTIVO = "Cargado por error <b>x</b>"


def _remito(**kw) -> DatosRemitoPdf:
    base = dict(
        numero="FRE-000001", fecha=date(2026, 2, 6), kg_total=Decimal("500"), origen_propio=True,
        de_nombre="Parral 1", variedad="Flame", temporada=2025, para_tipo_label="Comprador",
        para_nombre="Mercado", destino_label="Mercado", es_pasero=False,
        lineas=[(date(2026, 2, 6), "Flame", Decimal("500"))],
    )
    return DatosRemitoPdf(**{**base, **kw})


def _alfalfa(**kw) -> DatosAlfalfaPdf:
    base = dict(
        titulo="Alta de alfalfa", numero="ALF-000001", fecha=date(2026, 11, 17),
        contraparte_label="Potrero", contraparte_nombre="Potrero 1", vehiculo_patente=None,
        observaciones=None, lineas=[("Fardo", Decimal("10"), Decimal("100"))], kg_total=Decimal("100"),
    )
    return DatosAlfalfaPdf(**{**base, **kw})


def _pages(pdf: bytes) -> int:
    return len(PdfReader(BytesIO(pdf)).pages)


def test_remito_html_anulado_con_fecha_y_motivo_escapado():
    html = render_remito_html(_remito(anulado_el=date(2026, 3, 4), motivo_anulacion=MOTIVO))
    assert "ANULADO el 04/03/2026" in html
    assert "&lt;b&gt;x&lt;/b&gt;" in html
    assert "<b>x</b>" not in html


def test_remito_html_vigente_sin_marca():
    assert "ANULADO" not in render_remito_html(_remito())


def test_alfalfa_html_anulado_con_fecha_y_motivo_escapado():
    html = render_alfalfa_html(_alfalfa(anulado_el=date(2026, 3, 4), motivo_anulacion=MOTIVO))
    assert "ANULADO el 04/03/2026" in html
    assert "&lt;b&gt;x&lt;/b&gt;" in html
    assert "<b>x</b>" not in html


def test_alfalfa_html_vigente_sin_marca():
    assert "ANULADO" not in render_alfalfa_html(_alfalfa())


def test_pdfs_anulados_siguen_en_una_hoja():
    largo = "motivo muy largo " * 25
    assert _pages(generar_pdf_remito(_remito(anulado_el=date(2026, 3, 4), motivo_anulacion=largo))) == 1
    assert _pages(generar_pdf_alfalfa(_alfalfa(anulado_el=date(2026, 3, 4), motivo_anulacion=largo))) == 1


def test_anulado_el_local_convierte_utc_a_mendoza():
    # 01:00 UTC is still the previous day in Mendoza (UTC-3).
    assert anulado_el_local(datetime(2026, 3, 5, 1, 0, tzinfo=timezone.utc)) == date(2026, 3, 4)
    # Naive datetimes (SQLite) are treated as UTC.
    assert anulado_el_local(datetime(2026, 3, 5, 1, 0)) == date(2026, 3, 4)


async def _login(client, create_user) -> dict[str, str]:
    await create_user(email="admin@test.com", password=PASSWORD, role=UserRole.super_admin)
    resp = await client.post("/auth/login", data={"username": "admin@test.com", "password": PASSWORD})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_endpoint_pdf_remito_anulado_sigue_abriendo(client, create_user, create_parcela):
    h = await _login(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.flame)
    comprador = (await client.post("/alta-produccion/compradores", json={"nombre": "Mercado"}, headers=h)).json()
    res = await client.post(
        "/produccion/cosecha/despacho",
        json={"fecha": "2026-02-06", "para": "comprador", "parcela_id": parral.id,
              "kg_total": "500", "comprador_id": comprador["id"]},
        headers=h,
    )
    assert res.status_code == 201, res.text
    remito_id = res.json()["remito"]["id"]
    assert (await client.post(f"/remitos/{remito_id}/anular", json={"motivo": "Error"}, headers=h)).status_code == 200

    r = await client.get(f"/remitos/{remito_id}/pdf", headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and _pages(r.content) == 1


async def test_endpoint_pdf_alfalfa_anulado_sigue_abriendo(client, create_user, db_session):
    h = await _login(client, create_user)
    potrero = Parcela(nombre="Potrero 1", tipo=TipoParcela.potrero)
    db_session.add(potrero)
    await db_session.commit()
    res = await client.post(
        "/alfalfa/documentos",
        json={"tipo": "alta", "fecha": "2026-11-17", "potrero_id": potrero.id,
              "lineas": [{"producto": "fardo", "cantidad": "10"}]},
        headers=h,
    )
    assert res.status_code == 201, res.text
    doc_id = res.json()["id"]
    assert (await client.post(f"/alfalfa/documentos/{doc_id}/anular", json={"motivo": "Error"}, headers=h)).status_code == 200

    r = await client.get(f"/alfalfa/documentos/{doc_id}/pdf", headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and _pages(r.content) == 1
