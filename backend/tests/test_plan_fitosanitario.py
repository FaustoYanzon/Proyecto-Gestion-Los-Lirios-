"""Plan de aplicación fitosanitaria por temporada -- carga a mano, variedad por
variedad, con la opción de crear la misma fila para varias variedades a la vez
(`variedades: list[VariedadUva]`). Ver plan `flickering-percolating-raven.md`.
"""
from __future__ import annotations

from app.models.user import UserRole


async def _auth(client, create_user, role: UserRole = UserRole.gerencial):
    await create_user(email="gerencial@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "gerencial@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_crear_con_varias_variedades_genera_filas_independientes(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre Micro", unidad="kg")

    resp = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026,
            "variedades": ["flame", "bonarda", "syrah"],
            "numero_aplicacion": 1,
            "mes": 10,
            "insumo_id": insumo.id,
            "objetivo": "Oidio",
            "dosis_por_ha": 3.0,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body) == 3
    assert {row["variedad"] for row in body} == {"flame", "bonarda", "syrah"}
    assert all(row["insumo_nombre"] == "Azufre Micro" for row in body)
    assert all(row["insumo_unidad"] == "kg" for row in body)

    listado = await client.get("/plan-fitosanitario/", params={"temporada": 2026}, headers=headers)
    assert len(listado.json()) == 3


async def test_editar_una_fila_no_afecta_a_las_demas(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Vivando", unidad="lt")

    creado = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026,
            "variedades": ["flame", "red_globe"],
            "numero_aplicacion": 1,
            "mes": 10,
            "insumo_id": insumo.id,
            "objetivo": "Oidio",
            "dosis_por_ha": 0.25,
        },
        headers=headers,
    )
    filas = creado.json()
    fila_flame = next(r for r in filas if r["variedad"] == "flame")
    fila_rg = next(r for r in filas if r["variedad"] == "red_globe")

    editado = await client.put(
        f"/plan-fitosanitario/{fila_flame['id']}", json={"dosis_por_ha": 0.5}, headers=headers,
    )
    assert editado.status_code == 200, editado.text
    assert editado.json()["dosis_por_ha"] == 0.5

    verificar_rg = await client.get("/plan-fitosanitario/", params={"temporada": 2026, "variedad": "red_globe"}, headers=headers)
    assert verificar_rg.json()[0]["dosis_por_ha"] == 0.25


async def test_filtro_por_temporada_y_variedad(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo()

    await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2025, "variedades": ["flame"], "numero_aplicacion": 1,
            "mes": 10, "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.0,
        },
        headers=headers,
    )
    await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026, "variedades": ["flame", "fiesta"], "numero_aplicacion": 1,
            "mes": 10, "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.0,
        },
        headers=headers,
    )

    solo_2026 = await client.get("/plan-fitosanitario/", params={"temporada": 2026}, headers=headers)
    assert len(solo_2026.json()) == 2

    solo_fiesta_2026 = await client.get(
        "/plan-fitosanitario/", params={"temporada": 2026, "variedad": "fiesta"}, headers=headers,
    )
    assert len(solo_fiesta_2026.json()) == 1


async def test_encargado_puede_leer_pero_no_crear_ni_borrar(client, create_user, create_insumo):
    headers_ger = await _auth(client, create_user, role=UserRole.gerencial)
    insumo = await create_insumo()
    creado = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026, "variedades": ["flame"], "numero_aplicacion": 1,
            "mes": 10, "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.0,
        },
        headers=headers_ger,
    )
    plan_id = creado.json()[0]["id"]

    await create_user(email="encargado@test.com", password="Password123!", role=UserRole.encargado)
    login = await client.post(
        "/auth/login", data={"username": "encargado@test.com", "password": "Password123!"},
    )
    headers_enc = {"Authorization": f"Bearer {login.json()['access_token']}"}

    lectura = await client.get("/plan-fitosanitario/", params={"temporada": 2026}, headers=headers_enc)
    assert lectura.status_code == 200
    assert len(lectura.json()) == 1

    rechazo_crear = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026, "variedades": ["fiesta"], "numero_aplicacion": 1,
            "mes": 10, "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.0,
        },
        headers=headers_enc,
    )
    assert rechazo_crear.status_code == 403

    rechazo_borrar = await client.delete(f"/plan-fitosanitario/{plan_id}", headers=headers_enc)
    assert rechazo_borrar.status_code == 403


async def test_borrar_plan(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo()
    creado = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026, "variedades": ["flame"], "numero_aplicacion": 1,
            "mes": 10, "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.0,
        },
        headers=headers,
    )
    plan_id = creado.json()[0]["id"]

    borrar = await client.delete(f"/plan-fitosanitario/{plan_id}", headers=headers)
    assert borrar.status_code == 204

    listado = await client.get("/plan-fitosanitario/", params={"temporada": 2026}, headers=headers)
    assert listado.json() == []
