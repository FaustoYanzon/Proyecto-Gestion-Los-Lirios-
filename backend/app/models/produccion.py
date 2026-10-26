from __future__ import annotations

import enum
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, DateTime, Enum as SAEnum, Float, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.insumo import UnidadInsumo
from app.models.parcela import TipoRiego, VariedadUva

if TYPE_CHECKING:
    from app.models.insumo import Insumo, MovimientoStock
    from app.models.parcela import Parcela
    from app.models.trabajador import Trabajador
    from app.models.user import User
    from app.models.valvula import Valvula


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
        "Arreglo Parral",
        "Arreglo Riego",
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
    "Arreglo Parral": "general",
    "Arreglo Riego": "general",
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
    """Unificado 2026-09-08 con EstadoCampana (ver app.core.ciclo_campana)
    para que Fenología, Ciclo de Campaña y el mapa usen exactamente los
    mismos 7 nombres — antes tenía 'madurez'/'latencia' en vez de
    'cierre_racimo'/'post_cosecha'. Esos dos valores viejos quedan acá sin
    uso (Postgres no permite sacarlos del enum sin recrear el tipo) por si
    alguna fila muy vieja todavía los tuviera; el motor y los formularios ya
    no los producen ni los ofrecen — ver migraciones f3665520fad8 y
    703724978020.
    """
    brotacion = "brotacion"
    floracion = "floracion"
    cuaje = "cuaje"
    cierre_racimo = "cierre_racimo"
    envero = "envero"
    cosecha = "cosecha"
    post_cosecha = "post_cosecha"
    madurez = "madurez"  # legacy, sin uso — ver docstring
    latencia = "latencia"  # legacy, sin uso — ver docstring


