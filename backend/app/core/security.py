from datetime import datetime, timedelta, timezone

import jwt
from jwt import PyJWTError
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode["exp"] = expire
    # PyJWT >= 2 returns a str (python-jose also did), so callers are unaffected.
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    # "type" lets get_current_user reject a refresh token presented as a
    # bearer access token, and lets /auth/refresh reject an access token
    # presented as a refresh token.
    to_encode["type"] = "refresh"
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        # algorithms is pinned to our single allowed algorithm. This is the
        # mitigation against algorithm-confusion attacks: never trust the alg
        # header from the token itself.
        return jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"require": ["exp"]},  # reject tokens without an expiry
        )
    except PyJWTError:
        # Covers expired signature, invalid signature, malformed token, etc.
        return None


# Links firmados de corta vida (PDF de remito). Token JWT de solo lectura atado
# a UN remito. Lleva claims explícitos `typ` y `aud` = "remito_pdf" y se decodifica
# con `audience` obligatorio: un token de acceso (sin `aud`) no pasa acá, y este
# token no pasa como bearer (`decode_access_token` no acepta `aud` y además no
# trae "sub"). Ojo: el token viaja en la RUTA (/remitos/descarga/{token}), por lo
# que puede quedar en logs de acceso/proxy e historial; por eso vive solo 5 min y
# sirve únicamente para leer ese PDF.
REMITO_PDF_SCOPE = "remito_pdf"
REMITO_PDF_TOKEN_TTL_SECONDS = 300


def create_remito_pdf_token(remito_id: str, ttl_seconds: int = REMITO_PDF_TOKEN_TTL_SECONDS) -> str:
    payload = {
        "typ": REMITO_PDF_SCOPE,
        "aud": REMITO_PDF_SCOPE,
        "scope": REMITO_PDF_SCOPE,
        "rid": remito_id,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_remito_pdf_token(token: str) -> str | None:
    """Devuelve el remito_id del token, o None si vence, está adulterado o no
    es un token de PDF de remito (typ/aud incorrectos o ausentes)."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            audience=REMITO_PDF_SCOPE,
            options={"require": ["exp", "aud"]},
        )
    except PyJWTError:
        return None
    if payload.get("typ") != REMITO_PDF_SCOPE or not isinstance(payload.get("rid"), str):
        return None
    return payload["rid"]
