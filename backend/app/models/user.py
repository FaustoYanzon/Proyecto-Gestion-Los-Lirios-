from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.finanzas import Egreso, Ingreso
    from app.models.produccion import (
        CicloCampana,
        RegistroCosecha,
        RegistroFitosanitario,
        RegistroRiego,
        RegistroTrabajo,
    )


class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    gerencial = "gerencial"
    encargado = "encargado"
    regador = "regador"
    obrero = "obrero"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole), default=UserRole.obrero, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Incremented to invalidate all previously issued JWTs for this user
    # (password change, forced logout, deactivation). The access token carries
    # this value as the "tv" claim; a mismatch is rejected in get_current_user.
    token_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
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

    egresos: Mapped[list[Egreso]] = relationship(
        "Egreso", back_populates="created_by_user"
    )
    ingresos: Mapped[list[Ingreso]] = relationship(
        "Ingreso", back_populates="created_by_user"
    )
    registros_trabajo: Mapped[list[RegistroTrabajo]] = relationship(
        "RegistroTrabajo", back_populates="created_by_user"
    )
    registros_riego: Mapped[list[RegistroRiego]] = relationship(
        "RegistroRiego", back_populates="created_by_user"
    )
    registros_fitosanitarios: Mapped[list[RegistroFitosanitario]] = relationship(
        "RegistroFitosanitario", back_populates="created_by_user"
    )
    ciclos_campana: Mapped[list[CicloCampana]] = relationship(
        "CicloCampana", back_populates="created_by_user"
    )
    registros_cosecha: Mapped[list[RegistroCosecha]] = relationship(
        "RegistroCosecha", back_populates="created_by_user"
    )
