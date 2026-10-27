"""Link an applied product (a RegistroFitosanitario) to its row of the
phytosanitary plan.

The plan has no dates, so the match is exact on (temporada, variedad, insumo,
numero_aplicacion): the round is chosen by hand when the order is built, and
the variety comes from the parcel being confirmed. No match (an off-plan line,
or a variety the plan does not cover for that round) means an extra
application -- never an error.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.parcela import VariedadUva
from app.models.produccion import PlanFitosanitario


async def resolver_plan_id(
    db: AsyncSession,
    *,
    temporada: int,
    variedad: VariedadUva,
    insumo_id: str,
    numero_aplicacion: int | None,
) -> str | None:
    """Id of the plan row for this product, or None when the line is off-plan
    or the plan has no row for that variety."""
    if numero_aplicacion is None:
        return None
    # Ordered by id so a (not expected) duplicate row resolves deterministically.
    return (
        await db.execute(
            select(PlanFitosanitario.id)
            .where(
                PlanFitosanitario.temporada == temporada,
                PlanFitosanitario.variedad == variedad,
                PlanFitosanitario.insumo_id == insumo_id,
                PlanFitosanitario.numero_aplicacion == numero_aplicacion,
            )
            .order_by(PlanFitosanitario.id)
            .limit(1)
        )
    ).scalar_one_or_none()
