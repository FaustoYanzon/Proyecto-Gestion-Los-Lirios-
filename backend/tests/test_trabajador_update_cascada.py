"""Editar el nombre de un Trabajador propaga el cambio a los registros ya
cargados que lo tienen vinculado por trabajador_id/responsable_id --
trabajador_nombre/responsable son texto congelado en cada fila, no un join
en vivo, así que sin esta cascada el historico se queda con el nombre viejo.
"""
from __future__ import annotations

from app.models.user import UserRole


async def _auth(client, create_user, role: UserRole = UserRole.encargado):
    await create_user(email="encargado@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "encargado@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _crear_trabajador(client, headers, nombre: str) -> str:
    resp = await client.post("/trabajadores/", json={"nombre_completo": nombre}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


async def _renombrar(client, headers, trabajador_id: str, nombre_nuevo: str):
    resp = await client.put(
        f"/trabajadores/{trabajador_id}",
        json={"nombre_completo": nombre_nuevo},
        headers=headers,
    )
    assert resp.status_code == 200


async def test_renombrar_trabajador_actualiza_tareas_historicas(client, create_user):
    headers = await _auth(client, create_user)
    trabajador_id = await _crear_trabajador(client, headers, "Oscar Carrizo")

    creado = await client.post(
        "/produccion/trabajo/masivo",
        json={
            "fecha": "2026-08-25",
            "tarea": "Poda",
            "unidad_medida": "dias",
            "precio_unitario": "1000",
            "trabajadores": [
                {"trabajador_nombre": "Oscar Carrizo", "cantidad": "1", "trabajador_id": trabajador_id},
            ],
        },
        headers=headers,
    )
    assert creado.status_code == 201
    registro_id = creado.json()[0]["id"]

    await _renombrar(client, headers, trabajador_id, "Oscar Carrizo Corregido")

    listado = await client.get("/produccion/trabajo/", headers=headers)
    fila = next(r for r in listado.json() if r["id"] == registro_id)
    assert fila["trabajador_nombre"] == "Oscar Carrizo Corregido"


async def test_renombrar_trabajador_actualiza_riego_historico(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    trabajador_id = await _crear_trabajador(client, headers, "Juan Perez")

    creado = await client.post(
        "/produccion/riego/",
        json={
            "fecha": "2026-08-25",
            "parcela_id": parcela.id,
            "cabezal": "C1",
            "valvula": "V1",
            "inicio": "2026-08-25T08:00:00",
            "fin": "2026-08-25T10:00:00",
            "responsable": "Juan Perez",
            "responsable_id": trabajador_id,
        },
        headers=headers,
    )
    assert creado.status_code == 201
    registro_id = creado.json()["id"]

    await _renombrar(client, headers, trabajador_id, "Juan Perez Corregido")

    obtenido = await client.get(f"/produccion/riego/?parcela_id={parcela.id}", headers=headers)
    fila = next(r for r in obtenido.json() if r["id"] == registro_id)
    assert fila["responsable"] == "Juan Perez Corregido"


async def test_renombrar_trabajador_actualiza_fitosanitario_historico(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    trabajador_id = await _crear_trabajador(client, headers, "Maria Lopez")

    creado = await client.post(
        "/produccion/fitosanitarios/",
        json={
            "fecha": "2026-08-25",
            "parcela_id": parcela.id,
            "producto_nombre": "Cobre",
            "dosis_lt_ha": 1.5,
            "motivo": "Preventivo",
            "dias_carencia": 7,
            "dias_reingreso": 2,
            "responsable": "Maria Lopez",
            "responsable_id": trabajador_id,
        },
        headers=headers,
    )
    assert creado.status_code == 201
    registro_id = creado.json()["id"]

    await _renombrar(client, headers, trabajador_id, "Maria Lopez Corregida")

    listado = await client.get("/produccion/fitosanitarios/", headers=headers)
    fila = next(r for r in listado.json() if r["id"] == registro_id)
    assert fila["responsable"] == "Maria Lopez Corregida"


async def test_renombrar_trabajador_sin_tocar_nombre_no_reescribe_historico(client, create_user):
    headers = await _auth(client, create_user)
    trabajador_id = await _crear_trabajador(client, headers, "Ana Gomez")

    creado = await client.post(
        "/produccion/trabajo/masivo",
        json={
            "fecha": "2026-08-25",
            "tarea": "Riego",
            "unidad_medida": "dias",
            "precio_unitario": "500",
            "trabajadores": [
                {"trabajador_nombre": "Ana Gomez", "cantidad": "1", "trabajador_id": trabajador_id},
            ],
        },
        headers=headers,
    )
    registro_id = creado.json()[0]["id"]

    # Update que no toca nombre_completo -- no debe disparar la cascada ni romper nada.
    resp = await client.put(
        f"/trabajadores/{trabajador_id}",
        json={"telefono": "1122334455"},
        headers=headers,
    )
    assert resp.status_code == 200

    listado = await client.get("/produccion/trabajo/", headers=headers)
    fila = next(r for r in listado.json() if r["id"] == registro_id)
    assert fila["trabajador_nombre"] == "Ana Gomez"
