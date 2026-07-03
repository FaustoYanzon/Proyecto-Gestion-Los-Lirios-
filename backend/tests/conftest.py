"""Pytest fixtures for the auth test suite.

The app is tested against an in-memory SQLite database (shared via StaticPool)
so the suite is fast and hermetic — no PostgreSQL required. The production
get_db dependency is overridden to use this test database.

Environment variables are set BEFORE importing any app module, because
app.core.config.Settings is instantiated at import time and would otherwise
fail (missing DATABASE_URL / SECRET_KEY) or pick up the real .env.
"""
from __future__ import annotations

import os

# --- Must run before importing app.* ------------------------------------------
# Forced (not setdefault) so the test environment is deterministic regardless of
# any ambient vars or a local .env — the suite must never touch a real database.
os.environ["ENVIRONMENT"] = "development"
# In-memory SQLite for the app's own engine as well. It is never used (get_db is
# overridden to the StaticPool engine below), but this keeps import-time engine
# construction driver-agnostic and dependency-free (no PostgreSQL needed).
os.environ["DATABASE_URL"] = "sqlite+aiosqlite://"
os.environ["SECRET_KEY"] = "test-secret-key-not-used-in-production-0123456789"
# Keep the slowapi per-IP limit out of the way; these tests exercise the
# per-username throttle explicitly with a low threshold.
os.environ["LOGIN_RATE_LIMIT"] = "1000/minute"
os.environ["LOGIN_MAX_FAILURES"] = "3"
os.environ["LOGIN_FAILURE_WINDOW_SECONDS"] = "300"

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

# Import all models so Base.metadata is complete before create_all.
import app.models  # noqa: E402,F401
from app.core.database import Base, get_db  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402

# Single shared in-memory database for the whole session.
test_engine = create_async_engine(
    "sqlite+aiosqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = async_sessionmaker(
    test_engine, class_=AsyncSession, expire_on_commit=False
)


@pytest_asyncio.fixture(autouse=True)
async def _setup_database():
    """Fresh schema per test — full isolation."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(autouse=True)
async def _reset_login_throttle():
    """The throttle keeps process-global state; clear it between tests."""
    from app.core import login_throttle

    login_throttle._failures.clear()
    yield
    login_throttle._failures.clear()


async def _override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def create_user():
    """Factory to insert a user directly into the test DB."""

    async def _create(
        email: str = "admin@test.com",
        password: str = "Password123!",
        role: UserRole = UserRole.super_admin,
        is_active: bool = True,
    ) -> User:
        async with TestSessionLocal() as session:
            user = User(
                email=email,
                hashed_password=get_password_hash(password),
                full_name="Test User",
                role=role,
                is_active=is_active,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    return _create
