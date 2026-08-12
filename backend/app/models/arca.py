from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.finanzas import Egreso, Ingreso
    from app.models.user import User


class TipoArchivoArca(str, enum.Enum):
    recibido = "recibido"
    emitido = "emitido"


class EstadoComprobanteArca(str, enum.Enum):
    pendiente = "pendiente"
    clasificado = "clasificado"
    descartado = "descartado"


class LoteImportacionArca(Base):
    """One row per CSV upload from ARCA "Mis Comprobantes" (recibidos or
    emitidos). Also what the Alertas reminder checks against to know if a
    quincena's file was already imported."""

    __tablename__ = "lotes_importacion_arca"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    tipo_archivo: Mapped[TipoArchivoArca] = mapped_column(
        SAEnum(TipoArchivoArca), nullable=False
    )
    nombre_archivo: Mapped[str] = mapped_column(String(255), nullable=False)
    cantidad_filas: Mapped[int] = mapped_column(Integer, nullable=False)
    cantidad_nuevas: Mapped[int] = mapped_column(Integer, nullable=False)
    cantidad_duplicadas: Mapped[int] = mapped_column(Integer, nullable=False)
    importado_por: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    importado_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        Index("ix_lotes_importacion_arca_tipo_fecha", "tipo_archivo", "importado_at"),
    )

    comprobantes: Mapped[list[ComprobanteArcaImportado]] = relationship(
        "ComprobanteArcaImportado", back_populates="lote"
    )


class ComprobanteArcaImportado(Base):
    """One row per comprobante from an imported ARCA CSV (recibido = compra,
    emitido = venta). Kept separate from Egreso/Ingreso so ARCA-specific
    fields (CUIT, CAE, IVA breakdown) don't leak into those models -- once
    classified, this row links forward via egreso_id/ingreso_id.
    """

    __tablename__ = "comprobantes_arca_importados"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    lote_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("lotes_importacion_arca.id"), nullable=False
    )
    # Denormalized from the lote for the dedup unique index and for filtering
    # without a join.
    tipo_archivo: Mapped[TipoArchivoArca] = mapped_column(
        SAEnum(TipoArchivoArca), nullable=False
    )
    fecha_emision: Mapped[date] = mapped_column(Date, nullable=False)
    tipo_comprobante: Mapped[int] = mapped_column(Integer, nullable=False)
    tipo_comprobante_desc: Mapped[str] = mapped_column(String(100), nullable=False)
    es_nota_credito: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    punto_venta: Mapped[int] = mapped_column(Integer, nullable=False)
    numero_desde: Mapped[int] = mapped_column(Integer, nullable=False)
    numero_hasta: Mapped[int] = mapped_column(Integer, nullable=False)
    cod_autorizacion: Mapped[str | None] = mapped_column(String(30), nullable=True)
    cuit_contraparte: Mapped[str] = mapped_column(String(20), nullable=False)
    denominacion_contraparte: Mapped[str] = mapped_column(String(200), nullable=False)
    moneda: Mapped[str] = mapped_column(String(3), nullable=False)
    tipo_cambio: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    imp_neto_gravado_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    imp_no_gravado: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    imp_exentas: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    otros_tributos: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    total_iva: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    imp_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    estado: Mapped[EstadoComprobanteArca] = mapped_column(
        SAEnum(EstadoComprobanteArca), nullable=False, default=EstadoComprobanteArca.pendiente
    )
    egreso_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("egresos.id"), nullable=True
    )
    ingreso_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("ingresos.id"), nullable=True
    )
    clasificado_por: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    clasificado_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        Index("ix_comprobantes_arca_estado", "tipo_archivo", "estado"),
        Index("ix_comprobantes_arca_fecha_emision", "fecha_emision"),
        Index(
            "uq_comprobantes_arca_natural_key",
            "tipo_archivo", "tipo_comprobante", "punto_venta", "numero_desde", "cuit_contraparte",
            unique=True,
        ),
    )

    lote: Mapped[LoteImportacionArca] = relationship(
        "LoteImportacionArca", back_populates="comprobantes"
    )
    egreso: Mapped[Egreso | None] = relationship("Egreso")
    ingreso: Mapped[Ingreso | None] = relationship("Ingreso")
