# backend/app/models/alerta_descartada.py
# Las alertas del dashboard (frontend/components/Alertas.tsx) se calculan en
# vivo a partir de datos reales (riego, carencia, fenología) - no son filas
# persistidas. Esta tabla solo guarda qué alerta_id se descartó y hasta
# cuándo, para que el frontend pueda filtrarla de la lista calculada.
# Compartida entre todos los usuarios (no por-usuario) a propósito.

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

DISCARD_TTL_HOURS = 48


def _default_expira_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=DISCARD_TTL_HOURS)


class AlertaDescartada(Base):
    __tablename__ = "alertas_descartadas"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # Coincide con el id calculado en frontend/components/Alertas.tsx
    # (ej. "riego-1", "carencia-<parcela_id>", "sin-fenologia").
    alerta_id: Mapped[str] = mapped_column(String(128), nullable=False)
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)  # completada | cancelada
    descartada_por: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    descartada_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    # Vuelve a aparecer sola pasado este momento (48h) - una alerta real
    # como "riego atrasado" no debe quedar silenciada para siempre por error.
    expira_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_default_expira_at, nullable=False
    )
