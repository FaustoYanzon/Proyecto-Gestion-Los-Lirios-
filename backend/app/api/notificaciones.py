import asyncio
import json
import urllib.request
from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_gerencial_up
from app.core.database import get_db
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


def _send_expo_push_sync(messages: list[dict]) -> int:
    data = json.dumps(messages).encode("utf-8")
    req = urllib.request.Request(
        "https://exp.host/--/api/v2/push/send",
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status


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
    await db.commit()


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

    status = await asyncio.to_thread(_send_expo_push_sync, messages)
    return {"enviados": len(messages), "expo_status": status}
