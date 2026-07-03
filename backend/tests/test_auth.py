"""Auth security regression tests.

Locks in the behavior built during the security hardening pass: authentication,
role enforcement, session invalidation (token_version) and the per-username
failed-login throttle. Run with: pytest
"""
from __future__ import annotations

from app.models.user import UserRole


async def _login(client, username: str, password: str):
    return await client.post(
        "/auth/login",
        data={"username": username, "password": password},
    )


# --- Authentication ----------------------------------------------------------


async def test_login_success_returns_token(client, create_user):
    await create_user(email="a@test.com", password="Password123!")
    resp = await _login(client, "a@test.com", "Password123!")
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]


async def test_login_wrong_password_is_401(client, create_user):
    await create_user(email="a@test.com", password="Password123!")
    resp = await _login(client, "a@test.com", "wrong-password")
    assert resp.status_code == 401


async def test_login_unknown_user_is_401(client):
    resp = await _login(client, "nobody@test.com", "whatever")
    assert resp.status_code == 401


async def test_login_inactive_user_is_401(client, create_user):
    await create_user(email="a@test.com", password="Password123!", is_active=False)
    resp = await _login(client, "a@test.com", "Password123!")
    assert resp.status_code == 401


async def test_me_requires_token(client):
    resp = await client.get("/auth/me")
    assert resp.status_code == 401


async def test_me_with_valid_token(client, create_user):
    await create_user(email="a@test.com", password="Password123!")
    token = (await _login(client, "a@test.com", "Password123!")).json()["access_token"]
    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "a@test.com"


# --- Role enforcement --------------------------------------------------------


async def test_register_forbidden_for_non_super_admin(client, create_user):
    await create_user(email="enc@test.com", password="Password123!", role=UserRole.encargado)
    token = (await _login(client, "enc@test.com", "Password123!")).json()["access_token"]
    resp = await client.post(
        "/auth/register",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "new@test.com",
            "full_name": "New",
            "role": "obrero",
            "password": "Password123!",
        },
    )
    assert resp.status_code == 403


async def test_register_allowed_for_super_admin(client, create_user):
    await create_user(email="root@test.com", password="Password123!", role=UserRole.super_admin)
    token = (await _login(client, "root@test.com", "Password123!")).json()["access_token"]
    resp = await client.post(
        "/auth/register",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "new@test.com",
            "full_name": "New",
            "role": "obrero",
            "password": "Password123!",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "new@test.com"


# --- Session invalidation (token_version) ------------------------------------


async def test_change_password_invalidates_old_token(client, create_user):
    await create_user(email="a@test.com", password="Password123!")
    token = (await _login(client, "a@test.com", "Password123!")).json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    # Token works before the password change.
    assert (await client.get("/auth/me", headers=auth)).status_code == 200

    change = await client.post(
        "/auth/change-password",
        headers=auth,
        json={"current_password": "Password123!", "new_password": "NewPassword456!"},
    )
    assert change.status_code == 204

    # Same token is now rejected: token_version was bumped.
    assert (await client.get("/auth/me", headers=auth)).status_code == 401

    # New credentials work and old ones do not.
    assert (await _login(client, "a@test.com", "NewPassword456!")).status_code == 200
    assert (await _login(client, "a@test.com", "Password123!")).status_code == 401


# --- Per-username failed-login throttle --------------------------------------


async def test_username_throttle_after_max_failures(client, create_user):
    # conftest sets LOGIN_MAX_FAILURES=3.
    await create_user(email="a@test.com", password="Password123!")

    for _ in range(3):
        assert (await _login(client, "a@test.com", "wrong")).status_code == 401

    # Next attempt is throttled regardless of credentials being correct now.
    resp = await _login(client, "a@test.com", "Password123!")
    assert resp.status_code == 429


async def test_throttle_resets_after_successful_login(client, create_user):
    await create_user(email="a@test.com", password="Password123!")

    # Two failures (below the threshold of 3), then a success clears the counter.
    for _ in range(2):
        assert (await _login(client, "a@test.com", "wrong")).status_code == 401
    assert (await _login(client, "a@test.com", "Password123!")).status_code == 200

    # Counter was reset, so two more failures still do not trip the throttle.
    for _ in range(2):
        assert (await _login(client, "a@test.com", "wrong")).status_code == 401
