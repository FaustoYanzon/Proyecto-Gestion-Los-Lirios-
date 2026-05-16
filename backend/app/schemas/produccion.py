from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.produccion import ClasificacionTarea, EstadoFenologico, UnidadMedida


# ── Helpers ───────────────────────────────────────────────────────────────────

class TrabajadorItem(BaseModel):
    trabajador_nombre: str
    cantidad: Decimal


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
    pass


class RegistroCargaMasiva(BaseModel):
    fecha: date
    parcela_id: str | None = None
    tarea: str
    unidad_medida: UnidadMedida
    precio_unitario: Decimal
    detalle: str | None = None
    trabajadores: list[TrabajadorItem]


class RegistroTrabajoUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    trabajador_nombre: str | None = None
    tarea: str | None = None
    cantidad: Decimal | None = None
    unidad_medida: UnidadMedida | None = None
    precio_unitario: Decimal | None = None
    detalle: str | None = None


class RegistroTrabajoResponse(RegistroTrabajoBase):
    id: str
    clasificacion: ClasificacionTarea
    monto_total: Decimal
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
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
    id: str
    parcela_id: str
    parcela_nombre: str
    anio: int
    estado_fenologico: EstadoFenologico
    fecha_estado: date
