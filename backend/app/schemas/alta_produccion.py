import enum
from datetime import date, datetime
from decimal import Decimal

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.alta_produccion import EstadoLote, TipoProductor, TipoRemito
from app.models.parcela import VariedadUva
from app.models.produccion import OrigenCosecha, TipoEnvase
from app.schemas.produccion import RegistroCosechaResponse


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
    # True: carro incompleto. Las fichas se estiman por peso (si no vienen) y
    # no se calcula merma (kg_teorico = kg_real, merma_kg = 0).
    carro_incompleto: bool = False
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
    carro_incompleto: bool = False
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
    # "2026 · sultanina · 1 · N°3" (solo líneas con lote).
    lote_label: str | None = None
    # "2026-02-05 · flame · Parral 1" (solo líneas con cosecha).
    cosecha_label: str | None = None

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
    # None en remitos TRA (traslado a pasero), que llevan `pasero_id`.
    comprador_id: str | None
    pasero_id: str | None = None
    comprador_nombre: str | None = None
    pasero_nombre: str | None = None
    kg_total: Decimal
    vehiculo_patente: str | None
    observaciones: str | None
    created_at: datetime
    lineas: list[RemitoLineaResponse]
    comprobante_bodega: ComprobanteBodegaResponse | None = None


# ── Despacho de cosecha ("De -> Para") ───────────────────────────────────────

class ParaDespacho(str, enum.Enum):
    bodega = "bodega"
    comprador = "comprador"
    pasero = "pasero"


class DespachoCosechaCreate(BaseModel):
    """Alta de cosecha + remito (+ ingreso al pasero). Un solo formulario."""

    fecha: date
    para: ParaDespacho

    # DE. propio: `parcela_id` (parral); tercero: `productor_id` + `variedad`.
    origen: OrigenCosecha = OrigenCosecha.propio
    parcela_id: str | None = None
    productor_id: str | None = None
    # Propio: sobrescribe la variedad del parral. Tercero: obligatoria.
    variedad: VariedadUva | None = None

    # PARA. bodega/comprador: `comprador_id`. pasero: `pasero_id`.
    comprador_id: str | None = None
    pasero_id: str | None = None
    ubicacion_id: str | None = None
    carros: int = Field(default=1, ge=1)
    # True: el carro no está completo y las fichas se estiman por peso.
    carro_incompleto: bool = False

    # Peso: kg_total directo, o envases, o bruto/tara (en ese orden de prioridad).
    kg_total: KgPositivo | None = None
    tipo_envase: TipoEnvase = TipoEnvase.caja
    cantidad_envases: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    peso_unitario_kg: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=4)
    bruto_kg: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    tara_kg: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)

    vehiculo_patente: str | None = Field(default=None, max_length=20)
    cuadrilla: str | None = Field(default=None, max_length=150)
    acarreo: str | None = Field(default=None, max_length=150)
    n_ciu: str | None = Field(default=None, max_length=50)
    # N° del comprobante en papel; si no viene, se copia el del remito generado.
    n_remito: str | None = Field(default=None, max_length=50)
    observaciones: str | None = Field(default=None, max_length=500)
    imagen_remito_url: str | None = Field(default=None, max_length=500)
    idempotency_key: str | None = Field(default=None, max_length=36)

    @model_validator(mode="after")
    def _hay_peso(self) -> "DespachoCosechaCreate":
        por_envases = self.cantidad_envases is not None and self.peso_unitario_kg is not None
        por_balanza = self.bruto_kg is not None and self.tara_kg is not None
        if self.kg_total is None and not por_envases and not por_balanza:
            raise ValueError("Indicá el peso: kg_total, envases (cantidad x peso unitario) o bruto y tara")
        return self


class DespachoCosechaResponse(BaseModel):
    cosecha: RegistroCosechaResponse
    remito: RemitoResponse
    ingreso_pasero: IngresoPaseroResponse | None = None


class RemitoPdfLinkResponse(BaseModel):
    # Ruta relativa al API (con el token) y URL absoluta armada con el host del request.
    path: str
    url: str
    expires_in: int
