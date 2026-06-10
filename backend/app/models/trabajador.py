from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.produccion import RegistroTrabajo


class RolTrabajador(str, enum.Enum):
    obrero = "obrero"
    tractorista = "tractorista"
    encargado_cuadrilla = "encargado_cuadrilla"
    otro = "otro"


class Trabajador(Base):
    __tablename__ = "trabajadores"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    nombre_completo: Mapped[str] = mapped_column(String(150), nullable=False)
    dni: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    rol: Mapped[RolTrabajador] = mapped_column(
        SAEnum(RolTrabajador), default=RolTrabajador.obrero, nullable=False
    )
    telefono: Mapped[str | None] = mapped_column(String(30), nullable=True)
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

    registros_trabajo: Mapped[list[RegistroTrabajo]] = relationship(
        "RegistroTrabajo", back_populates="trabajador"
    )
