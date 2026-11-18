"""Anulación de remitos de pasa (POST /remitos/{id}/anular): soft-cancel que
repone el saldo del lote, libera los bines y deja de contar en saldos."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.models.parcela import TipoParcela, VariedadUva
from app.models.user import UserRole
from app.services.alta_produccion import saldo_cosecha

MOTIVO = "Remito cargado por error"


async def _login(client, create_user, role: UserRole, email: str):
    await create_user(email=email, password="Password123!", role=role)
    resp = await client.post("/auth/login", data={"username": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _admin(client, create_user):
    return await _login(client, create_user, UserRole.super_admin, "admin@test.com")


async def _comprador(client, headers, nombre="Pasera del Sur"):
    resp = await client.post("/alta-produccion/compradores", json={"nombre": nombre}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _lote_con_bines(client, headers, pasero_id, pesos=("400", "300", "350")):
    kg = str(sum(Decimal(p) for p in pesos) * 4)
    resp = await client.post(
        "/pasero/ingresos",
        json={"fecha": "2026-02-10", "pasero_id": pasero_id, "variedad": "sultanina",
              "kg_real": kg, "carros": 1},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}, headers=headers
    )).json()
    for peso in pesos:
        r = await client.post(
            f"/lotes-pasa/{lote['id']}/bines", json={"pasero_id": pasero_id, "kg_real": peso}, headers=headers
        )
        assert r.status_code == 201, r.text
    assert (await client.post(f"/lotes-pasa/{lote['id']}/cerrar", headers=headers)).status_code == 200
    return (await client.get(f"/lotes-pasa/{lote['id']}", headers=headers)).json()


def _entrega(comprador, *bin_ids):
    return {"tipo": "entrega_pasa", "fecha": "2026-04-01", "comprador_id": comprador,
            "lineas": [{"bin_id": b} for b in bin_ids]}


async def _saldo_lote(client, headers, lote_id) -> Decimal:
    return Decimal((await client.get(f"/lotes-pasa/{lote_id}", headers=headers)).json()["saldo_kg"])


async def _despachar(client, headers, parcela_id, para, comprador_id, kg="1000", **extra):
    body = {"fecha": "2026-02-06", "para": para, "parcela_id": parcela_id, **extra}
    if para == "pasero":
        body["pasero_id"] = extra["pasero_id"]  # propio -> pasero is weighed gross, no kg_total
    else:
        body.update(kg_total=kg, comprador_id=comprador_id)
    resp = await client.post("/produccion/cosecha/despacho", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _anular(client, headers, remito_id, motivo=MOTIVO):
    return await client.post(f"/remitos/{remito_id}/anular", json={"motivo": motivo}, headers=headers)


async def test_anular_entrega_repone_saldo_y_libera_los_bines(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_con_bines(client, h, pasero.id)
    comprador = await _comprador(client, h)
    b1, b2, _b3 = lote["bines"]
    antes = await _saldo_lote(client, h, lote["id"])

    remito = (await client.post("/remitos/", json=_entrega(comprador, b1["id"], b2["id"]), headers=h)).json()
    assert await _saldo_lote(client, h, lote["id"]) == antes - Decimal("700")

    resp = await _anular(client, h, remito["id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["anulado"] is True
    assert body["motivo_anulacion"] == MOTIVO
    assert body["anulado_at"] is not None
    assert await _saldo_lote(client, h, lote["id"]) == antes

    # Los bines vuelven a estar disponibles.
    detalle = (await client.get(f"/lotes-pasa/{lote['id']}", headers=h)).json()
    assert [b["entregado"] for b in detalle["bines"]] == [False, False, False]
    otra = await client.post("/remitos/", json=_entrega(comprador, b1["id"], b2["id"]), headers=h)
    assert otra.status_code == 201, otra.text


async def test_bin_de_remito_vigente_sigue_dando_409(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_con_bines(client, h, pasero.id)
    comprador = await _comprador(client, h)
    b1 = lote["bines"][0]
    assert (await client.post("/remitos/", json=_entrega(comprador, b1["id"]), headers=h)).status_code == 201
    dup = await client.post("/remitos/", json=_entrega(comprador, b1["id"]), headers=h)
    assert dup.status_code == 409


async def test_anulado_no_cuenta_en_entregas_del_lote_pero_se_lista(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_con_bines(client, h, pasero.id)
    comprador = await _comprador(client, h)
    b1 = lote["bines"][0]
    remito = (await client.post("/remitos/", json=_entrega(comprador, b1["id"]), headers=h)).json()
    assert (await _anular(client, h, remito["id"])).status_code == 200

    detalle = (await client.get(f"/lotes-pasa/{lote['id']}", headers=h)).json()
    bin_det = next(b for b in detalle["bines"] if b["id"] == b1["id"])
    assert bin_det["entregado"] is False
    assert bin_det["remito_numero"] is None

    listado = (await client.get("/remitos/", headers=h)).json()
    fila = next(r for r in listado if r["id"] == remito["id"])
    assert fila["anulado"] is True
    assert all(r["anulado"] is False for r in listado if r["id"] != remito["id"])


async def test_anular_fresco_devuelve_saldo_de_la_cosecha(client, create_user, create_parcela, session_factory):
    h = await _admin(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.flame)
    comprador = await _comprador(client, h, "Mercado Central")
    res = await _despachar(client, h, parral.id, "comprador", comprador, kg="500")
    cosecha_id, remito = res["cosecha"]["id"], res["remito"]
    assert remito["numero"] == "FRE-000001"

    from app.models.produccion import RegistroCosecha
    async with session_factory() as s:
        cosecha = await s.get(RegistroCosecha, cosecha_id)
        assert await saldo_cosecha(s, cosecha) == Decimal("0.00")

    resp = await _anular(client, h, remito["id"])
    assert resp.status_code == 200, resp.text
    async with session_factory() as s:
        cosecha = await s.get(RegistroCosecha, cosecha_id)
        assert await saldo_cosecha(s, cosecha) == Decimal("500.00")


async def test_anular_bodega_sin_comprobante_ok_y_con_comprobante_409(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.syrah)
    norte = await _comprador(client, h, "Bodega Norte")
    r1 = (await _despachar(client, h, parral.id, "bodega", norte, kg="1000"))["remito"]
    r2 = (await _despachar(client, h, parral.id, "bodega", norte, kg="2000"))["remito"]
    assert (await client.post(
        f"/remitos/{r2['id']}/comprobante-bodega",
        json={"numero_suv": "SUV-1", "kg_recibidos": "2000"}, headers=h,
    )).status_code == 201

    assert (await _anular(client, h, r2["id"])).status_code == 409
    assert (await _anular(client, h, r1["id"])).status_code == 200

    conc = (await client.get("/remitos/conciliacion-bodega", headers=h)).json()
    assert [f["remito_id"] for f in conc["filas"]] == [r2["id"]]


async def test_traslado_pasero_no_se_anula(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    parral = await create_parcela(nombre="Parral 3", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    res = await _despachar(
        client, h, parral.id, "pasero", None, pasero_id=pasero.id, carros=2, bruto_kg="3800",
    )
    assert res["remito"]["tipo"] == "traslado_pasero"
    assert (await _anular(client, h, res["remito"]["id"])).status_code == 409


async def test_doble_anulacion_409_y_saldo_repuesto_una_vez(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_con_bines(client, h, pasero.id)
    comprador = await _comprador(client, h)
    antes = await _saldo_lote(client, h, lote["id"])
    remito = (await client.post(
        "/remitos/", json=_entrega(comprador, lote["bines"][0]["id"]), headers=h
    )).json()
    assert (await _anular(client, h, remito["id"])).status_code == 200
    assert (await _anular(client, h, remito["id"])).status_code == 409
    assert await _saldo_lote(client, h, lote["id"]) == antes


@pytest.mark.parametrize("motivo", ["abcd", "    ab   ", ""])
async def test_motivo_corto_da_422(client, create_user, create_parcela, motivo):
    h = await _admin(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_con_bines(client, h, pasero.id)
    comprador = await _comprador(client, h)
    remito = (await client.post(
        "/remitos/", json=_entrega(comprador, lote["bines"][0]["id"]), headers=h
    )).json()
    assert (await _anular(client, h, remito["id"], motivo)).status_code == 422


async def test_motivo_demasiado_largo_da_422(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    assert (await _anular(client, h, "no-importa", "x" * 501)).status_code == 422


async def test_remito_inexistente_404(client, create_user):
    h = await _admin(client, create_user)
    assert (await _anular(client, h, "no-existe")).status_code == 404


@pytest.mark.parametrize("role", [UserRole.gerencial, UserRole.encargado, UserRole.regador])
async def test_solo_super_admin_puede_anular(client, create_user, create_parcela, role):
    admin = await _admin(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_con_bines(client, admin, pasero.id)
    comprador = await _comprador(client, admin)
    remito = (await client.post(
        "/remitos/", json=_entrega(comprador, lote["bines"][0]["id"]), headers=admin
    )).json()
    h = await _login(client, create_user, role, f"{role.value}@test.com")
    assert (await _anular(client, h, remito["id"])).status_code == 403
    vigente = (await client.get(f"/remitos/{remito['id']}", headers=admin)).json()
    assert vigente["anulado"] is False


async def test_numero_anulado_se_conserva_y_no_se_reutiliza(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_con_bines(client, h, pasero.id)
    comprador = await _comprador(client, h)
    b1, b2, _ = lote["bines"]
    r1 = (await client.post("/remitos/", json=_entrega(comprador, b1["id"]), headers=h)).json()
    assert r1["numero"] == "PAS-000001"
    assert (await _anular(client, h, r1["id"])).status_code == 200

    r2 = (await client.post("/remitos/", json=_entrega(comprador, b2["id"]), headers=h)).json()
    assert r2["numero"] == "PAS-000002"
    got = (await client.get(f"/remitos/{r1['id']}", headers=h)).json()
    assert got["numero"] == "PAS-000001"
    assert got["anulado"] is True


async def test_comprobante_sobre_bodega_anulado_da_409(client, create_user, create_parcela):
    h = await _admin(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.syrah)
    norte = await _comprador(client, h, "Bodega Norte")
    remito = (await _despachar(client, h, parral.id, "bodega", norte, kg="1000"))["remito"]
    assert (await _anular(client, h, remito["id"])).status_code == 200
    resp = await client.post(
        f"/remitos/{remito['id']}/comprobante-bodega",
        json={"numero_suv": "SUV-9", "kg_recibidos": "1000"}, headers=h,
    )
    assert resp.status_code == 409
