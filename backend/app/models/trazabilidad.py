from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum as SAEnum, Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.parcela import Parcela
    from app.models.user import User


class OrigenAnalisis(str, enum.Enum):
    propio = "propio"
    laboratorio = "laboratorio"


class EstadoSanitarioAnalisis(str, enum.Enum):
    sano = "sano"
    con_observaciones = "con_observaciones"
    rechazado = "rechazado"


class Foto(Base):
    """Album de fotos por parcela para la ficha de trazabilidad. Asociadas por
    fecha, no atadas a un evento puntual (riego/fito/cosecha) -- decision
    explicita del usuario, ver plan de la feature."""

    __tablename__ = "fotos_parcela"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=False
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    categoria: Mapped[str] = mapped_column(String(50), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(500), nullable=True)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_fotos_parcela_parcela_fecha", "parcela_id", "fecha"),
    )

    parcela: Mapped[Parcela] = relationship("Parcela", back_populates="fotos")
    created_by_user: Mapped[User] = relationship("User")


class AnalisisCalidad(Base):
    """Analisis de calidad de fruta por parcela (grados, acidez, ph, estado
    sanitario) -- medido por la propia finca o recibido de un laboratorio o
    bodega compradora (informe adjunto opcional, imagen o PDF)."""

    __tablename__ = "analisis_calidad"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=False
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    origen: Mapped[OrigenAnalisis] = mapped_column(SAEnum(OrigenAnalisis), nullable=False)
    brix: Mapped[float | None] = mapped_column(Float, nullable=True)
    acidez: Mapped[float | None] = mapped_column(Float, nullable=True)
    ph: Mapped[float | None] = mapped_column(Float, nullable=True)
    estado_sanitario: Mapped[EstadoSanitarioAnalisis | None] = mapped_column(
        SAEnum(EstadoSanitarioAnalisis), nullable=True
    )
    laboratorio_nombre: Mapped[str | None] = mapped_column(String(150), nullable=True)
    informe_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    observaciones: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_analisis_calidad_parcela_fecha", "parcela_id", "fecha"),
    )

    parcela: Mapped[Parcela] = relationship("Parcela", back_populates="analisis_calidad")
    created_by_user: Mapped[User] = relationship("User")
