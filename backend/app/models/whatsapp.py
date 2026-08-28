from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.finanzas import Egreso
    from app.models.user import User


class EstadoMensajeWhatsapp(str, enum.Enum):
    pendiente = "pendiente"
    clasificado = "clasificado"
    descartado = "descartado"


class TelefonoUsuarioWhatsapp(Base):
    """Vínculo teléfono de WhatsApp -> usuario del sistema. Un usuario puede
    tener más de un teléfono vinculado (por eso user_id no es unique), pero un
    teléfono siempre resuelve a un único usuario."""

    __tablename__ = "telefonos_usuarios_whatsapp"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    telefono: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    user: Mapped[User] = relationship("User", foreign_keys=[user_id])


class MensajeWhatsappPendiente(Base):
    """Un gasto informal recibido por WhatsApp, a la espera de que un usuario
    gerencial/super_admin lo clasifique en un Egreso real (tipo/clasificacion/
    finca/forma_pago) -- mismo patrón que ComprobanteArcaImportado en
    app/models/arca.py, pero alimentado por el webhook de Meta en vez de un
    CSV. La fila nunca se borra al clasificar (queda con estado=clasificado y
    egreso_id apuntando al Egreso resultante), así la foto del comprobante
    sigue siendo accesible sin agregar una columna nueva a Egreso."""

    __tablename__ = "mensajes_whatsapp_pendientes"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # messages[].id de Meta -- clave de idempotencia ante los reintentos
    # agresivos del webhook si no respondemos 200 a tiempo.
    wa_message_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    telefono: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    texto_original: Mapped[str] = mapped_column(String(1000), nullable=False)
    monto: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    descripcion: Mapped[str] = mapped_column(String(500), nullable=False)
    pagado: Mapped[bool] = mapped_column(Boolean, nullable=False)
    foto_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    estado: Mapped[EstadoMensajeWhatsapp] = mapped_column(
        SAEnum(EstadoMensajeWhatsapp), nullable=False, default=EstadoMensajeWhatsapp.pendiente
    )
    egreso_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("egresos.id"), nullable=True
    )
    clasificado_por: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    clasificado_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recibido_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        Index("ix_mensajes_whatsapp_estado", "estado"),
    )

    egreso: Mapped[Egreso | None] = relationship("Egreso")
