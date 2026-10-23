"""Envío de notificaciones push vía Expo. Compartido entre el endpoint manual
de notificaciones, el job automático de cumpleaños (app/core/birthdays.py) y
los avisos de órdenes de aplicación (app/api/ordenes_aplicacion.py).
"""

import logging
from typing import Any, Callable

import httpx
from sqlalchemy import delete, select

from app.core.database import AsyncSessionLocal
from app.models.push_token import PushToken

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Tope de Expo por request.
BATCH_SIZE = 100


async def send_expo_push(messages: list[dict]) -> int:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={"Accept": "application/json"},
        )
        return resp.status_code


async def _post_expo(messages: list[dict]) -> list[dict[str, Any]]:
    """Un request a Expo; devuelve un ticket por mensaje, en el mismo orden."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json().get("data", [])


async def notificar_tokens(
    titulo: str,
    cuerpo: str,
    user_ids: list[str] | None = None,
    data: dict | None = None,
    session_factory: Callable[[], Any] | None = None,
) -> None:
    """Push a los celulares registrados. `user_ids=None` = todos; una lista
    (aunque sea vacía) restringe a esos usuarios. Pensada para correr en un
    BackgroundTask: abre su propia sesión, envía en lotes, borra los tokens que
    Expo marca como `DeviceNotRegistered` y NUNCA propaga una excepción -- un
    aviso que falla no puede romper la operación que lo originó.

    Limitación conocida: hay un solo token por usuario, así que si dos personas
    comparten celular el aviso le llega a quien abrió la app última.
    """
    if user_ids is not None and not user_ids:
        return
    factory = session_factory or AsyncSessionLocal
    try:
        async with factory() as db:
            stmt = select(PushToken)
            if user_ids is not None:
                stmt = stmt.where(PushToken.user_id.in_(user_ids))
            tokens = [t.token for t in (await db.execute(stmt)).scalars().all()]

            muertos: list[str] = []
            for i in range(0, len(tokens), BATCH_SIZE):
                lote = tokens[i : i + BATCH_SIZE]
                messages = [
                    {
                        "to": token,
                        "title": titulo,
                        "body": cuerpo,
                        "sound": "default",
                        **({"data": data} if data else {}),
                    }
                    for token in lote
                ]
                try:
                    tickets = await _post_expo(messages)
                except Exception:
                    logger.exception("Fallo el envío de un lote de push (%d mensajes)", len(lote))
                    continue
                for token, ticket in zip(lote, tickets):
                    error = (ticket.get("details") or {}).get("error")
                    if ticket.get("status") == "error" and error == "DeviceNotRegistered":
                        muertos.append(token)

            if muertos:
                await db.execute(delete(PushToken).where(PushToken.token.in_(muertos)))
                await db.commit()
                logger.info("Push: %d tokens muertos borrados", len(muertos))
    except Exception:
        logger.exception("Fallo notificar_tokens (%s)", titulo)
