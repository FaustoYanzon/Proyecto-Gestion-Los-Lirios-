from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean, Date, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, Numeric, Sequence, String, Text,
    UniqueConstraint, text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.finanzas import Finca

if TYPE_CHECKING:
    from app.models.user import User


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class TipoMaquina(str, enum.Enum):
    tractor = "tractor"
    cosechadora = "cosechadora"
    enfardadora = "enfardadora"
    implemento = "implemento"


class GravedadFalla(str, enum.Enum):
    sigue_trabajando = "sigue_trabajando"
    parada = "parada"


class EstadoOrdenMaquinaria(str, enum.Enum):
    reportada = "reportada"
    diagnosticada = "diagnosticada"
    presupuesto_pendiente = "presupuesto_pendiente"
    presupuesto_aprobado = "presupuesto_aprobado"
    enviada_taller = "enviada_taller"
    en_reparacion = "en_reparacion"
    lista_retirar = "lista_retirar"
    pendiente_validacion = "pendiente_validacion"
    cerrada = "cerrada"
    cancelada = "cancelada"


class EstadoPresupuestoMaquinaria(str, enum.Enum):
    pendiente = "pendiente"
    aprobado = "aprobado"
    rechazado = "rechazado"


# Human-friendly global order number ("OM-0012" on the clients).
ORDEN_NUMERO_SEQ = Sequence("maquinaria_orden_numero_seq")

ICONOS_MAQUINA: tuple[str, ...] = ("tractor", "carro", "implemento")


def icono_por_defecto(tipo: TipoMaquina) -> str:
    """Icon derived from the machine type when none was chosen explicitly."""
    if tipo == TipoMaquina.tractor:
        return "tractor"
    if tipo == TipoMaquina.implemento:
        return "implemento"
    return "carro"


class Maquina(Base):
    __tablename__ = "maquinas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tipo: Mapped[TipoMaquina] = mapped_column(
        SAEnum(TipoMaquina, name="tipomaquina"), nullable=False
    )
    marca: Mapped[str] = mapped_column(String(100), nullable=False)
    modelo: Mapped[str] = mapped_column(String(100), nullable=False)
    anio: Mapped[int | None] = mapped_column(Integer, nullable=True)
    patente_serie: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Reserved for stage 2 (preventive maintenance by engine hours).
    horas_motor: Mapped[Decimal | None] = mapped_column(Numeric(10, 1), nullable=True)
    # Current location; machines move between fincas.
    finca: Mapped[Finca] = mapped_column(
        SAEnum(Finca, name="finca", create_type=False), nullable=False
    )
    # Implement -> tractor it is usually hitched to.
    tractor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("maquinas.id"), nullable=True
    )
    foto_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 'tractor' | 'carro' | 'implemento'; null = derive from `tipo`. Plain string on purpose.
    icono: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    ordenes: Mapped[list[OrdenMaquinaria]] = relationship(
        "OrdenMaquinaria", back_populates="maquina"
    )

    @property
    def icono_resuelto(self) -> str:
        return self.icono or icono_por_defecto(self.tipo)

    __table_args__ = (Index("ix_maquinas_finca", "finca"),)


