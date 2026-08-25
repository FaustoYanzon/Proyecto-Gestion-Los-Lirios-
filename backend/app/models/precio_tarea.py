from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.produccion import UnidadMedida

if TYPE_CHECKING:
    from app.models.parcela import Parcela
    from app.models.user import User


class PrecioTarea(Base):
    """Maestro de precios de referencia por tarea, con historial por campaña.

    `parcela_id` nulo = precio general de esa tarea/temporada/unidad, usado
    como fallback cuando no hay una regla específica para el parral elegido
    (ver GET /precios-tarea y buscarPrecio() en el frontend). No reemplaza
    `RegistroTrabajo.precio_unitario` -- solo lo autocompleta al cargar,
    sigue siendo editable ahí; cada tarea ya cargada guarda su propio precio
    congelado, independiente de si esta tabla cambia después.
    """

    __tablename__ = "precios_tarea"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    temporada: Mapped[int] = mapped_column(Integer, nullable=False)
    tarea: Mapped[str] = mapped_column(String(100), nullable=False)
    parcela_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("parcelas.id"), nullable=True
    )
    unidad_medida: Mapped[UnidadMedida] = mapped_column(SAEnum(UnidadMedida), nullable=False)
    precio_unitario: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_precios_tarea_temporada", "temporada"),
        # Dos índices únicos parciales en vez de uno solo -- Postgres no
        # considera iguales dos NULL, así que una unique constraint normal
        # sobre (temporada, tarea, parcela_id, unidad_medida) dejaría crear
        # infinitas filas "generales" (parcela_id NULL) duplicadas. Mismo
        # mecanismo que ya usa RegistroTrabajo para su idempotency_key.
        # postgresql_where + sqlite_where (no solo el primero) -- sin el
        # segundo, SQLAlchemy compila el índice sin condición alguna contra
        # el SQLite de los tests, convirtiéndolo en una unique constraint
        # llana que bloquea filas específicas y generales entre sí por error
        # (encontrado corriendo los tests, no hipotético).
        Index(
            "uq_precios_tarea_especifico",
            "temporada", "tarea", "parcela_id", "unidad_medida",
            unique=True,
            postgresql_where=text("parcela_id IS NOT NULL"),
            sqlite_where=text("parcela_id IS NOT NULL"),
        ),
        Index(
            "uq_precios_tarea_general",
            "temporada", "tarea", "unidad_medida",
            unique=True,
            postgresql_where=text("parcela_id IS NULL"),
            sqlite_where=text("parcela_id IS NULL"),
        ),
    )

    parcela: Mapped[Parcela | None] = relationship("Parcela")
    created_by_user: Mapped[User] = relationship("User")
