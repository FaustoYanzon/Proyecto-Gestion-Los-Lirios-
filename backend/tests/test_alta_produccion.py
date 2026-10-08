"""Módulo Alta de Producción (FASE 1): conversión 4:1, saldo de lote con
entregas parciales, lotes de una sola variedad, mermas y conciliación INV.
"""
from __future__ import annotations

from decimal import Decimal

from app.models.parcela import TipoParcela, VariedadUva
from app.models.user import UserRole
from app.services import mermas


async def _auth(client, create_user, role: UserRole = UserRole.gerencial):
    await create_user(email="gerente@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login", data={"username": "gerente@test.com", "password": "Password123!"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _ingresar_uva(client, headers, pasero_id, variedad="sultanina", kg="4000", carros=1, **extra):
    resp = await client.post(
        "/pasero/ingresos",
        json={"fecha": "2026-02-10", "pasero_id": pasero_id, "variedad": variedad,
              "kg_real": kg, "carros": carros, **extra},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _lote_cerrado(client, headers, pasero_id, kg="1000", variedad="sultanina", calidad=1):
    """Ingresa uva suficiente, abre un lote, le suma un bin y lo cierra."""
    await _ingresar_uva(client, headers, pasero_id, variedad=variedad, kg=str(Decimal(kg) * 4))
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": variedad, "calidad": calidad, "fecha": "2026-03-01"}, headers=headers
    )).json()
    resp = await client.post(
        f"/lotes-pasa/{lote['id']}/bines", json={"pasero_id": pasero_id, "kg_real": kg}, headers=headers
    )
    assert resp.status_code == 201, resp.text
    cerrado = await client.post(f"/lotes-pasa/{lote['id']}/cerrar", headers=headers)
    assert cerrado.status_code == 200, cerrado.text
    return cerrado.json()


async def _comprador(client, headers, nombre="Pasera del Sur"):
    resp = await client.post("/alta-produccion/compradores", json={"nombre": nombre}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ── Servicio de mermas (puro) ───────────────────────────────────────────────

def test_conversion_4_a_1():
    assert mermas.uva_consumida(Decimal("350"), Decimal("4")) == Decimal("1400.00")
    assert mermas.pasa_maxima(Decimal("1400"), Decimal("4")) == Decimal("350.00")


def test_kg_teorico_de_un_carro_es_90_fichas_de_18_kg():
    assert mermas.kg_teorico_ingreso(90, Decimal("18")) == Decimal("1620.00")


def test_merma_ingreso_teorico_vs_bascula():
    assert mermas.merma_ingreso(Decimal("1620"), Decimal("1540.50")) == Decimal("79.50")
    # La báscula pesó de más: merma negativa, no se oculta.
    assert mermas.merma_ingreso(Decimal("1620"), Decimal("1650")) == Decimal("-30.00")


def test_merma_bines_nominal_vs_real():
    assert mermas.merma_bines(2, Decimal("350"), Decimal("680")) == Decimal("20.00")


def test_balance_levantada_diferencia_contra_rendimiento_teorico():
    balance = mermas.balance_levantada(Decimal("4000"), Decimal("900"), Decimal("4"))
    assert balance["pasa_esperada_kg"] == Decimal("1000.00")
    assert balance["uva_consumida_kg"] == Decimal("3600.00")
    assert balance["uva_disponible_kg"] == Decimal("400.00")
    assert balance["diferencia_pasa_kg"] == Decimal("-100.00")


# ── Ingreso al pasero ───────────────────────────────────────────────────────

async def test_ingreso_pasero_calcula_teorico_y_merma(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    ingreso = await _ingresar_uva(client, headers, pasero.id, kg="1540.50", carros=1)
    assert Decimal(ingreso["fichas"]) == 90
    assert Decimal(ingreso["kg_teorico"]) == Decimal("1620.00")
    assert Decimal(ingreso["merma_kg"]) == Decimal("79.50")


async def test_ingreso_pasero_exige_parcela_tipo_pasero(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral)
    resp = await client.post(
        "/pasero/ingresos",
        json={"fecha": "2026-02-10", "pasero_id": parral.id, "variedad": "sultanina", "kg_real": "1000"},
        headers=headers,
    )
    assert resp.status_code == 404


async def test_ingreso_de_tercero_exige_productor(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    resp = await client.post(
        "/pasero/ingresos",
        json={"fecha": "2026-02-10", "pasero_id": pasero.id, "variedad": "sultanina",
              "kg_real": "1000", "origen": "tercero"},
        headers=headers,
    )
    assert resp.status_code == 422

    productor = await client.post(
        "/alta-produccion/productores", json={"nombre": "Finca Vecina"}, headers=headers
    )
    ok = await client.post(
        "/pasero/ingresos",
        json={"fecha": "2026-02-10", "pasero_id": pasero.id, "variedad": "sultanina",
              "kg_real": "1000", "origen": "tercero", "productor_id": productor.json()["id"]},
        headers=headers,
    )
    assert ok.status_code == 201


async def test_stock_pasero_por_variedad(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    await _ingresar_uva(client, headers, pasero.id, variedad="sultanina", kg="4000")
    await _ingresar_uva(client, headers, pasero.id, variedad="flame", kg="2000")
    stock = (await client.get("/pasero/stock", headers=headers)).json()
    por_variedad = {item["variedad"]: item for item in stock}
    assert Decimal(por_variedad["sultanina"]["uva_disponible_kg"]) == Decimal("4000")
    assert Decimal(por_variedad["flame"]["uva_disponible_kg"]) == Decimal("2000")


# ── Lotes: levantada 4:1 ────────────────────────────────────────────────────

async def test_bin_descuenta_4_kg_de_uva_por_kg_de_pasa(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    await _ingresar_uva(client, headers, pasero.id, kg="4000")
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}, headers=headers
    )).json()

    resp = await client.post(
        f"/lotes-pasa/{lote['id']}/bines", json={"pasero_id": pasero.id, "kg_real": "350"}, headers=headers
    )
    assert resp.status_code == 201
    assert Decimal(resp.json()["kg_total"]) == Decimal("350")

    stock = (await client.get("/pasero/stock", headers=headers)).json()[0]
    assert Decimal(stock["uva_consumida_kg"]) == Decimal("1400")
    assert Decimal(stock["uva_disponible_kg"]) == Decimal("2600")


async def test_no_se_levanta_mas_pasa_que_uva_disponible_sobre_4(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    await _ingresar_uva(client, headers, pasero.id, kg="1000")  # máximo 250 kg de pasa
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}, headers=headers
    )).json()

    demasiado = await client.post(
        f"/lotes-pasa/{lote['id']}/bines", json={"pasero_id": pasero.id, "kg_real": "250.01"}, headers=headers
    )
    assert demasiado.status_code == 409

    justo = await client.post(
        f"/lotes-pasa/{lote['id']}/bines", json={"pasero_id": pasero.id, "kg_real": "250"}, headers=headers
    )
    assert justo.status_code == 201


async def test_lote_de_una_variedad_no_toma_uva_de_otra(client, create_user, create_parcela):
    """Un lote es de una sola variedad: la uva del pasero es de otra variedad,
    así que no hay de dónde levantar y no se puede mezclar."""
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    await _ingresar_uva(client, headers, pasero.id, variedad="flame", kg="4000")
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}, headers=headers
    )).json()

    resp = await client.post(
        f"/lotes-pasa/{lote['id']}/bines", json={"pasero_id": pasero.id, "kg_real": "100"}, headers=headers
    )
    assert resp.status_code == 409


