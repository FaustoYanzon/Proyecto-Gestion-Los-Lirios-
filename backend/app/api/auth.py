from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_super_admin
from app.core import login_throttle
from app.core.config import settings
from app.core.limiter import limiter
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)
from app.models.user import User
from app.schemas.user import ChangePasswordRequest, RefreshRequest, Token, UserCreate, UserResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=Token)
@limiter.limit(settings.LOGIN_RATE_LIMIT)
async def login(
    request: Request,  # required by slowapi to key the limit on the client IP
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> Token:
    # OAuth2PasswordRequestForm names this field "username" regardless of what
    # it actually contains — here it's the app's own `username` credential
    # (login is no longer by email, see 2026-08-05). Always compared lowercase.
    username_input = form_data.username.strip().lower()

    # Per-username throttle: reject early if this account has too many recent
    # failures, regardless of source IP (blocks distributed password spraying).
    if await login_throttle.is_locked(username_input):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Try again later.",
        )

    result = await db.execute(select(User).where(User.username == username_input))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(form_data.password, user.hashed_password):
        # Count the failure under the same generic branch used for both unknown
        # user and wrong password, so we don't leak which one occurred.
        await login_throttle.record_failure(username_input)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Inactive user",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Successful auth: clear the failure counter for this username.
    await login_throttle.reset(username_input)

    token_data = {"sub": user.email, "role": user.role.value, "tv": user.token_version}
    access_token = create_access_token(
        # "tv" binds the token to the user's current token_version so it can be
        # invalidated server-side (password change / forced logout).
        data=token_data,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token = create_refresh_token(data=token_data)
    return Token(access_token=access_token, token_type="bearer", refresh_token=refresh_token)


@router.post("/refresh", response_model=Token)
async def refresh(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> Token:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
    )
    payload = decode_access_token(body.refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise credentials_exception

    email: str | None = payload.get("sub")
    if email is None:
        raise credentials_exception

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    # Same invalidation rule as get_current_user: a password change / forced
    # logout bumps token_version, which retroactively invalidates every
    # refresh token issued before it too.
    if user is None or not user.is_active or payload.get("tv") != user.token_version:
        raise credentials_exception

    new_access_token = create_access_token(
        data={"sub": user.email, "role": user.role.value, "tv": user.token_version},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    # No rotation: the same refresh token stays valid until it expires or
    # token_version changes. Simpler, and consistent with today's storage
    # model (no server-side token registry to update on rotation).
    return Token(access_token=new_access_token, token_type="bearer", refresh_token=body.refresh_token)


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> User:
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )
    result = await db.execute(select(User).where(User.username == user_data.username))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        )

    user = User(
        email=user_data.email,
        username=user_data.username,
        hashed_password=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        role=user_data.role,
        finca=user_data.finca,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(settings.LOGIN_RATE_LIMIT)
async def change_password(
    request: Request,  # required by slowapi to key the limit on the client IP
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Contraseña actual incorrecta",
        )
    current_user.hashed_password = get_password_hash(body.new_password)
    # Invalidate every previously issued token, including the one used for this
    # request. Clients must re-authenticate after changing their password.
    current_user.token_version += 1
    await db.flush()
