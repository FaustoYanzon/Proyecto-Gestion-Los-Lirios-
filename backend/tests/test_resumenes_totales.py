"""Tests para los totales calculados en SQL (no sobre la página visible).

Bug real reportado por Fausto (2026-08-18): EgresosTable/TareasTable sumaban
el array de la página cargada (tope de 100 filas del endpoint de listado), no
el total real de lo que matchea el filtro -- daba un número más bajo que el
KPI de Inicio, que sí suma sin límite. Estos endpoints (`/finanzas/egresos/
resumen/por-tipo` y `/produccion/trabajo/resumen/total`) son la fuente
correcta: SUM en SQL sin `.limit()`, con los mismos filtros que la lista.
"""
from __future__ import annotations

from decimal import Decimal

from app.models.user import UserRole


async def _auth(client, create_user, role: UserRole = UserRole.gerencial):
    await create_user(email="gerencial@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "gerencial@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _egreso_payload(**overrides):
    payload = {
        "fecha": "2026-06-01",
        "tipo": "produccion",
        "clasificacion": "fertilizantes",
        "monto": "1000.00",
        "moneda": "ars",
        "origen": "oficial",
        "finca": "media_agua",
        "forma_pago": "efectivo",
    }
    payload.update(overrides)
    return payload


async def test_egresos_resumen_suma_mas_de_100_filas(client, create_user):
    """El total no puede depender de un límite de página -- 120 filas > el
    limit=100 por defecto de GET /finanzas/egresos/."""
    headers = await _auth(client, create_user)
    for _ in range(120):
        resp = await client.post("/finanzas/egresos/", json=_egreso_payload(), headers=headers)
        assert resp.status_code == 201

    listado = await client.get("/finanzas/egresos/", headers=headers)
    assert len(listado.json()) == 100  # confirma el tope de paginación

    resumen = await client.get("/finanzas/egresos/resumen/por-tipo", headers=headers)
    assert resumen.status_code == 200
    total = sum(Decimal(r["total"]) for r in resumen.json())
    assert total == Decimal("120000.00")  # 120 * 1000, no 100 * 1000


async def test_egresos_resumen_respeta_filtro_de_tipo(client, create_user):
    headers = await _auth(client, create_user)
    await client.post("/finanzas/egresos/", json=_egreso_payload(tipo="produccion", clasificacion="fertilizantes", monto="500.00"), headers=headers)
    await client.post("/finanzas/egresos/", json=_egreso_payload(tipo="sueldos_personal", clasificacion="obreros", monto="900.00"), headers=headers)

    resumen = await client.get("/finanzas/egresos/resumen/por-tipo", params={"tipo": "sueldos_personal"}, headers=headers)
    rows = resumen.json()
    assert all(r["tipo"] == "sueldos_personal" for r in rows)
    assert sum(Decimal(r["total"]) for r in rows) == Decimal("900.00")


async def test_egresos_resumen_respeta_filtro_de_origen(client, create_user):
    headers = await _auth(client, create_user)
    await client.post("/finanzas/egresos/", json=_egreso_payload(origen="oficial", monto="300.00"), headers=headers)
    await client.post("/finanzas/egresos/", json=_egreso_payload(origen="no_oficial", monto="700.00"), headers=headers)

    resumen = await client.get("/finanzas/egresos/resumen/por-tipo", params={"origen": "no_oficial"}, headers=headers)
    total = sum(Decimal(r["total"]) for r in resumen.json())
    assert total == Decimal("700.00")


async def test_trabajo_resumen_total_suma_mas_de_100_filas(client, create_user):
    headers = await _auth(client, create_user)
    for i in range(120):
        resp = await client.post(
            "/produccion/trabajo/masivo",
            json={
                "fecha": "2026-06-01",
                "tarea": "Poda",
                "unidad_medida": "dias",
                "precio_unitario": "1000.00",
                "trabajadores": [{"trabajador_nombre": f"Trabajador {i}", "cantidad": "1"}],
            },
            headers=headers,
        )
        assert resp.status_code == 201

    listado = await client.get("/produccion/trabajo/", headers=headers)
    assert len(listado.json()) == 100

    resumen = await client.get("/produccion/trabajo/resumen/total", headers=headers)
    assert resumen.status_code == 200
    data = resumen.json()
    assert data["total_registros"] == 120
    assert Decimal(data["monto_total"]) == Decimal("120000.00")


async def test_trabajo_resumen_total_respeta_filtro_de_fecha(client, create_user):
    headers = await _auth(client, create_user)
    await client.post(
        "/produccion/trabajo/masivo",
        json={
            "fecha": "2026-06-01",
            "tarea": "Poda",
            "unidad_medida": "dias",
            "precio_unitario": "1000.00",
            "trabajadores": [{"trabajador_nombre": "Juan", "cantidad": "1"}],
        },
        headers=headers,
    )
    await client.post(
        "/produccion/trabajo/masivo",
        json={
            "fecha": "2026-07-01",
            "tarea": "Poda",
            "unidad_medida": "dias",
            "precio_unitario": "2000.00",
            "trabajadores": [{"trabajador_nombre": "Ana", "cantidad": "1"}],
        },
        headers=headers,
    )

    resumen = await client.get(
        "/produccion/trabajo/resumen/total",
        params={"fecha_desde": "2026-07-01", "fecha_hasta": "2026-07-31"},
        headers=headers,
    )
    data = resumen.json()
    assert data["total_registros"] == 1
    assert Decimal(data["monto_total"]) == Decimal("2000.00")
