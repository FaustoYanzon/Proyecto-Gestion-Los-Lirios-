from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.finanzas import Finca
from app.models.parcela import TipoParcela, TipoRiego, VariedadUva


class ParcelaBase(BaseModel):
    nombre: str
    tipo: TipoParcela
    variedad: VariedadUva | None = None
    superficie_ha: float | None = None
    finca: Finca | None = None
    tipo_riego: TipoRiego | None = None
    usa_cobertura_invierno: bool = False
    especie_cobertura_invierno: str | None = None
    cabezal_riego: str | None = None
    coordenadas: list | None = None


class ParcelaCreate(ParcelaBase):
    pass


class ParcelaUpdate(BaseModel):
    nombre: str | None = None
    tipo: TipoParcela | None = None
    variedad: VariedadUva | None = None
    superficie_ha: float | None = None
    finca: Finca | None = None
    tipo_riego: TipoRiego | None = None
    usa_cobertura_invierno: bool | None = None
    especie_cobertura_invierno: str | None = None
    cabezal_riego: str | None = None
    coordenadas: list | None = None
    is_active: bool | None = None


class ParcelaResponse(ParcelaBase):
    id: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ParcelaMapResponse(BaseModel):
    id: str
    nombre: str
    tipo: TipoParcela
    variedad: VariedadUva | None = None
    superficie_ha: float | None = None
    finca: Finca | None = None
    tipo_riego: TipoRiego | None = None
    usa_cobertura_invierno: bool = False
    especie_cobertura_invierno: str | None = None
    cabezal_riego: str | None = None
    coordenadas: list | None = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
