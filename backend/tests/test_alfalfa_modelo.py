"""Alfalfa inventory (2026-11-17): model constraints enforced by the database."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.alta_produccion import Comprador, Deposito
from app.models.alfalfa import (
    DocumentoAlfalfa,
    DocumentoAlfalfaLinea,
    ProductoAlfalfa,
    TipoDocumentoAlfalfa,
)
from app.models.parcela import TipoParcela


@pytest.fixture
async def refs(db_session, create_user, create_parcela):
    user = await create_user()
    potrero = await create_parcela(nombre="Potrero 1", tipo=TipoParcela.potrero)
    comprador = Comprador(nombre="Comprador Test")
    deposito = Deposito(nombre="Depósito Alfa")
    db_session.add_all([comprador, deposito])
    await db_session.commit()
    return {"user": user.id, "potrero": potrero.id, "comprador": comprador.id, "deposito": deposito.id}


def _alta(refs, numero="ALF-ALT-000001", **over) -> DocumentoAlfalfa:
    data = dict(
        tipo=TipoDocumentoAlfalfa.alta,
        numero=numero,
        fecha=date(2026, 11, 17),
        potrero_id=refs["potrero"],
        deposito_id=refs["deposito"],
        created_by=refs["user"],
    )
    data.update(over)
    return DocumentoAlfalfa(**data)


def _linea(producto: ProductoAlfalfa, cantidad: str, kg: str) -> DocumentoAlfalfaLinea:
    return DocumentoAlfalfaLinea(producto=producto, cantidad=Decimal(cantidad), kg=Decimal(kg))


async def test_alta_valida_con_dos_lineas(db_session, refs):
    doc = _alta(refs)
    doc.lineas = [
        _linea(ProductoAlfalfa.rollo, "2", "600"),
        _linea(ProductoAlfalfa.fardo, "10", "200"),
    ]
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    assert len(doc.lineas) == 2
    assert {l.producto for l in doc.lineas} == {ProductoAlfalfa.fardo, ProductoAlfalfa.rollo}


async def test_alta_sin_potrero_falla(db_session, refs):
    db_session.add(_alta(refs, potrero_id=None))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_salida_con_potrero_falla(db_session, refs):
    db_session.add(
        _alta(
            refs,
            tipo=TipoDocumentoAlfalfa.salida,
            numero="ALF-SAL-000001",
            comprador_id=refs["comprador"],
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_salida_valida(db_session, refs):
    db_session.add(
        _alta(
            refs,
            tipo=TipoDocumentoAlfalfa.salida,
            numero="ALF-SAL-000001",
            potrero_id=None,
            comprador_id=refs["comprador"],
        )
    )
    await db_session.commit()


async def test_producto_repetido_en_documento_falla(db_session, refs):
    doc = _alta(refs)
    doc.lineas = [
        _linea(ProductoAlfalfa.fardo, "1", "20"),
        _linea(ProductoAlfalfa.fardo, "2", "40"),
    ]
    db_session.add(doc)
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_tipo_numero_repetido_falla(db_session, refs):
    db_session.add(_alta(refs))
    await db_session.commit()
    db_session.add(_alta(refs))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_idempotency_key_unica_cuando_no_es_nula(db_session, refs):
    db_session.add(_alta(refs, numero="ALF-ALT-000001", idempotency_key="k1"))
    db_session.add(_alta(refs, numero="ALF-ALT-000002"))
    db_session.add(_alta(refs, numero="ALF-ALT-000003"))  # several NULL keys are fine
    await db_session.commit()
    db_session.add(_alta(refs, numero="ALF-ALT-000004", idempotency_key="k1"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
