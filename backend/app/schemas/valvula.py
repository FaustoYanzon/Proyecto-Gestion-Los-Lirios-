from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ValvulaResponse(BaseModel):
    id: str
    nombre: str
    parcela_id: str
    cabezal: int
    orden: int | None = None
    lat: float
    lon: float
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
