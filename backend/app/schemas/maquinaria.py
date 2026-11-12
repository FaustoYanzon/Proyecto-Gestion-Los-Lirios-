from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.finanzas import Finca, FormaPago, OrigenPago
from app.models.maquinaria import (
    EstadoOrdenMaquinaria,
    EstadoPresupuestoMaquinaria,
    GravedadFalla,
    TipoMaquina,
)
from app.services.maquinaria import EstadoMaquina


# ── Máquinas ──────────────────────────────────────────────────────────────────

def _require_https(value: str | None) -> str | None:
    if value is not None and not value.startswith("https://"):
        raise ValueError("La URL debe empezar con https://")
    return value


class MaquinaCreate(BaseModel):
    tipo: TipoMaquina
    marca: str = Field(min_length=1, max_length=100)
    modelo: str = Field(min_length=1, max_length=100)
    anio: int | None = Field(default=None, ge=1900, le=2100)
    patente_serie: str | None = Field(default=None, max_length=100)
    horas_motor: Decimal | None = Field(default=None, ge=0)
    finca: Finca
    tractor_id: str | None = None
    foto_url: str | None = Field(default=None, max_length=500)


class MaquinaUpdate(BaseModel):
    tipo: TipoMaquina | None = None
    marca: str | None = Field(default=None, min_length=1, max_length=100)
    modelo: str | None = Field(default=None, min_length=1, max_length=100)
    anio: int | None = Field(default=None, ge=1900, le=2100)
    patente_serie: str | None = Field(default=None, max_length=100)
    horas_motor: Decimal | None = Field(default=None, ge=0)
    finca: Finca | None = None
    tractor_id: str | None = None
    foto_url: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class MaquinaResumen(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tipo: TipoMaquina
    marca: str
    modelo: str
    patente_serie: str | None
    finca: Finca


class MaquinaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tipo: TipoMaquina
    marca: str
    modelo: str
    anio: int | None
    patente_serie: str | None
    horas_motor: Decimal | None
    finca: Finca
    tractor_id: str | None
    foto_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    # Derived from the open orders (assumption A1), never stored.
    estado: EstadoMaquina
    semaforo: str
    ordenes_abiertas: int


# ── Órdenes ───────────────────────────────────────────────────────────────────

class OrdenCreate(BaseModel):
    maquina_id: str
    descripcion: str = Field(min_length=1, max_length=2000)
    gravedad: GravedadFalla
    # Offline retries send the same key; also accepted as `Idempotency-Key` header.
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=36)


class OrdenUpdate(BaseModel):
    taller: str | None = Field(default=None, max_length=200)
    fecha_estimada_entrega: date | None = None
    descripcion: str | None = Field(default=None, min_length=1, max_length=2000)
    gravedad: GravedadFalla | None = None


class TransicionRequest(BaseModel):
    a_estado: EstadoOrdenMaquinaria
    nota: str | None = Field(default=None, max_length=1000)


class FotoOrdenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    url: str
    subida_por: str
    created_at: datetime


class PresupuestoCreate(BaseModel):
    # Falls back to the order's taller when omitted.
    taller: str | None = Field(default=None, max_length=200)
    monto: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    detalle: str | None = Field(default=None, max_length=2000)
    adjunto_url: str | None = Field(default=None, max_length=500)

    _https = field_validator("adjunto_url")(_require_https)


class PresupuestoResolver(BaseModel):
    aprobar: bool
    motivo: str | None = Field(default=None, max_length=1000)


class PresupuestoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    orden_id: str
    taller: str
    # monto / adjunto_url are null for roles below gerencial (money data).
    monto: Decimal | None
    detalle: str | None
    adjunto_url: str | None
    estado: EstadoPresupuestoMaquinaria
    motivo_rechazo: str | None
    created_by: str
    resuelto_por: str | None
    resuelto_at: datetime | None
    created_at: datetime


class PagoCreate(BaseModel):
    monto_real: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    factura_url: str | None = Field(default=None, max_length=500)
    fecha: date | None = None
    origen: OrigenPago = OrigenPago.no_oficial
    forma_pago: FormaPago = FormaPago.transferencia

    _https = field_validator("factura_url")(_require_https)


class PagoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    orden_id: str
    # monto_real / factura_url are null for roles below gerencial (money data).
    monto_real: Decimal | None
    factura_url: str | None
    fecha: date
    registrado_por: str
    egreso_id: str | None
    created_at: datetime


class EventoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    estado_desde: EstadoOrdenMaquinaria | None
    estado_hasta: EstadoOrdenMaquinaria
    usuario_id: str
    # Filled by the router (a User lookup); None only if the user row is gone.
    usuario_nombre: str | None = None
    nota: str | None
    created_at: datetime


class OrdenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    maquina_id: str
    maquina: MaquinaResumen
    finca: Finca
    reportada_por: str
    descripcion: str
    gravedad: GravedadFalla
    estado: EstadoOrdenMaquinaria
    taller: str | None
    fecha_estimada_entrega: date | None
    created_at: datetime
    updated_at: datetime


class OrdenDetalleResponse(OrdenResponse):
    fotos: list[FotoOrdenResponse]
    presupuestos: list[PresupuestoResponse]
    pago: PagoResponse | None
    eventos: list[EventoResponse]


# ── Historial de una máquina ──────────────────────────────────────────────────

class HistorialOrden(BaseModel):
    id: str
    estado: EstadoOrdenMaquinaria
    gravedad: GravedadFalla
    descripcion: str
    taller: str | None
    created_at: datetime
    costo: Decimal | None
    dias_fuera_servicio: Decimal


class HistorialMaquinaResponse(BaseModel):
    maquina_id: str
    # None for roles below gerencial (money data).
    costo_total: Decimal | None
    dias_fuera_servicio_total: Decimal
    ordenes: list[HistorialOrden]
