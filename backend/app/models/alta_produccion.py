"""Módulo "Alta de Producción": cadena de la fruta parral -> pasero -> lote ->
depósito -> comprador, con remitos como documentos de movimiento.

Se apoya en lo existente: el alta de kilos cosechados sigue siendo
`RegistroCosecha` (se extiende con `productor_id`) y el pasero es una `Parcela`
de tipo pasero. Cantidades en kg siempre `Numeric`/`Decimal`.
"""
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
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.parcela import VariedadUva
from app.models.produccion import OrigenCosecha

if TYPE_CHECKING:
    from app.models.parcela import Parcela


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


KG = Numeric(14, 2)


class TipoProductor(str, enum.Enum):
    propio = "propio"
    externo = "externo"


class EstadoLote(str, enum.Enum):
    abierto = "abierto"
    cerrado = "cerrado"


class TipoRemito(str, enum.Enum):
    salida_fresco = "salida_fresco"
    salida_bodega = "salida_bodega"
    entrega_pasa = "entrega_pasa"


class Productor(Base):
    __tablename__ = "productores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    nombre: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    tipo: Mapped[TipoProductor] = mapped_column(
        SAEnum(TipoProductor), nullable=False, default=TipoProductor.externo
    )
    cuit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contacto: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class Comprador(Base):
    __tablename__ = "compradores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    nombre: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    cuit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contacto: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class Deposito(Base):
    __tablename__ = "depositos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class ParametroProduccion(Base):
    """Valores configurables (kg por ficha, ratio uva/pasa, etc.). Un renglón
    por clave; si falta, el servicio usa el default de `PARAMETROS_DEFAULT`."""

    __tablename__ = "parametros_produccion"

    clave: Mapped[str] = mapped_column(String(50), primary_key=True)
    valor: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )


