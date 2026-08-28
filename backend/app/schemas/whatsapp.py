from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.finanzas import ClasificacionEgreso, Finca, FormaPago, TipoEgreso
from app.models.whatsapp import EstadoMensajeWhatsapp


class MensajeWhatsappResponse(BaseModel):
    id: str
    telefono: str
    user_id: str
    texto_original: str
    monto: Decimal
    descripcion: str
    pagado: bool
    foto_url: str | None
    estado: EstadoMensajeWhatsapp
    egreso_id: str | None
    clasificado_por: str | None
    clasificado_at: datetime | None
    recibido_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ClasificarEgresoWhatsappRequest(BaseModel):
    tipo: TipoEgreso
    clasificacion: ClasificacionEgreso
    finca: Finca
    forma_pago: FormaPago
    parcela_id: str | None = None
    descripcion: str | None = None
