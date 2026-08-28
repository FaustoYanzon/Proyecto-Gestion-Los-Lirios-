"""Cliente mínimo para la WhatsApp Business Cloud API de Meta. Mismo criterio
que app/core/push.py (httpx directo, sin SDK) y app/core/cloudinary_client.py
(API REST firmada/autenticada a mano)."""

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger("app")

_GRAPH_API_BASE = "https://graph.facebook.com/v20.0"


class WhatsappNotConfigured(RuntimeError):
    pass


def _require_config() -> tuple[str, str]:
    if not (settings.WHATSAPP_ACCESS_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID):
        raise WhatsappNotConfigured(
            "WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID no configurados"
        )
    return settings.WHATSAPP_ACCESS_TOKEN, settings.WHATSAPP_PHONE_NUMBER_ID


async def send_text_message(to: str, body: str) -> None:
    """Envía un mensaje de texto de respuesta. No propaga errores de red hacia
    el llamador -- el webhook siempre debe responder 200 a Meta aunque la
    respuesta saliente falle, así que acá solo se loguea."""
    try:
        access_token, phone_number_id = _require_config()
    except WhatsappNotConfigured:
        logger.warning("WhatsApp no configurado, no se pudo responder a %s", to)
        return

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{_GRAPH_API_BASE}/{phone_number_id}/messages",
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "messaging_product": "whatsapp",
                    "to": to,
                    "text": {"body": body},
                },
            )
        if response.status_code >= 400:
            logger.warning("Meta rechazó el envío a %s: %s", to, response.text)
    except httpx.HTTPError:
        logger.exception("Error de red enviando mensaje de WhatsApp a %s", to)


async def get_media_url(media_id: str) -> str | None:
    access_token, _ = _require_config()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{_GRAPH_API_BASE}/{media_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if response.status_code >= 400:
            logger.warning("No se pudo resolver media_id=%s: %s", media_id, response.text)
            return None
        return response.json().get("url")
    except httpx.HTTPError:
        logger.exception("Error de red resolviendo media_id=%s", media_id)
        return None


async def download_media(url: str) -> bytes | None:
    """Meta exige el mismo Bearer token también para descargar el binario, no
    solo para resolver la URL temporal."""
    access_token, _ = _require_config()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
        if response.status_code >= 400:
            logger.warning("No se pudo descargar media desde %s: %s", url, response.status_code)
            return None
        return response.content
    except httpx.HTTPError:
        logger.exception("Error de red descargando media desde %s", url)
        return None
