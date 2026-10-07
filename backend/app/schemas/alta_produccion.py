from datetime import date, datetime
from decimal import Decimal

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.models.alta_produccion import EstadoLote, TipoProductor, TipoRemito
from app.models.parcela import VariedadUva
from app.models.produccion import OrigenCosecha


# Coinciden con Numeric(14,2) / Numeric(14,4): fuera de rango Postgres daría 500.
KgPositivo = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
ParametroDecimal = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=4)]


# ── Maestros ─────────────────────────────────────────────────────────────────

class ProductorCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=150)
    tipo: TipoProductor = TipoProductor.externo
    cuit: str | None = None
    contacto: str | None = None


class ProductorUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=150)
    tipo: TipoProductor | None = None
    cuit: str | None = None
    contacto: str | None = None
    is_active: bool | None = None


class ProductorResponse(BaseModel):
    id: str
    nombre: str
    tipo: TipoProductor
    cuit: str | None
    contacto: str | None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CompradorCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=150)
    cuit: str | None = None
    contacto: str | None = None


class CompradorUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=150)
    cuit: str | None = None
    contacto: str | None = None
    is_active: bool | None = None


class CompradorResponse(BaseModel):
    id: str
    nombre: str
    cuit: str | None
    contacto: str | None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DepositoCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)


class DepositoUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    is_active: bool | None = None


class DepositoResponse(BaseModel):
    id: str
    nombre: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ParametrosResponse(BaseModel):
    kg_por_ficha: Decimal
    fichas_por_carro: int
    ratio_uva_pasa: Decimal
    kg_nominal_bin: Decimal
    tope_bines_lote: int | None


class ParametrosUpdate(BaseModel):
    """Solo se actualizan los campos enviados. `tope_bines_lote=null` quita el tope."""

    kg_por_ficha: ParametroDecimal | None = None
    fichas_por_carro: int | None = Field(default=None, gt=0)
    ratio_uva_pasa: ParametroDecimal | None = None
    kg_nominal_bin: ParametroDecimal | None = None
    tope_bines_lote: int | None = Field(default=None, gt=0)


# ── Pasero ───────────────────────────────────────────────────────────────────

class UbicacionPaseroCreate(BaseModel):
    pasero_id: str
    hilera: int = Field(gt=0)
    parte: int = Field(gt=0)


class UbicacionPaseroResponse(BaseModel):
    id: str
    pasero_id: str
    hilera: int
    parte: int

    model_config = ConfigDict(from_attributes=True)


class IngresoPaseroCreate(BaseModel):
    fecha: date
    pasero_id: str
    variedad: VariedadUva
    kg_real: KgPositivo
    # Alcanza con `carros` (fichas = carros x fichas_por_carro); `fichas`
    # permite cargar un carro incompleto.
    carros: int = Field(default=1, ge=1)
    fichas: int | None = Field(default=None, gt=0)
    origen: OrigenCosecha = OrigenCosecha.propio
    productor_id: str | None = None
    ubicacion_id: str | None = None
    cosecha_id: str | None = None
    observaciones: str | None = None


class IngresoPaseroResponse(BaseModel):
    id: str
    fecha: date
    pasero_id: str
    ubicacion_id: str | None
    cosecha_id: str | None
    variedad: VariedadUva
    origen: OrigenCosecha
    productor_id: str | None
    carros: int
    fichas: int
    kg_teorico: Decimal
    kg_real: Decimal
    merma_kg: Decimal
    observaciones: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StockPaseroItem(BaseModel):
    pasero_id: str
    pasero_nombre: str
    variedad: VariedadUva
    uva_ingresada_kg: Decimal
    uva_consumida_kg: Decimal
    uva_disponible_kg: Decimal
    pasa_levantada_kg: Decimal
    pasa_esperada_kg: Decimal
    diferencia_pasa_kg: Decimal


# ── Lotes ────────────────────────────────────────────────────────────────────

class LoteCreate(BaseModel):
    variedad: VariedadUva
    calidad: int = Field(ge=1, le=2)
    fecha: date | None = None
    deposito_id: str | None = None


class BinCreate(BaseModel):
    pasero_id: str
    kg_real: KgPositivo
    fecha: date | None = None


class LoteCierre(BaseModel):
    deposito_id: str | None = None


class BinResponse(BaseModel):
    id: str
    lote_id: str
    pasero_id: str
    fecha: date
    kg_real: Decimal
    uva_consumida_kg: Decimal
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LoteResponse(BaseModel):
    id: str
    temporada: int
    variedad: VariedadUva
    calidad: int
    numero: int
    estado: EstadoLote
    deposito_id: str | None
    kg_total: Decimal
    saldo_kg: Decimal
    tope_bines: int | None
    cantidad_bines: int
    merma_bines_kg: Decimal
    created_at: datetime
    closed_at: datetime | None


class LoteDetalleResponse(LoteResponse):
    bines: list[BinResponse]


# ── Remitos ──────────────────────────────────────────────────────────────────

class RemitoLineaCreate(BaseModel):
    kg: KgPositivo
    lote_id: str | None = None
    cosecha_id: str | None = None


class RemitoCreate(BaseModel):
    tipo: TipoRemito
    fecha: date
    comprador_id: str
    # Si no se informa, se genera correlativo por tipo (FRE-000001, ...).
    numero: str | None = Field(default=None, max_length=50)
    vehiculo_patente: str | None = None
    observaciones: str | None = None
    lineas: list[RemitoLineaCreate] = Field(min_length=1)


class RemitoLineaResponse(BaseModel):
    id: str
    lote_id: str | None
    cosecha_id: str | None
    kg: Decimal

    model_config = ConfigDict(from_attributes=True)


class ComprobanteBodegaCreate(BaseModel):
    numero_suv: str = Field(min_length=1, max_length=50)
    kg_recibidos: KgPositivo
    fecha: date | None = None
    observaciones: str | None = None


class ComprobanteBodegaResponse(BaseModel):
    id: str
    remito_id: str
    numero_suv: str
    kg_recibidos: Decimal
    fecha: date | None
    observaciones: str | None
    # kg_recibidos - kg del remito (negativo = la bodega recibió menos).
    diferencia_kg: Decimal
    created_at: datetime


class RemitoResponse(BaseModel):
    id: str
    tipo: TipoRemito
    numero: str
    fecha: date
    comprador_id: str
    kg_total: Decimal
    vehiculo_patente: str | None
    observaciones: str | None
    created_at: datetime
    lineas: list[RemitoLineaResponse]
    comprobante_bodega: ComprobanteBodegaResponse | None = None
