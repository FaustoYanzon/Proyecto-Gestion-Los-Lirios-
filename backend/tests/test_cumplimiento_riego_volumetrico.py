"""Volumetric irrigation compliance (applied litres vs expected litres of the parcela).

Each RegistroRiego stores mm for the ONE hectare of its valve, so summing mm across
the valves of a parcela inflated compliance (4 valves x 24 h = 400 %). These tests pin
the corrected rule across the shared helper, GET /produccion/estado-campana/cumplimiento-riego,
the dashboard eficiencia-hidrica and the trazabilidad ficha/PDF summary.

Hand-computed reference (2.0 ha parcela, 2 goteo valves, 24 h each):
  applied  = 2 * 24 h * 16 000 L/h        = 768 000 L
  1 riego  = 38.4 mm * 2.0 ha * 10 000    = 768 000 L  -> 1.0 equivalent -> 100 %
Run with: pytest
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.core import ciclo_campana, cumplimiento_riego
from app.models.parcela import TipoRiego, VariedadUva
from app.models.produccion import RegistroRiego
from app.models.user import UserRole

# ── Shared helper (pure functions) ─────────────────────────────────────────────


def test_litros_de_registro_goteo_manto_y_en_curso():
    assert cumplimiento_riego.litros_de_registro(24, TipoRiego.goteo, "1,2", None) == 768_000
    # manto: factor 4 * n_valvulas_manto (2) -> 8 h * 16 000 * 4 * 2
    assert cumplimiento_riego.litros_de_registro(8, TipoRiego.manto, None, 2) == 1_024_000
    assert cumplimiento_riego.litros_de_registro(None, TipoRiego.goteo, "1", None) == 0.0


def test_helpers_volumetricos_parcela_de_2ha():
    assert cumplimiento_riego.litros_esperados(1, 2.0) == pytest.approx(768_000)
    assert cumplimiento_riego.riegos_equivalentes(768_000, 2.0) == pytest.approx(1.0)
    assert cumplimiento_riego.riegos_equivalentes(384_000, 2.0) == pytest.approx(0.5)
    assert cumplimiento_riego.cumplimiento_pct(1_024_000, 1, 2.0) == pytest.approx(133.333, abs=0.01)
    assert cumplimiento_riego.lamina_mm(768_000, 2.0) == pytest.approx(38.4)


@pytest.mark.parametrize("superficie", [None, 0, -1.0])
def test_helpers_sin_superficie_devuelven_none(superficie):
    assert cumplimiento_riego.litros_esperados(1, superficie) is None
    assert cumplimiento_riego.lamina_mm(1000, superficie) is None
    assert cumplimiento_riego.riegos_equivalentes(1000, superficie) is None
    assert cumplimiento_riego.cumplimiento_pct(1000, 1, superficie) is None


def test_pct_none_si_no_se_esperan_riegos():
    assert cumplimiento_riego.cumplimiento_pct(1000, 0, 2.0) is None


# ── Helpers for endpoint tests ─────────────────────────────────────────────────


async def _auth(client, create_user, role: UserRole = UserRole.gerencial) -> tuple[dict, str]:
    user = await create_user(email="g@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login", data={"username": "g@test.com", "password": "Password123!"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, user.id


def _riego(
    parcela_id: str, user_id: str, dia: date, horas: float | None, *,
    tipo: TipoRiego = TipoRiego.goteo, valvula: str | None = "1", n_manto: int | None = None,
) -> RegistroRiego:
    inicio = datetime(dia.year, dia.month, dia.day, 8, tzinfo=timezone.utc)
    return RegistroRiego(
        fecha=dia, parcela_id=parcela_id, tipo=tipo,
        cabezal="1" if tipo == TipoRiego.goteo else None,
        valvula=valvula if tipo == TipoRiego.goteo else None,
        n_valvulas_manto=n_manto, inicio=inicio,
        fin=None if horas is None else inicio + timedelta(hours=horas),
        duracion_horas=horas, responsable="Juan", created_by=user_id,
    )


# ── GET /produccion/estado-campana/cumplimiento-riego ──────────────────────────

ESTADO_URL = "/produccion/estado-campana/cumplimiento-riego"


async def _item(client, headers, parcela_id: str) -> dict:
    resp = await client.get(ESTADO_URL, headers=headers)
    assert resp.status_code == 200, resp.text
    return next(i for i in resp.json() if i["parcela_id"] == parcela_id)


async def test_estado_dos_valvulas_24h_en_2ha_es_un_riego_equivalente(
    client, create_user, create_parcela, db_session
):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0, variedad=VariedadUva.syrah)
    hoy = date.today()
    for valvula in ("1", "2"):
        db_session.add(_riego(p.id, uid, hoy, 24, valvula=valvula))
    await db_session.commit()
    esperados = ciclo_campana.riegos_esperados(ciclo_campana.calcular_estado_actual(hoy))

    item = await _item(client, headers, p.id)

    assert item["litros_aplicados"] == pytest.approx(768_000)
    assert item["litros_esperados"] == pytest.approx(esperados * 768_000)
    assert item["mm_aplicados"] == pytest.approx(38.4)  # equivalent depth over the parcela
    assert item["riegos_equivalentes"] == 1.0  # NOT 2.0 (the old per-valve mm sum)
    assert item["cumplimiento_pct"] == pytest.approx(round(100 / esperados, 1))


async def test_estado_una_valvula_de_dos_es_medio_riego(
    client, create_user, create_parcela, db_session
):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0, variedad=VariedadUva.syrah)
    db_session.add(_riego(p.id, uid, date.today(), 24))
    await db_session.commit()
    esperados = ciclo_campana.riegos_esperados(ciclo_campana.calcular_estado_actual())

    item = await _item(client, headers, p.id)

    assert item["riegos_equivalentes"] == 0.5
    assert item["cumplimiento_pct"] == pytest.approx(round(50 / esperados, 1))


async def test_estado_manto_8h_en_2ha_con_2_valvulas_supera_un_riego(
    client, create_user, create_parcela, db_session
):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0, variedad=VariedadUva.syrah)
    db_session.add(_riego(p.id, uid, date.today(), 8, tipo=TipoRiego.manto, n_manto=2))
    await db_session.commit()
    esperados = ciclo_campana.riegos_esperados(ciclo_campana.calcular_estado_actual())

    item = await _item(client, headers, p.id)

    assert item["litros_aplicados"] == pytest.approx(1_024_000)
    assert item["riegos_equivalentes"] == pytest.approx(1.33)
    assert item["cumplimiento_pct"] == pytest.approx(round(133.33 / esperados, 1), abs=0.1)


async def test_estado_ignora_riego_en_curso_y_parcela_sin_superficie_no_rompe(
    client, create_user, create_parcela, db_session
):
    headers, uid = await _auth(client, create_user)
    con = await create_parcela(nombre="Parral 2", superficie_ha=2.0, variedad=VariedadUva.syrah)
    sin = await create_parcela(nombre="Parral 3", superficie_ha=None, variedad=VariedadUva.syrah)
    db_session.add(_riego(con.id, uid, date.today(), None))  # still running
    db_session.add(_riego(sin.id, uid, date.today(), 10))
    await db_session.commit()

    resp = await client.get(ESTADO_URL, headers=headers)

    assert resp.status_code == 200
    items = {i["parcela_id"]: i for i in resp.json()}
    assert items[con.id]["litros_aplicados"] == 0
    assert items[con.id]["cumplimiento_pct"] == 0.0
    assert items[sin.id]["litros_aplicados"] == pytest.approx(160_000)
    assert items[sin.id]["litros_esperados"] is None
    assert items[sin.id]["cumplimiento_pct"] is None
    assert items[sin.id]["riegos_equivalentes"] is None
    assert items[sin.id]["mm_aplicados"] is None


# ── GET /produccion/dashboard/eficiencia-hidrica ───────────────────────────────


async def test_dashboard_mm_total_es_lamina_sobre_la_parcela(
    client, create_user, create_parcela, db_session
):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0)
    for valvula in ("1", "2"):
        db_session.add(_riego(p.id, uid, date(2026, 10, 5), 24, valvula=valvula))
    await db_session.commit()

    resp = await client.get("/produccion/dashboard/eficiencia-hidrica?anio=2026", headers=headers)

    fila = next(r for r in resp.json() if r["parcela_id"] == p.id)
    assert fila["litros_totales"] == 768_000
    assert fila["mm_aplicados_total"] == pytest.approx(38.4)  # not 76.8
    assert fila["porcentaje_cumplimiento"] == round(768_000 / 12_000_000 * 100, 1)


# ── Trazabilidad ficha / resumen publico ───────────────────────────────────────

DESDE, HASTA = "2026-05-01", "2027-04-30"


async def _sembrar_dos_valvulas_24h(db_session, parcela_id: str, uid: str) -> None:
    # Jun 15 2026 falls in post_cosecha (May 1 -> Sep 19, 1 riego expected).
    for valvula in ("1", "2"):
        db_session.add(_riego(parcela_id, uid, date(2026, 6, 15), 24, valvula=valvula))
    await db_session.commit()


async def test_ficha_cumplimiento_por_estado_100_por_ciento(
    client, create_user, create_parcela, db_session
):
    headers, uid = await _auth(client, create_user, UserRole.super_admin)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0)
    await _sembrar_dos_valvulas_24h(db_session, p.id, uid)

    resp = await client.get(
        f"/trazabilidad/parcela/{p.id}/historial",
        params={"desde": DESDE, "hasta": HASTA}, headers=headers,
    )

    assert resp.status_code == 200, resp.text
    estado = next(
        e for e in resp.json()["cumplimiento_riego_por_estado"]
        if e["estado_campana"] == "post_cosecha"
    )
    assert estado["riegos_esperados"] == 1
    assert estado["litros_aplicados"] == pytest.approx(768_000)
    assert estado["mm_aplicados"] == pytest.approx(38.4)
    assert estado["riegos_equivalentes"] == 1.0
    assert estado["cumplimiento_pct"] == 100.0
    assert estado["cumplido"] is True


async def test_ficha_sin_superficie_no_rompe(client, create_user, create_parcela, db_session):
    headers, uid = await _auth(client, create_user, UserRole.super_admin)
    p = await create_parcela(nombre="Parral 2", superficie_ha=None)
    await _sembrar_dos_valvulas_24h(db_session, p.id, uid)

    resp = await client.get(
        f"/trazabilidad/parcela/{p.id}/historial",
        params={"desde": DESDE, "hasta": HASTA}, headers=headers,
    )

    assert resp.status_code == 200, resp.text
    estado = next(
        e for e in resp.json()["cumplimiento_riego_por_estado"]
        if e["estado_campana"] == "post_cosecha"
    )
    # No surface: compliance is unknown (None), never a misleading 0 % / incumplido.
    assert estado["mm_aplicados"] is None
    assert estado["riegos_equivalentes"] is None
    assert estado["cumplimiento_pct"] is None
    assert estado["cumplido"] is None
    assert estado["litros_aplicados"] == pytest.approx(768_000)


async def test_carta_pdf_sin_superficie_no_imprime_none(
    client, create_user, create_parcela, db_session, monkeypatch
):
    from xhtml2pdf import pisa

    from app.core import pdf_carta

    headers, uid = await _auth(client, create_user, UserRole.super_admin)
    p = await create_parcela(nombre="Parral 2", superficie_ha=None)
    await _sembrar_dos_valvulas_24h(db_session, p.id, uid)

    # Capture the rendered HTML: the PDF stream is compressed, so text is not greppable.
    captured: list[str] = []
    real_create_pdf = pisa.CreatePDF

    def spy(html, *args, **kwargs):
        captured.append(html)
        return real_create_pdf(html, *args, **kwargs)

    monkeypatch.setattr(pdf_carta.pisa, "CreatePDF", spy)

    resp = await client.get(
        f"/trazabilidad/parcela/{p.id}/carta-pdf",
        params={"desde": DESDE, "hasta": HASTA}, headers=headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    html = captured[0]
    assert "None" not in html
    assert "768000" in html  # real litres shown instead of 0.0 mm
    assert "fila-incumplido" not in html.split("Cumplimiento de riego por estado")[1].split("<h2>")[0]


async def test_resumen_publico_mm_riego_total_es_lamina(
    client, create_user, create_parcela, db_session
):
    headers, uid = await _auth(client, create_user, UserRole.super_admin)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0)
    await _sembrar_dos_valvulas_24h(db_session, p.id, uid)
    enlace = await client.post(
        f"/trazabilidad/parcela/{p.id}/enlaces",
        json={"desde": DESDE, "hasta": HASTA}, headers=headers,
    )
    assert enlace.status_code == 201, enlace.text

    resp = await client.get(f"/trazabilidad/publica/{enlace.json()['token']}")

    assert resp.status_code == 200, resp.text
    resumen = resp.json()["resumen"]
    assert resumen["mm_riego_total"] == 38.4  # 768 000 L / (2 ha * 10 000), not 76.8
    assert resumen["mm_objetivo_anual"] == 600.0
    assert resumen["pct_objetivo_riego"] == 6.4  # 38.4 / 600


# ── Single litres formula ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("horas", "tipo", "valvula", "n_manto"),
    [
        (24, TipoRiego.goteo, "1,2", None),
        (8, TipoRiego.manto, None, 2),  # manto new: n_valvulas_manto
        (8, TipoRiego.manto, "1,2,3", None),  # manto historical: n NULL
        (None, TipoRiego.goteo, "1", None),  # en curso
        (1.37, TipoRiego.goteo, "1", None),  # rounding must stay per record
    ],
)
def test_litros_aplicados_y_helper_comparten_formula(horas, tipo, valvula, n_manto):
    registro = RegistroRiego(
        parcela_id="p", created_by="u", fecha=date(2026, 6, 15), tipo=tipo,
        valvula=valvula, n_valvulas_manto=n_manto, duracion_horas=horas,
    )
    helper = cumplimiento_riego.litros_de_registro(horas, tipo, valvula, n_manto)
    assert registro.litros_aplicados == pytest.approx(helper, abs=0.005)
    assert helper == RegistroRiego.litros_de(horas, tipo, valvula, n_manto)
