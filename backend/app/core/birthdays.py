"""Chequeo diario de cumpleaños -- ver app/core/scheduler.py (quién lo llama
automáticamente) y POST /notificaciones/cumpleanos/ejecutar (vía manual).
"""

import calendar
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.push import send_expo_push
from app.models.push_token import PushToken
from app.models.user import User

logger = logging.getLogger(__name__)

FINCA_TZ = ZoneInfo("America/Argentina/San_Juan")


async def check_and_notify_birthdays(db: AsyncSession) -> int:
    """Notifica al equipo (menos al propio cumpleañero) por cada usuario
    activo cuyo cumpleaños sea hoy. Devuelve la cantidad de cumpleañeros
    notificados. Idempotente por día vía `last_birthday_notified_year`.
    """
    hoy = datetime.now(FINCA_TZ).date()
    # 29/2 en año no bisiesto -- lo tratamos como 28/2 para no saltear el
    # cumpleaños de alguien nacido un 29 de febrero.
    dia, mes = (
        (28, 2)
        if hoy.month == 2 and hoy.day == 28 and not calendar.isleap(hoy.year)
        else (hoy.day, hoy.month)
    )

    result = await db.execute(
        select(User).where(
            User.birth_day == dia,
            User.birth_month == mes,
            User.is_active.is_(True),
            (User.last_birthday_notified_year.is_(None))
            | (User.last_birthday_notified_year != hoy.year),
        )
    )
    cumpleaneros = list(result.scalars().all())
    if not cumpleaneros:
        return 0

    tokens = list((await db.execute(select(PushToken))).scalars().all())

    for user in cumpleaneros:
        destinatarios = [t for t in tokens if t.user_id != user.id]
        if destinatarios:
            messages = [
                {
                    "to": t.token,
                    "title": "Cumpleaños 🎂",
                    "body": f"¡Hoy es el cumpleaños de {user.full_name}!",
                    "sound": "default",
                }
                for t in destinatarios
            ]
            status = await send_expo_push(messages)
            logger.info(
                "Cumpleaños de %s: notificados %d destinatarios (status %s)",
                user.full_name, len(destinatarios), status,
            )
        user.last_birthday_notified_year = hoy.year

    await db.flush()
    return len(cumpleaneros)
