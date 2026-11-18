"""Manual egreso of insumos varios (free-text destino) and idempotent stock movements."""
from __future__ import annotations

from app.models.insumo import TipoInsumo
from app.models.user import UserRole


async def _auth(client, create_user, role: UserRole = UserRole.encargado):
    await create_user(email="encargado@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "encargado@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _stock(client, headers, insumo_id: str) -> float:
    resp = await client.get(f"/insumos/{insumo_id}", headers=headers)
    return float(resp.json()["stock_actual"])


def _egreso(cantidad="30", **extra):
    body = {"tipo": "egreso", "cantidad": cantidad, "fecha": "2026-11-18", "destino": "Tractor John Deere"}
    body.update(extra)
    return body


async def test_egreso_resta_stock_y_guarda_destino(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Gasoil", stock_actual=100.0, tipo=TipoInsumo.vario)

    resp = await client.post(f"/insumos/{insumo.id}/movimientos", json=_egreso("30"), headers=headers)

    assert resp.status_code == 201
    assert resp.json()["destino"] == "Tractor John Deere"
    assert await _stock(client, headers, insumo.id) == 70.0


async def test_egreso_stock_puede_quedar_negativo(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Aceite", stock_actual=10.0, tipo=TipoInsumo.vario)

    resp = await client.post(f"/insumos/{insumo.id}/movimientos", json=_egreso("25"), headers=headers)

    assert resp.status_code == 201
    assert await _stock(client, headers, insumo.id) == -15.0


async def test_egreso_sin_destino_o_en_blanco_422(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Grasa", stock_actual=50.0, tipo=TipoInsumo.vario)

    sin = _egreso("5")
    del sin["destino"]
    r1 = await client.post(f"/insumos/{insumo.id}/movimientos", json=sin, headers=headers)
    r2 = await client.post(f"/insumos/{insumo.id}/movimientos", json=_egreso("5", destino="   "), headers=headers)

    assert r1.status_code == 422
    assert r2.status_code == 422
    assert await _stock(client, headers, insumo.id) == 50.0


async def test_egreso_de_fitosanitario_422(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre", stock_actual=50.0, tipo=TipoInsumo.fitosanitario)

    resp = await client.post(f"/insumos/{insumo.id}/movimientos", json=_egreso("5"), headers=headers)

    assert resp.status_code == 422
    assert "aplicación" in resp.json()["detail"]
    assert await _stock(client, headers, insumo.id) == 50.0


async def test_egreso_regador_403(client, create_user, create_insumo):
    headers = await _auth(client, create_user, role=UserRole.regador)
    insumo = await create_insumo(nombre="Nafta", stock_actual=50.0, tipo=TipoInsumo.vario)

    resp = await client.post(f"/insumos/{insumo.id}/movimientos", json=_egreso("5"), headers=headers)

    assert resp.status_code == 403


async def test_egreso_idempotente_no_resta_dos_veces(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Gasoil 2", stock_actual=100.0, tipo=TipoInsumo.vario)
    body = _egreso("40", idempotency_key="key-egreso-1")

    first = await client.post(f"/insumos/{insumo.id}/movimientos", json=body, headers=headers)
    second = await client.post(f"/insumos/{insumo.id}/movimientos", json=body, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert await _stock(client, headers, insumo.id) == 60.0


async def test_ingreso_idempotente_no_suma_dos_veces(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Cobre 2", stock_actual=10.0)
    body = {"tipo": "ingreso", "cantidad": "5", "fecha": "2026-11-18", "idempotency_key": "key-ingreso-1"}

    first = await client.post(f"/insumos/{insumo.id}/movimientos", json=body, headers=headers)
    second = await client.post(f"/insumos/{insumo.id}/movimientos", json=body, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 200
    assert await _stock(client, headers, insumo.id) == 15.0


async def test_ingreso_sin_clave_sigue_funcionando(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Cobre 3", stock_actual=10.0)

    resp = await client.post(
        f"/insumos/{insumo.id}/movimientos",
        json={"tipo": "ingreso", "cantidad": "5", "fecha": "2026-11-18"},
        headers=headers,
    )

    assert resp.status_code == 201
    assert await _stock(client, headers, insumo.id) == 15.0


async def test_destino_se_ignora_en_ingreso(client, create_user, create_insumo):
    headers = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Cobre 4", stock_actual=10.0)

    resp = await client.post(
        f"/insumos/{insumo.id}/movimientos",
        json={"tipo": "ingreso", "cantidad": "5", "fecha": "2026-11-18", "destino": "Tractor"},
        headers=headers,
    )

    assert resp.status_code == 201
    assert resp.json()["destino"] is None
