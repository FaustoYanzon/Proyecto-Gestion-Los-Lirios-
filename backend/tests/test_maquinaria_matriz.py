"""Exhaustive role x transition matrix tests for the Maquinaria state machine.

All test cases are derived directly from the declarative `svc.TRANSICIONES`
and `svc.TRANSICIONES_POR_PAR` tables and the `EstadoOrdenMaquinaria` (`E`)
enum, so adding or modifying a transition automatically extends the matrix.
"""
from __future__ import annotations

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.maquinaria import EstadoOrdenMaquinaria as E, OrdenMaquinaria
from app.models.user import UserRole
from app.services import maquinaria as svc
from test_maquinaria import _login, _reportar, _transicion, avisos, ctx  # noqa: F401


def _transition_id(t: svc.Transicion) -> str:
    return f"{t.desde.value}->{t.hacia.value}"


async def _force_state(db_session: AsyncSession, orden_id: str, state: E) -> None:
    """Force an order into `state` directly in the DB without walking the API flow."""
    await db_session.execute(
        update(OrdenMaquinaria).where(OrdenMaquinaria.id == orden_id).values(estado=state)
    )
    await db_session.commit()


@pytest.mark.parametrize("t", svc.TRANSICIONES, ids=_transition_id)
async def test_matriz_rol_por_transicion(
    ctx, db_session: AsyncSession, t: svc.Transicion
) -> None:
    orden = await _reportar(ctx)
    orden_id = orden["id"]
    transition = _transition_id(t)

    same_finca_actors = (
        ("super_admin", UserRole.super_admin, ctx.h_sup),
        ("gerencial", UserRole.gerencial, ctx.h_ger),
        ("encargado", UserRole.encargado, ctx.h_enc),
    )
    for actor_name, role, headers in same_finca_actors:
        await _force_state(db_session, orden_id, t.desde)
        resp = await _transicion(
            ctx, orden_id, t.hacia.value, headers=headers, nota="motivo de prueba"
        )
        if role in t.roles_permitidos:
            assert resp.status_code not in (403, 404), (
                f"{actor_name} on {transition}: expected allowed (200/409), "
                f"got {resp.status_code} ({resp.text})"
            )
            assert resp.status_code in (200, 409), (
                f"{actor_name} on {transition}: expected 200 or 409, "
                f"got {resp.status_code} ({resp.text})"
            )
        else:
            assert resp.status_code == 403, (
                f"{actor_name} on {transition}: expected 403, "
                f"got {resp.status_code} ({resp.text})"
            )

    other_actors = (
        ("encargado_otra_finca", ctx.h_enc2, 404),
        ("regador", ctx.h_reg, 403),
    )
    for actor_name, headers, expected_status in other_actors:
        await _force_state(db_session, orden_id, t.desde)
        resp = await _transicion(
            ctx, orden_id, t.hacia.value, headers=headers, nota="motivo de prueba"
        )
        assert resp.status_code == expected_status, (
            f"{actor_name} on {transition}: expected {expected_status}, "
            f"got {resp.status_code} ({resp.text})"
        )


_UNCONDITIONAL_TRANSITIONS = tuple(
    t
    for t in svc.TRANSICIONES
    if t.precondicion is None and t.nivel in (svc.NivelRol.gerencial, svc.NivelRol.encargado)
)


@pytest.mark.parametrize("t", _UNCONDITIONAL_TRANSITIONS, ids=_transition_id)
async def test_transiciones_sin_precondicion_exitosas(
    ctx, db_session: AsyncSession, t: svc.Transicion
) -> None:
    orden = await _reportar(ctx)
    orden_id = orden["id"]
    await _force_state(db_session, orden_id, t.desde)

    actor_name, headers = (
        ("gerencial", ctx.h_ger)
        if t.nivel == svc.NivelRol.gerencial
        else ("encargado", ctx.h_enc)
    )
    transition = _transition_id(t)
    resp = await _transicion(
        ctx, orden_id, t.hacia.value, headers=headers, nota="motivo de prueba"
    )
    assert resp.status_code == 200, (
        f"{actor_name} on {transition}: expected 200, got {resp.status_code} ({resp.text})"
    )
    body = resp.json()
    assert body["estado"] == t.hacia.value, (
        f"{actor_name} on {transition}: expected state {t.hacia.value}, got {body['estado']}"
    )


async def test_pares_invalidos_dan_409(ctx, db_session: AsyncSession) -> None:
    orden = await _reportar(ctx)
    orden_id = orden["id"]
    failures: list[str] = []

    for desde in E:
        for hacia in E:
            if desde == hacia or (desde, hacia) in svc.TRANSICIONES_POR_PAR:
                continue
            await _force_state(db_session, orden_id, desde)
            resp = await _transicion(
                ctx, orden_id, hacia.value, headers=ctx.h_ger, nota="motivo de prueba"
            )
            if resp.status_code != 409:
                failures.append(f"{desde.value}->{hacia.value}: got {resp.status_code}")

    assert not failures, f"Invalid state pairs did not return 409: {failures}"


async def test_obrero_sin_acceso_al_modulo(ctx, create_user) -> None:
    _, h_obr = await _login(ctx.client, create_user, "obr@test.com", UserRole.obrero)

    resp_get = await ctx.client.get("/maquinaria/maquinas", headers=h_obr)
    assert resp_get.status_code == 403, (
        f"obrero GET /maquinaria/maquinas: expected 403, got {resp_get.status_code}"
    )

    resp_post = await ctx.client.post(
        "/maquinaria/ordenes",
        json={
            "maquina_id": ctx.maquina["id"],
            "descripcion": "No arranca",
            "gravedad": "parada",
        },
        headers=h_obr,
    )
    assert resp_post.status_code == 403, (
        f"obrero POST /maquinaria/ordenes: expected 403, got {resp_post.status_code}"
    )