# Estados del calendario único de Ciclo de Campaña (app.core.ciclo_campana).
# Enum Python separado de EstadoFenologico de arriba (columnas/tipos de
# Postgres distintos, cada uno con su propia tabla — CicloCampana vs.
# EstadoVariedadCampana), pero desde la unificación del 2026-09-08 sus 7
# valores activos coinciden exactamente. Si se agrega un estado nuevo hay
# que tocar los dos enums + fenologia.ESTADO_LABELS.
class EstadoCampana(str, enum.Enum):
    brotacion = "brotacion"
    floracion = "floracion"
    cuaje = "cuaje"
    cierre_racimo = "cierre_racimo"
    envero = "envero"
    cosecha = "cosecha"
    post_cosecha = "post_cosecha"


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
    # Generado por el cliente (UUID), una vez por envío lógico del form/wizard —
    # permite que un reintento (el usuario re-tocando "Guardar" después de una
    # respuesta lenta) devuelva el registro ya creado en vez de duplicarlo. Se
    # combina con trabajador_nombre porque /trabajo/masivo crea varias filas
    # (una por trabajador) compartiendo la misma key en un solo envío.
    idempotency_key: Mapped[str | None] = mapped_column(String(36), nullable=True)
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
        Index(
            "uq_registros_trabajo_idempotency",
            "idempotency_key", "trabajador_nombre",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
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
    # NULL en riego a manto nuevo: se riega la parcela entera, sin cabezal/valvula.
    cabezal: Mapped[str | None] = mapped_column(String(20), nullable=True)
    valvula: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Cantidad de valvulas equivalentes (ceil de la superficie) en manto nuevo.
    # NULL = registro historico (goteo, o manto viejo que usa FACTOR_MANTO_LEGACY).
    n_valvulas_manto: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Goteo o manto. En manto el caudal se estima por superficie (FACTOR_MANTO);
    # los manto historicos (n_valvulas_manto NULL) conservan FACTOR_MANTO_LEGACY.
    tipo: Mapped[TipoRiego] = mapped_column(
        SAEnum(TipoRiego), default=TipoRiego.goteo, server_default=TipoRiego.goteo.value, nullable=False
    )
    inicio: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # NULL mientras el riego está "en curso" (arrancó pero todavía no se cerró
    # con /riego/{id}/terminar) — se completa recién al terminar.
    fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duracion_horas: Mapped[float | None] = mapped_column(Float, nullable=True)
    mm_aplicados: Mapped[float | None] = mapped_column(Float, nullable=True)
    fertilizante_nombre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fertilizante_dosis_lt_ha: Mapped[float | None] = mapped_column(Float, nullable=True)
    responsable: Mapped[str] = mapped_column(String(100), nullable=False)
    responsable_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("trabajadores.id"), nullable=True
    )
    # Ver nota en RegistroTrabajo.idempotency_key.
    idempotency_key: Mapped[str | None] = mapped_column(String(36), nullable=True)
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
        Index(
            "uq_registros_riego_idempotency",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    # Cada valvula riega 1 ha y entrega 16,000 L/h => 1.6 mm/h sobre esa ha.
    MM_POR_HORA: float = 1.6
    LITROS_POR_HORA_VALVULA: float = 16_000.0
    # Referencia agronomica para el suelo de Media Agua: 6,000,000 L/ha/anio.
    LITROS_OBJETIVO_ANUAL_POR_HA: float = 6_000_000.0
    # Manto historico (sin n_valvulas_manto): 40% del caudal. Nunca se recalcula.
    FACTOR_MANTO_LEGACY: float = 0.4
    # Manto por superficie: 25% del caudal de las valvulas equivalentes.
    FACTOR_MANTO: float = 0.25

    @classmethod
    def factor_caudal(cls, tipo: TipoRiego | str | None, n_valvulas_manto: int | None = None) -> float:
        if tipo not in (TipoRiego.manto, TipoRiego.manto.value):
            return 1.0
        # n_valvulas_manto marks the new surface-based rule; NULL keeps old records stable.
        return cls.FACTOR_MANTO_LEGACY if n_valvulas_manto is None else cls.FACTOR_MANTO

    @staticmethod
    def valvulas_manto_de(superficie_ha: float) -> int:
        """Valvulas equivalentes de una parcela: ceil de la superficie, minimo 1."""
        # round() first so float noise (3.0000000000000004) does not bump to 4.
        return max(1, math.ceil(round(superficie_ha, 4)))

    @staticmethod
    def contar_valvulas(valvula: str | None, n_valvulas_manto: int | None) -> int:
        """Valvulas del riego: el n guardado (manto nuevo) o el CSV de `valvula`."""
        if n_valvulas_manto is not None:
            return n_valvulas_manto
        if not valvula:
            return 1
        return len([v for v in valvula.split(",") if v.strip()]) or 1

    def __init__(self, **kwargs: Any) -> None:
        inicio = kwargs.get("inicio")
        fin = kwargs.get("fin")
        if "duracion_horas" not in kwargs and inicio is not None and fin is not None:
            kwargs["duracion_horas"] = (fin - inicio).total_seconds() / 3600
        if kwargs.get("mm_aplicados") is None and kwargs.get("duracion_horas") is not None:
            kwargs["mm_aplicados"] = round(
                kwargs["duracion_horas"] * self.MM_POR_HORA
                * self.factor_caudal(kwargs.get("tipo"), kwargs.get("n_valvulas_manto")),
                2,
            )
        super().__init__(**kwargs)

    def recalcular_mm(self) -> None:
        """Recalcula mm_aplicados desde duracion_horas y el tipo de riego."""
        self.mm_aplicados = round(self.duracion_horas * self.MM_POR_HORA * self.factor_aplicado, 2)

    @property
    def n_valvulas(self) -> int:
        """Cantidad de valvulas abiertas en este riego.

        En goteo / manto historico el campo `valvula` guarda una lista separada
        por comas (ej: "1,2,3"); en manto nuevo se usa `n_valvulas_manto`.
        """
        return self.contar_valvulas(self.valvula, self.n_valvulas_manto)

    @property
    def factor_aplicado(self) -> float:
        """Factor de caudal que corresponde a este registro (tipo + regla vigente)."""
        return self.factor_caudal(self.tipo, self.n_valvulas_manto)

    @property
    def litros_aplicados(self) -> float:
        """Litros totales entregados en este registro.

        horas * litros/h/valvula * factor de caudal * cantidad de valvulas.

        0.0 mientras el riego está en curso (duracion_horas todavía None) —
        se completa recién al terminar.
        """
        if self.duracion_horas is None:
            return 0.0
        return round(
            self.duracion_horas * self.LITROS_POR_HORA_VALVULA * self.factor_aplicado * self.n_valvulas, 2
        )

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
    dosis_por_ha: Mapped[float] = mapped_column(Float, nullable=False)
    insumo_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("insumos.id"), nullable=True
    )
    unidad: Mapped[UnidadInsumo | None] = mapped_column(SAEnum(UnidadInsumo), nullable=True)
    cantidad_total: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    motivo: Mapped[str] = mapped_column(String(500), nullable=False)
    dias_carencia: Mapped[int] = mapped_column(Integer, nullable=False)
    dias_reingreso: Mapped[int] = mapped_column(Integer, nullable=False)
    fecha_habilitacion_cosecha: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_habilitacion_reingreso: Mapped[date] = mapped_column(Date, nullable=False)
    responsable: Mapped[str] = mapped_column(String(100), nullable=False)
    responsable_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("trabajadores.id"), nullable=True
    )
    # Nota de campo del operario al confirmar una orden de aplicación (ej.
    # "faltó producto para el último parral"). Libre, no afecta cantidad ni
    # producto, que quedan fijos por la orden -- ver OrdenAplicacionParcela.
    observaciones: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Válvula puntual cuando el registro nace de confirmar una orden de
    # aplicación por válvula (OrdenAplicacionValvula); null en los registros
    # por parcela entera (carga histórica y confirmación de respaldo).
    valvula_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("valvulas.id"), nullable=True
    )
    # Ver nota en RegistroTrabajo.idempotency_key.
    idempotency_key: Mapped[str | None] = mapped_column(String(36), nullable=True)
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
        Index(
            "uq_registros_fitosanitarios_idempotency",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
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
    insumo: Mapped[Insumo | None] = relationship(
        "Insumo", back_populates="registros_fitosanitarios"
    )
    movimiento_stock: Mapped[MovimientoStock | None] = relationship(
        "MovimientoStock", back_populates="registro_fitosanitario", uselist=False
    )
    orden_parcela: Mapped[OrdenAplicacionParcela | None] = relationship(
        "OrdenAplicacionParcela", back_populates="registro_fitosanitario", uselist=False
    )
    orden_valvula: Mapped[OrdenAplicacionValvula | None] = relationship(
        "OrdenAplicacionValvula", back_populates="registro_fitosanitario", uselist=False
    )
    fotos: Mapped[list[FotoRegistroFitosanitario]] = relationship(
        "FotoRegistroFitosanitario", back_populates="registro_fitosanitario"
    )


class PlanFitosanitario(Base):
    """Plan de aplicación cargado a mano por Fausto, temporada tras temporada,
    variedad real por variedad (sin agrupar en "Tintas" -- esa agrupación es
    solo cómo el agrónomo lo comunica en su hoja, no cómo vive el dato acá).
    Es una lista abierta de eventos por (temporada, variedad), no un valor
    único como MetaProduccion -- puede haber más de un producto en la misma
    ronda (numero_aplicacion)."""

    __tablename__ = "planes_fitosanitarios"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    temporada: Mapped[int] = mapped_column(Integer, nullable=False)
    variedad: Mapped[VariedadUva] = mapped_column(SAEnum(VariedadUva), nullable=False)
    numero_aplicacion: Mapped[int] = mapped_column(Integer, nullable=False)
    mes: Mapped[int] = mapped_column(Integer, nullable=False)
    insumo_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("insumos.id"), nullable=False
    )
    objetivo: Mapped[str] = mapped_column(String(200), nullable=False)
    dosis_por_ha: Mapped[float] = mapped_column(Float, nullable=False)
    notas: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
        Index("ix_planes_fitosanitarios_temporada_variedad", "temporada", "variedad"),
    )

    insumo: Mapped[Insumo] = relationship("Insumo")
    created_by_user: Mapped[User] = relationship("User")


