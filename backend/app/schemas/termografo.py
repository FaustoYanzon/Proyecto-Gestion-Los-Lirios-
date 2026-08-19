from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class LoteImportacionTermografoResponse(BaseModel):
    id: str
    device_id: str
    nombre_archivo: str
    intervalo_seg: int
    rango_inicio: datetime
    rango_fin: datetime
    cantidad_filas: int
    cantidad_nuevas: int
    cantidad_duplicadas: int
    importado_por: str
    importado_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ImportarTermografoResponse(BaseModel):
    lote: LoteImportacionTermografoResponse
    nuevos: int
    duplicados: int
    errores: list[str]


class LecturaTermografoResponse(BaseModel):
    fecha_hora: datetime
    temperatura: Decimal
    humedad: Decimal


class LecturaDiariaResponse(BaseModel):
    dia: date
    temp_min: Decimal
    temp_max: Decimal
    temp_avg: Decimal
    humedad_avg: Decimal


class LecturasTermografoResponse(BaseModel):
    granularidad: str  # "cruda" | "diaria"
    puntos: list[LecturaTermografoResponse] | list[LecturaDiariaResponse]


class EventoHeladaResponse(BaseModel):
    inicio: datetime
    fin: datetime
    duracion_horas: float
    minima: Decimal


class MetricasTermografoResponse(BaseModel):
    desde: date
    hasta: date
    cantidad_lecturas: int
    horas_bajo_cero: float
    horas_sobre_30: float
    horas_de_frio: float
    horas_riesgo_fungico: float
    gdd_acumulado: Decimal
    gdd_acumulado_desde_brotacion: Decimal | None
    amplitud_termica_promedio: Decimal | None
    eventos_helada: list[EventoHeladaResponse]
