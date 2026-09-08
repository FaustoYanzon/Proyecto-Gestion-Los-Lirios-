from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, Enum as SAEnum, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.produccion import RegistroFitosanitario
    from app.models.user import User


class UnidadInsumo(str, enum.Enum):
    kg = "kg"
    lt = "lt"


class TipoMovimientoStock(str, enum.Enum):
    ingreso = "ingreso"
    egreso_aplicacion = "egreso_aplicacion"
    ajuste = "ajuste"


class Insumo(Base):
    __tablename__ = "insumos"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    nombre: Mapped[str] = mapped_column(String(150), nullable=False)
    unidad: Mapped[UnidadInsumo] = mapped_column(SAEnum(UnidadInsumo), nullable=False)
    categoria: Mapped[str | None] = mapped_column(String(50), nullable=True)
    stock_actual: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    registros_fitosanitarios: Mapped[list[RegistroFitosanitario]] = relationship(
        "RegistroFitosanitario", back_populates="insumo"
    )
    movimientos: Mapped[list[MovimientoStock]] = relationship(
        "MovimientoStock", back_populates="insumo"
    )


class MovimientoStock(Base):
    __tablename__ = "movimientos_stock"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    insumo_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("insumos.id"), nullable=False
    )
    tipo: Mapped[TipoMovimientoStock] = mapped_column(SAEnum(TipoMovimientoStock), nullable=False)
    cantidad: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    observacion: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Único cuando no es null: un egreso automático por aplicación tiene siempre
    # un solo movimiento asociado, fácil de encontrar y revertir en update/delete
    # del RegistroFitosanitario (ver app/api/produccion.py).
    registro_fitosanitario_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("registros_fitosanitarios.id"), nullable=True
    )
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        Index("ix_movimientos_stock_insumo_fecha", "insumo_id", "fecha"),
        Index(
            "uq_movimientos_stock_registro_fitosanitario",
            "registro_fitosanitario_id",
            unique=True,
            postgresql_where=text("registro_fitosanitario_id IS NOT NULL"),
        ),
    )

    insumo: Mapped[Insumo] = relationship("Insumo", back_populates="movimientos")
    registro_fitosanitario: Mapped[RegistroFitosanitario | None] = relationship(
        "RegistroFitosanitario", back_populates="movimiento_stock"
    )
    created_by_user: Mapped[User] = relationship("User")