class OrigenOrdenAplicacion(str, enum.Enum):
    plan = "plan"
    extra = "extra"


class EstadoOrdenAplicacion(str, enum.Enum):
    pendiente = "pendiente"
    en_curso = "en_curso"
    completada = "completada"


class EstadoOrdenAplicacionParcela(str, enum.Enum):
    pendiente = "pendiente"
    aplicada = "aplicada"


class ResultadoValvula(str, enum.Enum):
    """Resultado de confirmar una válvula. No existe "parcial": una aplicación
    incompleta se registra como `completa` con observaciones (y descuenta la
    superficie entera de la válvula); la revisión posterior decide qué hacer."""

    completa = "completa"
    no_aplicada = "no_aplicada"


class OrdenAplicacion(Base):
    """Orden de aplicación ejecutable: lo que un operario ve y confirma en
    mobile, en vez de recibir la indicación solo de palabra. Nace de una
    línea del PlanFitosanitario (origen=plan, con plan_fitosanitario_id) o la
    crea el ingeniero/encargado suelta, fuera del plan (origen=extra).
    Congela insumo/dosis/objetivo/carencia al momento de crearse -- un
    cambio posterior en el plan no altera órdenes ya generadas."""

    __tablename__ = "ordenes_aplicacion"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    temporada: Mapped[int] = mapped_column(Integer, nullable=False)
    origen: Mapped[OrigenOrdenAplicacion] = mapped_column(
        SAEnum(OrigenOrdenAplicacion), nullable=False
    )
    plan_fitosanitario_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("planes_fitosanitarios.id"), nullable=True
    )
    variedad: Mapped[VariedadUva] = mapped_column(SAEnum(VariedadUva), nullable=False)
    insumo_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("insumos.id"), nullable=False
    )
    dosis_por_ha: Mapped[float] = mapped_column(Float, nullable=False)
    objetivo: Mapped[str] = mapped_column(String(200), nullable=False)
    dias_carencia: Mapped[int] = mapped_column(Integer, nullable=False)
    dias_reingreso: Mapped[int] = mapped_column(Integer, nullable=False)
    fecha_planificada: Mapped[date] = mapped_column(Date, nullable=False)
    estado: Mapped[EstadoOrdenAplicacion] = mapped_column(
        SAEnum(EstadoOrdenAplicacion),
        default=EstadoOrdenAplicacion.pendiente,
        server_default=EstadoOrdenAplicacion.pendiente.value,
        nullable=False,
    )
    notas: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
        Index("ix_ordenes_aplicacion_temporada_estado", "temporada", "estado"),
    )

    insumo: Mapped[Insumo] = relationship("Insumo")
    plan: Mapped[PlanFitosanitario | None] = relationship("PlanFitosanitario")
    created_by_user: Mapped[User] = relationship("User")
    parcelas: Mapped[list[OrdenAplicacionParcela]] = relationship(
        "OrdenAplicacionParcela", back_populates="orden", cascade="all, delete-orphan"
    )


