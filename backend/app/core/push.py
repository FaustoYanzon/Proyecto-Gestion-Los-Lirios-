"""Envío de notificaciones push vía Expo. Compartido entre el endpoint manual
de notificaciones y el job automático de cumpleaños (app/core/birthdays.py).
"""

import httpx


async def send_expo_push(messages: list[dict]) -> int:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://exp.host/--/api/v2/push/send",
            json=messages,
            headers={"Accept": "application/json"},
        )
        return resp.status_code
