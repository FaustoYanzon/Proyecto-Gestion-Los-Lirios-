from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.produccion import DestinoCosecha, EstadoCampana
from app.models.trazabilidad import EstadoSanitarioAnalisis, OrigenAnalisis
from app.schemas.produccion import (
    CicloCampanaResponse,
    RegistroCosechaResponse,
    RegistroFitosanitarioResponse,
    RegistroRiegoResponse,
    RegistroTrabajoResponse,
)


# ── Foto ────────────────────────────────────────────────────────────────────

class FotoBase(BaseModel):
    parcela_id: str
    fecha: date
    categoria: str
    descripcion: str | None = None


class FotoCreate(FotoBase):
    pass


class FotoResponse(FotoBase):
    id: str
    url: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Analisis de Calidad ───────────────────────────────────────────────────────

class AnalisisCalidadBase(BaseModel):
    parcela_id: str
    fecha: date
    origen: OrigenAnalisis
    brix: float | None = None
    acidez: float | None = None
    ph: float | None = None
    estado_sanitario: EstadoSanitarioAnalisis | None = None
    laboratorio_nombre: str | None = None
    observaciones: str | None = None


class AnalisisCalidadCreate(AnalisisCalidadBase):
    pass


class AnalisisCalidadResponse(AnalisisCalidadBase):
    id: str
    informe_url: str | None = None
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Historial / Ficha de Trazabilidad ─────────────────────────────────────────

class ComplianceFitosanitario(BaseModel):
    fitosanitario_id: str
    fecha_aplicacion: date
    producto_nombre: str
    fecha_habilitacion_cosecha: date
    estado: Literal["cumplido", "incumplido", "pendiente"]
    cosecha_conflictiva_id: str | None = None
    cosecha_conflictiva_fecha: date | None = None


class CumplimientoEstadoItem(BaseModel):
    estado_campana: EstadoCampana
    estado_campana_label: str
    fecha_inicio: date
    fecha_fin: date
    riegos_esperados: int
    mm_aplicados: float
    riegos_equivalentes: float
    cumplimiento_pct: float
    cumplido: bool


class ResumenDestinoItem(BaseModel):
    destino: DestinoCosecha
    destino_label: str
    kg_total: float
    n_registros: int
    pct_del_total: float


class CentroideItem(BaseModel):
    lat: float
    lng: float


class TareaResumenItem(BaseModel):
    tarea: str
    unidad_medida_label: str
    fecha_inicio: date
    fecha_fin: date
    registros: int


class HistorialParcelaResponse(BaseModel):
    parcela_id: str
    parcela_nombre: str
    desde: date
    hasta: date
    riegos: list[RegistroRiegoResponse]
    fitosanitarios: list[RegistroFitosanitarioResponse]
    trabajos: list[RegistroTrabajoResponse]
    cosechas: list[RegistroCosechaResponse]
    ciclos_campana: list[CicloCampanaResponse]
    fotos: list[FotoResponse]
    analisis_calidad: list[AnalisisCalidadResponse]
    compliance_fitosanitarios: list[ComplianceFitosanitario]
    parcela_variedad_descripcion: str | None = None
    parcela_centroide: CentroideItem | None = None
    parcela_tipo_riego: str | None = None
    parcela_cobertura_invierno: str | None = None
    cumplimiento_riego_por_estado: list[CumplimientoEstadoItem]
    resumen_destino: list[ResumenDestinoItem]
    tareas_resumen: list[TareaResumenItem]
    horas_de_frio: float | None = None
    mm_objetivo_anual: float
    meta_produccion_kg: float | None = None