async def test_un_solo_lote_abierto_por_variedad_y_calidad(client, create_user):
    headers = await _auth(client, create_user)
    body = {"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}
    assert (await client.post("/lotes-pasa/", json=body, headers=headers)).status_code == 201
    assert (await client.post("/lotes-pasa/", json=body, headers=headers)).status_code == 409
    # Otra variedad y otra calidad corren en paralelo.
    assert (await client.post("/lotes-pasa/", json={**body, "variedad": "flame"}, headers=headers)).status_code == 201
    assert (await client.post("/lotes-pasa/", json={**body, "calidad": 2}, headers=headers)).status_code == 201


async def test_numero_de_lote_correlativo_por_variedad_y_calidad(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    primero = await _lote_cerrado(client, headers, pasero.id, kg="100")
    segundo = await _lote_cerrado(client, headers, pasero.id, kg="100")
    assert (primero["numero"], segundo["numero"]) == (1, 2)
    assert primero["temporada"] == 2025  # marzo 2026 pertenece a la campaña 2025


async def test_tope_de_bines_cierra_el_lote_y_rechaza_mas(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    await client.patch("/alta-produccion/parametros", json={"tope_bines_lote": 2}, headers=headers)
    await _ingresar_uva(client, headers, pasero.id, kg="8000")
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}, headers=headers
    )).json()
    bin_body = {"pasero_id": pasero.id, "kg_real": "300"}

    assert (await client.post(f"/lotes-pasa/{lote['id']}/bines", json=bin_body, headers=headers)).json()["estado"] == "abierto"
    segundo = await client.post(f"/lotes-pasa/{lote['id']}/bines", json=bin_body, headers=headers)
    assert segundo.json()["estado"] == "cerrado"
    tercero = await client.post(f"/lotes-pasa/{lote['id']}/bines", json=bin_body, headers=headers)
    assert tercero.status_code == 409


