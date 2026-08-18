from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.parcela import Parcela


class Valvula(Base):
    """Catalogo real de valvulas de riego, poblado desde el GeoJSON de QGIS
    (frontend/public/layers/Valvulas.geojson) via scripts/seed_valvulas.py.

    Reemplaza las listas hardcodeadas y duplicadas que antes vivian en
    frontend/lib/api/riego.ts y mobile/lib/types.ts (VALVULAS_POR_PARCELA,
    CABEZAL_VALVULAS) — esas asumian un unico cabezal por parcela y una
    cantidad de valvulas por nombre de parcela que no coincidia con la
    realidad (ver auditoria de 2026-08-18, scripts/auditoria_valvulas_geojson.py).
    El cabezal es un atributo de la valvula, no de la parcela: una misma
    parcela puede tener valvulas alimentadas por cabezales distintos
    (caso real: Parral 2, valvula "21" en cabezal 2 vs. "22"/"23" en cabezal 1).
    """

    __tablename__ = "valvulas"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    nombre: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    parcela_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=False
    )
    cabezal: Mapped[int] = mapped_column(Integer, nullable=False)
    # Posicion oeste->este dentro de su parcela (1 = mas al oeste). Nula para
    # valvulas sin un orden fisico relevante conocido todavia.
    orden: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    parcela: Mapped[Parcela] = relationship("Parcela", back_populates="valvulas")
