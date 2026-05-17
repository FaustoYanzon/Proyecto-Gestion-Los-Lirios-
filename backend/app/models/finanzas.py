from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.parcela import VariedadUva

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
    credito = "credito"


class MonedaTipo(str, enum.Enum):
    ars = "ars"
    usd = "usd"


class ProductoIngreso(str, enum.Enum):
    uva_fresca = "uva_fresca"
    pasa = "pasa"
    mosto = "mosto"
    otro = "otro"


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
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    parcela: Mapped[Parcela | None] = relationship("Parcela", back_populates="egresos")
    created_by_user: Mapped[User] = relationship("User", back_populates="egresos")


class Ingreso(Base):
    __tablename__ = "ingresos"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    cliente: Mapped[str] = mapped_column(String(200), nullable=False)
    producto: Mapped[ProductoIngreso] = mapped_column(
        SAEnum(ProductoIngreso), nullable=False
    )
    variedad: Mapped[VariedadUva | None] = mapped_column(
        SAEnum(VariedadUva), nullable=True
    )
    kg_totales: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    precio_por_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    moneda: Mapped[MonedaTipo] = mapped_column(SAEnum(MonedaTipo), nullable=False)
    tipo_cambio: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    origen: Mapped[OrigenPago] = mapped_column(SAEnum(OrigenPago), nullable=False)
    finca: Mapped[Finca] = mapped_column(SAEnum(Finca), nullable=False)
    forma_pago: Mapped[FormaPago] = mapped_column(SAEnum(FormaPago), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(500), nullable=True)
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

    created_by_user: Mapped[User] = relationship("User", back_populates="ingresos")
