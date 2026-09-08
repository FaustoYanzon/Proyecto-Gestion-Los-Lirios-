from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.insumo import TipoMovimientoStock, UnidadInsumo


class InsumoBase(BaseModel):
    nombre: str
    unidad: UnidadInsumo
    categoria: str | None = None


class InsumoCreate(InsumoBase):
    stock_actual: Decimal = Decimal("0")


class InsumoUpdate(BaseModel):
    nombre: str | None = None
    unidad: UnidadInsumo | None = None
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


class MovimientoStockResponse(BaseModel):
    id: str
    insumo_id: str
    tipo: TipoMovimientoStock
    cantidad: Decimal
    fecha: date
    observacion: str | None = None
    registro_fitosanitario_id: str | None = None
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
