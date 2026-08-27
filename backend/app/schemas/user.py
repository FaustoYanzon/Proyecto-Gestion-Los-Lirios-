import re
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, ValidationInfo, field_validator

from app.models.finanzas import Finca
from app.models.user import UserRole

# Letters, digits, dot, underscore, hyphen. Stored/compared lowercase so
# "Camilo" and "camilo" never collide as different usernames.
USERNAME_PATTERN = re.compile(r"^[a-z0-9_.-]{3,50}$")


def _normalize_username(v: str) -> str:
    v = v.strip().lower()
    if not USERNAME_PATTERN.match(v):
        raise ValueError(
            "El usuario debe tener entre 3 y 50 caracteres: letras, números, '.', '_' o '-'"
        )
    return v


class UserBase(BaseModel):
    email: EmailStr
    # No format validator here on purpose — UserResponse also extends this,
    # and re-validating on read would reject rows whose username predates a
    # stricter pattern. Format is only enforced on write (UserCreate/Update).
    username: str
    full_name: str
    role: UserRole
    finca: Finca = Finca.media_agua


class UserCreate(UserBase):
    password: Annotated[str, Field(min_length=8)]

    @field_validator("username")
    @classmethod
    def _validate_username(cls, v: str) -> str:
        return _normalize_username(v)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = None
    full_name: str | None = None
    role: UserRole | None = None
    finca: Finca | None = None
    is_active: bool | None = None
    password: Annotated[str, Field(min_length=8)] | None = None

    @field_validator("username")
    @classmethod
    def _validate_username(cls, v: str | None) -> str | None:
        return _normalize_username(v) if v is not None else v


class UserResponse(UserBase):
    id: str
    is_active: bool
    created_at: datetime
    avatar_url: str | None = None
    birth_day: int | None = None
    birth_month: int | None = None
    birth_year: int | None = None

    model_config = ConfigDict(from_attributes=True)


class ChangePasswordRequest(BaseModel):
    current_password: Annotated[str, Field(min_length=1)]
    new_password: Annotated[str, Field(min_length=8)]


class UpdateBirthdayRequest(BaseModel):
    """Self-service (PATCH /auth/me/cumpleanos). Día/mes obligatorios juntos,
    año opcional -- muchos empleados de campo no lo saben con certeza y nunca
    se usa para decidir si hoy es su cumpleaños."""

    birth_day: Annotated[int, Field(ge=1, le=31)] | None = None
    birth_month: Annotated[int, Field(ge=1, le=12)] | None = None
    birth_year: Annotated[int, Field(ge=1900, le=2026)] | None = None

    @field_validator("birth_month")
    @classmethod
    def _day_and_month_together(cls, v: int | None, info: ValidationInfo) -> int | None:
        day = info.data.get("birth_day")
        if (v is None) != (day is None):
            raise ValueError("Día y mes de cumpleaños deben cargarse juntos")
        return v


class Token(BaseModel):
    access_token: str
    token_type: str
    refresh_token: str | None = None


class TokenData(BaseModel):
    email: str | None = None
    role: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str
