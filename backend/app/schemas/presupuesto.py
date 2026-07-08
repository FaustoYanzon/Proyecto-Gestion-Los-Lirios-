from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.finanzas import ClasificacionEgreso, MonedaTipo, TipoEgreso
from app.models.presupuesto import ConceptoPresupuesto


# ── Presupuesto ───────────────────────────────────────────────────────────────

class PresupuestoBase(BaseModel):
    temporada: int = Field(ge=2020, le=2100)
    mes: int = Field(ge=1, le=12)
    concepto: ConceptoPresupuesto
    tipo: TipoEgreso | None = None
    clasificacion: ClasificacionEgreso | None = None
    cliente: str | None = Field(None, max_length=200)
    monto: Decimal = Field(gt=0)
    moneda: MonedaTipo
    notas: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_concepto_fields(self) -> "PresupuestoBase":
        # Egreso lines budget by expense type; ingreso lines by client.
        if self.concepto == ConceptoPresupuesto.egreso:
            if self.tipo is None:
                raise ValueError("Egreso budget lines require 'tipo'")
            if self.cliente is not None:
                raise ValueError("Egreso budget lines must not set 'cliente'")
        else:
            if not self.cliente:
                raise ValueError("Ingreso budget lines require 'cliente'")
            if self.tipo is not None or self.clasificacion is not None:
                raise ValueError(
                    "Ingreso budget lines must not set 'tipo'/'clasificacion'"
                )
        return self


class PresupuestoCreate(PresupuestoBase):
    pass


class PresupuestoBulkCreate(BaseModel):
    items: list[PresupuestoCreate] = Field(min_length=1, max_length=500)


class PresupuestoUpdate(BaseModel):
    mes: int | None = Field(None, ge=1, le=12)
    monto: Decimal | None = Field(None, gt=0)
    moneda: MonedaTipo | None = None
    clasificacion: ClasificacionEgreso | None = None
    cliente: str | None = Field(None, max_length=200)
    notas: str | None = Field(None, max_length=500)


class PresupuestoResponse(PresupuestoBase):
    id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Metas de producción ───────────────────────────────────────────────────────

class MetaProduccionBase(BaseModel):
    temporada: int = Field(ge=2020, le=2100)
    parcela_id: str
    kg_plan: Decimal = Field(gt=0)
    notas: str | None = Field(None, max_length=500)


class MetaProduccionCreate(MetaProduccionBase):
    pass


class MetaProduccionUpdate(BaseModel):
    kg_plan: Decimal | None = Field(None, gt=0)
    notas: str | None = Field(None, max_length=500)


class MetaProduccionResponse(MetaProduccionBase):
    id: str
    parcela_nombre: str | None = None
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
