"""Órdenes multiproducto: modelo de líneas y vínculos explícitos del registro.

Spec: docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md
"""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.models.finanzas import Finca
from app.models.parcela import VariedadUva
from app.models.produccion import (
    OrdenAplicacion,
    OrdenAplicacionInsumo,
    OrdenAplicacionParcela,
    OrigenOrdenAplicacion,
    RegistroFitosanitario,
)
from app.models.user import UserRole
from tests.helpers_ordenes import add_linea_desde_shim


def _orden(user_id: str, insumo_id: str) -> OrdenAplicacion:
    return OrdenAplicacion(
        temporada=2026, origen=OrigenOrdenAplicacion.extra, variedad=VariedadUva.flame,
        insumo_id=insumo_id, dosis_por_ha=1.0, objetivo="Oidio", dias_carencia=7,
        dias_reingreso=2, fecha_planificada=date(2026, 10, 15), created_by=user_id,
    )


def _registro(parcela_id: str, user_id: str, **extra) -> RegistroFitosanitario:
    return RegistroFitosanitario(
        fecha=date(2026, 10, 16), parcela_id=parcela_id, producto_nombre="Azufre",
        dosis_por_ha=1.0, motivo="Oidio", dias_carencia=7, dias_reingreso=2,
        responsable="Test", created_by=user_id, **extra,
    )


async def test_linea_unica_por_orden_e_insumo(db_session, create_user, create_insumo):
    user = await create_user(email="ger@test.com")
    insumo = await create_insumo(nombre="Azufre")

    orden = _orden(user.id, insumo.id)
    add_linea_desde_shim(orden)
    add_linea_desde_shim(orden)
    db_session.add(orden)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_orden_con_dos_lineas_ordenadas_por_posicion(
    db_session, create_user, create_insumo,
):
    user = await create_user(email="ger@test.com")
    azufre = await create_insumo(nombre="Azufre")
    cobre = await create_insumo(nombre="Cobre")

    orden = _orden(user.id, azufre.id)
    # Inserted out of order on purpose: the collection must come back by posicion.
    orden.lineas.append(
        OrdenAplicacionInsumo(
            insumo_id=cobre.id, dosis_por_ha=2.0, dias_carencia=10, dias_reingreso=1,
            posicion=1,
        )
    )
    orden.lineas.append(
        OrdenAplicacionInsumo(
            insumo_id=azufre.id, dosis_por_ha=1.0, dias_carencia=7, dias_reingreso=2,
            posicion=0,
        )
    )
    db_session.add(orden)
    await db_session.flush()
    orden_id = orden.id
    db_session.expunge_all()

    cargada = (
        await db_session.execute(
            select(OrdenAplicacion)
            .options(
                selectinload(OrdenAplicacion.lineas).selectinload(OrdenAplicacionInsumo.insumo)
            )
            .where(OrdenAplicacion.id == orden_id)
        )
    ).scalar_one()
    assert [linea.insumo.nombre for linea in cargada.lineas] == ["Azufre", "Cobre"]


async def test_registro_orden_id_sale_de_orden_parcela_id(
    db_session, create_user, create_insumo, create_parcela,
):
    user = await create_user(email="ger@test.com")
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)

    orden = _orden(user.id, insumo.id)
    linea = add_linea_desde_shim(orden)
    item = OrdenAplicacionParcela(parcela_id=parcela.id)
    orden.parcelas.append(item)
    db_session.add(orden)
    await db_session.flush()

    vinculado = _registro(parcela.id, user.id, orden_parcela_id=item.id, orden_insumo_id=linea.id)
    suelto = _registro(parcela.id, user.id)
    db_session.add_all([vinculado, suelto])
    await db_session.flush()
    ids = (vinculado.id, suelto.id, orden.id)
    db_session.expunge_all()

    vinculado = await db_session.get(RegistroFitosanitario, ids[0])
    suelto = await db_session.get(RegistroFitosanitario, ids[1])
    assert vinculado.orden_id == ids[2]
    assert suelto.orden_id is None


# ── Legacy single-product flow keeps writing the new links ─────────────────


async def _auth(client, create_user):
    user = await create_user(email="ger@test.com", role=UserRole.gerencial)
    resp = await client.post(
        "/auth/login", data={"username": user.email, "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _payload_extra(insumo_id: str, parcela_ids: list[str]) -> dict:
    return {
        "temporada": 2026, "variedad": "flame", "insumo_id": insumo_id, "dosis_por_ha": 2.0,
        "objetivo": "Oidio", "dias_carencia": 7, "dias_reingreso": 2,
        "fecha_planificada": "2026-10-15", "parcela_ids": parcela_ids,
    }


async def test_orden_extra_nace_con_una_linea_y_confirmar_valvula_vincula_el_registro(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(
        nombre="Parral 2", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0,
    )
    await create_valvula(parcela_id=parcela.id, nombre="21", superficie_ha=1.0)

    orden = (
        await client.post(
            "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [parcela.id]), headers=headers,
        )
    ).json()
    lineas = (
        await db_session.execute(
            select(OrdenAplicacionInsumo).where(OrdenAplicacionInsumo.orden_id == orden["id"])
        )
    ).scalars().all()
    assert [(linea.insumo_id, linea.dosis_por_ha, linea.posicion) for linea in lineas] == [
        (insumo.id, 2.0, 0)
    ]

    item = orden["parcelas"][0]
    fila = item["valvulas"][0]
    resp = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/valvulas/{fila['id']}/confirmar",
        json={"resultado": "completa"}, headers=headers,
    )
    assert resp.status_code == 200, resp.text
    registro_id = resp.json()["registro_fitosanitario_id"]

    registro = await db_session.get(RegistroFitosanitario, registro_id)
    assert registro.orden_valvula_id == fila["id"]
    assert registro.orden_parcela_id == item["id"]
    assert registro.orden_insumo_id == lineas[0].id
    assert registro.orden_id == orden["id"]


async def test_confirmar_parcela_entera_vincula_el_registro(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Cobre")
    potrero = await create_parcela(nombre="Potrero 3", variedad="flame", finca=Finca.media_agua)

    orden = (
        await client.post(
            "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [potrero.id]), headers=headers,
        )
    ).json()
    item = orden["parcelas"][0]
    resp = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item['id']}/confirmar",
        json={}, headers=headers,
    )
    assert resp.status_code == 200, resp.text

    registro = await db_session.get(RegistroFitosanitario, resp.json()["registro_fitosanitario_id"])
    assert registro.orden_parcela_id == item["id"]
    assert registro.orden_valvula_id is None
    assert registro.orden_insumo_id is not None
    assert registro.orden_id == orden["id"]
