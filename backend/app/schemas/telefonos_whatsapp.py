from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TelefonoUsuarioWhatsappCreate(BaseModel):
    telefono: str
    user_id: str


class TelefonoUsuarioWhatsappResponse(BaseModel):
    id: str
    telefono: str
    user_id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
