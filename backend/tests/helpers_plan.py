"""Shared helpers for plan-coverage tests: build plan rows and orders through
the API and confirm them, so the records carry the same explicit links
(`plan_fitosanitario_id`, `orden_valvula_id`, ...) production code writes.
"""
from __future__ import annotations

from datetime import date, timedelta

from app.models.produccion import RegistroFitosanitario
from app.models.user import UserRole


async def auth(client, create_user, email: str = "ger@test.com") -> tuple[dict[str, str], str]:
    """Log in a gerencial user; returns (headers, user_id)."""
    user = await create_user(email=email, password="Password123!", role=UserRole.gerencial)
    resp = await client.post("/auth/login", data={"username": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, user.id


async def crear_plan(
    client, headers, insumo_id, variedades, numero_aplicacion=1, dosis_por_ha=1.5,
    mes=10, temporada=2026,
) -> dict[str, str]:
    """Create one plan row per variety; returns {variedad: plan_id}."""
    resp = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": temporada, "variedades": variedades,
            "numero_aplicacion": numero_aplicacion, "mes": mes, "insumo_id": insumo_id,
            "objetivo": "Oidio", "dosis_por_ha": dosis_por_ha,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return {fila["variedad"]: fila["id"] for fila in resp.json()}


def linea(insumo_id, dosis=1.5, numero_aplicacion: int | None = 1) -> dict:
    return {
        "insumo_id": insumo_id, "dosis_por_ha": dosis, "dias_carencia": 7,
        "dias_reingreso": 2, "numero_aplicacion": numero_aplicacion,
    }


async def crear_orden(client, headers, lineas, parcela_ids, valvula_ids=None) -> dict:
    body = {
        "temporada": 2026, "objetivo": "Curación", "fecha_planificada": "2026-10-15",
        "lineas": lineas, "parcela_ids": parcela_ids,
    }
    if valvula_ids is not None:
        body["valvula_ids"] = valvula_ids
    resp = await client.post("/ordenes-aplicacion/", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def confirmar_todo(client, headers, orden: dict) -> None:
    """Confirm every valve (or the whole parcel when it has no valves)."""
    for item in orden["parcelas"]:
        if item["valvulas"]:
            for fila in item["valvulas"]:
                resp = await client.post(
                    f"/ordenes-aplicacion/{orden['id']}/valvulas/{fila['id']}/confirmar",
                    json={"resultado": "completa"}, headers=headers,
                )
                assert resp.status_code == 200, resp.text
        else:
            resp = await client.post(
                f"/ordenes-aplicacion/{orden['id']}/parcelas/{item['id']}/confirmar",
                json={}, headers=headers,
            )
            assert resp.status_code == 200, resp.text


async def aplicar(client, headers, lineas, parcela_ids, valvula_ids=None) -> dict:
    orden = await crear_orden(client, headers, lineas, parcela_ids, valvula_ids)
    await confirmar_todo(client, headers, orden)
    return orden


def registro_parcela_entera(
    parcela_id: str, insumo_id: str, plan_id: str | None, created_by: str,
    dosis_por_ha: float = 1.5,
) -> RegistroFitosanitario:
    """A whole-parcel record linked to a plan row with no order behind it
    (what the historical backfill writes for manual records)."""
    hoy = date(2026, 10, 20)
    return RegistroFitosanitario(
        fecha=hoy, parcela_id=parcela_id, producto_nombre="Producto",
        dosis_por_ha=dosis_por_ha, insumo_id=insumo_id, motivo="Oidio",
        dias_carencia=7, dias_reingreso=2,
        fecha_habilitacion_cosecha=hoy + timedelta(days=7),
        fecha_habilitacion_reingreso=hoy + timedelta(days=2),
        responsable="Juan Perez", plan_fitosanitario_id=plan_id, created_by=created_by,
    )
