"""Cliente mínimo para subir avatares a Cloudinary.

Usa la API REST firmada directo con httpx (async) en vez del SDK oficial
`cloudinary`, que es síncrono y bloquearía el event loop si se llamara desde
un endpoint async sin envolverlo en un threadpool.
"""

import hashlib
import time

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_AVATAR_BYTES = 5 * 1024 * 1024


class CloudinaryNotConfigured(RuntimeError):
    pass


def _require_config() -> tuple[str, str, str]:
    if not (
        settings.CLOUDINARY_CLOUD_NAME
        and settings.CLOUDINARY_API_KEY
        and settings.CLOUDINARY_API_SECRET
    ):
        raise CloudinaryNotConfigured(
            "CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET no configurados"
        )
    return (
        settings.CLOUDINARY_CLOUD_NAME,
        settings.CLOUDINARY_API_KEY,
        settings.CLOUDINARY_API_SECRET,
    )


async def upload_avatar(raw: bytes, content_type: str, user_id: str) -> str:
    """Sube (o reemplaza) el avatar de un usuario. Devuelve el secure_url.

    public_id fijo por usuario + overwrite=true: cada subida pisa el asset
    anterior, no hace falta guardar/borrar nada aparte. Cloudinary versiona
    la URL (/v<version>/) en cada reemplazo, así que no hay problema de
    caché stale del lado del cliente.
    """
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de imagen no soportado (usar JPEG, PNG o WEBP).",
        )
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La imagen supera el tamaño máximo de 5 MB.",
        )

    try:
        cloud_name, api_key, api_secret = _require_config()
    except CloudinaryNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Subida de avatar no disponible (Cloudinary sin configurar).",
        ) from exc

    public_id = f"avatars/{user_id}"
    timestamp = int(time.time())
    # Firma según el esquema de Cloudinary: SHA1 de los params ordenados
    # alfabéticamente + api_secret, sin el archivo ni la api_key.
    params_to_sign = f"overwrite=true&public_id={public_id}&timestamp={timestamp}"
    signature = hashlib.sha1((params_to_sign + api_secret).encode()).hexdigest()

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"https://api.cloudinary.com/v1_1/{cloud_name}/image/upload",
            data={
                "public_id": public_id,
                "overwrite": "true",
                "timestamp": timestamp,
                "api_key": api_key,
                "signature": signature,
            },
            files={"file": ("avatar", raw, content_type)},
        )
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Cloudinary rechazó la subida: {response.text}",
        )
    return response.json()["secure_url"]


async def upload_comprobante_whatsapp(raw: bytes, content_type: str, wa_message_id: str) -> str | None:
    """Sube la foto de un comprobante recibido por WhatsApp. A diferencia de
    upload_avatar, cada comprobante es único (no se pisa uno anterior) y no se
    valida tamaño/formato con la misma exigencia -- una foto que Meta ya
    aceptó como imagen es suficiente. Devuelve None (en vez de levantar) si
    Cloudinary no está configurado o la subida falla, para que el webhook
    pueda seguir guardando el mensaje sin foto en vez de perder el gasto
    entero por un problema de infra ajeno al usuario.
    """
    try:
        cloud_name, api_key, api_secret = _require_config()
    except CloudinaryNotConfigured:
        return None

    public_id = f"comprobantes_whatsapp/{wa_message_id}"
    timestamp = int(time.time())
    params_to_sign = f"public_id={public_id}&timestamp={timestamp}"
    signature = hashlib.sha1((params_to_sign + api_secret).encode()).hexdigest()

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"https://api.cloudinary.com/v1_1/{cloud_name}/image/upload",
                data={
                    "public_id": public_id,
                    "timestamp": timestamp,
                    "api_key": api_key,
                    "signature": signature,
                },
                files={"file": ("comprobante", raw, content_type)},
            )
    except httpx.HTTPError:
        return None

    if response.status_code != 200:
        return None
    return response.json()["secure_url"]
