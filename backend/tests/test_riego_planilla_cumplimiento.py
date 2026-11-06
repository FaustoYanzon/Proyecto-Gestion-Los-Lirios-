"""Planilla de cumplimiento de riego: mm aplicados vs mm esperados por parcela y mes.

Expected values are computed by hand from CALENDARIO_CAMPANA (windows run from one
anchor to the day before the next; riegos_esperados per window):
  post_cosecha May 1 -> Sep 19 (142 d, 1)   brotacion Sep 20 -> Oct 19 (30 d, 1)
  floracion    Oct 20 -> Nov 9  (21 d, 1)   cuaje      Nov 10 -> Dec 4  (25 d, 3)
  cierre_racimo Dec 5 -> Jan 4  (31 d, 4)   envero     Jan 5  -> Jan 31 (27 d, 4)
  cosecha      Feb 1 -> Apr 30  (89 d in 2027, 3)
1 standard riego = 24 h * 1.6 = 38.4 mm.
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
    p = await create_parcela(nombre="Parral 2")
    await _riego(db_session, p.id, uid, date(2027, 3, 10), 10)  # goteo: 10 h * 1.6 = 16 mm

    resp = await client.get(URL, params=MARZO_2027, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["meses"] == ["2027-03"]
    celda = data["filas"][0]["celdas"]["2027-03"]
    # cosecha: 3 riegos * 31 / 89 = 1.04494 -> 1.04 ; * 38.4 = 40.1258 -> 40.13
    assert celda["riegos_esperados"] == "1.04"
    assert celda["mm_esperados"] == "40.13"
    assert celda["mm_aplicados"] == "16.00"
    assert celda["riegos_equivalentes"] == "0.42"  # 16 / 38.4
    assert celda["cumplimiento_pct"] == "39.9"  # 16 / 40.1258 * 100


async def test_mes_a_caballo_de_dos_ventanas(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2")
    await _riego(db_session, p.id, uid, date(2026, 11, 12), 24)  # 38.4 mm

    resp = await client.get(
        URL, params={"desde": "2026-11-01", "hasta": "2026-12-31"}, headers=headers
    )

    celdas = resp.json()["filas"][0]["celdas"]
    # Nov: floracion 9/21 * 1 = 0.42857 + cuaje 21/25 * 3 = 2.52 -> 2.94857
    assert celdas["2026-11"]["riegos_esperados"] == "2.95"
    assert celdas["2026-11"]["mm_esperados"] == "113.23"  # 2.948571 * 38.4
    assert celdas["2026-11"]["cumplimiento_pct"] == "33.9"  # 38.4 / 113.2251
    # Dec: cuaje 4/25 * 3 = 0.48 + cierre_racimo 27/31 * 4 = 3.48387 -> 3.96387
    assert celdas["2026-12"]["riegos_esperados"] == "3.96"
    assert celdas["2026-12"]["mm_esperados"] == "152.21"
    assert celdas["2026-12"]["mm_aplicados"] == "0.00"
    assert celdas["2026-12"]["cumplimiento_pct"] == "0.0"


async def test_mes_futuro_sin_porcentaje(client, create_user, create_parcela, fijar_hoy):
    fijar_hoy(date(2026, 11, 6))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2")

    resp = await client.get(
        URL, params={"desde": "2026-12-01", "hasta": "2026-12-31"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2026-12"]
    assert celda["cumplimiento_pct"] is None
    assert celda["mm_esperados"] == "0.00"
    assert celda["riegos_esperados"] == "0.00"


async def test_mes_actual_prorrateado_hasta_hoy(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2026, 11, 20))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2")
    await _riego(db_session, p.id, uid, date(2026, 11, 12), 24)  # 38.4 mm

    resp = await client.get(
        URL, params={"desde": "2026-11-01", "hasta": "2026-11-30"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2026-11"]
    # floracion Nov 1-9: 9/21 = 0.42857 ; cuaje Nov 10-20 only: 11/25 * 3 = 1.32
    assert celda["riegos_esperados"] == "1.75"
    assert celda["mm_esperados"] == "67.15"  # 1.748571 * 38.4
    assert celda["cumplimiento_pct"] == "57.2"  # 38.4 / 67.1451


async def test_riego_en_curso_se_ignora(client, create_user, create_parcela, db_session, fijar_hoy):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2")
    await _riego(db_session, p.id, uid, date(2027, 3, 5), None)

    resp = await client.get(URL, params=MARZO_2027, headers=headers)

    celda = resp.json()["filas"][0]["celdas"]["2027-03"]
    assert celda["mm_aplicados"] == "0.00"
    assert celda["riegos_equivalentes"] == "0.00"
    assert celda["cumplimiento_pct"] == "0.0"


async def test_filtra_por_tipo(client, create_user, create_parcela, db_session, fijar_hoy):
    fijar_hoy(date(2027, 6, 10))
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=0.5)
    await _riego(db_session, p.id, uid, date(2027, 3, 10), 10, TipoRiego.goteo)
    await _riego(db_session, p.id, uid, date(2027, 3, 12), 8, TipoRiego.manto)

    async def mm(tipo: str) -> float:
        resp = await client.get(URL, params={**MARZO_2027, "tipo": tipo}, headers=headers)
        return float(resp.json()["filas"][0]["celdas"]["2027-03"]["mm_aplicados"])

    goteo, manto, ambos = await mm("goteo"), await mm("manto"), await mm("ambos")
    assert goteo == 16.0
    assert manto > 0
    assert ambos == pytest.approx(goteo + manto)


async def test_filas_parcelas_activas_y_filtro_parcela(
    client, create_user, create_parcela, db_session, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    a = await create_parcela(nombre="Parral 10")
    await create_parcela(nombre="Parral 2")
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
    await create_parcela(nombre="Parral 2")

    resp = await client.get(
        URL, params={"desde": "2027-01-01", "hasta": "2027-01-31"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2027-01"]
    # cierre_racimo wraps Dec 5 -> Jan 4: 4/31 * 4 = 0.5161 ; envero Jan 5-31: 27/27 * 4 = 4
    assert celda["riegos_esperados"] == "4.52"
    assert celda["mm_esperados"] == "173.42"  # 4.516129 * 38.4


async def test_septiembre_post_cosecha_y_brotacion(client, create_user, create_parcela, fijar_hoy):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2")

    resp = await client.get(
        URL, params={"desde": "2026-09-01", "hasta": "2026-09-30"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2026-09"]
    # post_cosecha May 1 -> Sep 19 (142 d): 19/142 * 1 ; brotacion Sep 20-30: 11/30 * 1
    assert celda["riegos_esperados"] == "0.50"  # 0.1338 + 0.3667 = 0.5005
    assert celda["mm_esperados"] == "19.22"  # 0.500469 * 38.4


async def test_desde_a_mitad_de_mes_recorta_la_ventana(
    client, create_user, create_parcela, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2")

    resp = await client.get(
        URL, params={"desde": "2026-12-15", "hasta": "2026-12-31"}, headers=headers
    )

    celda = resp.json()["filas"][0]["celdas"]["2026-12"]
    # cuaje ends Dec 4 (out of range); cierre_racimo Dec 15-31 = 17 of 31 days * 4 riegos
    assert celda["riegos_esperados"] == "2.19"  # 17/31 * 4 = 2.1935
    assert celda["mm_esperados"] == "84.23"  # 2.193548 * 38.4


async def test_rango_y_parcela_sin_coincidencias_devuelve_filas_vacias(
    client, create_user, create_parcela, fijar_hoy
):
    fijar_hoy(date(2027, 6, 10))
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 2")

    resp = await client.get(
        URL,
        params={**MARZO_2027, "parcela_id": "00000000-0000-0000-0000-000000000000"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["filas"] == []
