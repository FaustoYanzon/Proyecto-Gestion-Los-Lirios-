import re
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

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

    model_config = ConfigDict(from_attributes=True)


class ChangePasswordRequest(BaseModel):
    current_password: Annotated[str, Field(min_length=1)]
    new_password: Annotated[str, Field(min_length=8)]


class Token(BaseModel):
    access_token: str
    token_type: str
    refresh_token: str | None = None


class TokenData(BaseModel):
    email: str | None = None
    role: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str
