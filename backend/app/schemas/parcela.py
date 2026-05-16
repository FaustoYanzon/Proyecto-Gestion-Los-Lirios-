from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.parcela import TipoParcela, VariedadUva


class ParcelaBase(BaseModel):
    nombre: str
    tipo: TipoParcela
    variedad: VariedadUva | None = None
    superficie_ha: float | None = None
    cabezal_riego: str | None = None
    coordenadas: list | None = None


class ParcelaCreate(ParcelaBase):
    pass


class ParcelaUpdate(BaseModel):
    nombre: str | None = None
    tipo: TipoParcela | None = None
    variedad: VariedadUva | None = None
    superficie_ha: float | None = None
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
    cabezal_riego: str | None = None
    coordenadas: list | None = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