async def test_no_se_cierra_un_lote_sin_bines(client, create_user):
    headers = await _auth(client, create_user)
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}, headers=headers
    )).json()
    assert (await client.post(f"/lotes-pasa/{lote['id']}/cerrar", headers=headers)).status_code == 409


async def test_merma_de_bines_en_el_lote(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    await _ingresar_uva(client, headers, pasero.id, kg="4000")
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}, headers=headers
    )).json()
    for kg in ("340", "340"):
        await client.post(
            f"/lotes-pasa/{lote['id']}/bines", json={"pasero_id": pasero.id, "kg_real": kg}, headers=headers
        )
    detalle = (await client.get(f"/lotes-pasa/{lote['id']}", headers=headers)).json()
    assert detalle["cantidad_bines"] == 2
    assert Decimal(detalle["merma_bines_kg"]) == Decimal("20")  # 2 x 350 - 680


# ── Remitos: entrega de pasa con saldo ──────────────────────────────────────

async def test_entregas_parciales_descuentan_saldo_del_lote(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_cerrado(client, headers, pasero.id, kg="1000")
    comprador = await _comprador(client, headers)

    def entrega(kg):
        return {"tipo": "entrega_pasa", "fecha": "2026-04-01", "comprador_id": comprador,
                "lineas": [{"lote_id": lote["id"], "kg": kg}]}

    primera = await client.post("/remitos/", json=entrega("400"), headers=headers)
    assert primera.status_code == 201
    assert primera.json()["numero"] == "PAS-000001"
    assert Decimal((await client.get(f"/lotes-pasa/{lote['id']}", headers=headers)).json()["saldo_kg"]) == Decimal("600")

    segunda = await client.post("/remitos/", json=entrega("600"), headers=headers)
    assert segunda.status_code == 201
    assert Decimal((await client.get(f"/lotes-pasa/{lote['id']}", headers=headers)).json()["saldo_kg"]) == Decimal("0")

    # El lote quedó en cero: no se puede entregar un kilo más.
    assert (await client.post("/remitos/", json=entrega("1"), headers=headers)).status_code == 409


async def test_no_se_entrega_mas_que_el_saldo_y_no_descuenta_a_medias(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    lote = await _lote_cerrado(client, headers, pasero.id, kg="1000")
    comprador = await _comprador(client, headers)

    resp = await client.post(
        "/remitos/",
        json={"tipo": "entrega_pasa", "fecha": "2026-04-01", "comprador_id": comprador,
              "lineas": [{"lote_id": lote["id"], "kg": "600"}, {"lote_id": lote["id"], "kg": "600"}]},
        headers=headers,
    )
    assert resp.status_code == 409  # 1200 > 1000: se suman las líneas del mismo lote
    assert Decimal((await client.get(f"/lotes-pasa/{lote['id']}", headers=headers)).json()["saldo_kg"]) == Decimal("1000")


async def test_no_se_entrega_de_un_lote_abierto(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    await _ingresar_uva(client, headers, pasero.id, kg="4000")
    lote = (await client.post(
        "/lotes-pasa/", json={"variedad": "sultanina", "calidad": 1, "fecha": "2026-03-01"}, headers=headers
    )).json()
    await client.post(
        f"/lotes-pasa/{lote['id']}/bines", json={"pasero_id": pasero.id, "kg_real": "300"}, headers=headers
    )
    comprador = await _comprador(client, headers)
    resp = await client.post(
        "/remitos/",
        json={"tipo": "entrega_pasa", "fecha": "2026-04-01", "comprador_id": comprador,
              "lineas": [{"lote_id": lote["id"], "kg": "100"}]},
        headers=headers,
    )
    assert resp.status_code == 409


async def test_entrega_de_pasa_rechaza_lineas_de_cosecha(client, create_user):
    headers = await _auth(client, create_user)
    comprador = await _comprador(client, headers)
    resp = await client.post(
        "/remitos/",
        json={"tipo": "entrega_pasa", "fecha": "2026-04-01", "comprador_id": comprador,
              "lineas": [{"cosecha_id": "x", "kg": "100"}]},
        headers=headers,
    )
    assert resp.status_code == 422


# ── Remitos de salida (fresco / bodega) e INV ───────────────────────────────

async def _cosecha(client, headers, parcela_id, destino, kg=10000):
    resp = await client.post(
        "/produccion/cosecha/",
        json={"fecha": "2026-02-05", "parcela_id": parcela_id, "variedad": "flame",
              "destino": destino, "kg_total": kg},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_remito_salida_fresco_descuenta_de_la_cosecha(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.flame)
    cosecha_id = await _cosecha(client, headers, parral.id, "MI", kg=10000)
    comprador = await _comprador(client, headers, "Mercado Central")

    def salida(kg):
        return {"tipo": "salida_fresco", "fecha": "2026-02-06", "comprador_id": comprador,
                "lineas": [{"cosecha_id": cosecha_id, "kg": kg}]}

    assert (await client.post("/remitos/", json=salida("6000"), headers=headers)).status_code == 201
    # Quedan 4000 sin despachar.
    assert (await client.post("/remitos/", json=salida("4001"), headers=headers)).status_code == 409
    assert (await client.post("/remitos/", json=salida("4000"), headers=headers)).status_code == 201


async def test_remito_bodega_solo_acepta_cosecha_con_destino_bodega(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.syrah)
    cosecha_mi = await _cosecha(client, headers, parral.id, "MI")
    comprador = await _comprador(client, headers, "Bodega Norte")
    resp = await client.post(
        "/remitos/",
        json={"tipo": "salida_bodega", "fecha": "2026-02-06", "comprador_id": comprador,
              "lineas": [{"cosecha_id": cosecha_mi, "kg": "1000"}]},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_comprobante_inv_calcula_diferencia_y_no_se_duplica(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.syrah)
    cosecha_id = await _cosecha(client, headers, parral.id, "BODEGA", kg=20000)
    comprador = await _comprador(client, headers, "Bodega Norte")
    remito = (await client.post(
        "/remitos/",
        json={"tipo": "salida_bodega", "fecha": "2026-02-06", "comprador_id": comprador,
              "lineas": [{"cosecha_id": cosecha_id, "kg": "18000"}]},
        headers=headers,
    )).json()

    resp = await client.post(
        f"/remitos/{remito['id']}/comprobante-bodega",
        json={"numero_suv": "SUV-123", "kg_recibidos": "17950"},
        headers=headers,
    )
    assert resp.status_code == 201
    assert Decimal(resp.json()["diferencia_kg"]) == Decimal("-50")

    repetido = await client.post(
        f"/remitos/{remito['id']}/comprobante-bodega",
        json={"numero_suv": "SUV-124", "kg_recibidos": "17950"},
        headers=headers,
    )
    assert repetido.status_code == 409

    detalle = (await client.get(f"/remitos/{remito['id']}", headers=headers)).json()
    assert detalle["comprobante_bodega"]["numero_suv"] == "SUV-123"


async def test_comprobante_inv_solo_para_remitos_a_bodega(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.flame)
    cosecha_id = await _cosecha(client, headers, parral.id, "MI")
    comprador = await _comprador(client, headers)
    remito = (await client.post(
        "/remitos/",
        json={"tipo": "salida_fresco", "fecha": "2026-02-06", "comprador_id": comprador,
              "lineas": [{"cosecha_id": cosecha_id, "kg": "500"}]},
        headers=headers,
    )).json()
    resp = await client.post(
        f"/remitos/{remito['id']}/comprobante-bodega",
        json={"numero_suv": "SUV-1", "kg_recibidos": "500"},
        headers=headers,
    )
    assert resp.status_code == 422


# ── Cosecha unificada con Productor, parámetros y maestros ──────────────────

async def test_cosecha_acepta_productor_y_rechaza_uno_inexistente(client, create_user):
    headers = await _auth(client, create_user)
    productor = (await client.post(
        "/alta-produccion/productores", json={"nombre": "Finca Vecina"}, headers=headers
    )).json()
    base = {"fecha": "2026-02-05", "origen": "tercero", "destino": "PASAS", "kg_total": 5000}

    ok = await client.post(
        "/produccion/cosecha/", json={**base, "productor_id": productor["id"]}, headers=headers
    )
    assert ok.status_code == 201
    assert ok.json()["productor_id"] == productor["id"]

    mal = await client.post("/produccion/cosecha/", json={**base, "productor_id": "no-existe"}, headers=headers)
    assert mal.status_code == 404


async def test_parametros_defaults_y_tope_configurable(client, create_user):
    headers = await _auth(client, create_user)
    defaults = (await client.get("/alta-produccion/parametros", headers=headers)).json()
    assert Decimal(defaults["kg_por_ficha"]) == Decimal("18")
    assert defaults["fichas_por_carro"] == 90
    assert Decimal(defaults["ratio_uva_pasa"]) == Decimal("4")
    assert Decimal(defaults["kg_nominal_bin"]) == Decimal("350")
    assert defaults["tope_bines_lote"] is None

    cambiado = (await client.patch(
        "/alta-produccion/parametros", json={"ratio_uva_pasa": "4.5", "tope_bines_lote": 10}, headers=headers
    )).json()
    assert Decimal(cambiado["ratio_uva_pasa"]) == Decimal("4.5")
    assert cambiado["tope_bines_lote"] == 10

    sin_tope = (await client.patch(
        "/alta-produccion/parametros", json={"tope_bines_lote": None}, headers=headers
    )).json()
    assert sin_tope["tope_bines_lote"] is None


async def test_productor_nombre_duplicado_rechaza(client, create_user):
    headers = await _auth(client, create_user)
    assert (await client.post("/alta-produccion/productores", json={"nombre": "José Pérez"}, headers=headers)).status_code == 201
    assert (await client.post("/alta-produccion/productores", json={"nombre": " jose perez "}, headers=headers)).status_code == 409


# ── Endurecimiento (revisión) ───────────────────────────────────────────────

async def test_kg_fuera_de_rango_o_con_mas_de_2_decimales_rechaza(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    for kg in ("1000000000000", "10.123"):  # excede Numeric(14,2) / 3 decimales
        resp = await client.post(
            "/pasero/ingresos",
            json={"fecha": "2026-02-10", "pasero_id": pasero.id, "variedad": "sultanina", "kg_real": kg},
            headers=headers,
        )
        assert resp.status_code == 422, kg


async def test_ingreso_solo_acepta_cosecha_destinada_a_pasa(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.sultanina)
    cosecha_mi = await _cosecha(client, headers, parral.id, "MI")
    cosecha_pasas = await _cosecha(client, headers, parral.id, "PASAS")
    base = {"fecha": "2026-02-10", "pasero_id": pasero.id, "variedad": "sultanina", "kg_real": "1000"}

    mal = await client.post("/pasero/ingresos", json={**base, "cosecha_id": cosecha_mi}, headers=headers)
    assert mal.status_code == 422
    ok = await client.post("/pasero/ingresos", json={**base, "cosecha_id": cosecha_pasas}, headers=headers)
    assert ok.status_code == 201


def test_pasa_maxima_redondea_hacia_abajo():
    assert mermas.pasa_maxima(Decimal("1000.03"), Decimal("4")) == Decimal("250.00")


async def test_ubicacion_duplicada_devuelve_409(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    body = {"pasero_id": pasero.id, "hilera": 1, "parte": 2}
    assert (await client.post("/pasero/ubicaciones", json=body, headers=headers)).status_code == 201
    assert (await client.post("/pasero/ubicaciones", json=body, headers=headers)).status_code == 409


# ── saldo_kg en cosecha y labels en líneas de remito ────────────────────────

async def test_cosecha_expone_saldo_kg_antes_y_despues_de_una_salida(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.flame)
    cosecha_id = await _cosecha(client, headers, parral.id, "MI", kg=10000)
    comprador = await _comprador(client, headers, "Mercado Central")

    antes = (await client.get(f"/produccion/cosecha/{cosecha_id}", headers=headers)).json()
    assert Decimal(antes["saldo_kg"]) == Decimal("10000")

    salida = {"tipo": "salida_fresco", "fecha": "2026-02-06", "comprador_id": comprador,
              "lineas": [{"cosecha_id": cosecha_id, "kg": "6000"}]}
    assert (await client.post("/remitos/", json=salida, headers=headers)).status_code == 201

    detalle = (await client.get(f"/produccion/cosecha/{cosecha_id}", headers=headers)).json()
    assert Decimal(detalle["saldo_kg"]) == Decimal("4000")
    listado = (await client.get("/produccion/cosecha/", headers=headers)).json()
    assert Decimal(next(c for c in listado if c["id"] == cosecha_id)["saldo_kg"]) == Decimal("4000")


async def test_lineas_de_remito_traen_lote_label_y_cosecha_label(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    pasero = await create_parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    parral = await create_parcela(nombre="Parral 1", tipo=TipoParcela.parral, variedad=VariedadUva.flame)
    lote = await _lote_cerrado(client, headers, pasero.id, kg="1000")
    cosecha_id = await _cosecha(client, headers, parral.id, "MI", kg=5000)
    comprador = await _comprador(client, headers)

    pasa = await client.post("/remitos/", json={
        "tipo": "entrega_pasa", "fecha": "2026-04-01", "comprador_id": comprador,
        "lineas": [{"lote_id": lote["id"], "kg": "100"}]}, headers=headers)
    assert pasa.status_code == 201, pasa.text
    linea = pasa.json()["lineas"][0]
    assert linea["lote_label"] == f"{lote['temporada']} · sultanina · 1 · N°{lote['numero']}"
    assert linea["cosecha_label"] is None

    fresco = await client.post("/remitos/", json={
        "tipo": "salida_fresco", "fecha": "2026-02-06", "comprador_id": comprador,
        "lineas": [{"cosecha_id": cosecha_id, "kg": "100"}]}, headers=headers)
    assert fresco.status_code == 201, fresco.text
    linea = fresco.json()["lineas"][0]
    assert linea["cosecha_label"] == "2026-02-05 · flame · Parral 1"
    assert linea["lote_label"] is None

    listado = (await client.get("/remitos/", headers=headers)).json()
    labels = {(l["lote_label"], l["cosecha_label"]) for r in listado for l in r["lineas"]}
    assert len(labels) == 2
