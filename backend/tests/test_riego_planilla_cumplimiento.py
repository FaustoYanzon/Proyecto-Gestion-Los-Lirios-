"""Planilla de cumplimiento de riego: volumen aplicado vs esperado por parcela y mes.

Expected values are computed by hand from CALENDARIO_CAMPANA (windows run from one
anchor to the day before the next; riegos_esperados per window):
  post_cosecha May 1 -> Sep 19 (142 d, 1)   brotacion Sep 20 -> Oct 19 (30 d, 1)
  floracion    Oct 20 -> Nov 9  (21 d, 1)   cuaje      Nov 10 -> Dec 4  (25 d, 3)
  cierre_racimo Dec 5 -> Jan 4  (31 d, 4)   envero     Jan 5  -> Jan 31 (27 d, 4)
  cosecha      Feb 1 -> Apr 30  (89 d in 2027, 3)
1 standard riego = 24 h * 1.6 = 38.4 mm over the WHOLE parcela = 38.4 * ha * 10 000 L.
Applied volume = hours * 16 000 L/h * caudal factor * n valvulas (never the per-record mm sum).
Tests default to a 1.0 ha parcela so 1 ha = 384 m3 per standard riego.
Run with: pytest
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.api import produccion as produccion_api
from app.models.parcela import Parcela, TipoParcela, TipoRiego
from app.models.produccion import RegistroRiego
from app.models.user import UserRole

URL = "/produccion/riego/planilla/cumplimiento"
MARZO_2027 = {"desde": "2027-03-01", "hasta": "2027-03-31"}


async def _auth(client, create_user) -> tuple[dict, str]:
    user = await create_user(email="enc@test.com", password="Password123!", role=UserRole.encargado)
    resp = await client.post(
        "/auth/login", data={"username": "enc@test.com", "password": "Password123!"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, user.id


async def _riego(
    session,
    parcela_id: str,
    user_id: str,
    dia: date,
    horas: float | None,
    tipo: TipoRiego = TipoRiego.goteo,
) -> None:
    """Insert through the model so mm_aplicados is computed by RegistroRiego itself."""
    inicio = datetime(dia.year, dia.month, dia.day, 12, 0, tzinfo=timezone.utc)
    session.add(
        RegistroRiego(
            fecha=dia,
            parcela_id=parcela_id,
            tipo=tipo,
            cabezal="1" if tipo == TipoRiego.goteo else None,
            valvula="1" if tipo == TipoRiego.goteo else None,
            n_valvulas_manto=1 if tipo == TipoRiego.manto else None,
            inicio=inicio,
            fin=None if horas is None else inicio + timedelta(hours=horas),
            duracion_horas=horas,
            responsable="Juan",
            created_by=user_id,
        )
    )
    await session.commit()


@pytest.fixture
def fijar_hoy(monkeypatch):
    def _fijar(hoy: date) -> None:
        monkeypatch.setattr(produccion_api, "_hoy_campo", lambda: hoy)

    return _fijar


async def test_mes_pasado_dentro_de_una_ventana(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=1.0)
    await _riego(db_session, p.id, uid, date(2027, 3, 10), 10)  # goteo: 10 h * 1.6 = 16 mm

    resp = await client.get(URL, params=MARZO_2027, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["meses"] == ["2027-03"]
    celda = data["filas"][0]["celdas"]["2027-03"]
    # cosecha: 3 riegos * 31 / 89 = 1.04494 -> 1.04 ; * 38.4 = 40.1258 -> 40.13
    assert celda["riegos_esperados"] == "1.04"
    assert celda["m3_esperados"] == "401.26"  # 1.044944 * 384 m3
    assert celda["m3_aplicados"] == "160.00"  # 10 h * 16 000 L/h
    assert celda["lamina_aplicada_mm"] == "16.00"  # 160 000 L / (1 ha * 10 000)
    assert celda["riegos_equivalentes"] == "0.42"  # 16 / 38.4
    assert celda["cumplimiento_pct"] == "39.9"  # 16 / 40.1258 * 100


async def test_mes_a_caballo_de_dos_ventanas(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=1.0)
    await _riego(db_session, p.id, uid, date(2026, 11, 12), 24)  # 38.4 mm

    resp = await client.get(
        URL, params={"desde": "2026-11-01", "hasta": "2026-12-31"}, headers=headers
    )

    celdas = resp.json()["filas"][0]["celdas"]
    # Nov: floracion 9/21 * 1 = 0.42857 + cuaje 21/25 * 3 = 2.52 -> 2.94857
    assert celdas["2026-11"]["riegos_esperados"] == "2.95"
    assert celdas["2026-11"]["m3_esperados"] == "1132.25"  # 2.948571 * 384
    assert celdas["2026-11"]["cumplimiento_pct"] == "33.9"  # 38.4 / 113.2251
    # Dec: cuaje 4/25 * 3 = 0.48 + cierre_racimo 27/31 * 4 = 3.48387 -> 3.96387
    assert celdas["2026-12"]["riegos_esperados"] == "3.96"
    assert celdas["2026-12"]["m3_esperados"] == "1522.13"  # 3.963871 * 384
    assert celdas["2026-12"]["m3_aplicados"] == "0.00"
    assert celdas["2026-12"]["cumplimiento_pct"] == "0.0"


async def test_mes_futuro_sin_porcentaje(client, create_user, create_parcela, fijar_hoy):
    fijar_hoy(date(2026, 11, 6))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2", superficie_ha=1.0)

    resp = await client.get(
        URL, params={"desde": "2026-12-01", "hasta": "2026-12-31"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2026-12"]
    assert celda["cumplimiento_pct"] is None
    assert celda["m3_esperados"] == "0.00"
    assert celda["riegos_esperados"] == "0.00"


async def test_mes_actual_prorrateado_hasta_hoy(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2026, 11, 20))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=1.0)
    await _riego(db_session, p.id, uid, date(2026, 11, 12), 24)  # 38.4 mm

    resp = await client.get(
        URL, params={"desde": "2026-11-01", "hasta": "2026-11-30"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2026-11"]
    # floracion Nov 1-9: 9/21 = 0.42857 ; cuaje Nov 10-20 only: 11/25 * 3 = 1.32
    assert celda["riegos_esperados"] == "1.75"
    assert celda["m3_esperados"] == "671.45"  # 1.748571 * 384
    assert celda["cumplimiento_pct"] == "57.2"  # 38.4 / 67.1451


async def test_riego_en_curso_se_ignora(client, create_user, create_parcela, db_session, fijar_hoy):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=1.0)
    await _riego(db_session, p.id, uid, date(2027, 3, 5), None)

    resp = await client.get(URL, params=MARZO_2027, headers=headers)

    celda = resp.json()["filas"][0]["celdas"]["2027-03"]
    assert celda["m3_aplicados"] == "0.00"
    assert celda["riegos_equivalentes"] == "0.00"
    assert celda["cumplimiento_pct"] == "0.0"


async def test_filtra_por_tipo(client, create_user, create_parcela, db_session, fijar_hoy):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=0.5)
    await _riego(db_session, p.id, uid, date(2027, 3, 10), 10, TipoRiego.goteo)
    await _riego(db_session, p.id, uid, date(2027, 3, 12), 8, TipoRiego.manto)

    async def m3(tipo: str) -> float:
        resp = await client.get(URL, params={**MARZO_2027, "tipo": tipo}, headers=headers)
        return float(resp.json()["filas"][0]["celdas"]["2027-03"]["m3_aplicados"])

    goteo, manto, ambos = await m3("goteo"), await m3("manto"), await m3("ambos")
    assert goteo == 160.0  # 10 h * 16 m3/h * 1 valve
    assert manto == 512.0  # 8 h * 16 m3/h * 4 (manto factor) * 1 valve
    assert ambos == pytest.approx(goteo + manto)


async def test_filas_parcelas_activas_y_filtro_parcela(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    a = await create_parcela(nombre="Parral 10")
    await create_parcela(nombre="Parral 2", superficie_ha=1.0)
    await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    inactiva = await create_parcela(nombre="Parral 3")
    row = await db_session.get(Parcela, inactiva.id)
    row.is_active = False
    await db_session.commit()
    rango = {"desde": "2027-03-01", "hasta": "2027-04-30"}

    resp = await client.get(URL, params=rango, headers=headers)
    filas = resp.json()["filas"]
    assert [f["parcela_nombre"] for f in filas] == ["Parral 2", "Parral 10"]
    # Every month of `meses` is present for every row, even without riegos.
    assert all(list(f["celdas"]) == ["2027-03", "2027-04"] for f in filas)

    resp = await client.get(URL, params={**rango, "parcela_id": a.id}, headers=headers)
    assert [f["parcela_nombre"] for f in resp.json()["filas"]] == ["Parral 10"]


async def test_un_solo_limite_usa_la_campana_y_ruta_no_es_capturada(
    client, create_user, fijar_hoy
):
    fijar_hoy(date(2026, 11, 6))
    headers, _ = await _auth(client, create_user)

    resp = await client.get(URL, params={"desde": "2026-08-01"}, headers=headers)
    assert resp.status_code == 200  # not shadowed by /riego/{riego_id}
    meses = resp.json()["meses"]
    assert meses[0] == "2026-08" and meses[-1] == "2027-04"

    resp = await client.get(URL, params={"desde": "2026-12-01", "hasta": "2026-08-01"}, headers=headers)
    assert resp.status_code == 422


async def test_enero_envuelve_cierre_racimo_y_envero(client, create_user, create_parcela, fijar_hoy):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2", superficie_ha=1.0)

    resp = await client.get(
        URL, params={"desde": "2027-01-01", "hasta": "2027-01-31"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2027-01"]
    # cierre_racimo wraps Dec 5 -> Jan 4: 4/31 * 4 = 0.5161 ; envero Jan 5-31: 27/27 * 4 = 4
    assert celda["riegos_esperados"] == "4.52"
    assert celda["m3_esperados"] == "1734.19"  # 4.516129 * 384


async def test_septiembre_post_cosecha_y_brotacion(client, create_user, create_parcela, fijar_hoy):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2", superficie_ha=1.0)

    resp = await client.get(
        URL, params={"desde": "2026-09-01", "hasta": "2026-09-30"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2026-09"]
    # post_cosecha May 1 -> Sep 19 (142 d): 19/142 * 1 ; brotacion Sep 20-30: 11/30 * 1
    assert celda["riegos_esperados"] == "0.50"  # 0.1338 + 0.3667 = 0.5005
    assert celda["m3_esperados"] == "192.18"  # 0.500469 * 384


async def test_desde_a_mitad_de_mes_recorta_la_ventana(
    client, create_user, create_parcela, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2", superficie_ha=1.0)

    resp = await client.get(
        URL, params={"desde": "2026-12-15", "hasta": "2026-12-31"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2026-12"]
    # cuaje ends Dec 4 (out of range); cierre_racimo Dec 15-31 = 17 of 31 days * 4 riegos
    assert celda["riegos_esperados"] == "2.19"  # 17/31 * 4 = 2.1935
    assert celda["m3_esperados"] == "842.32"  # 2.193548 * 384


async def test_rango_y_parcela_sin_coincidencias_devuelve_filas_vacias(
    client, create_user, create_parcela, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2", superficie_ha=1.0)

    resp = await client.get(
        URL,
        params={**MARZO_2027, "parcela_id": "00000000-0000-0000-0000-000000000000"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["filas"] == []


# -- Volumetric rule: the sum of per-valve mm must never be used -------------------

# March 2027 expects 1.044944 riegos (see test 1), so pct = riegos_equivalentes / 1.044944.
async def _celda_marzo(client, headers, parcela_id: str) -> dict:
    resp = await client.get(
        URL, params={**MARZO_2027, "parcela_id": parcela_id}, headers=headers
    )
    return resp.json()["filas"][0]["celdas"]["2027-03"]


async def test_dos_valvulas_24h_en_parcela_de_2ha_es_un_riego_estandar(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0)
    for valvula in ("1", "2"):
        inicio = datetime(2027, 3, 10, 8, tzinfo=timezone.utc)
        db_session.add(RegistroRiego(
            fecha=date(2027, 3, 10), parcela_id=p.id, tipo=TipoRiego.goteo, cabezal="1",
            valvula=valvula, inicio=inicio, fin=inicio + timedelta(hours=24),
            duracion_horas=24, responsable="Juan", created_by=uid,
        ))
    await db_session.commit()

    celda = await _celda_marzo(client, headers, p.id)

    assert celda["m3_aplicados"] == "768.00"  # 2 * 24 h * 16 m3/h
    assert celda["lamina_aplicada_mm"] == "38.40"  # 768 000 / (2 ha * 10 000)
    assert celda["riegos_equivalentes"] == "1.00"  # NOT 2.00 as the mm sum gave
    # 1.044944 riegos expected in March -> 768 / (1.044944 * 768) = 95.7 %
    assert celda["cumplimiento_pct"] == "95.7"


async def test_una_sola_valvula_de_dos_es_medio_riego(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0)
    await _riego(db_session, p.id, uid, date(2027, 3, 10), 24)  # 1 valve only

    celda = await _celda_marzo(client, headers, p.id)

    assert celda["m3_aplicados"] == "384.00"
    assert celda["riegos_equivalentes"] == "0.50"
    assert celda["cumplimiento_pct"] == "47.8"  # 0.5 / 1.044944


async def test_manto_8h_en_2ha_con_2_valvulas_es_133_por_ciento_de_un_riego(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=2.0)
    inicio = datetime(2027, 3, 10, 8, tzinfo=timezone.utc)
    db_session.add(RegistroRiego(
        fecha=date(2027, 3, 10), parcela_id=p.id, tipo=TipoRiego.manto, n_valvulas_manto=2,
        inicio=inicio, fin=inicio + timedelta(hours=8), duracion_horas=8,
        responsable="Juan", created_by=uid,
    ))
    await db_session.commit()

    celda = await _celda_marzo(client, headers, p.id)

    assert celda["m3_aplicados"] == "1024.00"  # 8 h * 16 m3/h * 4 * 2 valves
    assert celda["lamina_aplicada_mm"] == "51.20"
    assert celda["riegos_equivalentes"] == "1.33"  # 1 024 000 / 768 000
    assert celda["cumplimiento_pct"] == "127.6"  # 1.3333 / 1.044944


async def test_parcela_sin_superficie_no_rompe_y_no_da_porcentaje(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    sin = await create_parcela(nombre="Parral 2", superficie_ha=None)
    cero = await create_parcela(nombre="Parral 3", superficie_ha=0)
    await _riego(db_session, sin.id, uid, date(2027, 3, 10), 10)

    resp = await client.get(URL, params=MARZO_2027, headers=headers)

    assert resp.status_code == 200
    celdas = {f["parcela_nombre"]: f["celdas"]["2027-03"] for f in resp.json()["filas"]}
    for nombre in ("Parral 2", "Parral 3"):
        celda = celdas[nombre]
        assert celda["cumplimiento_pct"] is None
        assert celda["lamina_aplicada_mm"] is None
        assert celda["riegos_equivalentes"] is None
        assert celda["m3_esperados"] is None
        assert celda["riegos_esperados"] == "1.04"
    assert celdas["Parral 2"]["m3_aplicados"] == "160.00"
