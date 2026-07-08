from decimal import Decimal

from pydantic import BaseModel


class PresupuestoVsRealItem(BaseModel):
    temporada: int
    mes: int
    concepto: str
    tipo: str | None = None
    moneda: str
    monto_presupuesto: Decimal
    monto_real: Decimal
    desvio: Decimal
    desvio_pct: Decimal | None = None


class ProduccionParcelaKpi(BaseModel):
    temporada: int
    parcela_id: str
    parcela_nombre: str
    variedad: str | None = None
    superficie_ha: float | None = None
    kg_total: float
    kg_ha: Decimal | None = None
    kg_plan: Decimal | None = None
    desvio_plan_pct: Decimal | None = None
    litros_riego_estimados: float | None = None
    litros_por_kg: Decimal | None = None


class ProduccionVariedadKpi(BaseModel):
    temporada: int
    variedad: str | None = None
    kg_total: float
    superficie_ha: float | None = None
    kg_ha: Decimal | None = None


class ManoObraMensualKpi(BaseModel):
    temporada: int
    mes: int
    clasificacion: str
    jornales: Decimal | None = None
    monto: Decimal


class CompradorKpi(BaseModel):
    temporada: int
    comprador: str
    kg_entregados: float
    monto_cobrado_ars: Decimal
    monto_cobrado_usd: Decimal


class ManoObraParcelaKpi(BaseModel):
    temporada: int
    parcela_id: str
    parcela_nombre: str
    superficie_ha: float | None = None
    jornales: Decimal | None = None
    monto: Decimal
    monto_por_ha: Decimal | None = None


class ManoObraParcelaMesKpi(BaseModel):
    temporada: int
    mes: int
    parcela_id: str
    parcela_nombre: str
    jornales: Decimal | None = None
    monto: Decimal