class OrdenAplicacionParcela(Base):
    """Una fila por cada parcela incluida en la orden. `estado` pasa a
    `aplicada` cuando un operario confirma -- eso crea el
    RegistroFitosanitario correspondiente (vinculado acá vía
    registro_fitosanitario_id), reusando el descuento de stock y el cálculo
    de fechas de carencia/reingreso que ya tiene ese modelo, en vez de
    duplicar esa lógica."""

    __tablename__ = "ordenes_aplicacion_parcelas"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    orden_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("ordenes_aplicacion.id"), nullable=False
    )
    parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=False
    )
    estado: Mapped[EstadoOrdenAplicacionParcela] = mapped_column(
        SAEnum(EstadoOrdenAplicacionParcela),
        default=EstadoOrdenAplicacionParcela.pendiente,
        server_default=EstadoOrdenAplicacionParcela.pendiente.value,
        nullable=False,
    )
    registro_fitosanitario_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("registros_fitosanitarios.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        Index("ix_ordenes_aplicacion_parcelas_orden", "orden_id"),
        Index("ix_ordenes_aplicacion_parcelas_parcela", "parcela_id"),
        Index(
            "uq_ordenes_aplicacion_parcelas_orden_parcela",
            "orden_id", "parcela_id",
            unique=True,
        ),
        Index(
            "uq_ordenes_aplicacion_parcelas_registro",
            "registro_fitosanitario_id",
            unique=True,
            postgresql_where=text("registro_fitosanitario_id IS NOT NULL"),
        ),
    )

    orden: Mapped[OrdenAplicacion] = relationship(
        "OrdenAplicacion", back_populates="parcelas"
    )
    parcela: Mapped[Parcela] = relationship("Parcela")
    registro_fitosanitario: Mapped[RegistroFitosanitario | None] = relationship(
        "RegistroFitosanitario", back_populates="orden_parcela"
    )
    valvulas: Mapped[list[OrdenAplicacionValvula]] = relationship(
        "OrdenAplicacionValvula",
        back_populates="orden_parcela",
        cascade="all, delete-orphan",
    )


