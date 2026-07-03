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

    # Comma-separated list of allowed CORS origins, e.g.
    # ALLOWED_ORIGINS=https://app.losliriossa.com,https://admin.losliriossa.com
    # Never use "*" together with allow_credentials=True.
    ALLOWED_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Login throttling. Applied per client IP via slowapi.
    LOGIN_RATE_LIMIT: str = "10/minute"

    # Per-username throttle for failed logins (defends against distributed
    # password spraying that the per-IP limit above would miss). Sliding window:
    # once LOGIN_MAX_FAILURES failures occur within LOGIN_FAILURE_WINDOW_SECONDS,
    # further attempts for that username are rejected until the window drains.
    LOGIN_MAX_FAILURES: int = 10
    LOGIN_FAILURE_WINDOW_SECONDS: int = 300

    # Explicit override for interactive docs. When None, docs are enabled only
    # outside production (see docs_enabled below).
    DOCS_ENABLED: bool | None = None

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
