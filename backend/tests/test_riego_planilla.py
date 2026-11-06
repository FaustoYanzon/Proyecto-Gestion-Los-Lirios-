"""Planilla de cumplimiento de riego: parcelas x meses, cada riego en el mes de su inicio.
Run with: pytest
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.parcela import TipoParcela, TipoRiego
from app.models.produccion import RegistroRiego
from app.models.user import UserRole


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
    inicio: datetime,
    horas: float | None,
    tipo: TipoRiego = TipoRiego.manto,
) -> None:
    """Insert through the model so mm_aplicados is computed by RegistroRiego itself."""
    fin = None if horas is None else inicio + timedelta(hours=horas)
    session.add(
        RegistroRiego(
            fecha=inicio.date(),
            parcela_id=parcela_id,
            tipo=tipo,
            cabezal="1" if tipo == TipoRiego.goteo else None,
            valvula="1" if tipo == TipoRiego.goteo else None,
            n_valvulas_manto=1 if tipo == TipoRiego.manto else None,
            inicio=inicio,
            fin=fin,
            duracion_horas=horas,
            responsable="Juan",
            created_by=user_id,
        )
    )
    await session.commit()


def _utc(y: int, m: int, d: int, h: int = 12) -> datetime:
    return datetime(y, m, d, h, 0, tzinfo=timezone.utc)


URL = "/produccion/riego/planilla"
RANGO = {"desde": "2026-08-01", "hasta": "2026-12-31"}


async def test_planilla_agrupa_por_mes_de_inicio(client, create_user, create_parcela, db_session):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=0.5)
    await _riego(db_session, p.id, uid, _utc(2026, 8, 12), 5)
    await _riego(db_session, p.id, uid, _utc(2026, 9, 18), 3, TipoRiego.goteo)
    await _riego(db_session, p.id, uid, _utc(2026, 9, 22), 4)

    resp = await client.get(URL, params=RANGO, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["meses"] == ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]
    celdas = data["filas"][0]["celdas"]
    assert [c["fecha_inicio"] for c in celdas["2026-08"]] == ["2026-08-12"]
    assert [c["fecha_inicio"] for c in celdas["2026-09"]] == ["2026-09-18", "2026-09-22"]
    assert celdas["2026-09"][0]["tipo"] == "goteo"
    assert celdas["2026-09"][0]["horas"] == "3.00"
    assert "2026-10" not in celdas


async def test_planilla_filtra_tipo_manto(client, create_user, create_parcela, db_session):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=0.5)
    await _riego(db_session, p.id, uid, _utc(2026, 9, 18), 3, TipoRiego.goteo)
    await _riego(db_session, p.id, uid, _utc(2026, 9, 22), 4)

    resp = await client.get(URL, params={**RANGO, "tipo": "manto"}, headers=headers)
    celdas = resp.json()["filas"][0]["celdas"]["2026-09"]
    assert [c["tipo"] for c in celdas] == ["manto"]

    resp = await client.get(URL, params={**RANGO, "tipo": "goteo"}, headers=headers)
    celdas = resp.json()["filas"][0]["celdas"]["2026-09"]
    assert [c["tipo"] for c in celdas] == ["goteo"]


async def test_planilla_parcela_sin_riegos_tiene_fila_vacia(client, create_user, create_parcela, db_session):
    headers, _ = await _auth(client, create_user)
    await create_parcela(nombre="Parral 3", superficie_ha=1.0)
    await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)

    resp = await client.get(URL, params=RANGO, headers=headers)

    filas = resp.json()["filas"]
    assert [f["parcela_nombre"] for f in filas] == ["Parral 3"]
    assert filas[0]["celdas"] == {}


async def test_planilla_riego_en_curso_sin_mm(client, create_user, create_parcela, db_session):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=0.5)
    await _riego(db_session, p.id, uid, _utc(2026, 10, 5), None)

    resp = await client.get(URL, params=RANGO, headers=headers)

    celda = resp.json()["filas"][0]["celdas"]["2026-10"][0]
    assert celda["horas"] is None
    assert celda["mm"] is None
    assert celda["en_curso"] is True


async def test_planilla_mm_manto_usa_factor_4(client, create_user, create_parcela, db_session):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=0.5)
    await _riego(db_session, p.id, uid, _utc(2026, 10, 5), 8)

    resp = await client.get(URL, params=RANGO, headers=headers)

    celda = resp.json()["filas"][0]["celdas"]["2026-10"][0]
    assert celda["mm"] == "51.20"
    assert celda["horas"] == "8.00"
    assert celda["en_curso"] is False


async def test_planilla_limites_de_mes_y_rango(client, create_user, create_parcela, db_session):
    headers, uid = await _auth(client, create_user)
    p = await create_parcela(nombre="Parral 2", superficie_ha=0.5)
    # 2026-10-01 02:00 UTC is 2026-09-30 23:00 in Argentina (UTC-3): belongs to September.
    await _riego(db_session, p.id, uid, _utc(2026, 10, 1, 2), 1)
    # Local 2026-10-01 00:30 (03:30 UTC): October.
    await _riego(db_session, p.id, uid, _utc(2026, 10, 1, 3), 1)
    # Before desde and after hasta: excluded.
    await _riego(db_session, p.id, uid, _utc(2026, 7, 31, 12), 1)
    await _riego(db_session, p.id, uid, _utc(2027, 1, 5, 12), 1)

    resp = await client.get(URL, params=RANGO, headers=headers)

    celdas = resp.json()["filas"][0]["celdas"]
    assert [c["fecha_inicio"] for c in celdas["2026-09"]] == ["2026-09-30"]
    assert [c["fecha_inicio"] for c in celdas["2026-10"]] == ["2026-10-01"]
    assert sum(len(v) for v in celdas.values()) == 2


async def test_planilla_filtra_parcela_y_ordena_natural(client, create_user, create_parcela, db_session):
    headers, _ = await _auth(client, create_user)
    a = await create_parcela(nombre="Parral 10")
    await create_parcela(nombre="Parral 2")
    await create_parcela(nombre="Parral 3")

    resp = await client.get(URL, params=RANGO, headers=headers)
    assert [f["parcela_nombre"] for f in resp.json()["filas"]] == ["Parral 2", "Parral 3", "Parral 10"]

    resp = await client.get(URL, params={**RANGO, "parcela_id": a.id}, headers=headers)
    assert [f["parcela_nombre"] for f in resp.json()["filas"]] == ["Parral 10"]


async def test_planilla_default_es_campana_actual(client, create_user):
    headers, _ = await _auth(client, create_user)

    resp = await client.get(URL, headers=headers)

    meses = resp.json()["meses"]
    assert len(meses) == 12
    assert meses[0].endswith("-05") and meses[-1].endswith("-04")
