"""Annulment columns (2026-11-17): constraints enforced by the database."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.alfalfa import DocumentoAlfalfa, TipoDocumentoAlfalfa
from app.models.alta_produccion import Comprador, Deposito, Remito, RemitoLinea, TipoRemito


@pytest.fixture
async def refs(db_session, create_user, create_parcela):
    from app.models.parcela import TipoParcela

    user = await create_user()
    potrero = await create_parcela(nombre="Potrero 1", tipo=TipoParcela.potrero)
    comprador = Comprador(nombre="Comprador Test")
    deposito = Deposito(nombre="Depósito Alfa")
    db_session.add_all([comprador, deposito])
    await db_session.commit()
    return {"user": user.id, "potrero": potrero.id, "comprador": comprador.id, "deposito": deposito.id}


def _remito(refs, numero="REM-000001", **over) -> Remito:
    data = dict(
        tipo=TipoRemito.salida_fresco,
        numero=numero,
        fecha=date(2026, 11, 17),
        comprador_id=refs["comprador"],
        created_by=refs["user"],
    )
    data.update(over)
    return Remito(**data)


def _documento(refs, **over) -> DocumentoAlfalfa:
    data = dict(
        tipo=TipoDocumentoAlfalfa.alta,
        numero="ALF-ALT-000001",
        fecha=date(2026, 11, 17),
        potrero_id=refs["potrero"],
        deposito_id=refs["deposito"],
        created_by=refs["user"],
    )
    data.update(over)
    return DocumentoAlfalfa(**data)


async def test_remito_anulacion_incompleta_viola_check(db_session, refs):
    db_session.add(_remito(refs, anulado_at=datetime.now(timezone.utc)))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_remito_anulacion_completa_ok(db_session, refs):
    remito = _remito(
        refs,
        anulado_at=datetime.now(timezone.utc),
        anulado_by=refs["user"],
        motivo_anulacion="Error de carga",
    )
    db_session.add(remito)
    await db_session.commit()
    await db_session.refresh(remito)
    assert remito.motivo_anulacion == "Error de carga"


async def test_documento_alfalfa_anulacion_incompleta_viola_check(db_session, refs):
    db_session.add(_documento(refs, motivo_anulacion="solo motivo"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_documento_alfalfa_anulacion_completa_ok(db_session, refs):
    doc = _documento(
        refs,
        anulado_at=datetime.now(timezone.utc),
        anulado_by=refs["user"],
        motivo_anulacion="Duplicado",
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)
    assert doc.anulado_at is not None


async def _remito_con_linea(db_session, refs, numero, bin_id, anulada):
    remito = _remito(refs, numero=numero)
    remito.lineas = [RemitoLinea(bin_id=bin_id, kg=Decimal("10"), anulada=anulada)]
    db_session.add(remito)
    await db_session.commit()


async def test_bin_liberado_por_linea_anulada(db_session, refs):
    # Annulled line keeps its bin for audit but frees it for a new delivery.
    await _remito_con_linea(db_session, refs, "REM-000001", "bin-1", True)
    await _remito_con_linea(db_session, refs, "REM-000002", "bin-1", False)


async def test_bin_duplicado_en_lineas_vigentes_viola_indice(db_session, refs):
    await _remito_con_linea(db_session, refs, "REM-000001", "bin-1", False)
    with pytest.raises(IntegrityError):
        await _remito_con_linea(db_session, refs, "REM-000002", "bin-1", False)
