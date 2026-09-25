"""Los cheques/echeques se devengan en su vencimiento (f_pago), no cuando se
reciben -- ver Ingreso.fecha_imputacion."""
from __future__ import annotations

from app.models.user import UserRole


async def _auth(client, create_user):
    user = await create_user(email="ger@test.com", password="Password123!", role=UserRole.gerencial)
    resp = await client.post("/auth/login", data={"username": user.email, "password": "Password123!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _ingreso(**overrides):
    base = {
        "fecha": "2026-04-20", "destino": "uva_mesa", "comprador": "ERICK",
        "forma_pago": "cheque", "f_pago": "2026-06-15", "monto": "1000.00",
        "moneda": "ars", "origen": "oficial", "finca": "media_agua",
    }
    return {**base, **overrides}


async def test_cheque_se_imputa_por_vencimiento(client, create_user):
    headers = await _auth(client, create_user)
    resp = await client.post("/finanzas/ingresos/", json=_ingreso(), headers=headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["fecha_imputacion"] == "2026-06-15"

    # Por fecha de cobro cae en abril (campaña 2025/26)...
    por_cobro = await client.get(
        "/finanzas/ingresos/",
        params={"fecha_desde": "2026-05-01", "fecha_hasta": "2027-04-30"},
        headers=headers,
    )
    assert por_cobro.json() == []
    # ...pero se devenga en junio (campaña 2026/27).
    por_imputacion = await client.get(
        "/finanzas/ingresos/",
        params={"fecha_desde": "2026-05-01", "fecha_hasta": "2027-04-30", "por_imputacion": True},
        headers=headers,
    )
    assert len(por_imputacion.json()) == 1


async def test_transferencia_se_imputa_por_fecha(client, create_user):
    headers = await _auth(client, create_user)
    resp = await client.post(
        "/finanzas/ingresos/",
        json=_ingreso(forma_pago="transferencia", f_pago="2026-06-15"),
        headers=headers,
    )
    assert resp.json()["fecha_imputacion"] == "2026-04-20"
