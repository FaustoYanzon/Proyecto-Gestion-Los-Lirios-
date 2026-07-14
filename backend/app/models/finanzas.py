from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.parcela import Parcela
    from app.models.user import User


class OrigenPago(str, enum.Enum):
    oficial = "oficial"
    no_oficial = "no_oficial"


class Finca(str, enum.Enum):
    los_mimbres = "los_mimbres"
    media_agua = "media_agua"
    caucete = "caucete"


class FormaPago(str, enum.Enum):
    efectivo = "efectivo"
    transferencia = "transferencia"
    cheque = "cheque"
    echeque = "echeque"
    credito = "credito"


class MonedaTipo(str, enum.Enum):
    ars = "ars"
    usd = "usd"


class DestinoIngreso(str, enum.Enum):
    uva_mesa = "uva_mesa"
    bodega = "bodega"
    pasa = "pasa"
    alfalfa = "alfalfa"
    cebolla = "cebolla"
    sandia = "sandia"
    alquiler = "alquiler"
    otro = "otro"


class EstadoIngreso(str, enum.Enum):
    no_registrado = "no_registrado"
    facturado = "facturado"


class TipoEgreso(str, enum.Enum):
    sueldos_personal = "sueldos_personal"
    produccion = "produccion"
    inversion = "inversion"
    insumos_varios = "insumos_varios"
    impuestos_servicios = "impuestos_servicios"
    financiero = "financiero"
    materia_prima = "materia_prima"


class ClasificacionEgreso(str, enum.Enum):
    # Sueldos personal
    gerenciales = "gerenciales"
    encargados = "encargados"
    obreros = "obreros"
    contador = "contador"
    abogado = "abogado"
    administrador = "administrador"
    sueldos_otros = "sueldos_otros"
    # Producción
    fertilizantes = "fertilizantes"
    agroquimicos = "agroquimicos"
    produccion_otros = "produccion_otros"
    # Inversión
    inversion_movilidad = "inversion_movilidad"
    inversion_infraestructura = "inversion_infraestructura"
    inversion_riego = "inversion_riego"
    inversion_otros = "inversion_otros"
    # Insumos varios
    rep_repuestos_vehiculos = "rep_repuestos_vehiculos"
    rep_repuestos_infraestructura = "rep_repuestos_infraestructura"
    combustibles = "combustibles"
    insumos_otros = "insumos_otros"
    # Impuestos / servicios
    vep = "vep"
    energia_electrica = "energia_electrica"
    hidraulica = "hidraulica"
    rentas = "rentas"
    gas = "gas"
    internet = "internet"
    servicios_otros = "servicios_otros"
    # Financiero
    creditos_bancarios = "creditos_bancarios"
    seguros = "seguros"
    intereses = "intereses"
    financiero_otros = "financiero_otros"
    # Materia prima
    compra_uva_fresca = "compra_uva_fresca"
    compra_pasa = "compra_pasa"
    materia_prima_otros = "materia_prima_otros"


class Egreso(Base):
    __tablename__ = "egresos"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    tipo: Mapped[TipoEgreso] = mapped_column(SAEnum(TipoEgreso), nullable=False)
    clasificacion: Mapped[ClasificacionEgreso] = mapped_column(
        SAEnum(ClasificacionEgreso), nullable=False
    )
    descripcion: Mapped[str | None] = mapped_column(String(500), nullable=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    moneda: Mapped[MonedaTipo] = mapped_column(SAEnum(MonedaTipo), nullable=False)
    tipo_cambio: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    origen: Mapped[OrigenPago] = mapped_column(SAEnum(OrigenPago), nullable=False)
    finca: Mapped[Finca] = mapped_column(SAEnum(Finca), nullable=False)
    forma_pago: Mapped[FormaPago] = mapped_column(SAEnum(FormaPago), nullable=False)
    parcela_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=True
    )
    fuente: Mapped[str] = mapped_column(String(50), default="manual", nullable=False)
    referencia_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
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
        Index("ix_egresos_fecha", "fecha"),
        Index("ix_egresos_finca_fecha", "finca", "fecha"),
        Index("ix_egresos_moneda_fecha", "moneda", "fecha"),
    )

    parcela: Mapped[Parcela | None] = relationship("Parcela", back_populates="egresos")
    created_by_user: Mapped[User] = relationship("User", back_populates="egresos")


class Ingreso(Base):
    """A cobro (collection) — one row per payment received, mirroring the
    farm's "BD COBROS" ledger. Not a per-kg uva sale record: destino is the
    income category (uva de mesa, bodega, pasa, ...), comprador is free text.
    """

    __tablename__ = "ingresos"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    destino: Mapped[DestinoIngreso] = mapped_column(SAEnum(DestinoIngreso), nullable=False)
    comprador: Mapped[str] = mapped_column(String(200), nullable=False)
    forma_pago: Mapped[FormaPago] = mapped_column(SAEnum(FormaPago), nullable=False)
    estado: Mapped[EstadoIngreso | None] = mapped_column(SAEnum(EstadoIngreso), nullable=True)
    # Free text on purpose: "cuenta_destino" (caja, BSJ, or a person's name)
    # comes from an open-ended source spreadsheet — locking it to an enum
    # would reject values Fausto hasn't used yet. The frontend offers known
    # values plus previously-typed ones via GET /finanzas/ingresos/cuentas-destino.
    cuenta_destino: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Cheque-only fields — populated when forma_pago is cheque/echeque.
    banco: Mapped[str | None] = mapped_column(String(100), nullable=True)
    n_cheque: Mapped[str | None] = mapped_column(String(50), nullable=True)
    f_pago: Mapped[date | None] = mapped_column(Date, nullable=True)
    # What the cheque was used for once spent. NULL/empty = still available.
    # Drives the cheque tracking screen (/dashboard/finanzas/cheques).
    uso_cheque: Mapped[str | None] = mapped_column(String(200), nullable=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    moneda: Mapped[MonedaTipo] = mapped_column(SAEnum(MonedaTipo), nullable=False)
    tipo_cambio: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    origen: Mapped[OrigenPago] = mapped_column(SAEnum(OrigenPago), nullable=False)
    finca: Mapped[Finca] = mapped_column(SAEnum(Finca), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
        Index("ix_ingresos_fecha", "fecha"),
        Index("ix_ingresos_finca_fecha", "finca", "fecha"),
        Index("ix_ingresos_moneda_fecha", "moneda", "fecha"),
        Index("ix_ingresos_forma_pago", "forma_pago"),
    )

    created_by_user: Mapped[User] = relationship("User", back_populates="ingresos")
