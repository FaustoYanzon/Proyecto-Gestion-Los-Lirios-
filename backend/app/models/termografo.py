"""Modelos para el registro histórico del termógrafo de campo (dispositivo BLE,
CSV exportado por QR). Mismo patrón que app.models.arca: una tabla "lote" por
CSV subido + una tabla de lecturas, con índice único para dedupe -- resubir el
mismo CSV (o uno que se solapa en el borde con el anterior) no duplica filas.

`device_id` está en ambas tablas desde el día uno para dejar el schema listo
si algún día hay más de un termógrafo -- sin construir ninguna UI de selección
de dispositivo hasta que eso sea real.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LoteImportacionTermografo(Base):
    __tablename__ = "lotes_importacion_termografo"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    device_id: Mapped[str] = mapped_column(String(50), nullable=False)
    nombre_archivo: Mapped[str] = mapped_column(String(255), nullable=False)
    intervalo_seg: Mapped[int] = mapped_column(Integer, nullable=False)
    rango_inicio: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rango_fin: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
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
        Index("ix_lotes_importacion_termografo_device_fecha", "device_id", "importado_at"),
    )

    lecturas: Mapped[list[LecturaTermografo]] = relationship(
        "LecturaTermografo", back_populates="lote"
    )


class LecturaTermografo(Base):
    __tablename__ = "lecturas_termografo"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    lote_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("lotes_importacion_termografo.id"), nullable=False
    )
    # Denormalizado del lote para el índice único de dedupe y para filtrar sin join.
    device_id: Mapped[str] = mapped_column(String(50), nullable=False)
    fecha_hora: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    temperatura: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    humedad: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)

    __table_args__ = (
        Index(
            "uq_lecturas_termografo_natural_key",
            "device_id", "fecha_hora",
            unique=True,
        ),
    )

    lote: Mapped[LoteImportacionTermografo] = relationship(
        "LoteImportacionTermografo", back_populates="lecturas"
    )
