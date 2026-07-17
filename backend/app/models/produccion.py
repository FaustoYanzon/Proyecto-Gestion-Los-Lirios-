from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, DateTime, Enum as SAEnum, Float, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.parcela import Parcela
    from app.models.trabajador import Trabajador
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
    trabajador_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("trabajadores.id"), nullable=True
    )
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
        Index("ix_registros_trabajo_fecha", "fecha"),
        Index("ix_registros_trabajo_parcela_fecha", "parcela_id", "fecha"),
        Index("ix_registros_trabajo_trabajador_id", "trabajador_id"),
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
    trabajador: Mapped[Trabajador | None] = relationship(
        "Trabajador", back_populates="registros_trabajo"
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
    # NULL mientras el riego está "en curso" (arrancó pero todavía no se cerró
    # con /riego/{id}/terminar) — se completa recién al terminar.
    fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duracion_horas: Mapped[float | None] = mapped_column(Float, nullable=True)
    mm_aplicados: Mapped[float | None] = mapped_column(Float, nullable=True)
    fertilizante_nombre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fertilizante_dosis_lt_ha: Mapped[float | None] = mapped_column(Float, nullable=True)
    responsable: Mapped[str] = mapped_column(String(100), nullable=False)
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
        Index("ix_registros_riego_fecha", "fecha"),
        Index("ix_registros_riego_parcela_fecha", "parcela_id", "fecha"),
        Index("ix_registros_riego_en_curso", "cabezal", postgresql_where=text("fin IS NULL")),
    )

    # Cada valvula riega 1 ha y entrega 16,000 L/h => 1.6 mm/h sobre esa ha.
    MM_POR_HORA: float = 1.6
    LITROS_POR_HORA_VALVULA: float = 16_000.0
    # Referencia agronomica para el suelo de Media Agua: 6,000,000 L/ha/anio.
    LITROS_OBJETIVO_ANUAL_POR_HA: float = 6_000_000.0

    def __init__(self, **kwargs: Any) -> None:
        inicio = kwargs.get("inicio")
        fin = kwargs.get("fin")
        if "duracion_horas" not in kwargs and inicio is not None and fin is not None:
            kwargs["duracion_horas"] = (fin - inicio).total_seconds() / 3600
        if kwargs.get("mm_aplicados") is None and kwargs.get("duracion_horas") is not None:
            kwargs["mm_aplicados"] = round(kwargs["duracion_horas"] * 1.6, 2)
        super().__init__(**kwargs)

    @property
    def n_valvulas(self) -> int:
        """Cantidad de valvulas abiertas en este riego.

        El campo `valvula` guarda una lista separada por comas (ej: "1,2,3")
        cuando se abrieron varias valvulas a la vez sobre el mismo parral.
        """
        if not self.valvula:
            return 1
        valvulas = [v for v in self.valvula.split(",") if v.strip()]
        return len(valvulas) or 1

    @property
    def litros_aplicados(self) -> float:
        """Litros totales entregados al parral en este registro.

        Cada valvula cubre 1 ha y entrega LITROS_POR_HORA_VALVULA L/h, por lo
        que el total es horas * litros/h/valvula * cantidad de valvulas
        abiertas (no solo la duracion, como se calculaba antes).

        0.0 mientras el riego está en curso (duracion_horas todavía None) —
        se completa recién al terminar.
        """
        if self.duracion_horas is None:
            return 0.0
        return round(self.duracion_horas * self.LITROS_POR_HORA_VALVULA * self.n_valvulas, 2)

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
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_registros_fitosanitarios_fecha", "fecha"),
        Index("ix_registros_fitosanitarios_parcela_fecha", "parcela_id", "fecha"),
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
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_ciclos_campana_anio", "anio"),
        Index("ix_ciclos_campana_parcela_anio", "parcela_id", "anio"),
    )

    parcela: Mapped[Parcela] = relationship(
        "Parcela", back_populates="ciclos_campana"
    )
    created_by_user: Mapped[User] = relationship(
        "User", back_populates="ciclos_campana"
    )


