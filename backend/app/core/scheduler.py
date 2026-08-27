"""Scheduler in-process (sin infraestructura nueva) para jobs diarios.

Único job hoy: chequeo de cumpleaños. Si en el futuro se detecta que el
proceso de Railway no es lo bastante estable para confiar en un scheduler
in-process, el mismo `check_and_notify_birthdays` sirve igual detrás de un
Railway Cron Job que llame a POST /notificaciones/cumpleanos/ejecutar --
no hace falta reescribir la lógica, solo cambiar quién la dispara.
"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.birthdays import FINCA_TZ, check_and_notify_birthdays
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


async def _run_birthday_check() -> None:
    async with AsyncSessionLocal() as db:
        try:
            n = await check_and_notify_birthdays(db)
            await db.commit()
            logger.info("Chequeo de cumpleaños: %d notificados", n)
        except Exception:
            await db.rollback()
            logger.exception("Fallo el chequeo de cumpleaños")


def build_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone=FINCA_TZ)
    scheduler.add_job(_run_birthday_check, CronTrigger(hour=8, minute=0), id="birthday_check")
    return scheduler
