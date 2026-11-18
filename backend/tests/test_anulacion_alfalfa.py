"""Anulación de documentos de alfalfa (POST /alfalfa/documentos/{id}/anular)."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.models.alta_produccion import Comprador
from app.models.parcela import Parcela, TipoParcela
from app.models.user import UserRole

PASSWORD = "Password123!"
MOTIVO = "Documento cargado por error"


async def _login(client, create_user, email: str, role: UserRole) -> dict[str, str]:
    await create_user(email=email, password=PASSWORD, role=role)
    resp = await client.post("/auth/login", data={"username": email, "password": PASSWORD})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture
async def ctx(client, create_user, db_session):
    potrero = Parcela(nombre="Potrero 1", tipo=TipoParcela.potrero)
    comprador = Comprador(nombre="Forrajera del Valle")
    db_session.add_all([potrero, comprador])
    await db_session.commit()
    return {
        "potrero": potrero.id,
        "comprador": comprador.id,
        "h": await _login(client, create_user, "admin@test.com", UserRole.super_admin),
    }


async def _crear(client, ctx, tipo: str, lineas: list[dict]):
    body = {"tipo": tipo, "fecha": "2026-11-17", "lineas": lineas}
    if tipo == "alta":
        body["potrero_id"] = ctx["potrero"]
    else:
        body["comprador_id"] = ctx["comprador"]
    return await client.post("/alfalfa/documentos", json=body, headers=ctx["h"])


async def _stock(client, ctx) -> dict[str, tuple[Decimal, Decimal]]:
    resp = await client.get("/alfalfa/stock", headers=ctx["h"])
    return {s["producto"]: (Decimal(s["unidades"]), Decimal(s["kg"])) for s in resp.json()}


async def _anular(client, ctx, doc_id, motivo=MOTIVO, headers=None):
    return await client.post(
        f"/alfalfa/documentos/{doc_id}/anular", json={"motivo": motivo}, headers=headers or ctx["h"]
    )


FARDO = lambda n: [{"producto": "fardo", "cantidad": str(n)}]  # noqa: E731


async def test_anular_salida_devuelve_unidades_y_kg(client, ctx):
    await _crear(client, ctx, "alta", FARDO(10))
    antes = await _stock(client, ctx)
    salida = (await _crear(client, ctx, "salida", FARDO(4))).json()
    assert (await _stock(client, ctx))["fardo"][0] == Decimal("6")
    resp = await _anular(client, ctx, salida["id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["anulado"] is True and body["motivo_anulacion"] == MOTIVO and body["anulado_at"]
    assert await _stock(client, ctx) == antes


async def test_anular_alta_sin_salidas_baja_el_stock(client, ctx):
    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    assert (await _anular(client, ctx, alta["id"])).status_code == 200
    assert (await _stock(client, ctx))["fardo"] == (Decimal("0"), Decimal("0"))


async def test_anular_alta_con_salida_dependiente_409_sin_cambios(client, ctx):
    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    await _crear(client, ctx, "salida", FARDO(8))
    resp = await _anular(client, ctx, alta["id"])
    assert resp.status_code == 409
    assert "fardo" in resp.json()["detail"] and "-8" in resp.json()["detail"]
    assert (await client.get(f"/alfalfa/documentos/{alta['id']}", headers=ctx["h"])).json()["anulado"] is False
    assert (await _stock(client, ctx))["fardo"][0] == Decimal("2")


async def test_anular_alta_rechaza_si_kg_quedaria_negativo(client, ctx, db_session):
    # Units stay >= 0 but kg would go negative: the salida was valued with a
    # heavier kg_fardo than the alta, so removing the alta leaves kg < 0.
    from sqlalchemy import update

    from app.models.alfalfa import DocumentoAlfalfaLinea, TipoDocumentoAlfalfa  # noqa: F401

    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    await _crear(client, ctx, "alta", FARDO(10))
    salida = (await _crear(client, ctx, "salida", FARDO(5))).json()
    await db_session.execute(
        update(DocumentoAlfalfaLinea)
        .where(DocumentoAlfalfaLinea.documento_id == salida["id"])
        .values(kg=Decimal("100000"))
    )
    await db_session.commit()
    resp = await _anular(client, ctx, alta["id"])
    assert resp.status_code == 409
    assert "fardo" in resp.json()["detail"]


async def test_doble_anulacion_409(client, ctx):
    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    assert (await _anular(client, ctx, alta["id"])).status_code == 200
    assert (await _anular(client, ctx, alta["id"])).status_code == 409


async def test_documento_inexistente_404(client, ctx):
    assert (await _anular(client, ctx, "no-existe")).status_code == 404


@pytest.mark.parametrize("motivo", ["abc", "    ab   ", "x" * 501])
async def test_motivo_invalido_422(client, ctx, motivo):
    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    assert (await _anular(client, ctx, alta["id"], motivo)).status_code == 422


@pytest.mark.parametrize("role", [UserRole.gerencial, UserRole.encargado, UserRole.regador])
async def test_solo_super_admin_403(client, create_user, ctx, role):
    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    h = await _login(client, create_user, f"{role.value}@test.com", role)
    assert (await _anular(client, ctx, alta["id"], headers=h)).status_code == 403


async def test_listado_devuelve_anulados_marcados(client, ctx):
    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    await _anular(client, ctx, alta["id"])
    docs = (await client.get("/alfalfa/documentos", headers=ctx["h"])).json()
    assert [d["anulado"] for d in docs] == [True]
    assert docs[0]["motivo_anulacion"] == MOTIVO


async def test_numeracion_no_reutiliza_numero_anulado(client, ctx):
    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    await _anular(client, ctx, alta["id"])
    otra = (await _crear(client, ctx, "alta", FARDO(1))).json()
    assert alta["numero"] == "ALF-ALT-000001" and otra["numero"] == "ALF-ALT-000002"


async def test_alta_anulada_no_habilita_salidas(client, ctx):
    alta = (await _crear(client, ctx, "alta", FARDO(10))).json()
    await _anular(client, ctx, alta["id"])
    resp = await _crear(client, ctx, "salida", FARDO(1))
    assert resp.status_code == 409
    assert "Stock insuficiente" in resp.json()["detail"]
