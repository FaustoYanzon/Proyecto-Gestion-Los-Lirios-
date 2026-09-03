"""Trazabilidad Fase 3 -- enlace publico (QR, sin login).

Cubre: permisos de gestion (gerencial+), ciclo crear/listar/revocar, la vista
publica por token (valido / inexistente / revocado -> 404) y -- el punto
sensible de la feature -- que la vista publica y el PDF publico NUNCA expongan
`responsable` (riego/fito) ni `comprador` (cosecha). El chequeo es defensivo:
no "no aparece en este fixture" sino "la clave no existe en ningun nivel del
JSON serializado".
"""
from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader

from app.models.user import UserRole

DESDE = "2026-05-01"
HASTA = "2027-04-30"

REGADOR_SECRETO = "Regador Interno Secreto"
APLICADOR_SECRETO = "Aplicador Interno Secreto"
COMPRADOR_SECRETO = "Bodega Comercial Secreta SA"


async def _login(client, create_user, *, email: str, role: UserRole) -> dict:
    await create_user(email=email, password="Password123!", role=role)
    resp = await client.post(
        "/auth/login", data={"username": email, "password": "Password123!"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _sembrar_historial(client, headers, parcela_id: str) -> None:
    """Un riego, una aplicacion fitosanitaria y una cosecha dentro del rango,
    cada uno con un dato interno (responsable / comprador) que la vista publica
    tiene que ocultar."""
    r = await client.post(
        "/produccion/riego/",
        json={
            "fecha": "2026-06-15",
            "parcela_id": parcela_id,
            "cabezal": "C1",
            "valvula": "V1",
            "inicio": "2026-06-15T08:00:00",
            "fin": "2026-06-15T11:00:00",
            "responsable": REGADOR_SECRETO,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text

    f = await client.post(
        "/produccion/fitosanitarios/",
        json={
            "fecha": "2026-09-10",
            "parcela_id": parcela_id,
            "producto_nombre": "Azufre",
            "dosis_lt_ha": 2.0,
            "motivo": "Preventivo",
            "dias_carencia": 14,
            "dias_reingreso": 3,
            "responsable": APLICADOR_SECRETO,
        },
        headers=headers,
    )
    assert f.status_code == 201, f.text

    c = await client.post(
        "/produccion/cosecha/",
        json={
            "fecha": "2027-03-01",
            "parcela_id": parcela_id,
            "destino": "BODEGA",
            "comprador": COMPRADOR_SECRETO,
            "kg_total": 12000,
        },
        headers=headers,
    )
    assert c.status_code == 201, c.text


async def _crear_enlace(client, headers, parcela_id: str, *, desde=DESDE, hasta=HASTA) -> dict:
    resp = await client.post(
        f"/trazabilidad/parcela/{parcela_id}/enlaces",
        json={"desde": desde, "hasta": hasta},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _todas_las_claves(obj) -> set[str]:
    claves: set[str] = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            claves.add(k)
            claves |= _todas_las_claves(v)
    elif isinstance(obj, list):
        for item in obj:
            claves |= _todas_las_claves(item)
    return claves


# ── Permisos de gestion ─────────────────────────────────────────────────────

async def test_crear_enlace_prohibido_para_roles_menores(client, create_user, create_parcela):
    parcela = await create_parcela()
    for role in (UserRole.encargado, UserRole.regador, UserRole.obrero):
        headers = await _login(client, create_user, email=f"{role.value}@test.com", role=role)
        resp = await client.post(
            f"/trazabilidad/parcela/{parcela.id}/enlaces",
            json={"desde": DESDE, "hasta": HASTA},
            headers=headers,
        )
        assert resp.status_code == 403, f"{role.value}: {resp.status_code}"


async def test_gerencial_puede_crear_listar_y_revocar(client, create_user, create_parcela):
    parcela = await create_parcela()
    headers = await _login(client, create_user, email="ger@test.com", role=UserRole.gerencial)

    enlace = await _crear_enlace(client, headers, parcela.id)
    assert enlace["activo"] is True
    assert enlace["revoked_at"] is None
    assert enlace["token"]

    lista = await client.get(
        f"/trazabilidad/parcela/{parcela.id}/enlaces", headers=headers,
    )
    assert lista.status_code == 200
    assert [e["id"] for e in lista.json()] == [enlace["id"]]

    rev = await client.post(
        f"/trazabilidad/enlaces/{enlace['id']}/revocar", headers=headers,
    )
    assert rev.status_code == 200
    assert rev.json()["activo"] is False
    assert rev.json()["revoked_at"] is not None


async def test_revocar_enlace_inexistente_da_404(client, create_user, create_parcela):
    headers = await _login(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    resp = await client.post("/trazabilidad/enlaces/no-existe/revocar", headers=headers)
    assert resp.status_code == 404


# ── Vista publica: acceso por token ─────────────────────────────────────────

async def test_publica_token_valido_devuelve_historial(client, create_user, create_parcela):
    parcela = await create_parcela(nombre="Parral 12")
    headers = await _login(client, create_user, email="admin@test.com", role=UserRole.super_admin)
    await _sembrar_historial(client, headers, parcela.id)
    enlace = await _crear_enlace(client, headers, parcela.id)

    resp = await client.get(f"/trazabilidad/publica/{enlace['token']}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["parcela_nombre"] == "Parral 12"
    assert body["desde"] == DESDE and body["hasta"] == HASTA
    assert len(body["fitosanitarios"]) == 1
    assert body["fitosanitarios"][0]["estado_compliance"] in {"cumplido", "incumplido", "pendiente"}
    assert body["resumen"]["kg_total"] == 12000
    assert body["empresa"]["razon_social"]


async def test_publica_token_inexistente_da_404(client):
    resp = await client.get("/trazabilidad/publica/token-que-no-existe")
    assert resp.status_code == 404


async def test_publica_token_revocado_da_404(client, create_user, create_parcela):
    parcela = await create_parcela()
    headers = await _login(client, create_user, email="ger@test.com", role=UserRole.gerencial)
    enlace = await _crear_enlace(client, headers, parcela.id)

    await client.post(f"/trazabilidad/enlaces/{enlace['id']}/revocar", headers=headers)

    resp = await client.get(f"/trazabilidad/publica/{enlace['token']}")
    assert resp.status_code == 404


# ── Curacion: nunca exponer responsable / comprador ─────────────────────────

async def test_publica_json_no_expone_datos_internos(client, create_user, create_parcela):
    parcela = await create_parcela()
    headers = await _login(client, create_user, email="admin@test.com", role=UserRole.super_admin)
    await _sembrar_historial(client, headers, parcela.id)
    enlace = await _crear_enlace(client, headers, parcela.id)

    resp = await client.get(f"/trazabilidad/publica/{enlace['token']}")
    assert resp.status_code == 200

    claves = _todas_las_claves(resp.json())
    for prohibida in ("responsable", "responsable_id", "comprador", "trabajador_id", "created_by"):
        assert prohibida not in claves, f"la clave {prohibida!r} no debe estar en la vista publica"

    # y tampoco los valores, aunque cambie el nombre de la clave a futuro
    assert REGADOR_SECRETO not in resp.text
    assert APLICADOR_SECRETO not in resp.text
    assert COMPRADOR_SECRETO not in resp.text


async def test_pdf_publico_es_pdf_y_no_expone_datos_internos(client, create_user, create_parcela):
    parcela = await create_parcela()
    headers = await _login(client, create_user, email="admin@test.com", role=UserRole.super_admin)
    await _sembrar_historial(client, headers, parcela.id)
    enlace = await _crear_enlace(client, headers, parcela.id)

    resp = await client.get(f"/trazabilidad/publica/{enlace['token']}/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"

    texto = "".join(page.extract_text() for page in PdfReader(BytesIO(resp.content)).pages)
    assert REGADOR_SECRETO not in texto
    assert APLICADOR_SECRETO not in texto
    assert COMPRADOR_SECRETO not in texto


# ── QR auto-embebido en la carta interna ───────────────────────────────────

async def test_carta_interna_incluye_url_publica_si_hay_enlace_activo(client, create_user, create_parcela):
    parcela = await create_parcela()
    headers = await _login(client, create_user, email="admin@test.com", role=UserRole.super_admin)
    await _sembrar_historial(client, headers, parcela.id)

    sin_enlace = await client.get(
        f"/trazabilidad/parcela/{parcela.id}/carta-pdf",
        params={"desde": DESDE, "hasta": HASTA}, headers=headers,
    )
    assert sin_enlace.status_code == 200
    texto_sin = "".join(p.extract_text() for p in PdfReader(BytesIO(sin_enlace.content)).pages)
    assert "trazabilidad/publica" not in texto_sin.lower()

    enlace = await _crear_enlace(client, headers, parcela.id)

    con_enlace = await client.get(
        f"/trazabilidad/parcela/{parcela.id}/carta-pdf",
        params={"desde": DESDE, "hasta": HASTA}, headers=headers,
    )
    assert con_enlace.status_code == 200
    texto_con = "".join(p.extract_text() for p in PdfReader(BytesIO(con_enlace.content)).pages)
    assert enlace["token"] in texto_con or "trazabilidad/publica" in texto_con.lower()


async def test_carta_interna_ignora_enlace_de_otro_rango(client, create_user, create_parcela):
    parcela = await create_parcela()
    headers = await _login(client, create_user, email="admin@test.com", role=UserRole.super_admin)
    await _sembrar_historial(client, headers, parcela.id)
    # enlace para un rango distinto al que se pide en la carta
    await _crear_enlace(client, headers, parcela.id, desde="2025-05-01", hasta="2026-04-30")

    carta = await client.get(
        f"/trazabilidad/parcela/{parcela.id}/carta-pdf",
        params={"desde": DESDE, "hasta": HASTA}, headers=headers,
    )
    assert carta.status_code == 200
    texto = "".join(p.extract_text() for p in PdfReader(BytesIO(carta.content)).pages)
    assert "trazabilidad/publica" not in texto.lower()
