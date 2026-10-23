"""Push de orden nueva y alerta de revisión (app/core/push.py).

El borde HTTP con Expo es `app.core.push._post_expo`: se reemplaza acá; el resto
(armado de lotes, filtro por usuarios, limpieza de tokens muertos) corre real.
"""
from __future__ import annotations

import httpx
from sqlalchemy import select

from app.core import push
from app.models.finanzas import Finca
from app.models.push_token import PushToken
from app.models.user import UserRole


async def _tokens(session_factory, *pares: tuple[str, str]) -> None:
    async with session_factory() as s:
        for user_id, token in pares:
            s.add(PushToken(user_id=user_id, token=token, platform="android"))
        await s.commit()


async def _tokens_en_db(session_factory) -> set[str]:
    async with session_factory() as s:
        return {t.token for t in (await s.execute(select(PushToken))).scalars().all()}


def _ok(messages):
    return [{"status": "ok", "id": f"t{i}"} for i, _ in enumerate(messages)]


async def test_notificar_tokens_envia_en_lotes(monkeypatch, session_factory):
    lotes: list[list[dict]] = []

    async def fake_post(messages):
        lotes.append(messages)
        return _ok(messages)

    monkeypatch.setattr(push, "_post_expo", fake_post)
    monkeypatch.setattr(push, "BATCH_SIZE", 2)
    await _tokens(session_factory, *[(f"u{i}", f"ExponentPushToken[{i}]") for i in range(5)])

    await push.notificar_tokens("Nueva orden", "Parral 2", session_factory=session_factory)

    assert [len(l) for l in lotes] == [2, 2, 1]
    assert {m["title"] for l in lotes for m in l} == {"Nueva orden"}
    assert {m["body"] for l in lotes for m in l} == {"Parral 2"}


async def test_notificar_tokens_filtra_por_usuarios_y_lista_vacia_no_envia_a_nadie(
    monkeypatch, session_factory,
):
    enviados: list[str] = []

    async def fake_post(messages):
        enviados.extend(m["to"] for m in messages)
        return _ok(messages)

    monkeypatch.setattr(push, "_post_expo", fake_post)
    await _tokens(session_factory, ("u1", "ExponentPushToken[a]"), ("u2", "ExponentPushToken[b]"))

    await push.notificar_tokens("t", "c", user_ids=["u2"], session_factory=session_factory)
    assert enviados == ["ExponentPushToken[b]"]

    enviados.clear()
    await push.notificar_tokens("t", "c", user_ids=[], session_factory=session_factory)
    assert enviados == []


async def test_notificar_tokens_borra_los_tokens_muertos(monkeypatch, session_factory):
    async def fake_post(messages):
        return [
            {"status": "ok", "id": "1"} if m["to"].endswith("[vivo]")
            else {"status": "error", "details": {"error": "DeviceNotRegistered"}}
            for m in messages
        ]

    monkeypatch.setattr(push, "_post_expo", fake_post)
    await _tokens(session_factory, ("u1", "ExponentPushToken[vivo]"), ("u2", "ExponentPushToken[muerto]"))

    await push.notificar_tokens("t", "c", session_factory=session_factory)

    assert await _tokens_en_db(session_factory) == {"ExponentPushToken[vivo]"}


async def test_notificar_tokens_no_propaga_si_expo_falla(monkeypatch, session_factory):
    async def fake_post(messages):
        raise httpx.ConnectError("sin red")

    monkeypatch.setattr(push, "_post_expo", fake_post)
    await _tokens(session_factory, ("u1", "ExponentPushToken[a]"))

    await push.notificar_tokens("t", "c", session_factory=session_factory)  # no levanta

    assert await _tokens_en_db(session_factory) == {"ExponentPushToken[a]"}


# ── Integración con las órdenes ──────────────────────────────────────────────

from tests.test_orden_valvulas import (  # noqa: E402
    _auth, _orden_parral2, _payload_extra, _parral2_con_valvulas, _url,
)


def _recorder(monkeypatch):
    llamadas: list[dict] = []

    async def fake(titulo, cuerpo, user_ids=None, data=None, session_factory=None):
        llamadas.append({"titulo": titulo, "cuerpo": cuerpo, "user_ids": user_ids, "data": data})

    monkeypatch.setattr("app.api.ordenes_aplicacion.notificar_tokens", fake)
    return llamadas


async def test_crear_orden_extra_notifica_a_todos(
    client, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    llamadas = _recorder(monkeypatch)
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela, _v = await _parral2_con_valvulas(create_parcela, create_valvula)

    r = await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [parcela.id]), headers=headers,
    )
    assert r.status_code == 201, r.text

    assert len(llamadas) == 1
    assert llamadas[0]["titulo"].startswith("Nueva orden")
    assert "Azufre" in llamadas[0]["cuerpo"] and "Parral 2" in llamadas[0]["cuerpo"]
    assert llamadas[0]["user_ids"] is None


async def test_crear_orden_desde_plan_notifica_a_todos(
    client, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    llamadas = _recorder(monkeypatch)
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    await _parral2_con_valvulas(create_parcela, create_valvula)
    plan = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026, "variedades": ["flame"], "numero_aplicacion": 1, "mes": 10,
            "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.5,
        },
        headers=headers,
    )
    r = await client.post(
        "/ordenes-aplicacion/desde-plan",
        json={
            "plan_fitosanitario_id": plan.json()[0]["id"], "dias_carencia": 7,
            "dias_reingreso": 2, "fecha_planificada": "2026-10-15",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert len(llamadas) == 1 and llamadas[0]["user_ids"] is None


async def test_confirmar_con_observaciones_avisa_solo_a_encargados_y_superiores(
    client, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    llamadas = _recorder(monkeypatch)
    headers, ger = await _auth(client, create_user)
    _h, enc = await _auth(client, create_user, email="enc@test.com", role=UserRole.encargado)
    _h, reg = await _auth(client, create_user, email="reg@test.com", role=UserRole.regador)
    _h, obr = await _auth(client, create_user, email="obr@test.com", role=UserRole.obrero)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    llamadas.clear()  # la creación de la orden ya notificó a todos

    r = await client.post(
        _url(orden, filas["22"]),
        json={"resultado": "completa", "observaciones": "Alcanzó para la mitad"}, headers=headers,
    )
    assert r.status_code == 200, r.text

    assert len(llamadas) == 1
    assert set(llamadas[0]["user_ids"]) == {ger.id, enc.id}
    assert "Parral 2" in llamadas[0]["cuerpo"] and "22" in llamadas[0]["cuerpo"]
    assert "Alcanzó para la mitad" in llamadas[0]["cuerpo"]


async def test_confirmar_no_aplicada_avisa_y_completa_sin_observaciones_no(
    client, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    llamadas = _recorder(monkeypatch)
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    llamadas.clear()

    await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=headers)
    assert llamadas == []

    await client.post(
        _url(orden, filas["22"]),
        json={"resultado": "no_aplicada", "observaciones": "Se cortó el agua"}, headers=headers,
    )
    assert len(llamadas) == 1
    assert llamadas[0]["titulo"].startswith("Revisar aplicación")


async def test_si_el_push_falla_la_orden_se_crea_igual(
    client, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    async def roto(messages):
        raise httpx.ConnectError("sin red")

    monkeypatch.setattr(push, "_post_expo", roto)
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela, _v = await _parral2_con_valvulas(create_parcela, create_valvula)

    r = await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [parcela.id]), headers=headers,
    )
    assert r.status_code == 201, r.text
