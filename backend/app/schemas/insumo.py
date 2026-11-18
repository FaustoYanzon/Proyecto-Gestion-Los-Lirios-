from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.insumo import TipoInsumo, TipoMovimientoStock, UnidadInsumo


class InsumoBase(BaseModel):
    nombre: str
    unidad: UnidadInsumo
    tipo: TipoInsumo = TipoInsumo.fitosanitario
    categoria: str | None = None


class InsumoCreate(InsumoBase):
    stock_actual: Decimal = Decimal("0")


class InsumoUpdate(BaseModel):
    nombre: str | None = None
    unidad: UnidadInsumo | None = None
    tipo: TipoInsumo | None = None
    categoria: str | None = None
    is_active: bool | None = None


class InsumoResponse(InsumoBase):
    id: str
    stock_actual: Decimal
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MovimientoStockCreate(BaseModel):
    tipo: TipoMovimientoStock
    cantidad: Decimal
    fecha: date
    observacion: str | None = None
    destino: str | None = Field(default=None, max_length=200)
    idempotency_key: str | None = Field(default=None, max_length=64)

    @field_validator("destino")
    @classmethod
    def _destino_en_blanco_es_nulo(cls, v: str | None) -> str | None:
        v = v.strip() if v is not None else None
        return v or None


class MovimientoStockResponse(BaseModel):
    id: str
    insumo_id: str
    tipo: TipoMovimientoStock
    cantidad: Decimal
    fecha: date
    observacion: str | None = None
    destino: str | None = None
    idempotency_key: str | None = None
    registro_fitosanitario_id: str | None = None
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
