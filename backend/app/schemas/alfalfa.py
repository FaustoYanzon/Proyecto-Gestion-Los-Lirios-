"""Alfalfa inventory schemas: documents (alta/salida) and derived stock."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.models.alfalfa import ProductoAlfalfa, TipoDocumentoAlfalfa

# Products counted in whole units; semilla is loaded by kg.
PRODUCTOS_POR_UNIDAD = frozenset({ProductoAlfalfa.fardo, ProductoAlfalfa.rollo})


class LineaAlfalfaIn(BaseModel):
    producto: ProductoAlfalfa
    # Matches Numeric(14,2): out of range would be a 500 in Postgres.
    cantidad: Decimal = Field(gt=0, max_digits=14, decimal_places=2)

    @model_validator(mode="after")
    def _unidades_enteras(self) -> "LineaAlfalfaIn":
        if self.producto in PRODUCTOS_POR_UNIDAD and self.cantidad != self.cantidad.to_integral_value():
            raise ValueError(f"La cantidad de {self.producto.value} debe ser un número entero de unidades")
        return self


class DocumentoAlfalfaCreate(BaseModel):
    tipo: TipoDocumentoAlfalfa
    fecha: date
    potrero_id: str | None = Field(default=None, max_length=36)
    comprador_id: str | None = Field(default=None, max_length=36)
    vehiculo_patente: str | None = Field(default=None, max_length=20)
    observaciones: str | None = Field(default=None, max_length=500)
    idempotency_key: str | None = Field(default=None, max_length=36)
    lineas: list[LineaAlfalfaIn] = Field(min_length=1)

    @model_validator(mode="after")
    def _reglas_por_tipo(self) -> "DocumentoAlfalfaCreate":
        productos = [linea.producto for linea in self.lineas]
        if len(productos) != len(set(productos)):
            raise ValueError("Cada producto puede aparecer una sola vez por documento")
        # Mirrors ck_documento_alfalfa_destinatario_segun_tipo so it fails as 422, not 500.
        if self.tipo == TipoDocumentoAlfalfa.alta:
            if self.potrero_id is None:
                raise ValueError("Un alta requiere potrero_id")
            if self.comprador_id is not None or self.vehiculo_patente is not None:
                raise ValueError("Un alta no lleva comprador ni patente")
        else:
            if self.comprador_id is None:
                raise ValueError("Una salida requiere comprador_id")
            if self.potrero_id is not None:
                raise ValueError("Una salida no lleva potrero")
        return self


class LineaAlfalfaOut(BaseModel):
    id: str
    producto: ProductoAlfalfa
    cantidad: Decimal
    kg: Decimal

    model_config = ConfigDict(from_attributes=True)


class DocumentoAlfalfaOut(BaseModel):
    id: str
    tipo: TipoDocumentoAlfalfa
    numero: str
    fecha: date
    potrero_id: str | None
    comprador_id: str | None
    deposito_id: str
    vehiculo_patente: str | None
    observaciones: str | None
    idempotency_key: str | None
    created_by: str
    created_at: datetime
    anulado_at: datetime | None = None
    motivo_anulacion: str | None = None
    lineas: list[LineaAlfalfaOut]

    model_config = ConfigDict(from_attributes=True)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def anulado(self) -> bool:
        return self.anulado_at is not None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def kg_total(self) -> Decimal:
        return sum((linea.kg for linea in self.lineas), Decimal("0"))


class StockProductoOut(BaseModel):
    producto: ProductoAlfalfa
    unidades: Decimal
    kg: Decimal

    model_config = ConfigDict(from_attributes=True)