class CultivoCosecha(str, enum.Enum):
    vid = "vid"
    chacra = "chacra"
    ind_pasa = "ind_pasa"
    alfalfa = "alfalfa"
    otro = "otro"


class DestinoCosecha(str, enum.Enum):
    mercado_interno = "MI"
    bodega = "BODEGA"
    exportacion = "EXPO"
    pasas = "PASAS"
    rama_pasa = "RAMA_PASA"
    semilla = "SEMILLA"
    desc = "DESC"
    fardo = "FARDO"


class TipoEnvase(str, enum.Enum):
    caja = "caja"
    bin = "bin"
    chasis = "chasis"
    ficha = "ficha"
    vin = "vin"
    bolsa = "bolsa"
    otro = "otro"


class RegistroCosecha(Base):
    __tablename__ = "registros_cosecha"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    temporada: Mapped[int] = mapped_column(Integer, nullable=False)
    semana: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fecha: Mapped[date] = mapped_column(Date, nullable=False)

    parcela_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=True
    )
    cultivo: Mapped[CultivoCosecha] = mapped_column(
        SAEnum(CultivoCosecha), nullable=False, default=CultivoCosecha.vid
    )
    variedad: Mapped[str | None] = mapped_column(String(100), nullable=True)

    n_remito: Mapped[str | None] = mapped_column(String(50), nullable=True)
    n_ciu: Mapped[str | None] = mapped_column(String(50), nullable=True)

    destino: Mapped[DestinoCosecha] = mapped_column(
        SAEnum(DestinoCosecha), nullable=False
    )
    comprador: Mapped[str | None] = mapped_column(String(150), nullable=True)

    cuadrilla: Mapped[str | None] = mapped_column(String(150), nullable=True)
    acarreo: Mapped[str | None] = mapped_column(String(150), nullable=True)
    vehiculo_patente: Mapped[str | None] = mapped_column(String(20), nullable=True)

    tipo_envase: Mapped[TipoEnvase] = mapped_column(
        SAEnum(TipoEnvase), nullable=False, default=TipoEnvase.caja
    )
    cantidad_envases: Mapped[float | None] = mapped_column(Float, nullable=True)
    peso_unitario_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    bruto_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    tara_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    kg_total: Mapped[float] = mapped_column(Float, nullable=False)

    imagen_remito_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    observaciones: Mapped[str | None] = mapped_column(String(500), nullable=True)
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

    def __init__(self, **kwargs: Any) -> None:
        if "kg_total" not in kwargs or kwargs["kg_total"] is None:
            cantidad = kwargs.get("cantidad_envases")
            peso_u = kwargs.get("peso_unitario_kg")
            bruto = kwargs.get("bruto_kg")
            tara = kwargs.get("tara_kg")
            if cantidad is not None and peso_u is not None:
                kwargs["kg_total"] = round(float(cantidad) * float(peso_u), 2)
            elif bruto is not None and tara is not None:
                kwargs["kg_total"] = round(float(bruto) - float(tara), 2)
            else:
                kwargs["kg_total"] = 0.0
        if "temporada" not in kwargs and "fecha" in kwargs:
            f = kwargs["fecha"]
            kwargs["temporada"] = f.year if f.month >= 5 else f.year - 1
        super().__init__(**kwargs)

    __table_args__ = (
        Index("ix_registros_cosecha_fecha", "fecha"),
        Index("ix_registros_cosecha_temporada", "temporada"),
        Index("ix_registros_cosecha_parcela_temporada", "parcela_id", "temporada"),
    )

    parcela: Mapped["Parcela | None"] = relationship(
        "Parcela", back_populates="registros_cosecha"
    )
    created_by_user: Mapped["User"] = relationship(
        "User", back_populates="registros_cosecha"
    )
