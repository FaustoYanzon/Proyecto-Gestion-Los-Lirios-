"""Paseros stay out of drip irrigation, fito, application orders and the fito plan.

Only new writes are blocked: historical records on a pasero keep listing fine.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from app.models.parcela import TipoParcela, VariedadUva
from app.models.produccion import RegistroFitosanitario, RegistroRiego
from app.models.user import UserRole
from app.services.plan_avance import calcular_avance
from app.services.plan_contraste import (
    LineaContraste,
    ParcelaElegida,
    calcular_contraste,
)
from tests.helpers_plan import auth, crear_orden, crear_plan, linea


async def _auth(client, create_user, role: UserRole = UserRole.gerencial) -> dict:
    await create_user(email="gerencial@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "gerencial@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _fito_payload(parcela_id: str, insumo_id: str) -> dict:
    return {
        "fecha": "2026-09-08",
        "parcela_id": parcela_id,
        "insumo_id": insumo_id,
        "dosis_por_ha": 2.0,
        "motivo": "Preventivo",
        "dias_carencia": 7,
        "dias_reingreso": 2,
        "responsable": "Juan Perez",
    }


# -- Task 1: riego goteo y fito ------------------------------------------------

async def test_goteo_en_pasero_da_422(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    resp = await client.post(
        "/produccion/riego/",
        json={
            "fecha": "2026-10-05",
            "parcela_id": pasero.id,
            "inicio": "2026-10-05T08:00:00",
            "fin": "2026-10-05T18:00:00",
            "responsable": "Juan Perez",
            "cabezal": "1",
            "valvula": "1,2",
        },
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "pasero" in resp.json()["detail"].lower()


async def test_iniciar_goteo_en_pasero_da_422(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    resp = await client.post(
        "/produccion/riego/iniciar",
        json={
            "parcela_id": pasero.id,
            "tipo": "goteo",
            "cabezal": "1",
            "valvula": "1,2",
            "responsable": "Juan Perez",
        },
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "pasero" in resp.json()["detail"].lower()


async def test_fito_en_pasero_da_422(client, create_user, create_parcela, create_insumo):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    insumo = await create_insumo(stock_actual=100.0)
    resp = await client.post(
        "/produccion/fitosanitarios/", json=_fito_payload(pasero.id, insumo.id), headers=headers
    )
    assert resp.status_code == 422, resp.text
    assert "pasero" in resp.json()["detail"].lower()
    stock = await client.get(f"/insumos/{insumo.id}", headers=headers)
    assert float(stock.json()["stock_actual"]) == 100.0


async def test_fito_update_hacia_pasero_da_422_y_conserva_stock(
    client, create_user, create_parcela, create_insumo
):
    headers = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", superficie_ha=5.0)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    insumo = await create_insumo(stock_actual=100.0)

    creado = await client.post(
        "/produccion/fitosanitarios/", json=_fito_payload(parral.id, insumo.id), headers=headers
    )
    assert creado.status_code == 201, creado.text
    registro_id = creado.json()["id"]
    antes = await client.get(f"/insumos/{insumo.id}", headers=headers)
    stock_antes = float(antes.json()["stock_actual"])
    assert stock_antes == 90.0

    resp = await client.put(
        f"/produccion/fitosanitarios/{registro_id}",
        json={"parcela_id": pasero.id},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text

    despues = await client.get(f"/insumos/{insumo.id}", headers=headers)
    assert float(despues.json()["stock_actual"]) == stock_antes
    registro = await client.get(f"/produccion/fitosanitarios/{registro_id}", headers=headers)
    assert registro.json()["parcela_id"] == parral.id


async def test_listados_con_registro_historico_en_pasero_no_fallan(
    client, create_user, create_parcela, create_insumo, db_session
):
    user = await create_user(email="gerencial@test.com", password="Password123!", role=UserRole.gerencial)
    login = await client.post(
        "/auth/login", data={"username": "gerencial@test.com", "password": "Password123!"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero, superficie_ha=2.0)
    insumo = await create_insumo()

    db_session.add(
        RegistroFitosanitario(
            fecha=date(2026, 9, 8),
            parcela_id=pasero.id,
            insumo_id=insumo.id,
            producto_nombre=insumo.nombre,
            unidad=insumo.unidad,
            dosis_por_ha=2.0,
            cantidad_total=4.0,
            motivo="Historico",
            dias_carencia=7,
            dias_reingreso=2,
            responsable="Juan Perez",
            created_by=user.id,
        )
    )
    db_session.add(
        RegistroRiego(
            fecha=date(2026, 10, 5),
            parcela_id=pasero.id,
            cabezal="1",
            valvula="1,2",
            inicio=datetime(2026, 10, 5, 8, 0),
            fin=datetime(2026, 10, 5, 18, 0),
            responsable="Juan Perez",
            created_by=user.id,
        )
    )
    await db_session.commit()

    fito = await client.get(
        f"/produccion/fitosanitarios/?parcela_id={pasero.id}", headers=headers
    )
    assert fito.status_code == 200, fito.text
    assert len(fito.json()) == 1

    riego = await client.get(f"/produccion/riego/?parcela_id={pasero.id}", headers=headers)
    assert riego.status_code == 200, riego.text
    assert len(riego.json()) == 1


# -- Task 2: ordenes de aplicacion y plan fito ---------------------------------

async def test_orden_con_pasero_explicito_da_422(client, create_user, create_parcela, create_insumo):
    headers, _uid = await auth(client, create_user)
    parral = await create_parcela(nombre="Parral 2", variedad=VariedadUva.flame, superficie_ha=6.0)
    pasero = await create_parcela(
        nombre="Pasero 1", tipo=TipoParcela.pasero, variedad=VariedadUva.flame, superficie_ha=2.0
    )
    insumo = await create_insumo(nombre="Mancozeb")
    resp = await client.post(
        "/ordenes-aplicacion/",
        json={
            "temporada": 2026,
            "objetivo": "Curacion",
            "fecha_planificada": "2026-10-15",
            "lineas": [linea(insumo.id)],
            "parcela_ids": [parral.id, pasero.id],
        },
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "Pasero 1" in resp.json()["detail"]


async def test_orden_por_variedad_no_incluye_pasero(client, create_user, create_parcela, create_insumo):
    headers, _uid = await auth(client, create_user)
    parral = await create_parcela(nombre="Parral 2", variedad=VariedadUva.flame, superficie_ha=6.0)
    await create_parcela(
        nombre="Pasero 1", tipo=TipoParcela.pasero, variedad=VariedadUva.flame, superficie_ha=2.0
    )
    insumo = await create_insumo(nombre="Mancozeb")
    resp = await client.post(
        "/ordenes-aplicacion/",
        json={
            "temporada": 2026,
            "objetivo": "Curacion",
            "fecha_planificada": "2026-10-15",
            "lineas": [linea(insumo.id)],
            "variedad": "flame",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    assert [p["parcela_id"] for p in resp.json()["parcelas"]] == [parral.id]


async def _fito_historico(db, user_id: str, parcela_id: str, insumo_id: str, fecha: date) -> None:
    db.add(
        RegistroFitosanitario(
            fecha=fecha, parcela_id=parcela_id, producto_nombre="Producto", dosis_por_ha=2.0,
            insumo_id=insumo_id, motivo="Oidio", dias_carencia=7, dias_reingreso=2,
            fecha_habilitacion_cosecha=fecha + timedelta(days=7),
            fecha_habilitacion_reingreso=fecha + timedelta(days=2),
            responsable="Juan Perez", created_by=user_id,
        )
    )
    await db.commit()


async def test_plan_avance_ignora_pasero(client, db_session, create_user, create_parcela, create_insumo):
    headers, uid = await auth(client, create_user)
    pasero = await create_parcela(
        nombre="Pasero 1", tipo=TipoParcela.pasero, variedad=VariedadUva.flame, superficie_ha=2.0
    )
    insumo = await create_insumo(nombre="Mancozeb")
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=2.0, mes=10)
    await _fito_historico(db_session, uid, pasero.id, insumo.id, date(2026, 10, 10))

    items = await calcular_avance(db_session, 2026, 10)
    assert all(pasero.id not in {p.parcela_id for p in i.parcelas} for i in items)
    assert await calcular_avance(db_session, 2026, 10, parcela_id=pasero.id) == []


async def test_contraste_ignora_pasero(client, db_session, create_user, create_parcela, create_insumo):
    headers, _uid = await auth(client, create_user)
    pasero = await create_parcela(
        nombre="Pasero 1", tipo=TipoParcela.pasero, variedad=VariedadUva.flame, superficie_ha=2.0
    )
    insumo = await create_insumo(nombre="Mancozeb")
    await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=2.0, mes=10)

    [resultado] = await calcular_contraste(
        db_session,
        date(2026, 10, 15),
        [ParcelaElegida(parcela_id=pasero.id)],
        [LineaContraste(insumo_id=insumo.id, dosis_por_ha=Decimal("2"))],
    )
    assert resultado.variedades == []
