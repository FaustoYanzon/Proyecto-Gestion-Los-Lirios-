import asyncio
import os

from sqlalchemy import select

from app.core.config import INSECURE_SECRET_PLACEHOLDERS, settings
from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models.user import User, UserRole

# Standalone scripts must register EVERY model before touching the ORM:
# User has relationships to produccion/finanzas models, and SQLAlchemy fails
# at mapper-configuration time if any related model module was never imported.
import app.models  # noqa: F401,E402

# Bootstrap super-admin credentials come from the environment, never from source
# control. Set these once when provisioning an environment:
#   SUPER_ADMIN_EMAIL=admin@losliriossa.com
#   SUPER_ADMIN_PASSWORD=<strong value>
DEFAULT_ADMIN_EMAIL = "admin@loslirios.com"
MIN_ADMIN_PASSWORD_LENGTH = 12


def _resolve_admin_credentials() -> tuple[str, str]:
    """Read and validate the bootstrap admin credentials from the environment.

    Fails loudly instead of silently seeding a known/default password, which is
    the single most common way an internal tool ends up compromised.
    """
    email = os.getenv("SUPER_ADMIN_EMAIL", DEFAULT_ADMIN_EMAIL).strip()
    password = os.getenv("SUPER_ADMIN_PASSWORD", "").strip()

    if not password:
        raise RuntimeError(
            "SUPER_ADMIN_PASSWORD is not set. Export a strong password before "
            "seeding. Generate one with: "
            "python -c 'import secrets; print(secrets.token_urlsafe(24))'"
        )

    # In production, refuse obviously weak or placeholder passwords.
    if settings.is_production and (
        len(password) < MIN_ADMIN_PASSWORD_LENGTH
        or password.lower() in INSECURE_SECRET_PLACEHOLDERS
    ):
        raise RuntimeError(
            "SUPER_ADMIN_PASSWORD is too weak for production "
            f"(min {MIN_ADMIN_PASSWORD_LENGTH} chars, no placeholders)."
        )

    return email, password


async def create_super_admin() -> None:
    email, password = _resolve_admin_credentials()

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        if result.scalar_one_or_none() is not None:
            print("Super admin already exists — skipping.")
            return

        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            full_name=os.getenv("SUPER_ADMIN_NAME", "Fausto"),
            role=UserRole.super_admin,
        )
        session.add(user)
        await session.commit()
        print(f"Super admin created: {user.email}")


if __name__ == "__main__":
    asyncio.run(create_super_admin())
