# backend/app/api/alertas.py
# Las alertas en si se calculan en el frontend a partir de datos ya
# existentes (riego, carencia, fenologia) - este endpoint solo guarda que
# alerta_id se descarto (tilde = completada, cruz = cancelada) para que el
# frontend las filtre de la lista calculada. Compartido entre usuarios.

from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict, Field
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user
from app.models.user import User
from app.models.alerta_descartada import AlertaDescartada

router = APIRouter(prefix="/alertas", tags=["alertas"])


class DescartarAlertaRequest(BaseModel):
    alerta_id: str = Field(min_length=1, max_length=128)
    tipo: str = Field(pattern="^(completada|cancelada)$")


class AlertaDescartadaResponse(BaseModel):
    alerta_id: str
    tipo: str

    model_config = ConfigDict(from_attributes=True)


@router.get("/descartadas", response_model=list[AlertaDescartadaResponse])
async def listar_descartadas(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Alertas descartadas todavía vigentes (no expiradas)."""
    now = datetime.now(timezone.utc)
    stmt = select(AlertaDescartada).where(AlertaDescartada.expira_at > now)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/descartar", response_model=AlertaDescartadaResponse)
async def descartar_alerta(
    payload: DescartarAlertaRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = AlertaDescartada(
        alerta_id=payload.alerta_id,
        tipo=payload.tipo,
        descartada_por=current_user.id,
    )
    db.add(row)
    await db.flush()
    return row
