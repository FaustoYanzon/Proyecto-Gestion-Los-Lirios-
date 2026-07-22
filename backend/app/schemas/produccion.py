from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.finanzas import Finca
from app.models.parcela import VariedadUva
from app.models.produccion import (
    ClasificacionTarea,
    CultivoCosecha,
    DestinoCosecha,
    EstadoCampana,
    EstadoFenologico,
    TipoEnvase,
    UnidadMedida,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

class TrabajadorItem(BaseModel):
    trabajador_nombre: str
    cantidad: Decimal
    trabajador_id: str | None = None


# ── Registro Trabajo ──────────────────────────────────────────────────────────

class RegistroTrabajoBase(BaseModel):
    fecha: date
    parcela_id: str | None = None
    trabajador_nombre: str
    tarea: str
    cantidad: Decimal
    unidad_medida: UnidadMedida
    precio_unitario: Decimal
    detalle: str | None = None


class RegistroTrabajoCreate(RegistroTrabajoBase):
    # Required for correct egreso assignment — must match the finca where the
    # work is performed. Defaults to media_agua for backward compat but should
    # always be sent explicitly by the frontend.
    finca: Finca = Finca.media_agua
    # If provided, overrides trabajador_nombre with the linked Trabajador's full name.
    trabajador_id: str | None = None


class RegistroCargaMasiva(BaseModel):
    fecha: date
    parcela_id: str | None = None
    finca: Finca = Finca.media_agua  # same rationale as RegistroTrabajoCreate
    tarea: str
    unidad_medida: UnidadMedida
    precio_unitario: Decimal
    detalle: str | None = None
    trabajadores: list[TrabajadorItem]


class RegistroTrabajoUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    trabajador_nombre: str | None = None
    trabajador_id: str | None = None
    tarea: str | None = None
    cantidad: Decimal | None = None
    unidad_medida: UnidadMedida | None = None
    precio_unitario: Decimal | None = None
    detalle: str | None = None


class RegistroTrabajoResponse(RegistroTrabajoBase):
    id: str
    clasificacion: ClasificacionTarea
    monto_total: Decimal
    trabajador_id: str | None = None
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ResumenTrabajador(BaseModel):
    trabajador_nombre: str
    total_jornales: Decimal
    monto_total: Decimal
    tareas_realizadas: list[str]


class ResumenTarea(BaseModel):
    tarea: str
    clasificacion: ClasificacionTarea
    total_registros: int
    cantidad_total: Decimal
    monto_total: Decimal


# ── Registro Riego ────────────────────────────────────────────────────────────

class RegistroRiegoBase(BaseModel):
    fecha: date
    parcela_id: str
    cabezal: str
    valvula: str
    inicio: datetime
    fin: datetime
    mm_aplicados: float | None = None
    fertilizante_nombre: str | None = None
    fertilizante_dosis_lt_ha: float | None = None
    responsable: str


class RegistroRiegoCreate(RegistroRiegoBase):
    pass


class RegistroRiegoUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    cabezal: str | None = None
    valvula: str | None = None
    inicio: datetime | None = None
    fin: datetime | None = None
    mm_aplicados: float | None = None
    fertilizante_nombre: str | None = None
    fertilizante_dosis_lt_ha: float | None = None
    responsable: str | None = None


class RegistroRiegoResponse(RegistroRiegoBase):
    id: str
    duracion_horas: float
    n_valvulas: int
    litros_aplicados: float
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Riego en curso (inicio sin fin todavía) ───────────────────────────────────

class RegistroRiegoIniciar(BaseModel):
    parcela_id: str
    cabezal: str
    valvula: str
    responsable: str
    fertilizante_nombre: str | None = None
    fertilizante_dosis_lt_ha: float | None = None


class RegistroRiegoEnCursoResponse(BaseModel):
    id: str
    fecha: date
    parcela_id: str
    cabezal: str
    valvula: str
    inicio: datetime
    n_valvulas: int
    responsable: str
    fertilizante_nombre: str | None = None

    model_config = ConfigDict(from_attributes=True)


class RegistroRiegoTerminar(BaseModel):
    fin: datetime | None = None  # None => usar la hora del servidor


# ── Registro Fitosanitario ────────────────────────────────────────────────────

class RegistroFitosanitarioBase(BaseModel):
    fecha: date
    parcela_id: str
    producto_nombre: str
    dosis_lt_ha: float
    motivo: str
    dias_carencia: int
    dias_reingreso: int
    responsable: str


class RegistroFitosanitarioCreate(RegistroFitosanitarioBase):
    pass


class RegistroFitosanitarioUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    producto_nombre: str | None = None
    dosis_lt_ha: float | None = None
    motivo: str | None = None
    dias_carencia: int | None = None
    dias_reingreso: int | None = None
    responsable: str | None = None


class RegistroFitosanitarioResponse(RegistroFitosanitarioBase):
    id: str
    fecha_habilitacion_cosecha: date
    fecha_habilitacion_reingreso: date
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Ciclo Campaña ─────────────────────────────────────────────────────────────

class CicloCampanaBase(BaseModel):
    parcela_id: str
    anio: int
    estado_fenologico: EstadoFenologico
    fecha_estado: date
    rendimiento_kg_ha: Decimal | None = None
    observaciones: str | None = None


class CicloCampanaCreate(CicloCampanaBase):
    pass


class CicloCampanaUpdate(BaseModel):
    parcela_id: str | None = None
    anio: int | None = None
    estado_fenologico: EstadoFenologico | None = None
    fecha_estado: date | None = None
    rendimiento_kg_ha: Decimal | None = None
    observaciones: str | None = None


class CicloCampanaResponse(CicloCampanaBase):
    id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EstadoActualResponse(BaseModel):
    id: str | None = None
    parcela_id: str
    parcela_nombre: str
    anio: int | None = None
    estado_fenologico: EstadoFenologico | None = None
    fecha_estado: date | None = None


class FaseVariedadResponse(BaseModel):
    """Estado fenológico de una variedad, calculado automáticamente por
    fecha (ver app.core.fenologia) salvo que exista una confirmación manual
    reciente (CicloCampana) para alguna de sus parcelas, en cuyo caso esa
    confirmación tiene prioridad (`fuente="manual"`). Agrupa todos los
    parrales activos de esa variedad."""
    variedad: str
    tipo_uso: str
    fase: str
    fase_label: str
    estado_fenologico: EstadoFenologico
    riesgo_oidio: str
    tareas_recomendadas: list[str]
    proxima_fase: str | None
    proxima_fase_label: str | None
    proxima_fase_fecha: date | None
    parcelas: list[str]
    fuente: str  # "automatico" | "manual"
    fecha_confirmacion: date | None


# ── Ciclo de Campaña (calendario único, ver app.core.ciclo_campana) ────────────
# Sistema aparte de CicloCampana/EstadoActualResponse de arriba, que siguen
# alimentando "tareas recomendadas" sin cambios. Este es el pedido nuevo: un
# calendario único por fecha (igual para todas las variedades) con override
# manual por variedad entera y cumplimiento de riego por parcela.

class EstadoVariedadCampanaCreate(BaseModel):
    variedad: VariedadUva
    anio: int
    estado_campana: EstadoCampana
    fecha_confirmacion: date
    observaciones: str | None = None


class EstadoVariedadCampanaResponse(EstadoVariedadCampanaCreate):
    id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EstadoActualVariedad(BaseModel):
    variedad: VariedadUva
    estado_campana: EstadoCampana
    estado_campana_label: str
    fecha_inicio: date
    riegos_esperados: int
    fuente: str  # "automatico" | "manual"
    fecha_confirmacion: date | None
    observaciones: str | None
    proxima_estado_campana: EstadoCampana
    proxima_fecha: date
    parcelas: list[str]


class CumplimientoRiegoParcela(BaseModel):
    parcela_id: str
    parcela_nombre: str
    variedad: VariedadUva | None
    estado_campana: EstadoCampana
    estado_campana_label: str
    riegos_esperados: int
    mm_aplicados: float
    riegos_equivalentes: float
    cumplimiento_pct: float


# ── Dashboard schemas ─────────────────────────────────────────────────────────

class RendimientoAnio(BaseModel):
    anio: int
    rendimiento_kg_ha: Decimal | None
    kg_totales: Decimal | None


class RendimientoHistoricoParcela(BaseModel):
    parcela_id: str
    parcela_nombre: str
    variedad: str | None
    superficie_ha: float | None
    campanas: list[RendimientoAnio]


class EficienciaHidricaParcela(BaseModel):
    parcela_id: str
    parcela_nombre: str
    variedad: str | None
    superficie_ha: float | None
    mm_aplicados_total: float
    litros_totales: float
    litros_objetivo_anual: float | None
    porcentaje_cumplimiento: float | None
    rendimiento_kg_ha: float | None
    eficiencia_kg_por_mm: float | None


# ── Registro Cosecha ──────────────────────────────────────────────────────────

class RegistroCosechaBase(BaseModel):
    fecha: date
    parcela_id: str | None = None
    cultivo: CultivoCosecha = CultivoCosecha.vid
    variedad: str | None = None
    n_remito: str | None = None
    n_ciu: str | None = None
    destino: DestinoCosecha
    comprador: str | None = None
    cuadrilla: str | None = None
    acarreo: str | None = None
    vehiculo_patente: str | None = None
    tipo_envase: TipoEnvase = TipoEnvase.caja
    cantidad_envases: float | None = None
    peso_unitario_kg: float | None = None
    bruto_kg: float | None = None
    tara_kg: float | None = None
    kg_total: float
    imagen_remito_url: str | None = None
    observaciones: str | None = None


class RegistroCosechaCreate(RegistroCosechaBase):
    pass


class RegistroCosechaUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    cultivo: CultivoCosecha | None = None
    variedad: str | None = None
    n_remito: str | None = None
    n_ciu: str | None = None
    destino: DestinoCosecha | None = None
    comprador: str | None = None
    cuadrilla: str | None = None
    acarreo: str | None = None
    vehiculo_patente: str | None = None
    tipo_envase: TipoEnvase | None = None
    cantidad_envases: float | None = None
    peso_unitario_kg: float | None = None
    bruto_kg: float | None = None
    tara_kg: float | None = None
    kg_total: float | None = None
    imagen_remito_url: str | None = None
    observaciones: str | None = None


class RegistroCosechaResponse(RegistroCosechaBase):
    id: str
    temporada: int
    semana: int | None
    created_by: str
    created_at: datetime
    parcela_nombre: str | None = None

    model_config = ConfigDict(from_attributes=True)


# ── Summary schemas ───────────────────────────────────────────────────────────

class CosechaResumenPorParcela(BaseModel):
    parcela_id: str | None
    parcela_nombre: str
    variedad: str | None
    kg_total: float
    n_registros: int


class CosechaResumenPorSemana(BaseModel):
    semana: int
    kg_total: float
    n_registros: int


class CosechaResumenPorDestino(BaseModel):
    destino: str
    kg_total: float
    n_registros: int


class CosechaTotalesResponse(BaseModel):
    temporada: int
    kg_total: float
    n_registros: int
    n_parcelas: int
    resumen_por_destino: list[CosechaResumenPorDestino]
