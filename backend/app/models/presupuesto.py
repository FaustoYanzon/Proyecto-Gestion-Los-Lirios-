from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.finanzas import ClasificacionEgreso, MonedaTipo, TipoEgreso

if TYPE_CHECKING:
    from app.models.parcela import Parcela
    from app.models.user import User


class ConceptoPresupuesto(str, enum.Enum):
    ingreso = "ingreso"
    egreso = "egreso"


class Presupuesto(Base):
    """Monthly budget line for a campaign season.

    Mirrors the PRESUP sheet of the annual cash-flow Excel: one row per
    (temporada, mes, concepto, categoria). `temporada` follows the same
    convention as RegistroCosecha: 2026 = May 2026 -> April 2027.
    """

    __tablename__ = "presupuestos"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    temporada: Mapped[int] = mapped_column(Integer, nullable=False)
    mes: Mapped[int] = mapped_column(Integer, nullable=False)  # calendar month 1-12
    concepto: Mapped[ConceptoPresupuesto] = mapped_column(
        SAEnum(ConceptoPresupuesto), nullable=False
    )
    # Egreso rows budget at `tipo` level; `clasificacion` is optional drill-down.
    tipo: Mapped[TipoEgreso | None] = mapped_column(SAEnum(TipoEgreso), nullable=True)
    clasificacion: Mapped[ClasificacionEgreso | None] = mapped_column(
        SAEnum(ClasificacionEgreso), nullable=True
    )
    # Ingreso rows budget per client/buyer (CAMPERO, PUTRUELE, ... in the Excel).
    cliente: Mapped[str | None] = mapped_column(String(200), nullable=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    moneda: Mapped[MonedaTipo] = mapped_column(SAEnum(MonedaTipo), nullable=False)
    notas: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
        Index("ix_presupuestos_temporada", "temporada"),
        Index("ix_presupuestos_temporada_mes", "temporada", "mes"),
    )

    created_by_user: Mapped[User] = relationship("User")


class MetaProduccion(Base):
    """Planned production (kg) per parcela per season.

    Loaded once at the start of each campaign; enables plan-vs-real KPIs
    (kg totales vs plan, % avance cosecha, desvio de rinde vs plan).
    """

    __tablename__ = "metas_produccion"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    temporada: Mapped[int] = mapped_column(Integer, nullable=False)
    parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=False
    )
    kg_plan: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    notas: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
        UniqueConstraint("temporada", "parcela_id", name="uq_metas_temporada_parcela"),
        Index("ix_metas_produccion_temporada", "temporada"),
    )

    parcela: Mapped[Parcela] = relationship("Parcela")
    created_by_user: Mapped[User] = relationship("User")
