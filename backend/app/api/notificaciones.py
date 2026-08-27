from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_gerencial_up
from app.core.birthdays import check_and_notify_birthdays
from app.core.database import get_db
from app.core.push import send_expo_push
from app.models.push_token import PushToken
from app.models.user import User

router = APIRouter(prefix="/notificaciones", tags=["notificaciones"])


class RegisterTokenRequest(BaseModel):
    token: str
    platform: str = "android"


class SendNotificationRequest(BaseModel):
    titulo: str
    cuerpo: str
    user_ids: list[str] | None = None  # None = todos los usuarios


@router.post("/token", status_code=204)
async def register_token(
    req: RegisterTokenRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(PushToken).where(PushToken.user_id == current_user.id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.token = req.token
        existing.platform = req.platform
    else:
        db.add(PushToken(user_id=current_user.id, token=req.token, platform=req.platform))
    await db.flush()  # commit delegated to get_db context manager


@router.post("/enviar")
async def send_notification(
    req: SendNotificationRequest,
    _: User = Depends(require_gerencial_up),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    query = select(PushToken)
    if req.user_ids:
        query = query.where(PushToken.user_id.in_(req.user_ids))
    result = await db.execute(query)
    tokens: Sequence[PushToken] = result.scalars().all()

    if not tokens:
        raise HTTPException(status_code=404, detail="No hay tokens de push registrados")

    messages = [
        {"to": t.token, "title": req.titulo, "body": req.cuerpo, "sound": "default"}
        for t in tokens
    ]

    http_status = await send_expo_push(messages)
    return {"enviados": len(messages), "expo_status": http_status}


@router.post("/cumpleanos/ejecutar")
async def ejecutar_chequeo_cumpleanos(
    _: User = Depends(require_gerencial_up),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Dispara manualmente el chequeo de cumpleaños de hoy.

    Red de seguridad / vía de testeo: el scheduler in-process
    (app/core/scheduler.py) ya lo corre solo todos los días a las 8am.
    """
    n = await check_and_notify_birthdays(db)
    return {"notificados": n}
