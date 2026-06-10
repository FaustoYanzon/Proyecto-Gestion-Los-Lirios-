from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.trabajador import RolTrabajador


class TrabajadorBase(BaseModel):
    nombre_completo: str
    dni: str | None = None
    rol: RolTrabajador = RolTrabajador.obrero
    telefono: str | None = None


class TrabajadorCreate(TrabajadorBase):
    pass


class TrabajadorUpdate(BaseModel):
    nombre_completo: str | None = None
    dni: str | None = None
    rol: RolTrabajador | None = None
    telefono: str | None = None
    is_active: bool | None = None


class TrabajadorResponse(TrabajadorBase):
    id: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
