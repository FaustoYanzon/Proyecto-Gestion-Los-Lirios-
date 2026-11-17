"""Alfalfa inventory (2026-11-17): service rules and schemas.

Covers frozen kg, derived stock (altas minus salidas), stock validation on
salidas, schema validation, numbering per tipo and idempotent retries.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select

from app.models.alfalfa import (
    DocumentoAlfalfa,
    ProductoAlfalfa,
    TipoDocumentoAlfalfa,
)
from app.models.alta_produccion import Comprador
from app.models.parcela import Parcela, TipoParcela
from app.models.user import UserRole
from app.schemas.alfalfa import DocumentoAlfalfaCreate, DocumentoAlfalfaOut
from app.services.alfalfa import (
    DEPOSITO_ALFA,
    crear_documento,
    get_deposito_alfa,
    stock_alfalfa,
)

FECHA = date(2026, 11, 17)


@pytest.fixture
async def refs(db_session, create_user):
    user = await create_user(role=UserRole.gerencial)
    potrero = Parcela(nombre="Potrero 1", tipo=TipoParcela.potrero)
    comprador = Comprador(nombre="Forrajera del Valle")
    db_session.add_all([potrero, comprador])
    await db_session.commit()
    return {"user": user.id, "potrero": potrero.id, "comprador": comprador.id}


def _alta(refs, lineas, **over) -> DocumentoAlfalfaCreate:
    data = {
        "tipo": "alta",
        "fecha": FECHA,
        "potrero_id": refs["potrero"],
        "lineas": [{"producto": p, "cantidad": c} for p, c in lineas],
    }
    data.update(over)
    return DocumentoAlfalfaCreate(**data)


def _salida(refs, lineas, **over) -> DocumentoAlfalfaCreate:
    data = {
        "tipo": "salida",
        "fecha": FECHA,
        "comprador_id": refs["comprador"],
        "lineas": [{"producto": p, "cantidad": c} for p, c in lineas],
    }
    data.update(over)
    return DocumentoAlfalfaCreate(**data)


async def _count_documentos(db_session) -> int:
    return int(await db_session.scalar(select(func.count()).select_from(DocumentoAlfalfa)))


def _stock_por_producto(stock) -> dict:
    return {s.producto: s for s in stock}


# ── Alta ─────────────────────────────────────────────────────────────────────

async def test_alta_tres_lineas_congela_kg(db_session, refs, client, create_user):
    doc, creado = await crear_documento(
        db_session,
        _alta(refs, [("fardo", "10"), ("rollo", "2"), ("semilla", "50")]),
        refs["user"],
    )
    assert creado is True
    assert doc.numero == "ALF-ALT-000001"
    kg = {l.producto: l.kg for l in doc.lineas}
    assert kg == {
        ProductoAlfalfa.fardo: Decimal("200"),
        ProductoAlfalfa.rollo: Decimal("600"),
        ProductoAlfalfa.semilla: Decimal("50"),
    }
    out = DocumentoAlfalfaOut.model_validate(doc)
    assert out.kg_total == Decimal("850")
    doc_id = doc.id
    await db_session.commit()

    # Changing the parameter must not rewrite documents already loaded.
    await create_user(email="admin2@test.com", password="Password123!")
    login = await client.post(
        "/auth/login", data={"username": "admin2@test.com", "password": "Password123!"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = await client.patch("/alta-produccion/parametros", json={"kg_fardo": "25"}, headers=headers)
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    viejo = await db_session.get(DocumentoAlfalfa, doc_id)
    fardo = next(l for l in viejo.lineas if l.producto == ProductoAlfalfa.fardo)
    assert fardo.kg == Decimal("200")

    nuevo, _ = await crear_documento(db_session, _alta(refs, [("fardo", "10")]), refs["user"])
    assert nuevo.lineas[0].kg == Decimal("250")


async def test_stock_sin_movimientos_devuelve_tres_productos_en_cero(db_session):
    stock = await stock_alfalfa(db_session)
    assert [s.producto for s in stock] == [
        ProductoAlfalfa.fardo, ProductoAlfalfa.rollo, ProductoAlfalfa.semilla
    ]
    assert all(s.unidades == 0 and s.kg == 0 for s in stock)


async def test_stock_altas_menos_salidas(db_session, refs):
    await crear_documento(db_session, _alta(refs, [("fardo", "6"), ("semilla", "12.5")]), refs["user"])
    await crear_documento(db_session, _alta(refs, [("fardo", "4"), ("rollo", "3")]), refs["user"])
    await crear_documento(db_session, _salida(refs, [("fardo", "4")]), refs["user"])

    stock = _stock_por_producto(await stock_alfalfa(db_session))
    assert stock[ProductoAlfalfa.fardo].unidades == Decimal("6")
    assert stock[ProductoAlfalfa.fardo].kg == Decimal("120")
    assert stock[ProductoAlfalfa.rollo].unidades == Decimal("3")
    assert stock[ProductoAlfalfa.rollo].kg == Decimal("900")
    # Semilla is loaded by kg: units and kg are the same figure.
    assert stock[ProductoAlfalfa.semilla].unidades == Decimal("12.5")
    assert stock[ProductoAlfalfa.semilla].kg == Decimal("12.5")


# ── Salida ───────────────────────────────────────────────────────────────────

async def test_salida_igual_al_stock_pasa(db_session, refs):
    await crear_documento(db_session, _alta(refs, [("rollo", "5"), ("semilla", "30")]), refs["user"])

    doc, creado = await crear_documento(
        db_session,
        _salida(refs, [("rollo", "5"), ("semilla", "30")], vehiculo_patente="AB123CD"),
        refs["user"],
    )

    assert creado is True
    assert doc.comprador_id == refs["comprador"]
    deposito = await get_deposito_alfa(db_session)
    assert deposito.nombre == DEPOSITO_ALFA
    assert doc.deposito_id == deposito.id
    stock = _stock_por_producto(await stock_alfalfa(db_session))
    assert stock[ProductoAlfalfa.rollo].unidades == 0
    assert stock[ProductoAlfalfa.semilla].kg == 0


async def test_salida_mayor_al_stock_409(db_session, refs):
    await crear_documento(db_session, _alta(refs, [("fardo", "3")]), refs["user"])
    antes = await _count_documentos(db_session)

    with pytest.raises(HTTPException) as exc:
        await crear_documento(db_session, _salida(refs, [("fardo", "4")]), refs["user"])

    assert exc.value.status_code == 409
    assert "fardo" in exc.value.detail
    assert "3" in exc.value.detail
    assert await _count_documentos(db_session) == antes


async def test_comprador_inexistente_404(db_session, refs):
    with pytest.raises(HTTPException) as exc:
        await crear_documento(
            db_session,
            _salida(refs, [("fardo", "1")], comprador_id="00000000-0000-0000-0000-000000000000"),
            refs["user"],
        )
    assert exc.value.status_code == 404


async def test_comprador_inactivo_422(db_session, refs):
    comprador = await db_session.get(Comprador, refs["comprador"])
    comprador.is_active = False
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await crear_documento(db_session, _salida(refs, [("fardo", "1")]), refs["user"])
    assert exc.value.status_code == 422


# ── Schema validation (FastAPI turns these into 422) ─────────────────────────

def test_fardo_fraccionario_422(refs):
    with pytest.raises(ValidationError):
        _alta(refs, [("fardo", "1.5")])
    with pytest.raises(ValidationError):
        _alta(refs, [("rollo", "0.25")])


def test_fardo_entero_con_decimales_cero_es_valido(refs):
    data = _alta(refs, [("fardo", "10.00")])
    assert data.lineas[0].cantidad == Decimal("10")


def test_producto_repetido_422(refs):
    with pytest.raises(ValidationError):
        _alta(refs, [("fardo", "1"), ("fardo", "2")])


def test_semilla_tres_decimales_422(refs):
    with pytest.raises(ValidationError):
        _alta(refs, [("semilla", "1.234")])


def test_cantidad_fuera_de_rango_422(refs):
    # Numeric(14,2) allows 12 whole digits.
    with pytest.raises(ValidationError):
        _alta(refs, [("semilla", "1000000000000")])
    with pytest.raises(ValidationError):
        _alta(refs, [("semilla", "0")])
    with pytest.raises(ValidationError):
        _alta(refs, [("semilla", "-1")])


def test_sin_lineas_422(refs):
    with pytest.raises(ValidationError):
        _alta(refs, [])


def test_alta_sin_potrero_422(refs):
    with pytest.raises(ValidationError):
        _alta(refs, [("fardo", "1")], potrero_id=None)


def test_salida_sin_comprador_422(refs):
    with pytest.raises(ValidationError):
        _salida(refs, [("fardo", "1")], comprador_id=None)


def test_campos_del_otro_tipo_422(refs):
    with pytest.raises(ValidationError):
        _alta(refs, [("fardo", "1")], comprador_id=refs["comprador"])
    with pytest.raises(ValidationError):
        _alta(refs, [("fardo", "1")], vehiculo_patente="AB123CD")
    with pytest.raises(ValidationError):
        _salida(refs, [("fardo", "1")], potrero_id=refs["potrero"])


# ── Potrero validation ───────────────────────────────────────────────────────

async def test_potrero_inexistente_404(db_session, refs):
    with pytest.raises(HTTPException) as exc:
        await crear_documento(
            db_session,
            _alta(refs, [("fardo", "1")], potrero_id="00000000-0000-0000-0000-000000000000"),
            refs["user"],
        )
    assert exc.value.status_code == 404


async def test_potrero_inactivo_422(db_session, refs):
    potrero = await db_session.get(Parcela, refs["potrero"])
    potrero.is_active = False
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await crear_documento(db_session, _alta(refs, [("fardo", "1")]), refs["user"])
    assert exc.value.status_code == 422


async def test_parcela_no_potrero_422(db_session, refs):
    pasero = Parcela(nombre="Pasero 1", tipo=TipoParcela.pasero)
    db_session.add(pasero)
    await db_session.flush()

    with pytest.raises(HTTPException) as exc:
        await crear_documento(
            db_session, _alta(refs, [("fardo", "1")], potrero_id=pasero.id), refs["user"]
        )
    assert exc.value.status_code == 422


async def test_kg_fuera_de_rango_422(db_session, refs):
    # 12 whole digits fit the column as units, but × kg_rollo they overflow it.
    with pytest.raises(HTTPException) as exc:
        await crear_documento(db_session, _alta(refs, [("rollo", "999999999999")]), refs["user"])
    assert exc.value.status_code == 422


# ── Numbering and idempotency ────────────────────────────────────────────────

async def test_numeracion_correlativa_por_tipo(db_session, refs):
    primero, _ = await crear_documento(db_session, _alta(refs, [("fardo", "5")]), refs["user"])
    segundo, _ = await crear_documento(db_session, _alta(refs, [("fardo", "5")]), refs["user"])
    salida, _ = await crear_documento(db_session, _salida(refs, [("fardo", "1")]), refs["user"])

    assert primero.numero == "ALF-ALT-000001"
    assert segundo.numero == "ALF-ALT-000002"
    assert salida.numero == "ALF-SAL-000001"


async def test_idempotency_key_reintento_devuelve_original(db_session, refs):
    key = "3f1c2b6e-8d0a-4c55-9a77-0e2f6b1d9c10"
    original, creado = await crear_documento(
        db_session, _alta(refs, [("fardo", "10")], idempotency_key=key), refs["user"]
    )
    assert creado is True

    # Different content with the same key: the original document comes back.
    reintento, creado_2 = await crear_documento(
        db_session, _alta(refs, [("rollo", "7")], idempotency_key=key), refs["user"]
    )

    assert creado_2 is False
    assert reintento.id == original.id
    assert [l.producto for l in reintento.lineas] == [ProductoAlfalfa.fardo]
    assert await _count_documentos(db_session) == 1


async def test_salida_idempotency_replay_no_409_aunque_falte_stock(db_session, refs):
    await crear_documento(db_session, _alta(refs, [("fardo", "10")]), refs["user"])
    key = "7a1d0c52-3b9e-4f0a-8e6d-5c2b9a4e1f33"
    original, creado = await crear_documento(
        db_session, _salida(refs, [("fardo", "8")], idempotency_key=key), refs["user"]
    )
    assert creado is True
    antes = await _count_documentos(db_session)

    # Same key, payload now exceeds the remaining stock (2): replay wins, no 409.
    reintento, creado_2 = await crear_documento(
        db_session, _salida(refs, [("fardo", "8")], idempotency_key=key), refs["user"]
    )

    assert creado_2 is False
    assert reintento.id == original.id
    assert await _count_documentos(db_session) == antes


async def test_salida_replay_tras_lock_no_409(db_session, refs, monkeypatch):
    """Simulates request B: its pre-lock lookup misses (A had not committed),
    but A's document is visible once B holds the depot lock."""
    from app.services import alfalfa as svc

    await crear_documento(db_session, _alta(refs, [("fardo", "10")]), refs["user"])
    key = "9b2e1d63-4c0f-4a1b-9f7e-6d3c0b5f2a44"
    original, _ = await crear_documento(
        db_session, _salida(refs, [("fardo", "8")], idempotency_key=key), refs["user"]
    )

    real = svc._buscar_por_key
    calls = {"n": 0}

    async def miss_first(db, k):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(db, k)

    monkeypatch.setattr(svc, "_buscar_por_key", miss_first)
    reintento, creado = await crear_documento(
        db_session, _salida(refs, [("fardo", "8")], idempotency_key=key), refs["user"]
    )

    assert creado is False
    assert reintento.id == original.id


async def test_integrity_error_ajeno_se_propaga(db_session, refs, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    from app.services import alfalfa as svc

    async def boom(*args, **kwargs):
        raise IntegrityError("INSERT", {}, Exception("FOREIGN KEY constraint failed"))

    monkeypatch.setattr(db_session, "flush", boom)
    with pytest.raises(IntegrityError):
        await svc.crear_documento(db_session, _alta(refs, [("fardo", "1")]), refs["user"])
