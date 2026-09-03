from enum import Enum
from typing import Annotated

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(str, Enum):
    development = "development"
    staging = "staging"
    production = "production"


# Placeholder values that must never reach a production deployment.
# Kept as a set so both config validation and the seed script can reuse it.
INSECURE_SECRET_PLACEHOLDERS: frozenset[str] = frozenset(
    {
        "changeme",
        "secret",
        "dev",
        "development",
        "test",
        "your-secret-key",
    }
)

# Minimum entropy we require from SECRET_KEY. 32 bytes -> generate with:
#   python -c "import secrets; print(secrets.token_urlsafe(64))"
MIN_SECRET_KEY_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    ENVIRONMENT: Environment = Environment.development

    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Comma-separated list of allowed CORS origins, e.g.
    # ALLOWED_ORIGINS=https://app.losliriossa.com,https://admin.losliriossa.com
    # Never use "*" together with allow_credentials=True.
    ALLOWED_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Base URL publica del frontend, sin barra final. Se usa para construir el
    # link de la pagina publica de trazabilidad (QR en la carta PDF + endpoint
    # publico del PDF). En produccion apuntar al dominio de Vercel; el default
    # sirve para desarrollo local.
    PUBLIC_BASE_URL: str = "http://localhost:3000"

    # Login throttling. Applied per client IP via slowapi.
    LOGIN_RATE_LIMIT: str = "10/minute"

    # Throttle per IP de los endpoints publicos de trazabilidad (JSON + PDF).
    # El token de 24 bytes ya hace impracticable adivinar enlaces por fuerza
    # bruta; esto acota ademas el costo de que alguien pida el PDF (CPU-bound)
    # en loop. Un comprador que refresca la pagina un par de veces entra
    # comodo en 30/min.
    PUBLIC_TRAZABILIDAD_RATE_LIMIT: str = "30/minute"

    @field_validator("PUBLIC_BASE_URL", mode="before")
    @classmethod
    def _strip_trailing_slash(cls, value: object) -> object:
        if isinstance(value, str):
            return value.rstrip("/")
        return value

    # Per-username throttle for failed logins (defends against distributed
    # password spraying that the per-IP limit above would miss). Sliding window:
    # once LOGIN_MAX_FAILURES failures occur within LOGIN_FAILURE_WINDOW_SECONDS,
    # further attempts for that username are rejected until the window drains.
    LOGIN_MAX_FAILURES: int = 10
    LOGIN_FAILURE_WINDOW_SECONDS: int = 300

    # Explicit override for interactive docs. When None, docs are enabled only
    # outside production (see docs_enabled below).
    DOCS_ENABLED: bool | None = None

    LOG_LEVEL: str = "INFO"

    # None disables Sentry (default). Set to activate error reporting; get the
    # DSN from the project's Sentry organization settings.
    SENTRY_DSN: str | None = None

    # Avatares de usuario (backend/app/core/cloudinary_client.py). None
    # deshabilita la subida (el endpoint devuelve 503) sin romper el arranque
    # local sin credenciales -- mismo criterio que SENTRY_DSN.
    CLOUDINARY_CLOUD_NAME: str | None = None
    CLOUDINARY_API_KEY: str | None = None
    CLOUDINARY_API_SECRET: str | None = None

    # WhatsApp Business Cloud API (Meta). None deshabilita el envío de
    # mensajes salientes; WHATSAPP_APP_SECRET en None hace que el webhook
    # omita la validación de firma (con warning) en vez de romper el arranque
    # local sin credenciales -- mismo criterio que CLOUDINARY_*/SENTRY_DSN.
    WHATSAPP_VERIFY_TOKEN: str | None = None
    WHATSAPP_ACCESS_TOKEN: str | None = None
    WHATSAPP_PHONE_NUMBER_ID: str | None = None
    WHATSAPP_APP_SECRET: str | None = None

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a comma-separated string from .env and turn it into a list.

        pydantic-settings would otherwise try to JSON-decode a plain string for
        a list field, which fails for values like "https://a.com,https://b.com".
        """
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("LOG_LEVEL", mode="before")
    @classmethod
    def _validate_log_level(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.upper()
            if value not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
                raise ValueError(f"LOG_LEVEL inválido: {value!r}")
        return value

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT is Environment.production

    @property
    def docs_enabled(self) -> bool:
        """Whether /docs and /redoc should be served.

        Defaults to disabled in production; DOCS_ENABLED overrides explicitly.
        """
        if self.DOCS_ENABLED is not None:
            return self.DOCS_ENABLED
        return not self.is_production

    @model_validator(mode="after")
    def _validate_production_hardening(self) -> "Settings":
        """Fail fast at startup if production is misconfigured.

        A weak SECRET_KEY or a wildcard CORS origin with credentials are the two
        mistakes most likely to be shipped by accident, so we refuse to boot.
        """
        if not self.is_production:
            return self

        secret = self.SECRET_KEY.strip()
        if (
            len(secret) < MIN_SECRET_KEY_LENGTH
            or secret.lower() in INSECURE_SECRET_PLACEHOLDERS
        ):
            raise ValueError(
                "SECRET_KEY is too weak for production. Generate a strong value: "
                'python -c "import secrets; print(secrets.token_urlsafe(64))"'
            )

        if "*" in self.ALLOWED_ORIGINS:
            raise ValueError(
                "ALLOWED_ORIGINS cannot contain '*' in production while "
                "allow_credentials is enabled."
            )

        return self


settings = Settings()
