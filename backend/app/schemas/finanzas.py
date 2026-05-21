from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.finanzas import (
    ClasificacionEgreso,
    Finca,
    FormaPago,
    MonedaTipo,
    OrigenPago,
    ProductoIngreso,
    TipoEgreso,
)
from app.models.parcela import VariedadUva


# ── Egresos ──────────────────────────────────────────────────────────────────

class EgresoBase(BaseModel):
    fecha: date
    tipo: TipoEgreso
    clasificacion: ClasificacionEgreso
    descripcion: str | None = None
    monto: Decimal
    moneda: MonedaTipo
    tipo_cambio: Decimal | None = None
    origen: OrigenPago
    finca: Finca
    forma_pago: FormaPago
    parcela_id: str | None = None
    fuente: str = "manual"


class EgresoCreate(EgresoBase):
    pass


class EgresoUpdate(BaseModel):
    fecha: date | None = None
    tipo: TipoEgreso | None = None
    clasificacion: ClasificacionEgreso | None = None
    descripcion: str | None = None
    monto: Decimal | None = None
    moneda: MonedaTipo | None = None
    tipo_cambio: Decimal | None = None
    origen: OrigenPago | None = None
    finca: Finca | None = None
    forma_pago: FormaPago | None = None
    parcela_id: str | None = None
    fuente: str | None = None


class EgresoResponse(EgresoBase):
    id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ResumenEgresoPorTipo(BaseModel):
    tipo: TipoEgreso
    clasificacion: ClasificacionEgreso
    moneda: MonedaTipo
    total: Decimal


# ── Ingresos ──────────────────────────────────────────────────────────────────

class IngresoBase(BaseModel):
    fecha: date
    cliente: str
    producto: ProductoIngreso
    variedad: VariedadUva | None = None
    kg_totales: Decimal | None = None
    precio_por_kg: Decimal | None = None
    monto: Decimal
    moneda: MonedaTipo
    tipo_cambio: Decimal | None = None
    origen: OrigenPago
    finca: Finca
    forma_pago: FormaPago
    descripcion: str | None = None


class IngresoCreate(IngresoBase):
    pass


class IngresoUpdate(BaseModel):
    fecha: date | None = None
    cliente: str | None = None
    producto: ProductoIngreso | None = None
    variedad: VariedadUva | None = None
    kg_totales: Decimal | None = None
    precio_por_kg: Decimal | None = None
    monto: Decimal | None = None
    moneda: MonedaTipo | None = None
    tipo_cambio: Decimal | None = None
    origen: OrigenPago | None = None
    finca: Finca | None = None
    forma_pago: FormaPago | None = None
    descripcion: str | None = None


class IngresoResponse(IngresoBase):
    id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Flujo anual ───────────────────────────────────────────────────────────────

class FlujoMensual(BaseModel):
    mes: str
    ingresos_ars: Decimal
    egresos_ars: Decimal
    saldo_ars: Decimal
    ingresos_usd: Decimal
    egresos_usd: Decimal
    saldo_usd: Decimal


class FlujoAnualResponse(BaseModel):
    campana: str
    meses: list[FlujoMensual]
    total_ingresos_ars: Decimal
    total_egresos_ars: Decimal
    saldo_total_ars: Decimal
    total_ingresos_usd: Decimal
    total_egresos_usd: Decimal
    saldo_total_usd: Decimal


# ── Dashboard schemas ─────────────────────────────────────────────────────────

class IngresosPorProducto(BaseModel):
    producto: str
    variedad: str | None
    kg_totales: Decimal
    monto_ars: Decimal
    monto_usd: Decimal
    precio_promedio_kg_ars: Decimal | None


class ResumenAnualDashboard(BaseModel):
    campana: str
    total_ingresos_ars: Decimal
    total_egresos_ars: Decimal
    saldo_ars: Decimal
    total_ingresos_usd: Decimal
    total_egresos_usd: Decimal
    saldo_usd: Decimal
    ingresos_por_producto: list[IngresosPorProducto]


class EgresosMesItem(BaseModel):
    mes: str
    mes_key: str
    tipo: str
    total: Decimal


class EgresosPorMesResponse(BaseModel):
    campana: str
    items: list[EgresosMesItem]
    tipos_presentes: list[str]


class CostoPorKgResponse(BaseModel):
    campana: str
    total_egresos_ars: Decimal
    kg_cosechados_total: Decimal | None
    costo_por_kg_ars: Decimal | None
