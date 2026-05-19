from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.parcela import Parcela
    from app.models.user import User


TAREAS_POR_CLASIFICACION: dict[str, list[str]] = {
    "verano": [
        "Cosecha",
        "Tractor Cosecha",
        "Pasero",
        "Levantar Pasa",
        "Control Cosecha",
        "Amontonar Pasa",
        "Otros",
    ],
    "invierno": ["Poda", "Atada", "Tejido", "Otros"],
    "primavera": ["Verde", "Brote", "Raleo", "Polainas", "Descole", "Otros"],
    "otono": ["Murones", "Otros"],
    "general": [
        "Jornal Comun",
        "Tractor Comun",
        "Riego",
        "Mochila",
        "Limpieza Acequia",
        "Rastrillar Pasto",
        "Anchada",
        "Zanjeo",
        "Otros",
    ],
}

CLASIFICACION_POR_TAREA: dict[str, str] = {
    "Cosecha": "verano",
    "Tractor Cosecha": "verano",
    "Pasero": "verano",
    "Levantar Pasa": "verano",
    "Control Cosecha": "verano",
    "Amontonar Pasa": "verano",
    "Poda": "invierno",
    "Atada": "invierno",
    "Tejido": "invierno",
    "Verde": "primavera",
    "Brote": "primavera",
    "Raleo": "primavera",
    "Polainas": "primavera",
    "Descole": "primavera",
    "Murones": "otono",
    "Jornal Comun": "general",
    "Tractor Comun": "general",
    "Riego": "general",
    "Mochila": "general",
    "Limpieza Acequia": "general",
    "Rastrillar Pasto": "general",
    "Anchada": "general",
    "Zanjeo": "general",
}


class ClasificacionTarea(str, enum.Enum):
    general = "general"
    verano = "verano"
    otono = "otono"
    invierno = "invierno"
    primavera = "primavera"


class UnidadMedida(str, enum.Enum):
    dias = "dias"
    plantas = "plantas"
    melgas = "melgas"
    metros = "metros"
    vines = "vines"
    cajas = "cajas"
    gamelas = "gamelas"
    otros = "otros"


class EstadoFenologico(str, enum.Enum):
    brotacion = "brotacion"
    floracion = "floracion"
    cuaje = "cuaje"
    envero = "envero"
    madurez = "madurez"
    cosecha = "cosecha"
    latencia = "latencia"


class RegistroTrabajo(Base):
    __tablename__ = "registros_trabajo"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    parcela_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=True
    )
    trabajador_nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    clasificacion: Mapped[ClasificacionTarea] = mapped_column(
        SAEnum(ClasificacionTarea), nullable=False
    )
    tarea: Mapped[str] = mapped_column(String(100), nullable=False)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unidad_medida: Mapped[UnidadMedida] = mapped_column(
        SAEnum(UnidadMedida), nullable=False
    )
    precio_unitario: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    monto_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    detalle: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def __init__(self, **kwargs: Any) -> None:
        if "monto_total" not in kwargs:
            cantidad = kwargs.get("cantidad")
            precio_unitario = kwargs.get("precio_unitario")
            if cantidad is not None and precio_unitario is not None:
                kwargs["monto_total"] = Decimal(str(cantidad)) * Decimal(str(precio_unitario))
        super().__init__(**kwargs)

    parcela: Mapped[Parcela | None] = relationship(
        "Parcela", back_populates="registros_trabajo"
    )
    created_by_user: Mapped[User] = relationship(
        "User", back_populates="registros_trabajo"
    )


class RegistroRiego(Base):
    __tablename__ = "registros_riego"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=False
    )
    cabezal: Mapped[str] = mapped_column(String(20), nullable=False)
    valvula: Mapped[str] = mapped_column(String(20), nullable=False)
    inicio: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fin: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duracion_horas: Mapped[float] = mapped_column(Float, nullable=False)
    mm_aplicados: Mapped[float | None] = mapped_column(Float, nullable=True)
    fertilizante_nombre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fertilizante_dosis_lt_ha: Mapped[float | None] = mapped_column(Float, nullable=True)
    responsable: Mapped[str] = mapped_column(String(100), nullable=False)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # 16,000 L/ha/h = 1.6 mm/h
    MM_POR_HORA: float = 1.6

    def __init__(self, **kwargs: Any) -> None:
        inicio = kwargs.get("inicio")
        fin = kwargs.get("fin")
        if "duracion_horas" not in kwargs and inicio is not None and fin is not None:
            kwargs["duracion_horas"] = (fin - inicio).total_seconds() / 3600
        if kwargs.get("mm_aplicados") is None and kwargs.get("duracion_horas") is not None:
            kwargs["mm_aplicados"] = round(kwargs["duracion_horas"] * 1.6, 2)
        super().__init__(**kwargs)

    parcela: Mapped[Parcela] = relationship(
        "Parcela", back_populates="registros_riego"
    )
    created_by_user: Mapped[User] = relationship(
        "User", back_populates="registros_riego"
    )


class RegistroFitosanitario(Base):
    __tablename__ = "registros_fitosanitarios"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=False
    )
    producto_nombre: Mapped[str] = mapped_column(String(200), nullable=False)
    dosis_lt_ha: Mapped[float] = mapped_column(Float, nullable=False)
    motivo: Mapped[str] = mapped_column(String(500), nullable=False)
    dias_carencia: Mapped[int] = mapped_column(Integer, nullable=False)
    dias_reingreso: Mapped[int] = mapped_column(Integer, nullable=False)
    fecha_habilitacion_cosecha: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_habilitacion_reingreso: Mapped[date] = mapped_column(Date, nullable=False)
    responsable: Mapped[str] = mapped_column(String(100), nullable=False)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def __init__(self, **kwargs: Any) -> None:
        fecha = kwargs.get("fecha")
        if "fecha_habilitacion_cosecha" not in kwargs and fecha is not None:
            dias_carencia = kwargs.get("dias_carencia")
            if dias_carencia is not None:
                kwargs["fecha_habilitacion_cosecha"] = fecha + timedelta(days=dias_carencia)
        if "fecha_habilitacion_reingreso" not in kwargs and fecha is not None:
            dias_reingreso = kwargs.get("dias_reingreso")
            if dias_reingreso is not None:
                kwargs["fecha_habilitacion_reingreso"] = fecha + timedelta(days=dias_reingreso)
        super().__init__(**kwargs)

    parcela: Mapped[Parcela] = relationship(
        "Parcela", back_populates="registros_fitosanitarios"
    )
    created_by_user: Mapped[User] = relationship(
        "User", back_populates="registros_fitosanitarios"
    )


class CicloCampana(Base):
    __tablename__ = "ciclos_campana"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=False
    )
    anio: Mapped[int] = mapped_column(Integer, nullable=False)
    estado_fenologico: Mapped[EstadoFenologico] = mapped_column(
        SAEnum(EstadoFenologico), nullable=False
    )
    fecha_estado: Mapped[date] = mapped_column(Date, nullable=False)
    rendimiento_kg_ha: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    observaciones: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    parcela: Mapped[Parcela] = relationship(
        "Parcela", back_populates="ciclos_campana"
    )
    created_by_user: Mapped[User] = relationship(
        "User", back_populates="ciclos_campana"
    )
