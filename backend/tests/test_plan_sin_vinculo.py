"""Orders no longer link to the plan (progress is by date) and the plan keeps a
unique (temporada, variedad, ronda, insumo) key.

Spec: docs/superpowers/specs/2026-10-28-plan-mensual-avance-design.md (sections 4 and 6).
"""
from __future__ import annotations


import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.parcela import VariedadUva
from app.models.produccion import PlanFitosanitario, RegistroFitosanitario
from tests.helpers_plan import aplicar, auth, crear_orden, crear_plan, linea, registro_parcela_entera


async def _parral(create_parcela, create_valvula):
    parcela = await create_parcela(nombre="Parral 2", variedad=VariedadUva.flame, superficie_ha=2.0)
    valvula = await create_valvula(parcela_id=parcela.id, nombre="21", superficie_ha=2.0)
    return parcela, valvula


async def test_post_orden_acepta_e_ignora_numero_aplicacion(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela, _v = await _parral(create_parcela, create_valvula)
    insumo = await create_insumo()
    orden = await crear_orden(client, headers, [linea(insumo.id, numero_aplicacion=3)], [parcela.id])
    assert orden["lineas"][0]["numero_aplicacion"] is None
    assert orden["plan_fitosanitario_id"] is None


async def test_orden_confirmada_no_escribe_vinculo_al_plan(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela, _v = await _parral(create_parcela, create_valvula)
    insumo = await create_insumo()
    await crear_plan(client, headers, insumo.id, ["flame"])
    await aplicar(client, headers, [linea(insumo.id, numero_aplicacion=1)], [parcela.id])
    registros = (await db_session.execute(select(RegistroFitosanitario))).scalars().all()
    assert registros and all(r.plan_fitosanitario_id is None for r in registros)


async def test_desde_plan_equivale_a_post(
    client, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcela, _v = await _parral(create_parcela, create_valvula)
    insumo = await create_insumo()
    planes = await crear_plan(client, headers, insumo.id, ["flame"], dosis_por_ha=2.0)
    resp = await client.post(
        "/ordenes-aplicacion/desde-plan",
        json={
            "plan_fitosanitario_id": planes["flame"], "parcela_ids": [parcela.id],
            "fecha_planificada": "2026-10-15", "dias_carencia": 7, "dias_reingreso": 2,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["plan_fitosanitario_id"] is None
    assert cuerpo["lineas"][0]["dosis_por_ha"] == 2.0


async def test_plan_duplicado_devuelve_409_en_post_y_put(
    client, create_user, create_insumo,
):
    headers, _ = await auth(client, create_user)
    insumo = await create_insumo()
    primero = await crear_plan(client, headers, insumo.id, ["flame"], numero_aplicacion=1)
    otro = await crear_plan(client, headers, insumo.id, ["flame"], numero_aplicacion=2)

    cuerpo = {
        "temporada": 2026, "variedades": ["flame"], "numero_aplicacion": 1, "mes": 10,
        "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.5,
    }
    dup = await client.post("/plan-fitosanitario/", json=cuerpo, headers=headers)
    assert dup.status_code == 409
    assert "ronda 1" in dup.json()["detail"]

    choque = await client.put(
        f"/plan-fitosanitario/{otro['flame']}", json={"numero_aplicacion": 1}, headers=headers)
    assert choque.status_code == 409
    # Editing a row without touching its key must still work.
    ok = await client.put(
        f"/plan-fitosanitario/{primero['flame']}", json={"dosis_por_ha": 2.5}, headers=headers)
    assert ok.status_code == 200, ok.text


async def test_indice_unico_respalda_la_clave(db_session, create_user, create_insumo):
    insumo = await create_insumo()
    usuario = await create_user(email="idx@test.com")

    def fila() -> PlanFitosanitario:
        return PlanFitosanitario(
            temporada=2026, variedad=VariedadUva.flame, numero_aplicacion=1, mes=10,
            insumo_id=insumo.id, objetivo="Oidio", dosis_por_ha=1.0, created_by=usuario.id,
        )

    db_session.add(fila())
    await db_session.commit()
    db_session.add(fila())
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_borrar_fila_de_plan_con_registro_legacy_vinculado(
    client, db_session, create_user, create_parcela, create_valvula, create_insumo,
):
    headers, uid = await auth(client, create_user)
    parcela, _v = await _parral(create_parcela, create_valvula)
    insumo = await create_insumo()
    planes = await crear_plan(client, headers, insumo.id, ["flame"])
    db_session.add(registro_parcela_entera(parcela.id, insumo.id, planes["flame"], uid))
    await db_session.commit()

    resp = await client.delete(f"/plan-fitosanitario/{planes['flame']}", headers=headers)
    assert resp.status_code == 204, resp.text
    registro = (await db_session.execute(select(RegistroFitosanitario))).scalars().one()
    await db_session.refresh(registro)
    assert registro.plan_fitosanitario_id is None  # kept, just unlinked


async def test_endpoints_de_rondas_ya_no_existen(client, create_user):
    headers, _ = await auth(client, create_user)
    for ruta in ("cumplimiento", "rondas-pendientes"):
        resp = await client.get(f"/plan-fitosanitario/{ruta}", params={"temporada": 2026}, headers=headers)
        assert resp.status_code in (404, 405), (ruta, resp.status_code)


async def test_plan_sin_ronda_asigna_numero_y_rechaza_mes_repetido(
    client, create_user, create_insumo,
):
    headers, _uid = await auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    body = {"temporada": 2026, "variedades": ["flame"], "mes": 10,
            "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 2.0}
    ok = await client.post("/plan-fitosanitario/", json=body, headers=headers)
    assert ok.status_code == 201, ok.text
    assert ok.json()[0]["numero_aplicacion"] == 1
    dup = await client.post("/plan-fitosanitario/", json=body, headers=headers)
    assert dup.status_code == 409
    otro_mes = await client.post("/plan-fitosanitario/", json={**body, "mes": 11}, headers=headers)
    assert otro_mes.status_code == 201
    assert otro_mes.json()[0]["numero_aplicacion"] == 2


async def test_editar_plan_a_un_mes_ocupado_da_409(client, create_user, create_insumo):
    headers, _uid = await auth(client, create_user)
    insumo = await create_insumo(nombre="Cobre")
    body = {"temporada": 2026, "variedades": ["flame"], "insumo_id": insumo.id,
            "objetivo": "Peronospora", "dosis_por_ha": 1.0}
    octubre = (await client.post("/plan-fitosanitario/", json={**body, "mes": 10}, headers=headers)).json()[0]
    await client.post("/plan-fitosanitario/", json={**body, "mes": 11}, headers=headers)
    mismo = await client.put(f"/plan-fitosanitario/{octubre['id']}", json={"mes": 10, "dosis_por_ha": 2.0}, headers=headers)
    assert mismo.status_code == 200, mismo.text
    choque = await client.put(f"/plan-fitosanitario/{octubre['id']}", json={"mes": 11}, headers=headers)
    assert choque.status_code == 409
