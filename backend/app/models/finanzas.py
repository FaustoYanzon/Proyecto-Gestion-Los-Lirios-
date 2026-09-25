from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    ColumnElement, Date, DateTime, Enum as SAEnum, ForeignKey, Index, Numeric, String, and_, case,
)
from sqlalchemy.ext.hybrid import hybrid_property
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


class TipoEgreso(str, enum.Enum):
    sueldos_personal = "sueldos_personal"
    produccion = "produccion"
    inversion = "inversion"
    insumos_varios = "insumos_varios"
    impuestos_servicios = "impuestos_servicios"
    financiero = "financiero"
    materia_prima = "materia_prima"
    repuestos_reparacion = "repuestos_reparacion"


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
    combustibles = "combustibles"
    herramientas = "herramientas"
    indumentaria = "indumentaria"
    insumos_otros = "insumos_otros"
    # Repuestos y reparación (rep_repuestos_vehiculos/infraestructura ya
    # existían bajo insumos_varios -- mismo nombre de clasificacion, solo
    # cambian de tipo, ver migracion de reclasificacion de datos)
    rep_repuestos_vehiculos = "rep_repuestos_vehiculos"
    rep_repuestos_infraestructura = "rep_repuestos_infraestructura"
    rep_repuestos_maquinaria = "rep_repuestos_maquinaria"
    rep_repuestos_riego = "rep_repuestos_riego"
    rep_repuestos_parral = "rep_repuestos_parral"
    rep_repuestos_otros = "rep_repuestos_otros"
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


class ChequeMixin:
    """Campos de cheque/echeque compartidos por Egreso (cheques emitidos) e
    Ingreso (cheques recibidos). Solo se completan cuando forma_pago es
    cheque o echeque."""

    banco: Mapped[str | None] = mapped_column(String(100), nullable=True)
    n_cheque: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Fecha de Pago del cheque (columna "F PAGO" de BD Cobros): desde ese día
    # se puede cobrar/se debita, y es cuando impacta el ingreso o el gasto --
    # ver fecha_imputacion.
    f_pago: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Cuándo se mandó el aviso push de "ya se puede cobrar / se debita hoy"
    # (app/core/cheques_aviso.py). NULL = todavía no se avisó.
    aviso_pago_enviado_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @hybrid_property
    def fecha_imputacion(self) -> date:
        """Fecha en que el movimiento impacta en flujo/dashboard/KPIs: la
        Fecha de Pago (f_pago) para cheques y echeques, `fecha` para el resto.
        `fecha` sigue siendo cuándo se recibió/emitió."""
        if self.forma_pago in (FormaPago.cheque, FormaPago.echeque) and self.f_pago is not None:
            return self.f_pago
        return self.fecha

    @fecha_imputacion.inplace.expression
    @classmethod
    def _fecha_imputacion_expression(cls) -> ColumnElement[date]:
        return case(
            (
                and_(
                    cls.forma_pago.in_([FormaPago.cheque, FormaPago.echeque]),
                    cls.f_pago.is_not(None),
                ),
                cls.f_pago,
            ),
            else_=cls.fecha,
        )


class Egreso(ChequeMixin, Base):
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


class Ingreso(ChequeMixin, Base):
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
    # Free text on purpose: "cuenta_destino" (caja, BSJ, or a person's name)
    # comes from an open-ended source spreadsheet — locking it to an enum
    # would reject values Fausto hasn't used yet. The frontend offers known
    # values plus previously-typed ones via GET /finanzas/ingresos/cuentas-destino.
    cuenta_destino: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # banco / n_cheque / f_pago vienen de ChequeMixin.
    # What the cheque was used for once spent. NULL/empty = still available.
    # Drives the cheque tracking screen (/dashboard/finanzas/cheques).
    uso_cheque: Mapped[str | None] = mapped_column(String(200), nullable=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    moneda: Mapped[MonedaTipo] = mapped_column(SAEnum(MonedaTipo), nullable=False)
    tipo_cambio: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    origen: Mapped[OrigenPago] = mapped_column(SAEnum(OrigenPago), nullable=False)
    finca: Mapped[Finca] = mapped_column(SAEnum(Finca), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fuente: Mapped[str] = mapped_column(String(50), default="manual", nullable=False)
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
