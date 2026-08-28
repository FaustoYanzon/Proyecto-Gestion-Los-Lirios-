"""Webhook público de la WhatsApp Business Cloud API (Meta). Es la única ruta
del backend que no pasa por get_current_user -- la autenticación acá es la
firma HMAC del payload (X-Hub-Signature-256), no un JWT.

Meta reintenta agresivamente si no recibe 200 rápido, así que esta ruta nunca
debe propagar una excepción: cualquier error interno se loguea y aun así se
responde 200, para no generar una tormenta de reintentos.
"""

import hashlib
import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cloudinary_client import upload_comprobante_whatsapp
from app.core.config import settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.whatsapp_client import download_media, get_media_url, send_text_message
from app.core.whatsapp_parser import parse_mensaje_gasto
from app.models.whatsapp import MensajeWhatsappPendiente, TelefonoUsuarioWhatsapp

logger = logging.getLogger("app")

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp Webhook"])

_MSG_NO_AUTORIZADO = (
    "Tu número no está autorizado para cargar gastos. "
    "Pedile a un administrador que te vincule en el sistema."
)
_MSG_REFORMULAR = (
    "No pude entender el monto del gasto. Mandá el mensaje de nuevo con el "
    'formato "monto descripción [pagado|no pagado]", por ejemplo: '
    '"5000 nafta camioneta no pagado".'
)


def _verify_signature(raw_body: bytes, signature_header: str | None) -> bool:
    if not settings.WHATSAPP_APP_SECRET:
        # Sin App Secret configurado (típico en desarrollo local sin
        # credenciales de Meta todavía) no se puede validar -- se deja pasar
        # con un warning en vez de romper el arranque local, mismo criterio
        # que el resto de las integraciones opcionales de este proyecto.
        logger.warning("WHATSAPP_APP_SECRET no configurado, se omite validación de firma")
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(
        settings.WHATSAPP_APP_SECRET.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    received = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, received)


@router.get("/webhook")
async def verify_webhook(request: Request) -> Response:
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    if mode == "subscribe" and token == settings.WHATSAPP_VERIFY_TOKEN and challenge is not None:
        return Response(content=challenge, media_type="text/plain")
    return Response(status_code=status.HTTP_403_FORBIDDEN)


@router.post("/webhook")
@limiter.limit("120/minute")
async def receive_webhook(
    request: Request, db: AsyncSession = Depends(get_db)
) -> Response:
    raw_body = await request.body()
    if not _verify_signature(raw_body, request.headers.get("X-Hub-Signature-256")):
        logger.warning("Firma inválida en webhook de WhatsApp")
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)

    try:
        payload = await request.json()
    except ValueError:
        return Response(status_code=status.HTTP_200_OK)

    try:
        await _procesar_payload(payload, db)
    except Exception:
        # Nunca dejar que un error interno se propague como 500 -- Meta lo
        # interpretaría como fallo transitorio y reintentaría el mismo
        # payload indefinidamente. Se hace rollback explícito acá porque si
        # el error ocurrió durante un flush, la sesión queda en un estado que
        # rompería el commit automático de get_db al salir de este handler.
        logger.exception("Error procesando webhook de WhatsApp")
        await db.rollback()

    return Response(status_code=status.HTTP_200_OK)


async def _procesar_payload(payload: dict, db: AsyncSession) -> None:
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for message in value.get("messages", []):
                await _procesar_mensaje(message, db)


async def _procesar_mensaje(message: dict, db: AsyncSession) -> None:
    wa_message_id = message.get("id")
    telefono = message.get("from")
    if not wa_message_id or not telefono:
        return

    existente = await db.execute(
        select(MensajeWhatsappPendiente.id).where(
            MensajeWhatsappPendiente.wa_message_id == wa_message_id
        )
    )
    if existente.scalar_one_or_none() is not None:
        return  # Reintento de Meta del mismo mensaje -- ya procesado.

    vinculo_result = await db.execute(
        select(TelefonoUsuarioWhatsapp).where(TelefonoUsuarioWhatsapp.telefono == telefono)
    )
    vinculo = vinculo_result.scalar_one_or_none()
    if vinculo is None:
        await send_text_message(telefono, _MSG_NO_AUTORIZADO)
        return

    tipo = message.get("type")
    texto = ""
    foto_url: str | None = None

    if tipo == "text":
        texto = message.get("text", {}).get("body", "")
    elif tipo == "image":
        image = message.get("image", {})
        texto = image.get("caption", "")
        media_id = image.get("id")
        if media_id:
            media_url = await get_media_url(media_id)
            if media_url:
                raw = await download_media(media_url)
                if raw:
                    foto_url = await upload_comprobante_whatsapp(
                        raw, image.get("mime_type", "image/jpeg"), wa_message_id
                    )
    else:
        # Audio, video, ubicación, etc. -- no soportado todavía.
        await send_text_message(telefono, _MSG_REFORMULAR)
        return

    gasto = parse_mensaje_gasto(texto)
    if gasto is None:
        await send_text_message(telefono, _MSG_REFORMULAR)
        return

    timestamp = message.get("timestamp")
    recibido_at = (
        datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
        if timestamp
        else datetime.now(timezone.utc)
    )

    mensaje = MensajeWhatsappPendiente(
        wa_message_id=wa_message_id,
        telefono=telefono,
        user_id=vinculo.user_id,
        texto_original=texto,
        monto=gasto.monto,
        descripcion=gasto.descripcion,
        pagado=gasto.pagado,
        foto_url=foto_url,
        recibido_at=recibido_at,
    )
    db.add(mensaje)
    await db.flush()

    estado_pago = "pagado" if gasto.pagado else "no pagado"
    await send_text_message(
        telefono,
        f"✅ Registrado: ${gasto.monto} - {gasto.descripcion} ({estado_pago}). "
        "En breve alguien lo clasifica.",
    )
