"""Alfalfa inventory: fardos, rollos and semilla. Stock is derived from
documents (altas minus salidas) and lives in the fictitious "Depósito Alfa".
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

DEPOSITO_ALFA = "Depósito Alfa"


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


QTY = Numeric(14, 2)


class TipoDocumentoAlfalfa(str, enum.Enum):
    alta = "alta"
    salida = "salida"


class ProductoAlfalfa(str, enum.Enum):
    fardo = "fardo"
    rollo = "rollo"
    semilla = "semilla"


class DocumentoAlfalfa(Base):
    __tablename__ = "documentos_alfalfa"
    __table_args__ = (
        UniqueConstraint("tipo", "numero", name="uq_documento_alfalfa_tipo_numero"),
        # Alta carries the potrero; salida carries the comprador.
        CheckConstraint(
            "(tipo = 'alta' AND potrero_id IS NOT NULL AND comprador_id IS NULL) "
            "OR (tipo = 'salida' AND comprador_id IS NOT NULL AND potrero_id IS NULL)",
            name="ck_documento_alfalfa_destinatario_segun_tipo",
        ),
        # Retries with the same key must not create a second document.
        Index(
            "uq_documento_alfalfa_idempotency_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
            sqlite_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tipo: Mapped[TipoDocumentoAlfalfa] = mapped_column(
        SAEnum(TipoDocumentoAlfalfa), nullable=False, index=True
    )
    numero: Mapped[str] = mapped_column(String(50), nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    potrero_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("parcelas.id", name="fk_documentos_alfalfa_potrero_id_parcelas"),
        nullable=True, index=True,
    )
    comprador_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compradores.id", name="fk_documentos_alfalfa_comprador_id_compradores"),
        nullable=True, index=True,
    )
    deposito_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("depositos.id", name="fk_documentos_alfalfa_deposito_id_depositos"),
        nullable=False,
    )
    vehiculo_patente: Mapped[str | None] = mapped_column(String(20), nullable=True)
    observaciones: Mapped[str | None] = mapped_column(String(500), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)

    lineas: Mapped[list["DocumentoAlfalfaLinea"]] = relationship(
        "DocumentoAlfalfaLinea",
        back_populates="documento",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="DocumentoAlfalfaLinea.producto",
    )


class DocumentoAlfalfaLinea(Base):
    __tablename__ = "documento_alfalfa_lineas"
    __table_args__ = (
        UniqueConstraint("documento_id", "producto", name="uq_documento_alfalfa_linea_producto"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    documento_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documentos_alfalfa.id"), nullable=False, index=True
    )
    producto: Mapped[ProductoAlfalfa] = mapped_column(SAEnum(ProductoAlfalfa), nullable=False)
    # Units for fardo/rollo, kg for semilla.
    cantidad: Mapped[Decimal] = mapped_column(QTY, nullable=False)
    # Frozen at creation with the parameters in force (kg_fardo / kg_rollo).
    kg: Mapped[Decimal] = mapped_column(QTY, nullable=False)

    documento: Mapped["DocumentoAlfalfa"] = relationship("DocumentoAlfalfa", back_populates="lineas")
