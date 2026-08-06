"""PUT /users/{id} regression tests — email is updatable (2026-08-05 gap fix:
previously only full_name/role/is_active/password were, forcing a manual DB
UPDATE the last time an email had to change). Run with: pytest
"""
from __future__ import annotations

from app.models.user import UserRole


async def _login_token(client, username: str, password: str) -> str:
    resp = await client.post("/auth/login", data={"username": username, "password": password})
    return resp.json()["access_token"]


async def test_super_admin_can_update_email(client, create_user):
    admin = await create_user(email="admin@test.com", password="Password123!")
    target = await create_user(
        email="old@test.com", username="targetuser", password="Password123!", role=UserRole.obrero
    )
    token = await _login_token(client, "admin@test.com", "Password123!")

    resp = await client.put(
        f"/users/{target.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"email": "new@test.com"},
    )
    assert resp.status_code == 200
    assert resp.json()["email"] == "new@test.com"

    # Login is by username (unaffected by the email change), not by email —
    # see test_auth.py::test_login_is_by_username_not_email for that behavior.
    assert (await _login_token(client, "targetuser", "Password123!"))


async def test_update_email_rejects_duplicate(client, create_user):
    admin = await create_user(email="admin@test.com", password="Password123!")
    await create_user(email="taken@test.com", password="Password123!", role=UserRole.obrero)
    target = await create_user(email="old2@test.com", password="Password123!", role=UserRole.obrero)
    token = await _login_token(client, "admin@test.com", "Password123!")

    resp = await client.put(
        f"/users/{target.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"email": "taken@test.com"},
    )
    assert resp.status_code == 409
