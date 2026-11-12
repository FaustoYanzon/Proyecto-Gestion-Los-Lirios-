"""Maquinaria module: derived machine state, order state machine, role/finca
visibility, payment -> Egreso and offline-idempotent reports.

The Expo push edge is replaced by a recorder (`avisos`); Cloudinary uploads are
replaced by a fake. The exhaustive role x transition matrix is intentionally not
here: it can be generated from `TRANSICIONES` (see the last test for the shape).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.finanzas import ClasificacionEgreso, Egreso, Finca, MonedaTipo, TipoEgreso
from app.models.maquinaria import (
    EstadoOrdenMaquinaria as E,
    GravedadFalla as G,
    PagoMaquinaria,
)
from app.models.user import UserRole
from app.services import maquinaria as svc

PASSWORD = "Password123!"


# ── Fixtures / helpers ────────────────────────────────────────────────────────

@pytest.fixture
def avisos(monkeypatch) -> list[dict]:
    """Records every push the service would send instead of calling Expo."""
    enviados: list[dict] = []

    def fake_notificar(titulo, cuerpo, user_ids=None, data=None, session_factory=None):
        enviados.append({"titulo": titulo, "cuerpo": cuerpo, "user_ids": user_ids, "data": data})

    monkeypatch.setattr(svc, "notificar_tokens", fake_notificar)
    monkeypatch.setattr(svc, "lanzar_aviso", lambda coro: None)
    return enviados


@pytest.fixture
def fake_upload(monkeypatch) -> None:
    async def _upload(raw, content_type, orden_id):
        return f"https://res.cloudinary.com/demo/image/upload/v1/fotos_maquinaria/{orden_id}/x{len(raw)}.jpg"

    monkeypatch.setattr("app.api.maquinaria.upload_foto_maquinaria_orden", _upload)


async def _login(client, create_user, email: str, role: UserRole, finca: Finca = Finca.media_agua):
    user = await create_user(email=email, password=PASSWORD, role=role, finca=finca)
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    return user, {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture
async def ctx(client, create_user, avisos):
    """gerencial + encargado (media_agua) + encargado (caucete) + regador, one machine."""
    ger, h_ger = await _login(client, create_user, "ger@test.com", UserRole.gerencial)
    sup, h_sup = await _login(client, create_user, "sup@test.com", UserRole.super_admin)
    enc, h_enc = await _login(client, create_user, "enc@test.com", UserRole.encargado)
    enc2, h_enc2 = await _login(
        client, create_user, "enc2@test.com", UserRole.encargado, Finca.caucete
    )
    reg, h_reg = await _login(client, create_user, "reg@test.com", UserRole.regador)
    resp = await client.post(
        "/maquinaria/maquinas",
        json={"tipo": "tractor", "marca": "John Deere", "modelo": "5090", "finca": "media_agua"},
        headers=h_ger,
    )
    assert resp.status_code == 201, resp.text
    return SimpleNamespace(
        client=client, ger=ger, sup=sup, enc=enc, enc2=enc2, reg=reg,
        h_ger=h_ger, h_sup=h_sup, h_enc=h_enc, h_enc2=h_enc2, h_reg=h_reg,
        maquina=resp.json(),
    )


async def _reportar(ctx, gravedad: str = "parada", key: str | None = None, headers=None) -> dict:
    payload = {"maquina_id": ctx.maquina["id"], "descripcion": "No arranca", "gravedad": gravedad}
    if key:
        payload["idempotency_key"] = key
    resp = await ctx.client.post(
        "/maquinaria/ordenes", json=payload, headers=headers or ctx.h_enc
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _transicion(ctx, orden_id: str, estado: str, headers=None, nota: str | None = None):
    return await ctx.client.post(
        f"/maquinaria/ordenes/{orden_id}/transicion",
        json={"a_estado": estado, "nota": nota},
        headers=headers or ctx.h_ger,
    )


async def _ok(resp, code: int = 200) -> dict:
    assert resp.status_code == code, resp.text
    return resp.json() if resp.content else {}


async def _hasta_diagnosticada(ctx, orden_id: str) -> None:
    await _ok(await ctx.client.patch(
        f"/maquinaria/ordenes/{orden_id}", json={"taller": "Taller Pepe"}, headers=ctx.h_ger
    ))
    await _ok(await _transicion(ctx, orden_id, "diagnosticada"))


async def _hasta_aprobada(ctx, orden_id: str) -> str:
    await _hasta_diagnosticada(ctx, orden_id)
    orden = await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{orden_id}/presupuestos",
        json={"monto": "150000.50", "detalle": "Cambio de bomba"},
        headers=ctx.h_ger,
    ), 201)
    presupuesto_id = orden["presupuestos"][0]["id"]
    await _ok(await ctx.client.post(
        f"/maquinaria/presupuestos/{presupuesto_id}/resolver",
        json={"aprobar": True}, headers=ctx.h_ger,
    ))
    return presupuesto_id


async def _hasta_lista_retirar(ctx, orden_id: str) -> None:
    await _hasta_aprobada(ctx, orden_id)
    for estado in ("enviada_taller", "en_reparacion", "lista_retirar"):
        await _ok(await _transicion(ctx, orden_id, estado))


async def _estado_maquina(ctx) -> str:
    resp = await ctx.client.get(f"/maquinaria/maquinas/{ctx.maquina['id']}", headers=ctx.h_ger)
    return (await _ok(resp))["estado"]


# ── Derived machine state (A1) ────────────────────────────────────────────────

@pytest.mark.parametrize(
    "ordenes, esperado",
    [
        ([], svc.EstadoMaquina.operativa),
        ([(E.cerrada, G.parada), (E.cancelada, G.parada)], svc.EstadoMaquina.operativa),
        ([(E.reportada, G.sigue_trabajando)], svc.EstadoMaquina.operativa_con_observaciones),
        ([(E.reportada, G.parada)], svc.EstadoMaquina.parada),
        ([(E.presupuesto_aprobado, G.parada)], svc.EstadoMaquina.parada),
        ([(E.enviada_taller, G.sigue_trabajando)], svc.EstadoMaquina.en_taller),
        ([(E.en_reparacion, G.parada)], svc.EstadoMaquina.en_taller),
        ([(E.lista_retirar, G.parada)], svc.EstadoMaquina.en_taller),
        # Already back, waiting for the encargado: never red.
        ([(E.pendiente_validacion, G.parada)], svc.EstadoMaquina.operativa_con_observaciones),
        # Several open orders: the worst wins; taller beats parada beats observaciones.
        ([(E.reportada, G.parada), (E.en_reparacion, G.sigue_trabajando)], svc.EstadoMaquina.en_taller),
        ([(E.reportada, G.sigue_trabajando), (E.diagnosticada, G.parada)], svc.EstadoMaquina.parada),
        ([(E.reportada, G.sigue_trabajando), (E.cerrada, G.parada)], svc.EstadoMaquina.operativa_con_observaciones),
    ],
)
def test_estado_maquina_derivado(ordenes, esperado):
    assert svc.estado_maquina(ordenes) == esperado


def test_dias_fuera_servicio_suma_solo_tramos_parada_o_taller():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def ev(desde, hasta, dias):
        return SimpleNamespace(
            estado_desde=desde, estado_hasta=hasta, created_at=t0 + timedelta(days=dias)
        )

    eventos = [
        ev(E.reportada, E.diagnosticada, 1),
        ev(E.diagnosticada, E.cancelada, 3),
    ]
    # parada: out of service from the report until it is cancelled (3 days).
    assert svc.dias_fuera_servicio(t0, G.parada, eventos, ahora=t0 + timedelta(days=10)) == Decimal("3.0")
    # sigue_trabajando: never out of service before the workshop.
    assert svc.dias_fuera_servicio(t0, G.sigue_trabajando, eventos, ahora=t0 + timedelta(days=10)) == Decimal("0.0")


# ── Happy path ────────────────────────────────────────────────────────────────

async def test_flujo_completo_hasta_cerrada(ctx, avisos):
    assert await _estado_maquina(ctx) == "operativa"
    orden = await _reportar(ctx)
    oid = orden["id"]
    assert orden["estado"] == "reportada"
    assert orden["finca"] == "media_agua"
    assert await _estado_maquina(ctx) == "parada"

    # Report push: gerencial + super_admin, not the reporter.
    assert avisos[-1]["titulo"] == "Falla reportada"
    assert set(avisos[-1]["user_ids"]) == {ctx.ger.id, ctx.sup.id}

    await _hasta_aprobada(ctx, oid)
    assert any(a["titulo"] == "Presupuesto pendiente de aprobación" for a in avisos)

    await _ok(await _transicion(ctx, oid, "enviada_taller"))
    assert await _estado_maquina(ctx) == "en_taller"
    await _ok(await _transicion(ctx, oid, "en_reparacion"))
    await _ok(await _transicion(ctx, oid, "lista_retirar"))
    lista = [a for a in avisos if a["titulo"] == "Máquina lista para retirar"]
    # The actor (ger) is excluded; the other gerencial and the finca's encargado hear about it.
    assert lista and set(lista[-1]["user_ids"]) == {ctx.enc.id, ctx.sup.id}
    # The encargado of ANOTHER finca is never notified.
    assert all(ctx.enc2.id not in a["user_ids"] for a in avisos)

    # lista_retirar -> pendiente_validacion needs the payment first.
    resp = await _transicion(ctx, oid, "pendiente_validacion")
    assert resp.status_code == 409
    await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/pago",
        json={"monto_real": "160000.00", "fecha": "2026-11-10"}, headers=ctx.h_ger,
    ), 201)
    await _ok(await _transicion(ctx, oid, "pendiente_validacion"))
    assert await _estado_maquina(ctx) == "operativa_con_observaciones"

    # Encargado validates -> closed -> machine operative again.
    cerrada = await _ok(await _transicion(ctx, oid, "cerrada", headers=ctx.h_enc))
    assert cerrada["estado"] == "cerrada"
    assert await _estado_maquina(ctx) == "operativa"

    trayecto = [(e["estado_desde"], e["estado_hasta"]) for e in cerrada["eventos"]]
    assert trayecto[0] == (None, "reportada")
    assert trayecto[-1] == ("pendiente_validacion", "cerrada")
    assert len(trayecto) == 9  # creation + 8 transitions


async def test_estado_terminal_no_admite_mas_transiciones(ctx):
    orden = await _reportar(ctx)
    await _ok(await _transicion(ctx, orden["id"], "cancelada", nota="No conviene"))
    resp = await _transicion(ctx, orden["id"], "reportada")
    assert resp.status_code == 409


async def test_diagnosticar_exige_taller(ctx):
    orden = await _reportar(ctx)
    resp = await _transicion(ctx, orden["id"], "diagnosticada")
    assert resp.status_code == 409
    assert "taller" in resp.json()["detail"].lower()


# ── Rejection loop ────────────────────────────────────────────────────────────

async def test_rechazo_vuelve_a_diagnosticada_y_permite_nuevo_presupuesto(ctx):
    orden = await _reportar(ctx)
    oid = orden["id"]
    await _hasta_diagnosticada(ctx, oid)
    det = await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/presupuestos", json={"monto": "500000"}, headers=ctx.h_ger
    ), 201)
    assert det["estado"] == "presupuesto_pendiente"
    pid = det["presupuestos"][0]["id"]

    # Rejection needs a reason.
    resp = await ctx.client.post(
        f"/maquinaria/presupuestos/{pid}/resolver", json={"aprobar": False}, headers=ctx.h_ger
    )
    assert resp.status_code == 400

    await _ok(await ctx.client.post(
        f"/maquinaria/presupuestos/{pid}/resolver",
        json={"aprobar": False, "motivo": "Muy caro"}, headers=ctx.h_ger,
    ))
    det = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{oid}", headers=ctx.h_ger))
    assert det["estado"] == "diagnosticada"
    assert det["presupuestos"][0]["estado"] == "rechazado"
    assert det["presupuestos"][0]["motivo_rechazo"] == "Muy caro"

    # Already resolved: cannot be resolved twice.
    resp = await ctx.client.post(
        f"/maquinaria/presupuestos/{pid}/resolver", json={"aprobar": True}, headers=ctx.h_ger
    )
    assert resp.status_code == 409

    # New budget (another workshop) -> approved -> flow continues.
    det = await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/presupuestos",
        json={"monto": "300000", "taller": "Taller Otro"}, headers=ctx.h_ger,
    ), 201)
    assert len(det["presupuestos"]) == 2
    pid2 = det["presupuestos"][1]["id"]
    await _ok(await ctx.client.post(
        f"/maquinaria/presupuestos/{pid2}/resolver", json={"aprobar": True}, headers=ctx.h_ger
    ))
    det = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{oid}", headers=ctx.h_ger))
    assert det["estado"] == "presupuesto_aprobado"
    assert det["taller"] == "Taller Otro"


async def test_presupuesto_solo_en_orden_diagnosticada(ctx):
    orden = await _reportar(ctx)
    resp = await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/presupuestos", json={"monto": "1000", "taller": "X"},
        headers=ctx.h_ger,
    )
    assert resp.status_code == 409


async def test_transicion_manual_a_presupuesto_aprobado_sin_resolver_falla(ctx):
    orden = await _reportar(ctx)
    await _hasta_diagnosticada(ctx, orden["id"])
    await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/presupuestos", json={"monto": "1000"}, headers=ctx.h_ger
    ), 201)
    resp = await _transicion(ctx, orden["id"], "presupuesto_aprobado")
    assert resp.status_code == 409


# ── Cancel rules ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("hasta_estado", ["reportada", "diagnosticada", "enviada_taller"])
async def test_cancelar_permitido_hasta_enviada_taller(ctx, hasta_estado):
    orden = await _reportar(ctx)
    oid = orden["id"]
    if hasta_estado in ("diagnosticada", "enviada_taller"):
        await _hasta_diagnosticada(ctx, oid)
    if hasta_estado == "enviada_taller":
        await ctx.client.post(
            f"/maquinaria/ordenes/{oid}/presupuestos", json={"monto": "10"}, headers=ctx.h_ger
        )
        det = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{oid}", headers=ctx.h_ger))
        await ctx.client.post(
            f"/maquinaria/presupuestos/{det['presupuestos'][0]['id']}/resolver",
            json={"aprobar": True}, headers=ctx.h_ger,
        )
        await _ok(await _transicion(ctx, oid, "enviada_taller"))
    det = await _ok(await _transicion(ctx, oid, "cancelada", nota="Se vende la máquina"))
    assert det["estado"] == "cancelada"
    assert det["eventos"][-1]["nota"] == "Se vende la máquina"
    assert await _estado_maquina(ctx) == "operativa"


async def test_cancelar_requiere_motivo(ctx):
    orden = await _reportar(ctx)
    resp = await _transicion(ctx, orden["id"], "cancelada")
    assert resp.status_code == 400


async def test_cancelar_no_permitido_desde_en_reparacion(ctx):
    orden = await _reportar(ctx)
    await _hasta_aprobada(ctx, orden["id"])
    await _ok(await _transicion(ctx, orden["id"], "enviada_taller"))
    await _ok(await _transicion(ctx, orden["id"], "en_reparacion"))
    resp = await _transicion(ctx, orden["id"], "cancelada", nota="x")
    assert resp.status_code == 409


async def test_encargado_no_puede_cancelar_ni_gestionar(ctx):
    orden = await _reportar(ctx)
    resp = await _transicion(ctx, orden["id"], "cancelada", headers=ctx.h_enc, nota="x")
    assert resp.status_code == 403
    resp = await _transicion(ctx, orden["id"], "diagnosticada", headers=ctx.h_enc)
    assert resp.status_code == 403


# ── Reopen (A6) ───────────────────────────────────────────────────────────────

async def test_reabrir_desde_pendiente_validacion(ctx, avisos):
    orden = await _reportar(ctx)
    oid = orden["id"]
    await _hasta_lista_retirar(ctx, oid)
    await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/pago", json={"monto_real": "100"}, headers=ctx.h_ger
    ), 201)
    await _ok(await _transicion(ctx, oid, "pendiente_validacion"))

    # Reason is mandatory.
    resp = await _transicion(ctx, oid, "en_reparacion", headers=ctx.h_enc)
    assert resp.status_code == 400

    det = await _ok(await _transicion(
        ctx, oid, "en_reparacion", headers=ctx.h_enc, nota="Sigue perdiendo aceite"
    ))
    assert det["estado"] == "en_reparacion"
    assert det["eventos"][-1]["nota"] == "Sigue perdiendo aceite"
    assert await _estado_maquina(ctx) == "en_taller"
    # The payment is kept, so the next cycle can go straight to validation.
    await _ok(await _transicion(ctx, oid, "lista_retirar"))
    await _ok(await _transicion(ctx, oid, "pendiente_validacion"))


async def test_encargado_de_otra_finca_no_puede_validar(ctx):
    orden = await _reportar(ctx)
    await _hasta_lista_retirar(ctx, orden["id"])
    await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/pago", json={"monto_real": "100"}, headers=ctx.h_ger
    )
    await _ok(await _transicion(ctx, orden["id"], "pendiente_validacion"))
    # Hidden as 404: the order does not exist for that encargado.
    resp = await _transicion(ctx, orden["id"], "cerrada", headers=ctx.h_enc2)
    assert resp.status_code == 404


# ── Roles / finca visibility ──────────────────────────────────────────────────

async def test_regador_no_accede_al_modulo(ctx):
    for path in ("/maquinaria/maquinas", "/maquinaria/ordenes"):
        resp = await ctx.client.get(path, headers=ctx.h_reg)
        assert resp.status_code == 403


async def test_encargado_ve_solo_su_finca(ctx):
    # Second machine in another finca.
    otra = await _ok(await ctx.client.post(
        "/maquinaria/maquinas",
        json={"tipo": "cosechadora", "marca": "Case", "modelo": "X", "finca": "caucete"},
        headers=ctx.h_ger,
    ), 201)
    orden_a = await _reportar(ctx)
    orden_b = await _ok(await ctx.client.post(
        "/maquinaria/ordenes",
        json={"maquina_id": otra["id"], "descripcion": "Ruido", "gravedad": "sigue_trabajando"},
        headers=ctx.h_enc2,
    ), 201)

    mias = await _ok(await ctx.client.get("/maquinaria/maquinas", headers=ctx.h_enc))
    assert [m["id"] for m in mias] == [ctx.maquina["id"]]
    todas = await _ok(await ctx.client.get("/maquinaria/maquinas", headers=ctx.h_ger))
    assert {m["id"] for m in todas} == {ctx.maquina["id"], otra["id"]}
    filtradas = await _ok(await ctx.client.get("/maquinaria/maquinas?finca=caucete", headers=ctx.h_sup))
    assert [m["id"] for m in filtradas] == [otra["id"]]
    por_estado = await _ok(await ctx.client.get("/maquinaria/maquinas?estado=parada", headers=ctx.h_ger))
    assert [m["id"] for m in por_estado] == [ctx.maquina["id"]]

    ordenes_enc = await _ok(await ctx.client.get("/maquinaria/ordenes", headers=ctx.h_enc))
    assert [o["id"] for o in ordenes_enc] == [orden_a["id"]]
    ordenes_ger = await _ok(await ctx.client.get("/maquinaria/ordenes", headers=ctx.h_ger))
    assert {o["id"] for o in ordenes_ger} == {orden_a["id"], orden_b["id"]}

    # Direct access to another finca's machine/order is a 404, not a 403.
    assert (await ctx.client.get(f"/maquinaria/maquinas/{otra['id']}", headers=ctx.h_enc)).status_code == 404
    assert (await ctx.client.get(f"/maquinaria/ordenes/{orden_b['id']}", headers=ctx.h_enc)).status_code == 404
    # ... and an encargado cannot report on a machine of another finca.
    resp = await ctx.client.post(
        "/maquinaria/ordenes",
        json={"maquina_id": otra["id"], "descripcion": "x", "gravedad": "parada"}, headers=ctx.h_enc,
    )
    assert resp.status_code == 404


async def test_alta_y_edicion_de_maquinas_solo_gerencial(ctx):
    body = {"tipo": "tractor", "marca": "X", "modelo": "Y", "finca": "media_agua"}
    assert (await ctx.client.post("/maquinaria/maquinas", json=body, headers=ctx.h_enc)).status_code == 403
    assert (
        await ctx.client.patch(
            f"/maquinaria/maquinas/{ctx.maquina['id']}", json={"marca": "Z"}, headers=ctx.h_enc
        )
    ).status_code == 403


async def test_patch_maquina_solo_cambia_campos_enviados(ctx):
    mid = ctx.maquina["id"]
    await _ok(await ctx.client.patch(
        f"/maquinaria/maquinas/{mid}", json={"anio": 2015, "patente_serie": "AB123"}, headers=ctx.h_ger
    ))
    maq = await _ok(await ctx.client.patch(
        f"/maquinaria/maquinas/{mid}", json={"finca": "caucete"}, headers=ctx.h_ger
    ))
    assert maq["finca"] == "caucete"
    assert maq["anio"] == 2015 and maq["patente_serie"] == "AB123" and maq["marca"] == "John Deere"
    # Moving the machine does not change the finca snapshot of existing orders.


async def test_orden_conserva_finca_snapshot_si_la_maquina_se_traslada(ctx):
    orden = await _reportar(ctx)
    await _ok(await ctx.client.patch(
        f"/maquinaria/maquinas/{ctx.maquina['id']}", json={"finca": "caucete"}, headers=ctx.h_ger
    ))
    det = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{orden['id']}", headers=ctx.h_enc))
    assert det["finca"] == "media_agua"
    assert (await ctx.client.get(f"/maquinaria/ordenes/{orden['id']}", headers=ctx.h_enc2)).status_code == 404


# ── Payment -> Egreso ─────────────────────────────────────────────────────────

async def test_pago_crea_egreso_y_anularlo_lo_borra(ctx, db_session):
    orden = await _reportar(ctx)
    oid = orden["id"]
    await _hasta_lista_retirar(ctx, oid)

    pago = await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/pago",
        json={"monto_real": "160000.25", "fecha": "2026-11-10", "factura_url": "https://x/f.pdf"},
        headers=ctx.h_ger,
    ), 201)
    assert pago["egreso_id"]

    egreso = (await db_session.execute(
        select(Egreso).where(Egreso.fuente == "maquinaria")
    )).scalar_one()
    assert egreso.id == pago["egreso_id"]
    assert egreso.referencia_id == pago["id"]
    assert egreso.tipo == TipoEgreso.repuestos_reparacion
    assert egreso.clasificacion == ClasificacionEgreso.rep_repuestos_maquinaria
    assert egreso.moneda == MonedaTipo.ars
    assert egreso.monto == Decimal("160000.25")
    assert egreso.finca == Finca.media_agua
    assert egreso.created_by == ctx.ger.id

    # Second payment on the same order is rejected.
    resp = await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/pago", json={"monto_real": "1"}, headers=ctx.h_ger
    )
    assert resp.status_code == 409

    resp = await ctx.client.delete(f"/maquinaria/ordenes/{oid}/pago", headers=ctx.h_ger)
    assert resp.status_code == 204
    db_session.expire_all()
    assert (await db_session.execute(select(Egreso).where(Egreso.fuente == "maquinaria"))).first() is None
    assert (await db_session.execute(select(PagoMaquinaria))).first() is None


async def test_pago_solo_en_lista_retirar_y_solo_gerencial(ctx):
    orden = await _reportar(ctx)
    resp = await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/pago", json={"monto_real": "10"}, headers=ctx.h_ger
    )
    assert resp.status_code == 409
    await _hasta_lista_retirar(ctx, orden["id"])
    resp = await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/pago", json={"monto_real": "10"}, headers=ctx.h_enc
    )
    assert resp.status_code == 403
    resp = await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/pago", json={"monto_real": "0"}, headers=ctx.h_ger
    )
    assert resp.status_code == 422


async def test_anular_pago_solo_mientras_lista_retirar(ctx):
    orden = await _reportar(ctx)
    oid = orden["id"]
    await _hasta_lista_retirar(ctx, oid)
    await ctx.client.post(f"/maquinaria/ordenes/{oid}/pago", json={"monto_real": "10"}, headers=ctx.h_ger)
    await _ok(await _transicion(ctx, oid, "pendiente_validacion"))
    resp = await ctx.client.delete(f"/maquinaria/ordenes/{oid}/pago", headers=ctx.h_ger)
    assert resp.status_code == 409


# ── Idempotent report ─────────────────────────────────────────────────────────

async def test_reporte_idempotente_por_body(ctx, avisos):
    key = "11111111-1111-1111-1111-111111111111"
    primero = await _reportar(ctx, key=key)
    segundo = await _reportar(ctx, key=key)
    assert primero["id"] == segundo["id"]
    listado = await _ok(await ctx.client.get("/maquinaria/ordenes", headers=ctx.h_ger))
    assert len(listado) == 1
    assert len(segundo["eventos"]) == 1
    assert len([a for a in avisos if a["titulo"] == "Falla reportada"]) == 1


async def test_reporte_idempotente_por_header(ctx):
    key = "22222222-2222-2222-2222-222222222222"
    payload = {"maquina_id": ctx.maquina["id"], "descripcion": "Pierde aceite", "gravedad": "parada"}
    r1 = await ctx.client.post(
        "/maquinaria/ordenes", json=payload, headers={**ctx.h_enc, "Idempotency-Key": key}
    )
    r2 = await ctx.client.post(
        "/maquinaria/ordenes", json=payload, headers={**ctx.h_enc, "Idempotency-Key": key}
    )
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]


# ── Photos ────────────────────────────────────────────────────────────────────

async def test_fotos_maximo_por_orden_y_borrado(ctx, fake_upload):
    orden = await _reportar(ctx)
    oid = orden["id"]
    ids = []
    for n in range(svc.MAX_FOTOS_REPORTE):
        resp = await ctx.client.post(
            f"/maquinaria/ordenes/{oid}/fotos",
            files={"file": ("f.jpg", b"x" * (n + 1), "image/jpeg")}, headers=ctx.h_enc,
        )
        ids.append((await _ok(resp, 201))["id"])
    resp = await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/fotos",
        files={"file": ("f.jpg", b"xxx", "image/jpeg")}, headers=ctx.h_enc,
    )
    assert resp.status_code == 409

    det = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{oid}", headers=ctx.h_ger))
    assert len(det["fotos"]) == svc.MAX_FOTOS_REPORTE

    # An encargado of another finca can neither see nor delete them.
    resp = await ctx.client.delete(f"/maquinaria/ordenes/{oid}/fotos/{ids[0]}", headers=ctx.h_enc2)
    assert resp.status_code == 404
    resp = await ctx.client.delete(f"/maquinaria/ordenes/{oid}/fotos/{ids[0]}", headers=ctx.h_enc)
    assert resp.status_code == 204
    det = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{oid}", headers=ctx.h_ger))
    assert len(det["fotos"]) == svc.MAX_FOTOS_REPORTE - 1


# ── History ───────────────────────────────────────────────────────────────────

async def test_historial_de_maquina_con_costos(ctx):
    orden = await _reportar(ctx)
    await _hasta_lista_retirar(ctx, orden["id"])
    await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/pago", json={"monto_real": "2500.50"}, headers=ctx.h_ger
    )
    hist = await _ok(await ctx.client.get(
        f"/maquinaria/maquinas/{ctx.maquina['id']}/historial", headers=ctx.h_ger
    ))
    assert Decimal(hist["costo_total"]) == Decimal("2500.50")
    assert len(hist["ordenes"]) == 1
    # Costs are money data: hidden from the encargado.
    hist_enc = await _ok(await ctx.client.get(
        f"/maquinaria/maquinas/{ctx.maquina['id']}/historial", headers=ctx.h_enc
    ))
    assert hist_enc["costo_total"] is None
    assert hist_enc["ordenes"][0]["costo"] is None


# ── Review fixes ──────────────────────────────────────────────────────────────

def _sin_dinero(det: dict) -> None:
    for p in det["presupuestos"]:
        assert p["monto"] is None and p["adjunto_url"] is None
    if det["pago"] is not None:
        assert det["pago"]["monto_real"] is None and det["pago"]["factura_url"] is None


async def test_encargado_nunca_recibe_montos(ctx):
    orden = await _reportar(ctx)
    oid = orden["id"]
    _sin_dinero(orden)  # POST /ordenes
    await _hasta_diagnosticada(ctx, oid)
    await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/presupuestos",
        json={"monto": "999.00", "adjunto_url": "https://x/p.pdf"}, headers=ctx.h_ger,
    ), 201)
    det = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{oid}", headers=ctx.h_enc))
    assert len(det["presupuestos"]) == 1
    _sin_dinero(det)  # GET
    det_g = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{oid}", headers=ctx.h_ger))
    assert Decimal(det_g["presupuestos"][0]["monto"]) == Decimal("999.00")

    pid = det["presupuestos"][0]["id"]
    await _ok(await ctx.client.post(
        f"/maquinaria/presupuestos/{pid}/resolver", json={"aprobar": True}, headers=ctx.h_ger))
    for estado in ("enviada_taller", "en_reparacion", "lista_retirar"):
        await _ok(await _transicion(ctx, oid, estado))
    await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{oid}/pago",
        json={"monto_real": "1234.00", "factura_url": "https://x/f.pdf"}, headers=ctx.h_ger), 201)
    det = await _ok(await ctx.client.get(f"/maquinaria/ordenes/{oid}", headers=ctx.h_enc))
    assert det["pago"] is not None
    _sin_dinero(det)
    await _ok(await _transicion(ctx, oid, "pendiente_validacion"))
    det = await _ok(await _transicion(
        ctx, oid, "en_reparacion", headers=ctx.h_enc, nota="mal"))  # POST transicion
    _sin_dinero(det)


async def test_historial_cross_finca_tras_trasladar_maquina(ctx):
    orden = await _reportar(ctx)  # media_agua snapshot
    await _ok(await _transicion(ctx, orden["id"], "cancelada", nota="x"))
    await _ok(await ctx.client.patch(
        f"/maquinaria/maquinas/{ctx.maquina['id']}", json={"finca": "caucete"}, headers=ctx.h_ger))
    # enc2 (caucete) now sees the machine but not the media_agua history.
    hist = await _ok(await ctx.client.get(
        f"/maquinaria/maquinas/{ctx.maquina['id']}/historial", headers=ctx.h_enc2))
    assert hist["ordenes"] == []
    # enc (media_agua) lost the machine entirely.
    resp = await ctx.client.get(
        f"/maquinaria/maquinas/{ctx.maquina['id']}/historial", headers=ctx.h_enc)
    assert resp.status_code == 404
    hist_g = await _ok(await ctx.client.get(
        f"/maquinaria/maquinas/{ctx.maquina['id']}/historial", headers=ctx.h_ger))
    assert len(hist_g["ordenes"]) == 1


async def test_idempotencia_header_invalido_y_otra_finca(ctx):
    payload = {"maquina_id": ctx.maquina["id"], "descripcion": "x", "gravedad": "parada"}
    for bad in ("", "k" * 37):
        resp = await ctx.client.post(
            "/maquinaria/ordenes", json=payload, headers={**ctx.h_enc, "Idempotency-Key": bad})
        assert resp.status_code == 422
    key = "33333333-3333-3333-3333-333333333333"
    await _reportar(ctx, key=key)
    # Same key from an encargado of another finca: neutral 404, no 409.
    resp = await ctx.client.post(
        "/maquinaria/ordenes", json={**payload, "idempotency_key": key}, headers=ctx.h_enc2)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Máquina no encontrada"


async def test_segundo_presupuesto_pendiente_rechazado(ctx, db_session):
    from sqlalchemy.exc import IntegrityError

    from app.models.maquinaria import EstadoPresupuestoMaquinaria, PresupuestoMaquinaria

    orden = await _reportar(ctx)
    await _hasta_diagnosticada(ctx, orden["id"])
    await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/presupuestos", json={"monto": "10"}, headers=ctx.h_ger), 201)
    # API level: the order is no longer diagnosticada.
    resp = await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/presupuestos", json={"monto": "11"}, headers=ctx.h_ger)
    assert resp.status_code == 409
    # DB level: the partial unique index blocks a second pending budget.
    db_session.add(PresupuestoMaquinaria(
        orden_id=orden["id"], taller="T", monto=Decimal("1"), created_by=ctx.ger.id,
        estado=EstadoPresupuestoMaquinaria.pendiente))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_doble_pago_409(ctx):
    orden = await _reportar(ctx)
    await _hasta_lista_retirar(ctx, orden["id"])
    url = f"/maquinaria/ordenes/{orden['id']}/pago"
    await _ok(await ctx.client.post(url, json={"monto_real": "5"}, headers=ctx.h_ger), 201)
    resp = await ctx.client.post(url, json={"monto_real": "5"}, headers=ctx.h_ger)
    assert resp.status_code == 409


async def test_pago_acepta_origen_y_forma_pago_y_exige_https(ctx, db_session):
    orden = await _reportar(ctx)
    await _hasta_lista_retirar(ctx, orden["id"])
    url = f"/maquinaria/ordenes/{orden['id']}/pago"
    resp = await ctx.client.post(
        url, json={"monto_real": "5", "factura_url": "http://x/f"}, headers=ctx.h_ger)
    assert resp.status_code == 422
    await _ok(await ctx.client.post(
        url, json={"monto_real": "5", "origen": "oficial", "forma_pago": "efectivo"},
        headers=ctx.h_ger), 201)
    egreso = (await db_session.execute(select(Egreso).where(Egreso.fuente == "maquinaria"))).scalar_one()
    assert egreso.origen.value == "oficial" and egreso.forma_pago.value == "efectivo"
    resp = await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/presupuestos",
        json={"monto": "1", "adjunto_url": "ftp://x"}, headers=ctx.h_ger)
    assert resp.status_code == 422


async def test_finanzas_no_edita_ni_borra_egreso_de_maquinaria(ctx):
    orden = await _reportar(ctx)
    await _hasta_lista_retirar(ctx, orden["id"])
    pago = await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/pago", json={"monto_real": "5"}, headers=ctx.h_ger), 201)
    eid = pago["egreso_id"]
    resp = await ctx.client.delete(f"/finanzas/egresos/{eid}", headers=ctx.h_ger)
    assert resp.status_code == 409
    assert "Maquinaria" in resp.json()["detail"]
    resp = await ctx.client.put(
        f"/finanzas/egresos/{eid}", json={"descripcion": "x"}, headers=ctx.h_ger)
    assert resp.status_code == 409


async def test_cancelar_marca_presupuesto_pendiente_como_rechazado(ctx):
    orden = await _reportar(ctx)
    await _hasta_diagnosticada(ctx, orden["id"])
    await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/presupuestos", json={"monto": "10"}, headers=ctx.h_ger), 201)
    det = await _ok(await _transicion(ctx, orden["id"], "cancelada", nota="No va"))
    assert det["presupuestos"][0]["estado"] == "rechazado"
    assert det["presupuestos"][0]["motivo_rechazo"] == "Orden cancelada"


async def test_tractor_id_ciclos_y_validaciones(ctx):
    async def nueva(tipo, **extra):
        return await _ok(await ctx.client.post(
            "/maquinaria/maquinas",
            json={"tipo": tipo, "marca": "M", "modelo": "X", "finca": "media_agua", **extra},
            headers=ctx.h_ger), 201)

    a = ctx.maquina  # tractor
    b = await nueva("tractor")
    impl = await nueva("implemento", tractor_id=a["id"])
    assert impl["tractor_id"] == a["id"]

    # Self reference and non-tractor target.
    for payload, mid in (({"tractor_id": a["id"]}, a["id"]), ({"tractor_id": impl["id"]}, b["id"])):
        resp = await ctx.client.patch(f"/maquinaria/maquinas/{mid}", json=payload, headers=ctx.h_ger)
        assert resp.status_code == 400
    # Cycle a -> b -> a.
    await _ok(await ctx.client.patch(
        f"/maquinaria/maquinas/{a['id']}", json={"tractor_id": b["id"]}, headers=ctx.h_ger))
    resp = await ctx.client.patch(
        f"/maquinaria/maquinas/{b['id']}", json={"tractor_id": a["id"]}, headers=ctx.h_ger)
    assert resp.status_code == 400
    # Cannot stop being a tractor while an implement points to it.
    resp = await ctx.client.patch(
        f"/maquinaria/maquinas/{a['id']}", json={"tipo": "cosechadora"}, headers=ctx.h_ger)
    assert resp.status_code == 409
    # Inactive tractor is not valid.
    await ctx.client.patch(f"/maquinaria/maquinas/{b['id']}", json={"is_active": False}, headers=ctx.h_ger)
    resp = await ctx.client.post(
        "/maquinaria/maquinas",
        json={"tipo": "implemento", "marca": "M", "modelo": "Y", "finca": "media_agua",
              "tractor_id": b["id"]}, headers=ctx.h_ger)
    assert resp.status_code == 400


async def test_no_se_borran_fotos_de_orden_cerrada(ctx, fake_upload):
    orden = await _reportar(ctx)
    foto = await _ok(await ctx.client.post(
        f"/maquinaria/ordenes/{orden['id']}/fotos",
        files={"file": ("f.jpg", b"x", "image/jpeg")}, headers=ctx.h_enc), 201)
    await _ok(await _transicion(ctx, orden["id"], "cancelada", nota="x"))
    resp = await ctx.client.delete(
        f"/maquinaria/ordenes/{orden['id']}/fotos/{foto['id']}", headers=ctx.h_enc)
    assert resp.status_code == 409


async def test_fallo_en_notificacion_no_rompe_la_operacion(ctx, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("expo down")

    monkeypatch.setattr(svc, "notificar_tokens", boom)
    orden = await _reportar(ctx)
    assert orden["estado"] == "reportada"


# ── Transition table shape (base for the generated role x transition matrix) ──

def test_tabla_transiciones_es_consistente():
    pares = [(t.desde, t.hacia) for t in svc.TRANSICIONES]
    assert len(pares) == len(set(pares)), "duplicated transition"
    # Terminal states have no exits; every other state has at least one.
    for estado in E:
        salidas = svc.transiciones_desde(estado)
        assert bool(salidas) == (estado in svc.ESTADOS_ABIERTOS), estado
    # Cancel is allowed exactly up to enviada_taller, with a mandatory reason.
    cancelables = {t.desde for t in svc.TRANSICIONES if t.hacia == E.cancelada}
    assert cancelables == set(svc.ESTADOS_CANCELABLES)
    assert all(t.requiere_nota for t in svc.TRANSICIONES if t.hacia == E.cancelada)
    # Only encargado-level transitions are the two that leave pendiente_validacion.
    nivel_encargado = {(t.desde, t.hacia) for t in svc.TRANSICIONES if t.nivel == svc.NivelRol.encargado}
    assert nivel_encargado == {
        (E.pendiente_validacion, E.cerrada),
        (E.pendiente_validacion, E.en_reparacion),
    }
    # Roles that can never touch a transition (module is encargado+).
    for t in svc.TRANSICIONES:
        assert UserRole.regador not in t.roles_permitidos
        assert UserRole.obrero not in t.roles_permitidos


async def test_eventos_incluyen_nombre_del_usuario(ctx):
    orden = await _reportar(ctx)
    await _hasta_diagnosticada(ctx, orden["id"])
    detalle = await _ok(await ctx.client.get(
        f"/maquinaria/ordenes/{orden['id']}", headers=ctx.h_enc))
    assert len(detalle["eventos"]) == 2
    for evento in detalle["eventos"]:
        assert evento["usuario_nombre"], evento
    # The creation event belongs to the encargado, the diagnosis to the gerencial.
    assert detalle["eventos"][0]["usuario_id"] == ctx.enc.id
    assert detalle["eventos"][1]["usuario_id"] == ctx.ger.id
    assert detalle["eventos"][0]["usuario_nombre"] == ctx.enc.full_name
    assert detalle["eventos"][1]["usuario_nombre"] == ctx.ger.full_name
