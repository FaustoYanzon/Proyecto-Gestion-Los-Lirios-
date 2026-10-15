"""Despacho de cosecha ("De -> Para"): POST /produccion/cosecha/despacho crea
cosecha + remito (+ ingreso al pasero) en una transacción, y el remito sale en
PDF (Bearer o link firmado de vida corta)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from io import BytesIO

from pypdf import PdfReader
from sqlalchemy import select

from app.core.security import create_remito_pdf_token
from app.models.alta_produccion import Comprador, IngresoPasero, Remito, RemitoLinea, TipoRemito
from app.models.parcela import TipoParcela, VariedadUva
from app.models.produccion import DestinoCosecha, OrigenCosecha, RegistroCosecha
from app.models.user import User, UserRole
from app.services.alta_produccion import saldo_cosecha

URL = "/produccion/cosecha/despacho"


async def _auth(client, create_user, role: UserRole = UserRole.encargado, email: str = "enc@test.com"):
    await create_user(email=email, password="Password123!", role=role)
    resp = await client.post("/auth/login", data={"username": email, "password": "Password123!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _comprador(client, headers, nombre="Bodega Andina"):
    resp = await client.post("/alta-produccion/compradores", json={"nombre": nombre}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


TARA_CARRO = Decimal("400")  # default del parámetro tara_carro


def _body(**extra):
    base = {"fecha": "2026-02-10", "kg_total": "1500.50"}
    base.update(extra)
    # Propio -> pasero se pesa en la báscula: el servidor resta tara_carro x carros.
    # El helper sigue hablando en kg netos y arma el peso bruto de báscula.
    if base.get("para") == "pasero" and base.get("origen", "propio") == "propio":
        neto = Decimal(str(base.pop("kg_total")))
        if "bruto_kg" not in base:
            base["bruto_kg"] = str(neto + TARA_CARRO * base.get("carros", 1))
    return base


# ── Cada "Para" ─────────────────────────────────────────────────────────────

async def test_despacho_a_bodega(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 7", variedad=VariedadUva.flame)
    comprador_id = await _comprador(client, h)
    resp = await client.post(URL, json=_body(
        para="bodega", parcela_id=parral.id, comprador_id=comprador_id,
        vehiculo_patente="AB123CD", cuadrilla="Los Pérez", n_ciu="CIU-9",
    ), headers=h)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["cosecha"]["destino"] == "BODEGA"
    assert data["cosecha"]["variedad"] == "flame"  # sale del parral
    assert data["cosecha"]["comprador"] == "Bodega Andina"
    assert data["cosecha"]["comprador_id"] == comprador_id
    assert Decimal(data["cosecha"]["saldo_kg"]) == 0
    assert data["remito"]["tipo"] == "salida_bodega"
    assert data["remito"]["numero"] == "BOD-000001"
    assert data["remito"]["comprador_nombre"] == "Bodega Andina"
    assert data["remito"]["pasero_id"] is None
    assert data["cosecha"]["n_remito"] == "BOD-000001"  # se copia el N° del remito
    assert len(data["remito"]["lineas"]) == 1
    assert Decimal(data["remito"]["lineas"][0]["kg"]) == Decimal("1500.50")
    assert data["remito"]["lineas"][0]["cosecha_id"] == data["cosecha"]["id"]
    assert data["ingreso_pasero"] is None


async def test_despacho_a_comprador(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 7", variedad=VariedadUva.fiesta)
    comprador_id = await _comprador(client, h, "Verdulería Sur")
    resp = await client.post(URL, json=_body(
        para="comprador", parcela_id=parral.id, comprador_id=comprador_id, n_remito="0001-00012",
    ), headers=h)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["cosecha"]["destino"] == "MI"
    assert data["remito"]["tipo"] == "salida_fresco"
    assert data["remito"]["numero"] == "FRE-000001"
    assert data["cosecha"]["n_remito"] == "0001-00012"  # el informado no se pisa
    assert Decimal(data["cosecha"]["saldo_kg"]) == 0


async def test_despacho_a_pasero_crea_ingreso_y_remito_tra(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 3", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    resp = await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id, kg_total="3000", carros=2,
    ), headers=h)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["cosecha"]["destino"] == "RAMA_PASA"
    assert data["remito"]["tipo"] == "traslado_pasero"
    assert data["remito"]["numero"] == "TRA-000001"
    assert data["remito"]["comprador_id"] is None
    assert data["remito"]["pasero_id"] == pasero.id
    assert data["remito"]["pasero_nombre"] == "Pasero 1"
    ing = data["ingreso_pasero"]
    assert ing["cosecha_id"] == data["cosecha"]["id"]
    assert ing["pasero_id"] == pasero.id
    assert ing["variedad"] == "sultanina"
    assert ing["origen"] == "propio"
    assert ing["carros"] == 2 and ing["fichas"] == 180  # 2 x 90
    assert Decimal(ing["kg_real"]) == Decimal("3000")  # se pesa una sola vez
    assert Decimal(ing["kg_teorico"]) == Decimal("3240.00")
    # La uva ya está en el pasero: no queda saldo por despachar.
    assert Decimal(data["cosecha"]["saldo_kg"]) == 0


async def test_carro_incompleto_estima_fichas_por_peso(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 3", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    resp = await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id, kg_total="900", carro_incompleto=True,
    ), headers=h)
    assert resp.status_code == 201, resp.text
    assert resp.json()["ingreso_pasero"]["fichas"] == 50  # 900 / 18

    chico = await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id, kg_total="5", carro_incompleto=True,
    ), headers=h)
    assert chico.json()["ingreso_pasero"]["fichas"] == 1  # mínimo 1
    assert chico.json()["remito"]["numero"] == "TRA-000002"


# ── Origen ──────────────────────────────────────────────────────────────────

async def test_tercero_solo_puede_ir_al_pasero(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    comprador_id = await _comprador(client, h)
    productor = (await client.post(
        "/alta-produccion/productores", json={"nombre": "Finca Vecina"}, headers=h
    )).json()
    for para in ("bodega", "comprador"):
        resp = await client.post(URL, json=_body(
            para=para, origen="tercero", productor_id=productor["id"], variedad="flame",
            comprador_id=comprador_id,
        ), headers=h)
        assert resp.status_code == 422, resp.text
        assert "terceros" in resp.json()["detail"]

    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    ok = await client.post(URL, json=_body(
        para="pasero", origen="tercero", productor_id=productor["id"], variedad="flame", pasero_id=pasero.id,
    ), headers=h)
    assert ok.status_code == 201, ok.text
    data = ok.json()
    assert data["cosecha"]["origen"] == "tercero"
    assert data["cosecha"]["productor_id"] == productor["id"]
    assert data["cosecha"]["proveedor_tercero"] == "Finca Vecina"
    assert data["ingreso_pasero"]["productor_id"] == productor["id"]
    assert data["ingreso_pasero"]["origen"] == "tercero"


async def test_tercero_exige_productor_y_variedad(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    sin_productor = await client.post(URL, json=_body(
        para="pasero", origen="tercero", variedad="flame", pasero_id=pasero.id), headers=h)
    assert sin_productor.status_code == 422
    productor = (await client.post(
        "/alta-produccion/productores", json={"nombre": "Finca Vecina"}, headers=h)).json()
    sin_variedad = await client.post(URL, json=_body(
        para="pasero", origen="tercero", productor_id=productor["id"], pasero_id=pasero.id), headers=h)
    assert sin_variedad.status_code == 422


async def test_propio_valida_parral_y_variedad(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    comprador_id = await _comprador(client, h)
    base = dict(para="comprador", comprador_id=comprador_id)

    sin_parcela = await client.post(URL, json=_body(**base), headers=h)
    assert sin_parcela.status_code == 422

    potrero = await create_parcela(nombre="Potrero 1", tipo=TipoParcela.potrero, variedad=VariedadUva.flame)
    assert (await client.post(URL, json=_body(parcela_id=potrero.id, **base), headers=h)).status_code == 422

    sin_variedad = await create_parcela(nombre="Parral X")
    assert (await client.post(URL, json=_body(parcela_id=sin_variedad.id, **base), headers=h)).status_code == 422

    # La variedad del parral se puede sobrescribir.
    ok = await client.post(URL, json=_body(parcela_id=sin_variedad.id, variedad="syrah", **base), headers=h)
    assert ok.status_code == 201, ok.text
    assert ok.json()["cosecha"]["variedad"] == "syrah"

    parral = await create_parcela(nombre="Parral Y", variedad=VariedadUva.flame)
    sobre = await client.post(URL, json=_body(parcela_id=parral.id, variedad="bonarda", **base), headers=h)
    assert sobre.json()["cosecha"]["variedad"] == "bonarda"


async def test_destinatario_inconsistente_es_422(client, create_user, create_parcela, session_factory):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", variedad=VariedadUva.flame)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    comprador_id = await _comprador(client, h)
    assert (await client.post(URL, json=_body(para="comprador", parcela_id=parral.id), headers=h)).status_code == 422
    assert (await client.post(URL, json=_body(para="bodega", parcela_id=parral.id), headers=h)).status_code == 422
    assert (await client.post(URL, json=_body(para="pasero", parcela_id=parral.id), headers=h)).status_code == 422
    # pasero que no es pasero
    assert (await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=parral.id), headers=h)).status_code == 404
    # comprador inexistente
    assert (await client.post(URL, json=_body(
        para="comprador", parcela_id=parral.id, comprador_id="no-existe"), headers=h)).status_code == 404
    # comprador + pasero mezclados
    assert (await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id, comprador_id=comprador_id), headers=h)
    ).status_code == 422
    # Nada de lo anterior dejó restos (todo es transaccional).
    async with session_factory() as s:
        assert (await s.execute(select(RegistroCosecha))).scalars().first() is None
        assert (await s.execute(select(Remito))).scalars().first() is None


# ── Peso ────────────────────────────────────────────────────────────────────

async def test_peso_por_envases_y_por_bruto_tara(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", variedad=VariedadUva.flame)
    comprador_id = await _comprador(client, h)
    base = dict(fecha="2026-02-10", para="comprador", parcela_id=parral.id, comprador_id=comprador_id)

    envases = await client.post(URL, json=dict(
        base, tipo_envase="caja", cantidad_envases="120", peso_unitario_kg="18.5"), headers=h)
    assert envases.status_code == 201, envases.text
    assert Decimal(str(envases.json()["cosecha"]["kg_total"])) == Decimal("2220")

    bruto = await client.post(URL, json=dict(base, bruto_kg="5200", tara_kg="1700"), headers=h)
    assert bruto.status_code == 201, bruto.text
    assert Decimal(str(bruto.json()["cosecha"]["kg_total"])) == Decimal("3500")

    assert (await client.post(URL, json=dict(base), headers=h)).status_code == 422  # sin peso
    tara_mayor = await client.post(URL, json=dict(base, bruto_kg="100", tara_kg="500"), headers=h)
    assert tara_mayor.status_code == 422


# ── Idempotencia ────────────────────────────────────────────────────────────

async def test_idempotencia_no_duplica_nada(client, create_user, create_parcela, session_factory):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 3", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    body = _body(para="pasero", parcela_id=parral.id, pasero_id=pasero.id, idempotency_key="key-123")
    primero = await client.post(URL, json=body, headers=h)
    segundo = await client.post(URL, json=body, headers=h)
    assert primero.status_code == 201 and segundo.status_code == 201
    a, b = primero.json(), segundo.json()
    assert a["cosecha"]["id"] == b["cosecha"]["id"]
    assert a["remito"]["id"] == b["remito"]["id"]
    assert a["ingreso_pasero"]["id"] == b["ingreso_pasero"]["id"]
    async with session_factory() as s:
        assert len((await s.execute(select(RegistroCosecha))).scalars().all()) == 1
        assert len((await s.execute(select(Remito))).scalars().all()) == 1
        assert len((await s.execute(select(IngresoPasero))).scalars().all()) == 1


# ── Saldo ───────────────────────────────────────────────────────────────────

async def test_remito_manual_sobre_cosecha_despachada_no_se_admite(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", variedad=VariedadUva.flame)
    comprador_id = await _comprador(client, h)
    data = (await client.post(URL, json=_body(
        para="comprador", parcela_id=parral.id, comprador_id=comprador_id), headers=h)).json()
    resp = await client.post("/remitos/", json={
        "tipo": "salida_fresco", "fecha": "2026-02-11", "comprador_id": comprador_id,
        "lineas": [{"cosecha_id": data["cosecha"]["id"], "kg": "1"}],
    }, headers=h)
    assert resp.status_code == 422  # el alta manual de FRE/BOD ya no existe


async def test_linea_tra_no_descuenta_saldo(client, create_user, create_parcela, session_factory):
    """Una línea de remito TRA sola (sin ingreso vinculado) no resta saldo,
    mientras que una FRE/BOD sí."""
    await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    parral = await create_parcela(nombre="Parral 1", variedad=VariedadUva.flame)
    async with session_factory() as s:
        user = (await s.execute(select(User))).scalars().first()
        comp = Comprador(nombre="X")
        s.add(comp)
        await s.flush()
        comprador_id = comp.id
        cosecha = RegistroCosecha(
            fecha=date(2026, 2, 10), parcela_id=parral.id,
            destino=DestinoCosecha.rama_pasa, origen=OrigenCosecha.propio, kg_total=1000.0,
            created_by=user.id,
        )
        s.add(cosecha)
        await s.flush()
        tra = Remito(tipo=TipoRemito.traslado_pasero, numero="TRA-000001", fecha=cosecha.fecha,
                     pasero_id=pasero.id, kg_total=Decimal("400"), created_by=user.id,
                     lineas=[RemitoLinea(cosecha_id=cosecha.id, kg=Decimal("400"))])
        s.add(tra)
        await s.flush()
        assert await saldo_cosecha(s, cosecha) == Decimal("1000.00")  # TRA no descuenta
        fre = Remito(tipo=TipoRemito.salida_fresco, numero="FRE-000001", fecha=cosecha.fecha,
                     comprador_id=comprador_id, kg_total=Decimal("300"), created_by=user.id,
                     lineas=[RemitoLinea(cosecha_id=cosecha.id, kg=Decimal("300"))])
        s.add(fre)
        await s.flush()
        assert await saldo_cosecha(s, cosecha) == Decimal("700.00")  # FRE sí
        # Un ingreso al pasero vinculado descuenta lo que entró.
        s.add(IngresoPasero(
            fecha=cosecha.fecha, pasero_id=pasero.id, cosecha_id=cosecha.id, variedad=VariedadUva.flame,
            origen=OrigenCosecha.propio, carros=1, fichas=90, kg_teorico=Decimal('1620'),
            kg_real=Decimal('250'), merma_kg=Decimal('1370'), created_by=user.id,
        ))
        await s.flush()
        assert await saldo_cosecha(s, cosecha) == Decimal('450.00')  # 1000 - 300 FRE - 250 ingresados


async def test_remitos_listado_tolera_comprador_nulo(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 3", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    await client.post(URL, json=_body(para="pasero", parcela_id=parral.id, pasero_id=pasero.id), headers=h)
    listado = await client.get("/remitos/", headers=h)
    assert listado.status_code == 200
    assert listado.json()[0]["comprador_id"] is None
    assert listado.json()[0]["pasero_nombre"] == "Pasero 1"
    por_pasero = await client.get(f"/remitos/?pasero_id={pasero.id}", headers=h)
    assert len(por_pasero.json()) == 1
    detalle = await client.get(f"/remitos/{listado.json()[0]['id']}", headers=h)
    assert detalle.status_code == 200


async def test_post_remitos_no_crea_tra(client, create_user):
    h = await _auth(client, create_user)
    comprador_id = await _comprador(client, h)
    resp = await client.post("/remitos/", json={
        "tipo": "traslado_pasero", "fecha": "2026-02-11", "comprador_id": comprador_id,
        "lineas": [{"cosecha_id": "x", "kg": "1"}],
    }, headers=h)
    assert resp.status_code == 422


# ── Permisos ────────────────────────────────────────────────────────────────

async def test_despacho_requiere_rol(client, create_user, create_parcela):
    parral = await create_parcela(nombre="Parral 1", variedad=VariedadUva.flame)
    body = _body(para="bodega", parcela_id=parral.id, comprador_id="x")
    assert (await client.post(URL, json=body)).status_code == 401
    h = await _auth(client, create_user, role=UserRole.obrero, email="obrero@test.com")
    assert (await client.post(URL, json=body, headers=h)).status_code == 403


async def test_propio_a_pasero_resta_tara_carro_y_rechaza_kg_total(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 9", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 9", tipo=TipoParcela.pasero)
    base = {"fecha": "2026-02-10", "para": "pasero", "parcela_id": parral.id, "pasero_id": pasero.id}
    # 3 carros, 1.500 kg en báscula, tara 400 x 3 = 1.200 -> 300 kg netos.
    ok = await client.post(URL, json=dict(base, carros=3, bruto_kg="1500"), headers=h)
    assert ok.status_code == 201, ok.text
    assert Decimal(ok.json()["cosecha"]["kg_total"]) == Decimal("300")
    assert Decimal(ok.json()["cosecha"]["tara_kg"]) == Decimal("1200")
    assert Decimal(ok.json()["ingreso_pasero"]["kg_real"]) == Decimal("300")
    # Sin peso de báscula, o con kg_total: 422.
    assert (await client.post(URL, json=dict(base, carros=1, kg_total="500"), headers=h)).status_code == 422
    # Báscula menor que la tara: no hay uva.
    assert (await client.post(URL, json=dict(base, carros=2, bruto_kg="700"), headers=h)).status_code == 422


async def test_chasis_no_lleva_peso_unitario(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 8", variedad=VariedadUva.flame)
    comprador = await _comprador(client, h)
    body = _body(para="bodega", parcela_id=parral.id, comprador_id=comprador,
                 tipo_envase="chasis", cantidad_envases="10", peso_unitario_kg="50")
    assert (await client.post(URL, json=body, headers=h)).status_code == 422
    ok = dict(_body(para="bodega", parcela_id=parral.id, comprador_id=comprador, tipo_envase="chasis"),
              bruto_kg="5000", tara_kg="1200")
    ok.pop("kg_total")
    resp = await client.post(URL, json=ok, headers=h)
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["cosecha"]["kg_total"]) == Decimal("3800")


async def test_regador_no_despacha_ni_ve_remitos(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    remito = await _remito_pasero(client, h, create_parcela)
    hr = await _auth(client, create_user, role=UserRole.regador, email="regador@test.com")
    parral = await create_parcela(nombre="Parral 2", variedad=VariedadUva.flame)
    body = _body(para="bodega", parcela_id=parral.id, comprador_id="x")
    assert (await client.post(URL, json=body, headers=hr)).status_code == 403
    assert (await client.get("/remitos/", headers=hr)).status_code == 403
    assert (await client.get(f"/remitos/{remito['id']}", headers=hr)).status_code == 403
    assert (await client.get(f"/remitos/{remito['id']}/pdf", headers=hr)).status_code == 403
    assert (await client.post(f"/remitos/{remito['id']}/pdf-link", headers=hr)).status_code == 403


# ── PDF ─────────────────────────────────────────────────────────────────────

async def _remito_pasero(client, h, create_parcela, **extra):
    parral = await create_parcela(nombre="Parral Ñandú", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero Único", tipo=TipoParcela.pasero)
    resp = await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id, **extra), headers=h)
    assert resp.status_code == 201, resp.text
    return resp.json()["remito"]


def _texto(pdf: bytes) -> str:
    return " ".join((p.extract_text() or "") for p in PdfReader(BytesIO(pdf)).pages)


def _plano(pdf: bytes) -> str:
    """Texto del PDF con los saltos de línea (por wrap) colapsados a espacios."""
    return " ".join(_texto(pdf).split())


async def test_pdf_con_bearer(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    remito = await _remito_pasero(
        client, h, create_parcela, vehiculo_patente="AB123CD", cuadrilla="Cuadrilla Muñoz",
        acarreo="Transportes Peñaloza", n_ciu="CIU-77", observaciones="Uva en buen estado, sin lluvia. " * 8,
    )
    resp = await client.get(f"/remitos/{remito['id']}/pdf", headers=h)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")
    texto = _texto(resp.content)
    for esperado in ("comprobante interno de entrega", "TRA-000001", "Los Lirios SA", "33-67368809-9",
                     "Entrega", "Recibe", "no válido como documento fiscal", "Pasero Único", "Fichas"):
        assert esperado in texto, esperado
    # Lo que va al pasero no sale en camión: sin transporte, observaciones ni transportista.
    for ausente in ("Transporte y observaciones", "Transportista", "AB123CD", "CIU-77"):
        assert ausente not in texto, ausente


async def test_pdf_bodega_incluye_transporte(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 7", variedad=VariedadUva.flame)
    comprador_id = await _comprador(client, h)
    resp = await client.post(URL, json=_body(
        para="bodega", parcela_id=parral.id, comprador_id=comprador_id,
        vehiculo_patente="AB123CD", cuadrilla="Cuadrilla Muñoz", acarreo="Transportes Peñaloza",
        n_ciu="CIU-77", observaciones="Uva en buen estado, sin lluvia. " * 8), headers=h)
    assert resp.status_code == 201, resp.text
    remito = resp.json()["remito"]
    pdf = await client.get(f"/remitos/{remito['id']}/pdf", headers=h)
    assert pdf.status_code == 200
    texto = _texto(pdf.content)
    for esperado in ("BOD-", "Transporte y observaciones", "Transportista", "AB123CD", "CIU-77"):
        assert esperado in texto, esperado


async def test_pdf_requiere_auth_y_rol(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    remito = await _remito_pasero(client, h, create_parcela)
    assert (await client.get(f"/remitos/{remito['id']}/pdf")).status_code == 401
    assert (await client.post(f"/remitos/{remito['id']}/pdf-link")).status_code == 401
    h2 = await _auth(client, create_user, role=UserRole.obrero, email="obrero@test.com")
    assert (await client.get(f"/remitos/{remito['id']}/pdf", headers=h2)).status_code == 403
    assert (await client.post(f"/remitos/{remito['id']}/pdf-link", headers=h2)).status_code == 403
    assert (await client.get("/remitos/no-existe/pdf", headers=h)).status_code == 404


async def test_pdf_link_firmado(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    remito = await _remito_pasero(client, h, create_parcela)
    link = await client.post(f"/remitos/{remito['id']}/pdf-link", headers=h)
    assert link.status_code == 200, link.text
    body = link.json()
    assert body["expires_in"] == 300
    assert body["url"].endswith(body["path"])
    # Sin Authorization header (como Linking desde mobile).
    pdf = await client.get(body["path"])
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")
    assert "TRA-000001" in _texto(pdf.content)


async def test_pdf_link_vencido_o_adulterado(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    remito = await _remito_pasero(client, h, create_parcela)
    vencido = create_remito_pdf_token(remito["id"], ttl_seconds=-10)
    assert (await client.get(f"/remitos/descarga/{vencido}")).status_code == 401
    valido = create_remito_pdf_token(remito["id"])
    assert (await client.get(f"/remitos/descarga/{valido}x")).status_code == 401
    assert (await client.get("/remitos/descarga/basura")).status_code == 401


async def test_pdf_link_solo_sirve_ese_remito(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    primero = await _remito_pasero(client, h, create_parcela)
    parral = await create_parcela(nombre="Parral Otro", variedad=VariedadUva.flame)
    pasero = await create_parcela(nombre="Pasero Otro", tipo=TipoParcela.pasero)
    segundo = (await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id), headers=h)).json()["remito"]
    token = (await client.post(f"/remitos/{primero['id']}/pdf-link", headers=h)).json()["path"]
    pdf = await client.get(token)
    assert "remito-TRA-000001.pdf" in pdf.headers["content-disposition"]
    assert "TRA-000002" not in _texto(pdf.content)
    assert segundo["numero"] == "TRA-000002"
    # El token no abre el detalle ni otras rutas: no es un bearer.
    solo_token = token.rsplit("/", 1)[1]
    otra = await client.get(f"/remitos/{segundo['id']}", headers={"Authorization": f"Bearer {solo_token}"})
    assert otra.status_code == 401
    otro_pdf = await client.get(
        f"/remitos/{segundo['id']}/pdf", headers={"Authorization": f"Bearer {solo_token}"})
    assert otro_pdf.status_code == 401


async def test_pdf_de_remito_a_comprador_y_bodega(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", variedad=VariedadUva.flame)
    comprador_id = await _comprador(client, h, "Bodega Ñuñoa & Hijos <S.A.>")
    for para, numero in (("bodega", "BOD-000001"), ("comprador", "FRE-000001")):
        remito = (await client.post(URL, json=_body(
            para=para, parcela_id=parral.id, comprador_id=comprador_id), headers=h)).json()["remito"]
        resp = await client.get(f"/remitos/{remito['id']}/pdf", headers=h)
        assert resp.status_code == 200 and resp.content.startswith(b"%PDF")
        texto = _texto(resp.content)
        assert numero in texto and "Ñuñoa" in texto


# ── remito_id / remito_numero en la cosecha ─────────────────────────────────

async def test_cosecha_expone_remito_en_despacho_get_y_lista(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 7", variedad=VariedadUva.flame)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    comprador_id = await _comprador(client, h)
    esperado = {}
    for para, extra, prefijo in (
        ("bodega", {"comprador_id": comprador_id}, "BOD"),
        ("comprador", {"comprador_id": comprador_id}, "FRE"),
        ("pasero", {"pasero_id": pasero.id}, "TRA"),
    ):
        resp = await client.post(URL, json=_body(para=para, parcela_id=parral.id, **extra), headers=h)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["cosecha"]["remito_id"] == data["remito"]["id"]
        assert data["cosecha"]["remito_numero"] == data["remito"]["numero"]
        assert data["remito"]["numero"].startswith(prefijo)
        esperado[data["cosecha"]["id"]] = (data["remito"]["id"], data["remito"]["numero"])

    detalle = await client.get(f"/produccion/cosecha/{next(iter(esperado))}", headers=h)
    assert detalle.json()["remito_numero"] == "BOD-000001"

    lista = (await client.get("/produccion/cosecha/", headers=h)).json()
    assert {c["id"]: (c["remito_id"], c["remito_numero"]) for c in lista} == esperado

    hg = await _auth(client, create_user, UserRole.gerencial, "ger@test.com")
    put = await client.put(
        f"/produccion/cosecha/{next(iter(esperado))}", json={"observaciones": "x"}, headers=hg
    )
    assert put.status_code == 200, put.text
    assert put.json()["remito_numero"] == "BOD-000001"


async def test_cosecha_historica_sin_remitos_devuelve_null(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 7", variedad=VariedadUva.flame)
    resp = await client.post(
        "/produccion/cosecha/",
        json={"fecha": "2026-02-05", "parcela_id": parral.id, "variedad": "flame",
              "destino": "MI", "kg_total": 100},
        headers=h,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["remito_id"] is None and resp.json()["remito_numero"] is None
    cid = resp.json()["id"]
    assert (await client.get(f"/produccion/cosecha/{cid}", headers=h)).json()["remito_id"] is None
    lista = (await client.get("/produccion/cosecha/", headers=h)).json()
    assert lista[0]["remito_id"] is None and lista[0]["remito_numero"] is None


async def test_lista_cosecha_resuelve_remitos_en_una_sola_consulta(
    client, create_user, create_parcela, monkeypatch
):
    from app.api import produccion as api_produccion

    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 7", variedad=VariedadUva.flame)
    comprador_id = await _comprador(client, h)
    for _ in range(3):
        resp = await client.post(
            URL, json=_body(para="bodega", parcela_id=parral.id, comprador_id=comprador_id), headers=h
        )
        assert resp.status_code == 201, resp.text

    llamadas: list[int] = []
    original = api_produccion.remitos_por_cosecha

    async def espia(db, cosechas):
        llamadas.append(len(cosechas))
        return await original(db, cosechas)

    monkeypatch.setattr(api_produccion, "remitos_por_cosecha", espia)
    lista = (await client.get("/produccion/cosecha/", headers=h)).json()
    assert len(lista) == 3 and all(c["remito_numero"] for c in lista)
    assert llamadas == [3]  # una sola llamada para toda la página


# ── Revisión: update/delete de cosecha despachada ───────────────────────────

async def _despacho_pasero(client, h, create_parcela, sufijo="", **extra):
    parral = await create_parcela(nombre=f"Parral 3{sufijo}", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre=f"Pasero 1{sufijo}", tipo=TipoParcela.pasero)
    resp = await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id, **extra), headers=h)
    assert resp.status_code == 201, resp.text
    return resp.json(), parral, pasero


async def test_cosecha_despachada_no_se_borra_ni_se_desincroniza(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    hg = await _auth(client, create_user, UserRole.gerencial, "ger@test.com")
    parral = await create_parcela(nombre="Parral 7", variedad=VariedadUva.flame)
    otro = await create_parcela(nombre="Parral 8", variedad=VariedadUva.flame)
    comprador_id = await _comprador(client, h)
    otro_comprador = await _comprador(client, h, "Otra Bodega")
    cosecha = (await client.post(URL, json=_body(
        para="bodega", parcela_id=parral.id, comprador_id=comprador_id), headers=h)).json()["cosecha"]
    url = f"/produccion/cosecha/{cosecha['id']}"

    for cambio in ({"kg_total": 999}, {"destino": "MI"}, {"parcela_id": otro.id},
                   {"comprador_id": otro_comprador}, {"fecha": "2026-03-01"}):
        resp = await client.put(url, json=cambio, headers=hg)
        assert resp.status_code == 409, (cambio, resp.text)
        assert "línea(s) de remito" in resp.json()["detail"]
    # Recalcular kg por envases también desincroniza.
    assert (await client.put(url, json={"cantidad_envases": 10, "peso_unitario_kg": 3}, headers=hg)
            ).status_code == 409

    # Inocuos, o el mismo valor: siguen editables.
    ok = await client.put(url, json={"observaciones": "ok", "cuadrilla": "X", "n_ciu": "C-1"}, headers=hg)
    assert ok.status_code == 200, ok.text
    assert ok.json()["observaciones"] == "ok" and ok.json()["kg_total"] == cosecha["kg_total"]
    mismo = await client.put(
        url, json={"kg_total": cosecha["kg_total"], "destino": "BODEGA"}, headers=hg)
    assert mismo.status_code == 200, mismo.text

    borrar = await client.delete(url, headers=hg)
    assert borrar.status_code == 409
    assert "No se puede eliminar la cosecha" in borrar.json()["detail"]
    assert (await client.get(url, headers=h)).status_code == 200


async def test_cosecha_con_ingreso_pasero_no_se_borra(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    hg = await _auth(client, create_user, UserRole.gerencial, "ger@test.com")
    data, _, _ = await _despacho_pasero(client, h, create_parcela)
    url = f"/produccion/cosecha/{data['cosecha']['id']}"
    resp = await client.delete(url, headers=hg)
    assert resp.status_code == 409
    assert "ingreso(s) al pasero" in resp.json()["detail"]
    assert (await client.put(url, json={"kg_total": 1}, headers=hg)).status_code == 409


async def test_cosecha_sin_vinculos_se_edita_y_borra(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    hg = await _auth(client, create_user, UserRole.gerencial, "ger@test.com")
    parral = await create_parcela(nombre="Parral 7", variedad=VariedadUva.flame)
    cid = (await client.post("/produccion/cosecha/", json={
        "fecha": "2026-02-05", "parcela_id": parral.id, "variedad": "flame",
        "destino": "MI", "kg_total": 100}, headers=h)).json()["id"]
    assert (await client.put(f"/produccion/cosecha/{cid}", json={"kg_total": 120}, headers=hg)
            ).status_code == 200
    assert (await client.delete(f"/produccion/cosecha/{cid}", headers=hg)).status_code == 204


# ── Revisión: ingreso manual vinculado no duplica ───────────────────────────

async def test_ingreso_manual_vinculado_exige_saldo(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    data, parral, pasero = await _despacho_pasero(client, h, create_parcela, kg_total="1000")
    # El despacho ya ingresó todo: un segundo ingreso vinculado duplicaría la uva.
    dup = await client.post("/pasero/ingresos", json={
        "fecha": "2026-02-10", "pasero_id": pasero.id, "variedad": "sultanina",
        "kg_real": "500", "cosecha_id": data["cosecha"]["id"]}, headers=h)
    assert dup.status_code == 409, dup.text
    assert "0.00 kg" in dup.json()["detail"]

    # Cosecha histórica con saldo: alcanza hasta agotarlo.
    cid = (await client.post("/produccion/cosecha/", json={
        "fecha": "2026-02-05", "parcela_id": parral.id, "variedad": "sultanina",
        "destino": "RAMA_PASA", "kg_total": 1000}, headers=h)).json()["id"]
    body = {"fecha": "2026-02-10", "pasero_id": pasero.id, "variedad": "sultanina",
            "kg_real": "600", "cosecha_id": cid}
    assert (await client.post("/pasero/ingresos", json=body, headers=h)).status_code == 201
    de_mas = await client.post("/pasero/ingresos", json=body, headers=h)
    assert de_mas.status_code == 409
    assert "400.00 kg" in de_mas.json()["detail"]
    assert (await client.post("/pasero/ingresos", json=dict(body, kg_real="400"), headers=h)
            ).status_code == 201
    # Sin cosecha_id no hay saldo que validar.
    libre = dict(body)
    libre.pop("cosecha_id")
    assert (await client.post("/pasero/ingresos", json=libre, headers=h)).status_code == 201


# ── Revisión: idempotencia ──────────────────────────────────────────────────

async def test_idempotencia_misma_clave_con_otros_datos_es_409(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 3", variedad=VariedadUva.sultanina)
    otro = await create_parcela(nombre="Parral 4", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    body = _body(para="pasero", parcela_id=parral.id, pasero_id=pasero.id, idempotency_key="key-xyz")
    assert (await client.post(URL, json=body, headers=h)).status_code == 201
    for cambio in ({"bruto_kg": "900"}, {"parcela_id": otro.id}, {"fecha": "2026-03-01"}):
        resp = await client.post(URL, json=dict(body, **cambio), headers=h)
        assert resp.status_code == 409, (cambio, resp.text)
        assert resp.json()["detail"] == "Esa clave de idempotencia ya se usó con otros datos"
    # El payload idéntico sigue devolviendo lo ya creado.
    assert (await client.post(URL, json=body, headers=h)).status_code == 201


async def test_idempotencia_carrera_devuelve_lo_creado(
    client, create_user, create_parcela, session_factory, monkeypatch
):
    """Dos envíos simultáneos: ambos pasan el chequeo previo (no ven nada), el
    INSERT del segundo choca con el índice único y debe devolver 201 con lo ya
    creado, sin duplicar."""
    from app.services import despacho_cosecha

    h = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 3", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    body = _body(para="pasero", parcela_id=parral.id, pasero_id=pasero.id, idempotency_key="key-race")
    primero = await client.post(URL, json=body, headers=h)
    assert primero.status_code == 201

    original = despacho_cosecha._buscar_por_key
    llamadas: list[str] = []

    async def ciega_la_primera_vez(db, key):
        llamadas.append(key)
        return None if len(llamadas) == 1 else await original(db, key)

    monkeypatch.setattr(despacho_cosecha, "_buscar_por_key", ciega_la_primera_vez)
    segundo = await client.post(URL, json=body, headers=h)
    assert segundo.status_code == 201, segundo.text
    assert len(llamadas) == 2
    assert segundo.json()["cosecha"]["id"] == primero.json()["cosecha"]["id"]
    assert segundo.json()["remito"]["id"] == primero.json()["remito"]["id"]
    async with session_factory() as s:
        assert len((await s.execute(select(RegistroCosecha))).scalars().all()) == 1
        assert len((await s.execute(select(Remito))).scalars().all()) == 1
        assert len((await s.execute(select(IngresoPasero))).scalars().all()) == 1

    # Si además el payload difiere, la carrera también termina en 409.
    llamadas.clear()
    distinto = await client.post(URL, json=dict(body, bruto_kg="907"), headers=h)
    assert distinto.status_code == 409


# ── Revisión: carro incompleto persistido ───────────────────────────────────

async def test_carro_incompleto_se_persiste_sin_merma(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    data, _, _ = await _despacho_pasero(
        client, h, create_parcela, kg_total="900", carro_incompleto=True)
    ing = data["ingreso_pasero"]
    assert ing["carro_incompleto"] is True
    assert ing["fichas"] == 50
    assert Decimal(ing["kg_teorico"]) == Decimal(ing["kg_real"]) == Decimal("900")
    assert Decimal(ing["merma_kg"]) == 0
    listado = (await client.get("/pasero/ingresos", headers=h)).json()
    assert listado[0]["carro_incompleto"] is True

    completo, _, _ = await _despacho_pasero(client, h, create_parcela, "b", kg_total="3000", carros=2)
    assert completo["ingreso_pasero"]["carro_incompleto"] is False
    assert Decimal(completo["ingreso_pasero"]["merma_kg"]) == Decimal("240.00")


async def test_ingreso_manual_carro_incompleto(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    resp = await client.post("/pasero/ingresos", json={
        "fecha": "2026-02-10", "pasero_id": pasero.id, "variedad": "sultanina",
        "kg_real": "360", "carro_incompleto": True}, headers=h)
    assert resp.status_code == 201, resp.text
    assert resp.json()["fichas"] == 20 and Decimal(resp.json()["merma_kg"]) == 0
    assert Decimal(resp.json()["kg_teorico"]) == Decimal("360")


async def test_kg_por_ficha_cero_es_422_no_500(client, create_user, create_parcela, session_factory):
    import pytest

    from app.models.alta_produccion import ParametroProduccion
    from app.services import mermas

    h = await _auth(client, create_user)
    async with session_factory() as s:
        s.add(ParametroProduccion(clave="kg_por_ficha", valor=Decimal("0")))
        await s.commit()
    parral = await create_parcela(nombre="Parral 3", variedad=VariedadUva.sultanina)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    resp = await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id, carro_incompleto=True), headers=h)
    assert resp.status_code == 422, resp.text
    assert "kg_por_ficha" in resp.json()["detail"]
    with pytest.raises(ValueError):
        mermas.fichas_estimadas(Decimal("100"), Decimal("0"))


async def test_pdf_usa_el_flag_carro_incompleto(client, create_user, create_parcela):
    h = await _auth(client, create_user)
    incompleto, _, _ = await _despacho_pasero(
        client, h, create_parcela, kg_total="900", carro_incompleto=True)
    pdf = await client.get(f"/remitos/{incompleto['remito']['id']}/pdf", headers=h)
    assert "carro incompleto" in _plano(pdf.content)

    pasero = await create_parcela(nombre="Pasero 2", tipo=TipoParcela.pasero)
    parral = await create_parcela(nombre="Parral 9", variedad=VariedadUva.sultanina)
    completo = (await client.post(URL, json=_body(
        para="pasero", parcela_id=parral.id, pasero_id=pasero.id, kg_total="3000", carros=2), headers=h)).json()
    pdf2 = await client.get(f"/remitos/{completo['remito']['id']}/pdf", headers=h)
    assert "carro incompleto" not in _plano(pdf2.content)


async def test_pdf_no_infiere_incompleto_por_fichas(client, create_user, create_parcela, session_factory):
    h = await _auth(client, create_user)
    data, _, _ = await _despacho_pasero(client, h, create_parcela, kg_total="3000", carros=2)
    async with session_factory() as s:
        ing = (await s.execute(select(IngresoPasero))).scalars().first()
        ing.fichas = 77  # distinto de carros x fichas_por_carro, pero el flag es False
        await s.commit()
    pdf = await client.get(f"/remitos/{data['remito']['id']}/pdf", headers=h)
    assert "carro incompleto" not in _plano(pdf.content)
    async with session_factory() as s:
        ing = (await s.execute(select(IngresoPasero))).scalars().first()
        ing.carro_incompleto = True
        await s.commit()
    pdf = await client.get(f"/remitos/{data['remito']['id']}/pdf", headers=h)
    assert "carro incompleto" in _plano(pdf.content)


# ── Revisión: claims typ/aud del link firmado ───────────────────────────────

def test_token_pdf_exige_typ_y_aud():
    from datetime import datetime, timedelta, timezone

    import jwt

    from app.core.config import settings
    from app.core.security import (
        create_access_token,
        decode_access_token,
        decode_remito_pdf_token,
    )

    def firmar(**claims):
        payload = {"rid": "r-1", "exp": datetime.now(timezone.utc) + timedelta(seconds=60), **claims}
        return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    ok = create_remito_pdf_token("r-1")
    claims = jwt.decode(ok, settings.SECRET_KEY, algorithms=[settings.ALGORITHM], audience="remito_pdf")
    assert claims["typ"] == "remito_pdf" and claims["aud"] == "remito_pdf"
    assert decode_remito_pdf_token(ok) == "r-1"

    assert decode_remito_pdf_token(firmar(typ="remito_pdf")) is None  # sin aud
    assert decode_remito_pdf_token(firmar(aud="remito_pdf")) is None  # sin typ
    assert decode_remito_pdf_token(firmar(typ="access", aud="remito_pdf")) is None
    assert decode_remito_pdf_token(firmar(typ="remito_pdf", aud="otra")) is None
    assert decode_remito_pdf_token(firmar(scope="remito_pdf")) is None  # formato viejo
    # Un token de acceso normal no pasa como link de PDF...
    assert decode_remito_pdf_token(create_access_token({"sub": "a@b.com", "rid": "r-1"})) is None
    # ...ni el link de PDF pasa como token de acceso.
    assert decode_access_token(ok) is None
