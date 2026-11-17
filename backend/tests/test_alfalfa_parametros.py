"""Alfalfa inventory (2026-11-17): editable parameters kg_fardo (20) and kg_rollo (300).
Run with: pytest
"""
from __future__ import annotations

from decimal import Decimal

from app.models.user import UserRole

URL = "/alta-produccion/parametros"


async def _login(client, create_user) -> dict:
    await create_user(email="gerente@test.com", password="Password123!", role=UserRole.gerencial)
    resp = await client.post(
        "/auth/login",
        data={"username": "gerente@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_parametros_default_alfalfa(client, create_user):
    headers = await _login(client, create_user)

    resp = await client.get(URL, headers=headers)

    assert resp.status_code == 200
    assert Decimal(resp.json()["kg_fardo"]) == 20
    assert Decimal(resp.json()["kg_rollo"]) == 300


async def test_patch_kg_fardo(client, create_user):
    headers = await _login(client, create_user)

    resp = await client.patch(URL, json={"kg_fardo": "22"}, headers=headers)
    assert resp.status_code == 200

    resp = await client.get(URL, headers=headers)
    assert Decimal(resp.json()["kg_fardo"]) == 22
    assert Decimal(resp.json()["kg_rollo"]) == 300


async def test_patch_kg_fardo_cero_422(client, create_user):
    headers = await _login(client, create_user)

    resp = await client.patch(URL, json={"kg_fardo": "0"}, headers=headers)

    assert resp.status_code == 422
