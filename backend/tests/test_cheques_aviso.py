"""Aviso push de cheques cuya Fecha de Pago (f_pago) ya llegó -- ver
app/core/cheques_aviso.py."""
from __future__ import annotations

from datetime import date, timedelta

from app.core import cheques_aviso
from app.models.user import UserRole


async def _auth(client, create_user):
    user = await create_user(email="ger@test.com", password="Password123!", role=UserRole.gerencial)
    resp = await client.post("/auth/login", data={"username": user.email, "password": "Password123!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    await client.post("/notificaciones/token", json={"token": "ExponentPushToken[ger]"}, headers=headers)
    return headers


def _ingreso(f_pago: date, **kw):
    return {
        "fecha": (f_pago - timedelta(days=30)).isoformat(), "destino": "uva_mesa",
        "comprador": "ERICK", "forma_pago": "cheque", "f_pago": f_pago.isoformat(),
        "monto": "150000.00", "moneda": "ars", "origen": "oficial", "finca": "media_agua", **kw,
    }


def _egreso(f_pago: date):
    return {
        "fecha": (f_pago - timedelta(days=10)).isoformat(), "tipo": "insumos_varios",
        "clasificacion": "insumos_otros", "monto": "50000.00", "moneda": "ars", "origen": "oficial",
        "finca": "media_agua", "forma_pago": "echeque", "f_pago": f_pago.isoformat(),
    }


async def test_avisa_una_sola_vez_cheques_cobrables_y_emitidos(client, create_user, monkeypatch):
    enviados: list[list[dict]] = []

    async def fake_push(messages):
        enviados.append(messages)
        return 200

    monkeypatch.setattr(cheques_aviso, "send_expo_push", fake_push)
    headers = await _auth(client, create_user)
    hoy = date.today()
    await client.post("/finanzas/ingresos/", json=_ingreso(hoy), headers=headers)
    await client.post("/finanzas/ingresos/", json=_ingreso(hoy + timedelta(days=5)), headers=headers)
    # Ya endosado a un tercero: no se avisa como "para cobrar".
    await client.post("/finanzas/ingresos/", json=_ingreso(hoy, uso_cheque="Pago a Ferretería"), headers=headers)
    egreso = await client.post("/finanzas/egresos/", json=_egreso(hoy), headers=headers)
    assert egreso.status_code == 201, egreso.text
    assert egreso.json()["fecha_imputacion"] == hoy.isoformat()

    r = await client.post("/notificaciones/cheques/ejecutar", headers=headers)
    assert r.json() == {"recibidos": 1, "emitidos": 1}
    assert len(enviados) == 1
    cuerpos = [m["body"] for m in enviados[0]]
    assert any("cheque ya se puede cobrar" in c and "ERICK" in c for c in cuerpos)
    assert any("emitido se debita" in c for c in cuerpos)

    # Segunda corrida el mismo día: nada nuevo.
    r2 = await client.post("/notificaciones/cheques/ejecutar", headers=headers)
    assert r2.json() == {"recibidos": 0, "emitidos": 0}
    assert len(enviados) == 1


async def test_cambiar_fecha_de_pago_rearma_el_aviso(client, create_user, monkeypatch):
    async def fake_push(messages):
        return 200

    monkeypatch.setattr(cheques_aviso, "send_expo_push", fake_push)
    headers = await _auth(client, create_user)
    hoy = date.today()
    creado = await client.post("/finanzas/ingresos/", json=_ingreso(hoy), headers=headers)
    await client.post("/notificaciones/cheques/ejecutar", headers=headers)

    # Se reprograma a otra fecha que también ya llegó -> vuelve a avisar.
    await client.put(
        f"/finanzas/ingresos/{creado.json()['id']}",
        json={"f_pago": (hoy - timedelta(days=1)).isoformat()},
        headers=headers,
    )
    r = await client.post("/notificaciones/cheques/ejecutar", headers=headers)
    assert r.json()["recibidos"] == 1
