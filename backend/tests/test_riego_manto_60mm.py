"""Riego a manto de 60 mm fijos (2026-11-17): cada riego a manto terminado entrega
`mm_riego_manto` mm sobre la parcela completa, sin importar el tiempo, congelado en
`registros_riego.litros_manto`.
Run with: pytest
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.core import cumplimiento_riego
from app.models.parcela import Parcela, TipoRiego
from app.models.produccion import RegistroRiego
from app.models.user import User, UserRole


async def _login(client, create_user, role: UserRole = UserRole.gerencial) -> tuple[dict, User]:
    user = await create_user(email="gerente@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "gerente@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, user


def _manto(parcela_id: str, horas: float = 10, **extra) -> dict:
    inicio = datetime(2026, 10, 5, 8, tzinfo=timezone.utc)
    return {
        "fecha": "2026-10-05",
        "parcela_id": parcela_id,
        "tipo": "manto",
        "inicio": inicio.isoformat(),
        "fin": (inicio + timedelta(hours=horas)).isoformat(),
        "responsable": "Juan Perez",
        **extra,
    }


def _iniciar(parcela_id: str) -> dict:
    return {"parcela_id": parcela_id, "tipo": "manto", "responsable": "Juan Perez"}


# --- Task 1: parameter and litres formula --------------------------------------


async def test_parametro_mm_riego_manto_default_60_y_editable(client, create_user):
    headers, _ = await _login(client, create_user)

    resp = await client.get("/alta-produccion/parametros", headers=headers)
    assert resp.status_code == 200
    assert float(resp.json()["mm_riego_manto"]) == 60

    resp = await client.patch(
        "/alta-produccion/parametros", json={"mm_riego_manto": "50"}, headers=headers
    )
    assert resp.status_code == 200
    assert float(resp.json()["mm_riego_manto"]) == 50

    resp = await client.get("/alta-produccion/parametros", headers=headers)
    assert float(resp.json()["mm_riego_manto"]) == 50


def test_litros_manto_de_calcula_mm_por_superficie() -> None:
    assert RegistroRiego.litros_manto_de(60, 2.3) == 60 * 2.3 * 10_000
    assert RegistroRiego.litros_manto_de(60, None) is None
    assert RegistroRiego.litros_manto_de(60, 0) is None
    assert RegistroRiego.litros_manto_de(60, -1) is None


def test_litros_de_manto_usa_litros_manto_e_ignora_horas() -> None:
    corto = RegistroRiego.litros_de(1, "manto", None, 3, 1_800_000.0)
    largo = RegistroRiego.litros_de(24, TipoRiego.manto, None, 3, 1_800_000.0)
    assert corto == largo == 1_800_000.0
    assert RegistroRiego.litros_de(None, "manto", None, 3, 1_800_000.0) == 0.0
    assert RegistroRiego.litros_de(10, "manto", None, 3, None) == 0.0
    assert cumplimiento_riego.litros_de_registro(5, "manto", None, 3, 900_000.0) == 900_000.0


def test_litros_de_goteo_no_cambia() -> None:
    assert RegistroRiego.litros_de(10, "goteo", "1,2", None) == 10 * 16_000 * 2
    # A stray litros_manto never leaks into goteo.
    assert RegistroRiego.litros_de(10, "goteo", "1,2", None, 999.0) == 10 * 16_000 * 2


# --- Task 2: freezing on create / terminar / update ---------------------------


async def test_manto_terminado_vale_60mm_sin_importar_el_tiempo(client, create_user, create_parcela):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=3.0)

    for horas in (2, 20):
        resp = await client.post(
            "/produccion/riego/", json=_manto(parcela.id, horas), headers=headers
        )
        assert resp.status_code == 201
        assert resp.json()["litros_aplicados"] == 60 * 3 * 10_000
        assert resp.json()["mm_aplicados"] == 60


async def test_manto_en_curso_no_cuenta(client, create_user, create_parcela, db_session):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=3.0)

    iniciado = await client.post("/produccion/riego/iniciar", json=_iniciar(parcela.id), headers=headers)
    assert iniciado.status_code == 201
    en_curso = await db_session.get(RegistroRiego, iniciado.json()["id"])
    assert en_curso.litros_aplicados == 0
    assert not en_curso.mm_aplicados
    assert en_curso.litros_manto is None

    inicio = datetime.fromisoformat(iniciado.json()["inicio"].replace("Z", "+00:00"))
    fin = (inicio + timedelta(hours=3)).isoformat()
    terminado = await client.post(
        f"/produccion/riego/{iniciado.json()['id']}/terminar", json={"fin": fin}, headers=headers
    )
    assert terminado.status_code == 200
    assert terminado.json()["litros_aplicados"] == 1_800_000
    assert terminado.json()["mm_aplicados"] == 60


async def test_cumplimiento_cuenta_1_56_riegos_por_manto(client, create_user, create_parcela):
    from app.models.parcela import VariedadUva

    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=1.0, variedad=VariedadUva.flame)
    hoy = datetime.now(timezone.utc)
    resp = await client.post(
        "/produccion/riego/",
        json={
            "fecha": hoy.date().isoformat(),
            "parcela_id": parcela.id,
            "tipo": "manto",
            "inicio": (hoy - timedelta(hours=4)).isoformat(),
            "fin": hoy.isoformat(),
            "responsable": "Juan Perez",
        },
        headers=headers,
    )
    assert resp.status_code == 201

    resp = await client.get("/produccion/estado-campana/cumplimiento-riego", headers=headers)
    assert resp.status_code == 200
    items = resp.json()
    fila = next(i for i in items if i["parcela_id"] == parcela.id)
    assert fila["riegos_equivalentes"] == pytest.approx(1.56, abs=0.005)


async def test_superficie_editada_despues_no_cambia_el_manto_terminado(
    client, create_user, create_parcela, db_session
):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=3.0)
    creado = (await client.post("/produccion/riego/", json=_manto(parcela.id), headers=headers)).json()

    guardada = await db_session.get(Parcela, parcela.id)
    guardada.superficie_ha = 5.0
    await db_session.commit()

    resp = await client.get(f"/produccion/riego/{creado['id']}", headers=headers)
    assert resp.json()["litros_aplicados"] == 1_800_000


async def test_cambiar_el_parametro_no_toca_registros_viejos(client, create_user, create_parcela):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=3.0)
    viejo = (await client.post("/produccion/riego/", json=_manto(parcela.id), headers=headers)).json()

    resp = await client.patch(
        "/alta-produccion/parametros", json={"mm_riego_manto": "50"}, headers=headers
    )
    assert resp.status_code == 200
    nuevo = (await client.post("/produccion/riego/", json=_manto(parcela.id), headers=headers)).json()

    releido = (await client.get(f"/produccion/riego/{viejo['id']}", headers=headers)).json()
    assert releido["mm_aplicados"] == 60
    assert releido["litros_aplicados"] == 1_800_000
    assert nuevo["mm_aplicados"] == 50
    assert nuevo["litros_aplicados"] == 50 * 3 * 10_000


async def test_put_sin_cambiar_parcela_conserva_litros(client, create_user, create_parcela, db_session):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=3.0)
    creado = (await client.post("/produccion/riego/", json=_manto(parcela.id), headers=headers)).json()

    # Parameter changed after the riego: an unrelated edit must not refreeze it.
    await client.patch("/alta-produccion/parametros", json={"mm_riego_manto": "50"}, headers=headers)
    resp = await client.put(
        f"/produccion/riego/{creado['id']}", json={"responsable": "Otro"}, headers=headers
    )

    assert resp.status_code == 200
    assert resp.json()["responsable"] == "Otro"
    assert resp.json()["litros_aplicados"] == 1_800_000
    assert resp.json()["mm_aplicados"] == 60


async def test_put_cambiando_parcela_recalcula(client, create_user, create_parcela):
    headers, _ = await _login(client, create_user)
    a = await create_parcela(nombre="A", superficie_ha=3.0)
    b = await create_parcela(nombre="B", superficie_ha=0.5)
    creado = (await client.post("/produccion/riego/", json=_manto(a.id), headers=headers)).json()

    resp = await client.put(f"/produccion/riego/{creado['id']}", json={"parcela_id": b.id}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["litros_aplicados"] == 60 * 0.5 * 10_000
    assert resp.json()["mm_aplicados"] == 60


async def test_put_cierra_un_manto_en_curso_y_lo_congela(client, create_user, create_parcela):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=3.0)
    iniciado = (await client.post("/produccion/riego/iniciar", json=_iniciar(parcela.id), headers=headers)).json()
    inicio = datetime.fromisoformat(iniciado["inicio"].replace("Z", "+00:00"))

    resp = await client.put(
        f"/produccion/riego/{iniciado['id']}",
        json={"fin": (inicio + timedelta(hours=2)).isoformat()},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["litros_aplicados"] == 1_800_000
    assert resp.json()["mm_aplicados"] == 60


async def test_put_manto_a_goteo_limpia_litros_manto(client, create_user, create_parcela, db_session):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=3.0)
    creado = (await client.post("/produccion/riego/", json=_manto(parcela.id), headers=headers)).json()

    resp = await client.put(
        f"/produccion/riego/{creado['id']}",
        json={"tipo": "goteo", "cabezal": "1", "valvula": "1,2"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["litros_aplicados"] == 10 * 16_000 * 2
    assert resp.json()["mm_aplicados"] == 16.0
    guardado = await db_session.get(RegistroRiego, creado["id"])
    await db_session.refresh(guardado)
    assert guardado.litros_manto is None


async def test_manto_sin_superficie_no_rompe(client, create_user, create_parcela, db_session):
    headers, user = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=None)
    db_session.add(
        RegistroRiego(
            fecha=datetime(2026, 10, 5).date(),
            parcela_id=parcela.id,
            tipo=TipoRiego.manto,
            inicio=datetime(2026, 10, 5, 8, tzinfo=timezone.utc),
            fin=datetime(2026, 10, 5, 18, tzinfo=timezone.utc),
            litros_manto=None,
            responsable="Juan Perez",
            created_by=user.id,
        )
    )
    await db_session.commit()

    listado = await client.get("/produccion/riego/", headers=headers)
    assert listado.status_code == 200
    assert listado.json()[0]["litros_aplicados"] == 0

    planilla = await client.get("/produccion/riego/planilla/cumplimiento", headers=headers)
    assert planilla.status_code == 200
    eficiencia = await client.get("/produccion/dashboard/eficiencia-hidrica?anio=2026", headers=headers)
    assert eficiencia.status_code == 200
    cumplimiento = await client.get("/produccion/estado-campana/cumplimiento-riego", headers=headers)
    assert cumplimiento.status_code == 200


async def test_cliente_viejo_con_valvula_se_ignora(client, create_user, create_parcela):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=3.0)

    resp = await client.post(
        "/produccion/riego/",
        json=_manto(parcela.id, cabezal="1", valvula="1,2", mm_aplicados=6.4),
        headers=headers,
    )

    assert resp.status_code == 201
    assert resp.json()["litros_aplicados"] == 1_800_000
    assert resp.json()["mm_aplicados"] == 60
    assert resp.json()["cabezal"] is None


async def test_eficiencia_hidrica_usa_litros_congelados(client, create_user, create_parcela):
    headers, _ = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=2.0)
    await client.post("/produccion/riego/", json=_manto(parcela.id, horas=1), headers=headers)

    resp = await client.get("/produccion/dashboard/eficiencia-hidrica?anio=2026", headers=headers)

    assert resp.status_code == 200
    fila = next(r for r in resp.json() if r["parcela_id"] == parcela.id)
    assert fila["litros_totales"] == 60 * 2 * 10_000
    assert fila["mm_aplicados_total"] == pytest.approx(60)