class OrdenAplicacionValvula(Base):
    """Una fila por válvula de cada parcela de la orden. El operario confirma
    válvula por válvula (en cualquier orden); cada confirmación `completa`
    crea su propio RegistroFitosanitario con la superficie de la válvula. La
    parcela pasa a `aplicada` cuando todas sus válvulas están resueltas
    (aplicada, sea completa o no_aplicada). Las parcelas sin válvulas, y las
    órdenes anteriores a este modelo, se confirman por parcela entera."""

    __tablename__ = "ordenes_aplicacion_valvulas"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    orden_parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("ordenes_aplicacion_parcelas.id"), nullable=False
    )
    valvula_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("valvulas.id"), nullable=False
    )
    estado: Mapped[EstadoOrdenAplicacionParcela] = mapped_column(
        SAEnum(EstadoOrdenAplicacionParcela),
        default=EstadoOrdenAplicacionParcela.pendiente,
        server_default=EstadoOrdenAplicacionParcela.pendiente.value,
        nullable=False,
    )
    resultado: Mapped[ResultadoValvula | None] = mapped_column(
        SAEnum(ResultadoValvula), nullable=True
    )
    responsable_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("trabajadores.id"), nullable=True
    )
    responsable: Mapped[str | None] = mapped_column(String(100), nullable=True)
    observaciones: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    registro_fitosanitario_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("registros_fitosanitarios.id"), nullable=True
    )
    confirmada_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revisada_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revisada_por: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        Index(
            "uq_ordenes_aplicacion_valvulas_parcela_valvula",
            "orden_parcela_id", "valvula_id",
            unique=True,
        ),
        Index("ix_ordenes_aplicacion_valvulas_valvula", "valvula_id"),
        Index(
            "ix_ordenes_aplicacion_valvulas_a_revisar",
            "confirmada_at",
            postgresql_where=text("estado = 'aplicada' AND revisada_at IS NULL"),
        ),
        Index(
            "uq_ordenes_aplicacion_valvulas_registro",
            "registro_fitosanitario_id",
            unique=True,
            postgresql_where=text("registro_fitosanitario_id IS NOT NULL"),
        ),
    )

    orden_parcela: Mapped[OrdenAplicacionParcela] = relationship(
        "OrdenAplicacionParcela", back_populates="valvulas"
    )
    valvula: Mapped[Valvula] = relationship("Valvula")
    registro_fitosanitario: Mapped[RegistroFitosanitario | None] = relationship(
        "RegistroFitosanitario", back_populates="orden_valvula"
    )
    fotos: Mapped[list[FotoRegistroFitosanitario]] = relationship(
        "FotoRegistroFitosanitario"
    )


