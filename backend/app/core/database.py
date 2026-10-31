from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.cloudinary_client import MEDIA_A_BORRAR_KEY, programar_borrado
from app.core.config import settings

# QueuePool sizing options are invalid for SQLite (used by the test suite), so
# only pass them for real pooled backends like PostgreSQL.
_engine_kwargs: dict = {"echo": False, "pool_pre_ping": True}
if not settings.DATABASE_URL.startswith("sqlite"):
    _engine_kwargs.update(pool_size=10, max_overflow=20)

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
            # Only after a successful commit: media of rows that really went away.
            if urls := session.info.pop(MEDIA_A_BORRAR_KEY, None):
                programar_borrado(urls)
        except Exception:
            await session.rollback()
            raise