class UbicacionPasero(Base):
    """Parte de una hilera dentro de un pasero (raqueo). El pasero es una
    `Parcela` de tipo pasero."""

    __tablename__ = "ubicaciones_pasero"
    __table_args__ = (UniqueConstraint("pasero_id", "hilera", "parte", name="uq_ubicacion_pasero"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    pasero_id: Mapped[str] = mapped_column(String(36), ForeignKey("parcelas.id"), nullable=False, index=True)
    hilera: Mapped[int] = mapped_column(Integer, nullable=False)
    parte: Mapped[int] = mapped_column(Integer, nullable=False)

    pasero: Mapped["Parcela"] = relationship("Parcela")


class IngresoPasero(Base):
    __tablename__ = "ingresos_pasero"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    pasero_id: Mapped[str] = mapped_column(String(36), ForeignKey("parcelas.id"), nullable=False, index=True)
    ubicacion_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("ubicaciones_pasero.id"), nullable=True
    )
    cosecha_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("registros_cosecha.id"), nullable=True, index=True
    )
    variedad: Mapped[VariedadUva] = mapped_column(SAEnum(VariedadUva), nullable=False, index=True)
    origen: Mapped[OrigenCosecha] = mapped_column(SAEnum(OrigenCosecha), nullable=False)
    productor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("productores.id"), nullable=True)

    carros: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    fichas: Mapped[int] = mapped_column(Integer, nullable=False)
    kg_teorico: Mapped[Decimal] = mapped_column(KG, nullable=False)
    kg_real: Mapped[Decimal] = mapped_column(KG, nullable=False)
    # kg_teorico - kg_real (positivo = merma; negativo = la báscula pesó de más).
    merma_kg: Mapped[Decimal] = mapped_column(KG, nullable=False)

    observaciones: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class Lote(Base):
    """Lote de pasa levantada. Una sola variedad; identificado por
    temporada + variedad + calidad + número."""

    __tablename__ = "lotes_pasa"
    __table_args__ = (
        UniqueConstraint("temporada", "variedad", "calidad", "numero", name="uq_lote_pasa"),
        # A lo sumo un lote abierto por variedad+calidad, garantizado en la base.
        Index(
            "uq_lote_pasa_abierto",
            "variedad",
            "calidad",
            unique=True,
            postgresql_where=text("estado = 'abierto'"),
            sqlite_where=text("estado = 'abierto'"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    temporada: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    variedad: Mapped[VariedadUva] = mapped_column(SAEnum(VariedadUva), nullable=False)
    calidad: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 buena, 2 mala
    numero: Mapped[int] = mapped_column(Integer, nullable=False)
    estado: Mapped[EstadoLote] = mapped_column(
        SAEnum(EstadoLote), nullable=False, default=EstadoLote.abierto, index=True
    )
    deposito_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("depositos.id"), nullable=True)
    kg_total: Mapped[Decimal] = mapped_column(KG, nullable=False, default=Decimal("0"))
    saldo_kg: Mapped[Decimal] = mapped_column(KG, nullable=False, default=Decimal("0"))
    # Tope de bines vigente al abrir el lote (None = sin tope).
    tope_bines: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    bines: Mapped[list["Bin"]] = relationship(
        "Bin", back_populates="lote", cascade="all, delete-orphan", order_by="Bin.created_at"
    )


class Bin(Base):
    __tablename__ = "bines_pasa"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    lote_id: Mapped[str] = mapped_column(String(36), ForeignKey("lotes_pasa.id"), nullable=False, index=True)
    pasero_id: Mapped[str] = mapped_column(String(36), ForeignKey("parcelas.id"), nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    kg_real: Mapped[Decimal] = mapped_column(KG, nullable=False)
    # Uva fresca descontada del pasero por este bin (kg_real * ratio uva/pasa).
    uva_consumida_kg: Mapped[Decimal] = mapped_column(KG, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)

    lote: Mapped["Lote"] = relationship("Lote", back_populates="bines")


class Remito(Base):
    __tablename__ = "remitos"
    __table_args__ = (UniqueConstraint("tipo", "numero", name="uq_remito_tipo_numero"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tipo: Mapped[TipoRemito] = mapped_column(SAEnum(TipoRemito), nullable=False, index=True)
    numero: Mapped[str] = mapped_column(String(50), nullable=False)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    comprador_id: Mapped[str] = mapped_column(String(36), ForeignKey("compradores.id"), nullable=False)
    kg_total: Mapped[Decimal] = mapped_column(KG, nullable=False, default=Decimal("0"))
    vehiculo_patente: Mapped[str | None] = mapped_column(String(20), nullable=True)
    observaciones: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)

    lineas: Mapped[list["RemitoLinea"]] = relationship(
        "RemitoLinea", back_populates="remito", cascade="all, delete-orphan"
    )
    comprobante_bodega: Mapped["ComprobanteBodega | None"] = relationship(
        "ComprobanteBodega", back_populates="remito", uselist=False, cascade="all, delete-orphan"
    )


class RemitoLinea(Base):
    """Descuento concreto de stock: de un `Lote` (entrega de pasa) o de un
    `RegistroCosecha` (salida de fresco/bodega). Exactamente uno de los dos."""

    __tablename__ = "remito_lineas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    remito_id: Mapped[str] = mapped_column(String(36), ForeignKey("remitos.id"), nullable=False, index=True)
    lote_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("lotes_pasa.id"), nullable=True, index=True)
    cosecha_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("registros_cosecha.id"), nullable=True, index=True
    )
    kg: Mapped[Decimal] = mapped_column(KG, nullable=False)

    remito: Mapped["Remito"] = relationship("Remito", back_populates="lineas")


class ComprobanteBodega(Base):
    """Contraparte INV de un remito de salida a bodega (SUV + kg recibidos)."""

    __tablename__ = "comprobantes_bodega"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    remito_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("remitos.id"), nullable=False, unique=True
    )
    numero_suv: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    kg_recibidos: Mapped[Decimal] = mapped_column(KG, nullable=False)
    fecha: Mapped[date | None] = mapped_column(Date, nullable=True)
    observaciones: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)

    remito: Mapped["Remito"] = relationship("Remito", back_populates="comprobante_bodega")