class FotoRegistroFitosanitario(Base):
    """Álbum de fotos de una aplicación real, adjuntadas opcionalmente por el
    operario al confirmar una orden (mismo patrón que Foto para el álbum de
    parcela, ver app.models.trazabilidad)."""

    __tablename__ = "fotos_registros_fitosanitarios"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # Null en las fotos de una válvula `no_aplicada` (no hay registro: nada se
    # aplicó) -- esas cuelgan solo de `orden_valvula_id`.
    registro_fitosanitario_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("registros_fitosanitarios.id"), nullable=True
    )
    orden_valvula_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("ordenes_aplicacion_valvulas.id"), nullable=True
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        Index("ix_fotos_registros_fitosanitarios_registro", "registro_fitosanitario_id"),
        Index("ix_fotos_registros_fitosanitarios_orden_valvula", "orden_valvula_id"),
    )

    registro_fitosanitario: Mapped[RegistroFitosanitario | None] = relationship(
        "RegistroFitosanitario", back_populates="fotos"
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


class EstadoVariedadCampana(Base):
    """Override manual del calendario único de Ciclo de Campaña
    (app.core.ciclo_campana) — a nivel VARIEDAD entera, no por parcela: al
    confirmar un estado a mano se aplica a todas las parcelas de esa
    variedad. Tabla separada de CicloCampana a propósito (esa sigue siendo
    el registro por parcela + historial de rendimiento, sin cambios)."""

    __tablename__ = "estados_variedad_campana"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    variedad: Mapped[VariedadUva] = mapped_column(SAEnum(VariedadUva), nullable=False)
    anio: Mapped[int] = mapped_column(Integer, nullable=False)
    estado_campana: Mapped[EstadoCampana] = mapped_column(
        SAEnum(EstadoCampana), nullable=False
    )
    fecha_confirmacion: Mapped[date] = mapped_column(Date, nullable=False)
    observaciones: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        Index("ix_estados_variedad_campana_variedad_anio", "variedad", "anio"),
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


class OrigenCosecha(str, enum.Enum):
    """Distingue uva propia (cosechada en parcelas de Los Lirios) de materia
    prima comprada a terceros para industria de pasa -- necesario para no
    diluir KPIs de rendimiento/costo propio (ver dashboard_costo_por_kg en
    finanzas.py) con kg que no salieron de un parral propio."""
    propio = "propio"
    tercero = "tercero"


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
    origen: Mapped[OrigenCosecha] = mapped_column(
        SAEnum(OrigenCosecha),
        default=OrigenCosecha.propio,
        server_default=OrigenCosecha.propio.value,
        nullable=False,
    )
    # Solo tiene sentido cuando origen=tercero -- nombre del productor/finca
    # que vendió la materia prima (no es un parcela_id propio).
    proveedor_tercero: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # Productor normalizado (módulo Alta de Producción). `proveedor_tercero`
    # queda como respaldo del texto original de los registros históricos.
    productor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("productores.id"), nullable=True, index=True
    )

    n_remito: Mapped[str | None] = mapped_column(String(50), nullable=True)
    n_ciu: Mapped[str | None] = mapped_column(String(50), nullable=True)

    destino: Mapped[DestinoCosecha] = mapped_column(
        SAEnum(DestinoCosecha), nullable=False
    )
    comprador: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # Comprador normalizado (despacho de cosecha). `comprador` (texto) se sigue
    # llenando con el nombre por compatibilidad.
    comprador_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("compradores.id", name="fk_registros_cosecha_comprador_id_compradores"),
        nullable=True,
        index=True,
    )

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
    # Ver nota en RegistroTrabajo.idempotency_key.
    idempotency_key: Mapped[str | None] = mapped_column(String(36), nullable=True)
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
        Index(
            "uq_registros_cosecha_idempotency",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    parcela: Mapped["Parcela | None"] = relationship(
        "Parcela", back_populates="registros_cosecha"
    )
    created_by_user: Mapped["User"] = relationship(
        "User", back_populates="registros_cosecha"
    )
