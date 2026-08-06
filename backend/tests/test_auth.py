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
    assert body["refresh_token"]


async def test_login_is_by_username_not_email(client, create_user):
    # 2026-08-05: login moved from email to a separate `username` credential.
    # When they differ, only the username works — email is no longer accepted.
    await create_user(email="camilo@test.com", username="camilov", password="Password123!")
    assert (await _login(client, "camilov", "Password123!")).status_code == 200
    assert (await _login(client, "camilo@test.com", "Password123!")).status_code == 401


async def test_login_username_is_case_insensitive(client, create_user):
    await create_user(email="a@test.com", username="miuser", password="Password123!")
    assert (await _login(client, "MiUser", "Password123!")).status_code == 200


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
            "username": "newuser",
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
            "username": "newuser",
            "full_name": "New",
            "role": "obrero",
            "password": "Password123!",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "new@test.com"
    assert resp.json()["username"] == "newuser"


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


# --- Refresh token ------------------------------------------------------------


async def test_refresh_returns_new_access_token(client, create_user):
    await create_user(email="a@test.com", password="Password123!")
    login_body = (await _login(client, "a@test.com", "Password123!")).json()

    resp = await client.post("/auth/refresh", json={"refresh_token": login_body["refresh_token"]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    # Note: content can coincide with the original access token if both are
    # issued within the same second (JWT "exp" has second precision and the
    # rest of the payload is identical) — not asserted here for that reason.

    # The new access token actually works.
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "a@test.com"


async def test_refresh_rejects_garbage_token(client):
    resp = await client.post("/auth/refresh", json={"refresh_token": "not-a-real-token"})
    assert resp.status_code == 401


async def test_access_token_rejected_by_refresh_endpoint(client, create_user):
    await create_user(email="a@test.com", password="Password123!")
    access_token = (await _login(client, "a@test.com", "Password123!")).json()["access_token"]

    resp = await client.post("/auth/refresh", json={"refresh_token": access_token})
    assert resp.status_code == 401


async def test_refresh_token_rejected_as_bearer_access_token(client, create_user):
    await create_user(email="a@test.com", password="Password123!")
    refresh_token = (await _login(client, "a@test.com", "Password123!")).json()["refresh_token"]

    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {refresh_token}"})
    assert resp.status_code == 401


async def test_password_change_invalidates_refresh_token(client, create_user):
    await create_user(email="a@test.com", password="Password123!")
    login_body = (await _login(client, "a@test.com", "Password123!")).json()
    auth = {"Authorization": f"Bearer {login_body['access_token']}"}

    await client.post(
        "/auth/change-password",
        headers=auth,
        json={"current_password": "Password123!", "new_password": "NewPassword456!"},
    )

    resp = await client.post("/auth/refresh", json={"refresh_token": login_body["refresh_token"]})
    assert resp.status_code == 401


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