class OrdenMaquinaria(Base):
    __tablename__ = "maquinaria_ordenes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # Assigned by the service (Postgres sequence; max+1 fallback on SQLite).
    numero: Mapped[int] = mapped_column(Integer, nullable=False)
    maquina_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("maquinas.id"), nullable=False
    )
    # Snapshot of the machine's finca at report time (assumption A2).
    finca: Mapped[Finca] = mapped_column(
        SAEnum(Finca, name="finca", create_type=False), nullable=False
    )
    reportada_por: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    gravedad: Mapped[GravedadFalla] = mapped_column(
        SAEnum(GravedadFalla, name="gravedadfalla"), nullable=False
    )
    estado: Mapped[EstadoOrdenMaquinaria] = mapped_column(
        SAEnum(EstadoOrdenMaquinaria, name="estadoordenmaquinaria"),
        default=EstadoOrdenMaquinaria.reportada,
        nullable=False,
    )
    taller: Mapped[str | None] = mapped_column(String(200), nullable=True)
    fecha_estimada_entrega: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Client-generated key so an offline report retried after sync is not duplicated.
    idempotency_key: Mapped[str | None] = mapped_column(
        String(36), unique=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    maquina: Mapped[Maquina] = relationship("Maquina", back_populates="ordenes")
    reportada_por_user: Mapped[User] = relationship("User", foreign_keys=[reportada_por])
    fotos: Mapped[list[FotoOrdenMaquinaria]] = relationship(
        "FotoOrdenMaquinaria",
        back_populates="orden",
        cascade="all, delete-orphan",
        order_by="FotoOrdenMaquinaria.created_at",
    )
    presupuestos: Mapped[list[PresupuestoMaquinaria]] = relationship(
        "PresupuestoMaquinaria",
        back_populates="orden",
        order_by="PresupuestoMaquinaria.created_at",
    )
    pago: Mapped[PagoMaquinaria | None] = relationship(
        "PagoMaquinaria", back_populates="orden", uselist=False
    )
    eventos: Mapped[list[EventoOrdenMaquinaria]] = relationship(
        "EventoOrdenMaquinaria",
        back_populates="orden",
        order_by="EventoOrdenMaquinaria.created_at",
    )

    __table_args__ = (
        UniqueConstraint("numero", name="uq_maquinaria_ordenes_numero"),
        Index("ix_maquinaria_ordenes_maquina", "maquina_id"),
        Index("ix_maquinaria_ordenes_finca_estado", "finca", "estado"),
    )


class FotoOrdenMaquinaria(Base):
    __tablename__ = "maquinaria_orden_fotos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    orden_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("maquinaria_ordenes.id"), nullable=False
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    subida_por: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    orden: Mapped[OrdenMaquinaria] = relationship("OrdenMaquinaria", back_populates="fotos")

    __table_args__ = (Index("ix_maquinaria_orden_fotos_orden", "orden_id"),)


class PresupuestoMaquinaria(Base):
    __tablename__ = "maquinaria_presupuestos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    orden_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("maquinaria_ordenes.id"), nullable=False
    )
    taller: Mapped[str] = mapped_column(String(200), nullable=False)
    # ARS only (decision 5): there is no currency column on purpose.
    monto: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    adjunto_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    estado: Mapped[EstadoPresupuestoMaquinaria] = mapped_column(
        SAEnum(EstadoPresupuestoMaquinaria, name="estadopresupuestomaquinaria"),
        default=EstadoPresupuestoMaquinaria.pendiente,
        nullable=False,
    )
    motivo_rechazo: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    resuelto_por: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    resuelto_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    orden: Mapped[OrdenMaquinaria] = relationship(
        "OrdenMaquinaria", back_populates="presupuestos"
    )

    __table_args__ = (
        Index("ix_maquinaria_presupuestos_orden", "orden_id"),
        # At most one pending budget per order (assumption A4), enforced in the DB.
        Index(
            "uq_maquinaria_presupuesto_pendiente",
            "orden_id",
            unique=True,
            postgresql_where=text("estado = 'pendiente'"),
            sqlite_where=text("estado = 'pendiente'"),
        ),
    )


class PagoMaquinaria(Base):
    __tablename__ = "maquinaria_pagos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # One payment per order (assumption A5).
    orden_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("maquinaria_ordenes.id"), unique=True, nullable=False
    )
    monto_real: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    factura_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    registrado_por: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    egreso_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("egresos.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    orden: Mapped[OrdenMaquinaria] = relationship("OrdenMaquinaria", back_populates="pago")


class EventoOrdenMaquinaria(Base):
    """Timeline row: one per state change. Also the base for 'days out of service'."""

    __tablename__ = "maquinaria_orden_eventos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    orden_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("maquinaria_ordenes.id"), nullable=False
    )
    # Null on the creation event.
    estado_desde: Mapped[EstadoOrdenMaquinaria | None] = mapped_column(
        SAEnum(EstadoOrdenMaquinaria, name="estadoordenmaquinaria", create_type=False),
        nullable=True,
    )
    estado_hasta: Mapped[EstadoOrdenMaquinaria] = mapped_column(
        SAEnum(EstadoOrdenMaquinaria, name="estadoordenmaquinaria", create_type=False),
        nullable=False,
    )
    usuario_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    nota: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    orden: Mapped[OrdenMaquinaria] = relationship("OrdenMaquinaria", back_populates="eventos")

    __table_args__ = (Index("ix_maquinaria_orden_eventos_orden", "orden_id", "created_at"),)
