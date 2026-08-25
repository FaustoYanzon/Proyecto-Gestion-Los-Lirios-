from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.produccion import UnidadMedida


class PrecioTareaBase(BaseModel):
    temporada: int = Field(ge=2020, le=2100)
    tarea: str = Field(min_length=1, max_length=100)
    parcela_id: str | None = None
    unidad_medida: UnidadMedida
    precio_unitario: Decimal = Field(gt=0)


class PrecioTareaCreate(PrecioTareaBase):
    pass


class PrecioTareaUpdate(BaseModel):
    precio_unitario: Decimal = Field(gt=0)


class PrecioTareaResponse(PrecioTareaBase):
    id: str
    parcela_nombre: str | None = None
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
