import asyncio

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models.user import User, UserRole


async def create_super_admin() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User).where(User.email == "admin@loslirios.com")
        )
        if result.scalar_one_or_none() is not None:
            print("Super admin already exists — skipping.")
            return

        user = User(
            email="admin@loslirios.com",
            hashed_password=get_password_hash("Admin1234!"),
            full_name="Fausto",
            role=UserRole.super_admin,
        )
        session.add(user)
        await session.commit()
        print(f"Super admin created: {user.email}")


if __name__ == "__main__":
    asyncio.run(create_super_admin())
