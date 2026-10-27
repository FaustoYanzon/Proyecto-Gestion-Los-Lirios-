"""GET /plan-fitosanitario/rondas-pendientes: the cards the engineer taps to
build an order from the plan.

Spec: docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md
(API, `rondas-pendientes`).
"""
from __future__ import annotations

from app.main import app
from app.models.parcela import VariedadUva
from app.models.user import UserRole
from tests.helpers_plan import aplicar, auth, crear_plan, linea

_TINTOS = ["flame", "syrah", "bonarda"]


async def _rondas(client, headers, temporada: int = 2026) -> list[dict]:
    resp = await client.get(
        "/plan-fitosanitario/rondas-pendientes", params={"temporada": temporada}, headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _cuatro_productos(create_insumo):
    return [await create_insumo(nombre=n) for n in ("Azufre", "Cobre", "Mancozeb", "Vivando")]


def _parcelas(tarjeta: dict) -> dict[str, dict]:
    return {p["id"]: p for v in tarjeta["variedades"] for p in v["parcelas"]}


async def test_agrupa_variedades_con_misma_ronda_y_productos(
    client, create_user, create_parcela, create_insumo,
):
    headers, _ = await auth(client, create_user)
    parcelas = {
        v: await create_parcela(nombre=f"P {v}", variedad=VariedadUva(v), superficie_ha=5.0)
        for v in _TINTOS
    }
    insumos = await _cuatro_productos(create_insumo)
    for insumo in insumos:
        await crear_plan(
            client, headers, insumo.id, _TINTOS, numero_aplicacion=3, mes=11,
            dosis_por_ha=1.5, objetivo="Curación tintos",
        )

    (tarjeta,) = await _rondas(client, headers)
    assert tarjeta["numero_aplicacion"] == 3
    assert tarjeta["objetivo"] == "Curación tintos"
    assert tarjeta["mes"] == 11
    assert sorted(l["insumo_id"] for l in tarjeta["lineas"]) == sorted(i.id for i in insumos)
    assert {l["insumo_nombre"] for l in tarjeta["lineas"]} == {"Azufre", "Cobre", "Mancozeb", "Vivando"}
    assert all(l["dosis_por_ha"] == 1.5 and l["unidad"] == "lt" for l in tarjeta["lineas"])

    variedades = {v["variedad"]: v for v in tarjeta["variedades"]}
    assert set(variedades) == set(_TINTOS)
    for nombre, variedad in variedades.items():
        assert variedad["ha_pendientes"] == 5.0
        (parcela,) = variedad["parcelas"]
        assert parcela == {
            "id": parcelas[nombre].id, "nombre": f"P {nombre}",
            "ha_pendientes": 5.0, "parcial": False,
        }


async def test_dosis_distinta_separa_tarjetas(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    await create_parcela(nombre="P flame", variedad=VariedadUva.flame, superficie_ha=5.0)
    await create_parcela(nombre="P syrah", variedad=VariedadUva.syrah, superficie_ha=4.0)
    azufre = await create_insumo(nombre="Azufre")
    cobre = await create_insumo(nombre="Cobre")
    await crear_plan(client, headers, azufre.id, ["flame", "syrah"], dosis_por_ha=2.0)
    # Same round and products, but Cobre at a different dose per variety.
    await crear_plan(client, headers, cobre.id, ["flame"], dosis_por_ha=1.5)
    await crear_plan(client, headers, cobre.id, ["syrah"], dosis_por_ha=3.0)

    tarjetas = await _rondas(client, headers)
    assert len(tarjetas) == 2
    por_variedad = {t["variedades"][0]["variedad"]: t for t in tarjetas}
    assert set(por_variedad) == {"flame", "syrah"}
    assert all(len(t["variedades"]) == 1 for t in tarjetas)
    dosis_cobre = {
        v: next(l["dosis_por_ha"] for l in t["lineas"] if l["insumo_id"] == cobre.id)
        for v, t in por_variedad.items()
    }
    assert dosis_cobre == {"flame": 1.5, "syrah": 3.0}


async def test_ronda_cubierta_no_aparece(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    parcela = await create_parcela(nombre="P1", variedad=VariedadUva.flame, superficie_ha=5.0)
    azufre = await create_insumo(nombre="Azufre")
    cobre = await create_insumo(nombre="Cobre")
    await crear_plan(client, headers, azufre.id, ["flame"], numero_aplicacion=1)
    await crear_plan(client, headers, cobre.id, ["flame"], numero_aplicacion=1)
    await crear_plan(client, headers, azufre.id, ["flame"], numero_aplicacion=2, mes=12)

    await aplicar(
        client, headers,
        [linea(azufre.id, numero_aplicacion=1), linea(cobre.id, numero_aplicacion=1)],
        [parcela.id],
    )

    (tarjeta,) = await _rondas(client, headers)
    assert tarjeta["numero_aplicacion"] == 2


async def test_parcela_con_una_linea_cubierta_viene_parcial(
    client, create_user, create_parcela, create_insumo,
):
    headers, _ = await auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.flame, superficie_ha=5.0)
    p2 = await create_parcela(nombre="P2", variedad=VariedadUva.flame, superficie_ha=3.0)
    azufre = await create_insumo(nombre="Azufre")
    cobre = await create_insumo(nombre="Cobre")
    await crear_plan(client, headers, azufre.id, ["flame"])
    await crear_plan(client, headers, cobre.id, ["flame"])

    # Only Azufre on P1: Cobre is still pending there, the whole round on P2.
    await aplicar(client, headers, [linea(azufre.id)], [p1.id])

    (tarjeta,) = await _rondas(client, headers)
    assert {l["insumo_id"] for l in tarjeta["lineas"]} == {azufre.id, cobre.id}
    parcelas = _parcelas(tarjeta)
    assert parcelas[p1.id]["parcial"] is True
    assert parcelas[p1.id]["ha_pendientes"] == 5.0
    assert parcelas[p2.id]["parcial"] is False
    assert parcelas[p2.id]["ha_pendientes"] == 3.0
    assert tarjeta["variedades"][0]["ha_pendientes"] == 8.0


async def test_orden_parcial_deja_pendiente_el_resto(
    client, create_user, create_parcela, create_insumo,
):
    headers, _ = await auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.flame, superficie_ha=5.0)
    p2 = await create_parcela(nombre="P2", variedad=VariedadUva.flame, superficie_ha=3.0)
    insumos = await _cuatro_productos(create_insumo)
    for insumo in insumos:
        await crear_plan(client, headers, insumo.id, ["flame"])

    # An order with 3 of the 4 products on both parcels.
    await aplicar(client, headers, [linea(i.id) for i in insumos[:3]], [p1.id, p2.id])

    (tarjeta,) = await _rondas(client, headers)
    assert [l["insumo_id"] for l in tarjeta["lineas"]] == [insumos[3].id]
    parcelas = _parcelas(tarjeta)
    # Relative to the lines still on the card, both parcels are fully pending.
    assert parcelas[p1.id]["parcial"] is False
    assert parcelas[p2.id]["parcial"] is False
    assert tarjeta["variedades"][0]["ha_pendientes"] == 8.0


async def test_parcela_cubierta_se_omite_y_variedad_cubierta_sale(
    client, create_user, create_parcela, create_insumo,
):
    headers, _ = await auth(client, create_user)
    p1 = await create_parcela(nombre="P1", variedad=VariedadUva.flame, superficie_ha=5.0)
    p2 = await create_parcela(nombre="P2", variedad=VariedadUva.flame, superficie_ha=3.0)
    syrah = await create_parcela(nombre="S1", variedad=VariedadUva.syrah, superficie_ha=4.0)
    azufre = await create_insumo(nombre="Azufre")
    await crear_plan(client, headers, azufre.id, ["flame", "syrah"])

    await aplicar(client, headers, [linea(azufre.id)], [p1.id, syrah.id])

    (tarjeta,) = await _rondas(client, headers)
    assert [v["variedad"] for v in tarjeta["variedades"]] == ["flame"]
    assert list(_parcelas(tarjeta)) == [p2.id]


async def test_orden_por_numero_y_mes(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    await create_parcela(nombre="P1", variedad=VariedadUva.flame, superficie_ha=5.0)
    azufre = await create_insumo(nombre="Azufre")
    cobre = await create_insumo(nombre="Cobre")
    await crear_plan(client, headers, azufre.id, ["flame"], numero_aplicacion=2, mes=12)
    await crear_plan(client, headers, cobre.id, ["flame"], numero_aplicacion=1, mes=11, objetivo="Peronospora")
    await crear_plan(client, headers, azufre.id, ["flame"], numero_aplicacion=1, mes=10)

    tarjetas = await _rondas(client, headers)
    assert [(t["numero_aplicacion"], t["mes"]) for t in tarjetas] == [(1, 10), (1, 11), (2, 12)]


async def test_otra_temporada_no_aparece(client, create_user, create_parcela, create_insumo):
    headers, _ = await auth(client, create_user)
    await create_parcela(nombre="P1", variedad=VariedadUva.flame, superficie_ha=5.0)
    azufre = await create_insumo(nombre="Azufre")
    await crear_plan(client, headers, azufre.id, ["flame"], temporada=2025)

    assert await _rondas(client, headers) == []


async def test_ruta_estatica_no_choca_con_plan_id(client, create_user):
    headers, _ = await auth(client, create_user)
    # Would be 405 if a `/{plan_id}` route captured it first.
    assert await _rondas(client, headers) == []

    rutas = [getattr(r, "path", "") for r in app.routes]
    estatica = rutas.index("/plan-fitosanitario/rondas-pendientes")
    parametrizadas = [i for i, p in enumerate(rutas) if p.startswith("/plan-fitosanitario/{")]
    assert parametrizadas and all(estatica < i for i in parametrizadas)


async def _login(client, create_user, email: str, role: UserRole) -> dict[str, str]:
    await create_user(email=email, password="Password123!", role=role)
    login = await client.post("/auth/login", data={"username": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_requiere_encargado(client, create_user):
    """require_encargado_up, like the other plan reads (it includes regador)."""
    obrero = await _login(client, create_user, "obrero@test.com", UserRole.obrero)
    resp = await client.get(
        "/plan-fitosanitario/rondas-pendientes", params={"temporada": 2026}, headers=obrero,
    )
    assert resp.status_code == 403

    for i, role in enumerate((UserRole.encargado, UserRole.regador)):
        headers = await _login(client, create_user, f"u{i}@test.com", role)
        assert await _rondas(client, headers) == []

    sin_token = await client.get("/plan-fitosanitario/rondas-pendientes", params={"temporada": 2026})
    assert sin_token.status_code == 401
