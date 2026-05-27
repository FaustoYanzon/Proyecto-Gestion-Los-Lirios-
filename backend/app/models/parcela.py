from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Float, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.finanzas import Egreso
    from app.models.produccion import (
        CicloCampana,
        RegistroCosecha,
        RegistroFitosanitario,
        RegistroRiego,
        RegistroTrabajo,
    )


class TipoParcela(str, enum.Enum):
    parral = "parral"
    potrero = "potrero"
    pasero = "pasero"
    cabezal = "cabezal"


class VariedadUva(str, enum.Enum):
    flame = "flame"
    red_globe = "red_globe"
    fiesta = "fiesta"
    bonarda = "bonarda"
    sultanina = "sultanina"
    syrah = "syrah"
    aspirant = "aspirant"
    alfalfa = "alfalfa"
    otro = "otro"


class Parcela(Base):
    __tablename__ = "parcelas"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    nombre: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    tipo: Mapped[TipoParcela] = mapped_column(SAEnum(TipoParcela), nullable=False)
    variedad: Mapped[VariedadUva | None] = mapped_column(
        SAEnum(VariedadUva), nullable=True
    )
    superficie_ha: Mapped[float | None] = mapped_column(Float, nullable=True)
    cabezal_riego: Mapped[str | None] = mapped_column(String(20), nullable=True)
    coordenadas: Mapped[list | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    egresos: Mapped[list[Egreso]] = relationship(
        "Egreso", back_populates="parcela"
    )
    registros_trabajo: Mapped[list[RegistroTrabajo]] = relationship(
        "RegistroTrabajo", back_populates="parcela"
    )
    registros_riego: Mapped[list[RegistroRiego]] = relationship(
        "RegistroRiego", back_populates="parcela"
    )
    registros_fitosanitarios: Mapped[list[RegistroFitosanitario]] = relationship(
        "RegistroFitosanitario", back_populates="parcela"
    )
    ciclos_campana: Mapped[list[CicloCampana]] = relationship(
        "CicloCampana", back_populates="parcela"
    )
    registros_cosecha: Mapped[list[RegistroCosecha]] = relationship(
        "RegistroCosecha", back_populates="parcela"
    )
