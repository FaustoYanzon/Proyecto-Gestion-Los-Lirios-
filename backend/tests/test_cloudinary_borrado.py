"""Deleting a photo/report row must also destroy the file in Cloudinary.

The endpoint only queues the URL on the session (`encolar_borrado`); `get_db`
destroys it after the commit, best effort. Nothing here reaches the network:
httpx is replaced with a MockTransport.
"""
from __future__ import annotations

from datetime import date

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import cloudinary_client, database
from app.core.cloudinary_client import (
    MEDIA_A_BORRAR_KEY,
    borrar_medios,
    encolar_borrado,
    parse_media_url,
)
from app.models.trazabilidad import Foto
from app.models.user import UserRole

CLOUD = "demo-cloud"
URL_FOTO = f"https://res.cloudinary.com/{CLOUD}/image/upload/v1700000000/fotos_parcela/p1/abc-123.jpg"
URL_ORDEN = f"https://res.cloudinary.com/{CLOUD}/image/upload/fotos_ordenes_aplicacion/op1/def-456.webp"
URL_INFORME_PDF = f"https://res.cloudinary.com/{CLOUD}/image/upload/v1/informes_analisis/an1.pdf"
URL_AVATAR = f"https://res.cloudinary.com/{CLOUD}/image/upload/v1/avatars/user1.jpg"


@pytest.mark.parametrize(
    ("url", "esperado"),
    [
        (URL_FOTO, (CLOUD, "image", "fotos_parcela/p1/abc-123")),
        (URL_ORDEN, (CLOUD, "image", "fotos_ordenes_aplicacion/op1/def-456")),
        (URL_INFORME_PDF, (CLOUD, "image", "informes_analisis/an1")),
        (URL_AVATAR, None),  # avatars overwrite themselves: never destroyed
        (f"https://res.cloudinary.com/{CLOUD}/image/upload/v1/comprobantes_whatsapp/x.jpg", None),
        ("https://example.com/fotos_parcela/p1/abc.jpg", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_media_url(url, esperado):
    assert parse_media_url(url) == esperado


def test_encolar_borrado_solo_encola_medios_borrables():
    class FakeDb:
        info: dict = {}

    db = FakeDb()
    db.info = {}
    for url in (URL_FOTO, URL_AVATAR, None, "https://example.com/x.jpg"):
        encolar_borrado(db, url)
    assert db.info[MEDIA_A_BORRAR_KEY] == [URL_FOTO]


def _mock_cloudinary(monkeypatch, handler) -> list[httpx.Request]:
    """Route every httpx.AsyncClient in cloudinary_client through `handler`."""
    vistos: list[httpx.Request] = []
    real_client = httpx.AsyncClient

    def responder(request: httpx.Request) -> httpx.Response:
        vistos.append(request)
        return handler(request)

    monkeypatch.setattr(
        cloudinary_client.httpx, "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(responder), **kw),
    )
    monkeypatch.setattr(cloudinary_client.settings, "CLOUDINARY_CLOUD_NAME", CLOUD)
    monkeypatch.setattr(cloudinary_client.settings, "CLOUDINARY_API_KEY", "key")
    monkeypatch.setattr(cloudinary_client.settings, "CLOUDINARY_API_SECRET", "secret")
    return vistos


async def test_borrar_medios_llama_destroy_firmado(monkeypatch):
    vistos = _mock_cloudinary(monkeypatch, lambda r: httpx.Response(200, json={"result": "ok"}))
    await borrar_medios([URL_FOTO, URL_INFORME_PDF])

    assert [str(r.url) for r in vistos] == [
        f"https://api.cloudinary.com/v1_1/{CLOUD}/image/destroy",
    ] * 2
    cuerpo = vistos[0].content.decode()
    assert "public_id=fotos_parcela%2Fp1%2Fabc-123" in cuerpo
    assert "invalidate=true" in cuerpo
    assert "signature=" in cuerpo and "api_key=key" in cuerpo
    assert "secret" not in cuerpo  # the secret only signs, it is never sent


async def test_borrar_medios_no_toca_otra_cuenta_ni_otras_carpetas(monkeypatch):
    vistos = _mock_cloudinary(monkeypatch, lambda r: httpx.Response(200, json={"result": "ok"}))
    await borrar_medios([
        "https://res.cloudinary.com/otra-cuenta/image/upload/v1/fotos_parcela/p1/a.jpg",
        URL_AVATAR,
    ])
    assert vistos == []


async def test_borrar_medios_no_levanta_si_cloudinary_falla(monkeypatch, caplog):
    def falla(request: httpx.Request) -> httpx.Response:
        if "abc-123" in request.content.decode():
            raise httpx.ConnectError("sin red")
        return httpx.Response(500, text="boom")

    _mock_cloudinary(monkeypatch, falla)
    with caplog.at_level("WARNING"):
        await borrar_medios([URL_FOTO, URL_ORDEN])  # must not raise
    assert "cloudinary destroy failed" in caplog.text
    assert "cloudinary destroy rejected" in caplog.text


async def test_borrar_medios_sin_credenciales_no_hace_nada(monkeypatch):
    vistos = _mock_cloudinary(monkeypatch, lambda r: httpx.Response(200, json={"result": "ok"}))
    monkeypatch.setattr(cloudinary_client.settings, "CLOUDINARY_API_SECRET", None)
    await borrar_medios([URL_FOTO])
    assert vistos == []


async def test_delete_foto_encola_la_url(client, create_user, create_parcela, db_session, monkeypatch):
    user = await create_user(email="ger@test.com", password="Password123!", role=UserRole.gerencial)
    login = await client.post("/auth/login", data={"username": "ger@test.com", "password": "Password123!"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    parcela = await create_parcela()
    foto = Foto(parcela_id=parcela.id, fecha=date(2026, 10, 1), categoria="otra", url=URL_FOTO, created_by=user.id)
    db_session.add(foto)
    await db_session.commit()

    encoladas: list[str | None] = []
    monkeypatch.setattr("app.api.trazabilidad.encolar_borrado", lambda db, url: encoladas.append(url))

    resp = await client.delete(f"/trazabilidad/fotos/{foto.id}", headers=headers)
    assert resp.status_code == 200, resp.text
    assert encoladas == [URL_FOTO]


async def test_get_db_programa_el_borrado_solo_tras_el_commit(db_session, monkeypatch):
    programados: list[list[str]] = []
    monkeypatch.setattr(database, "programar_borrado", programados.append)
    monkeypatch.setattr(
        database, "AsyncSessionLocal", async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    )

    # Success: queued URLs are handed over after the commit.
    gen = database.get_db()
    session = await gen.__anext__()
    session.info[MEDIA_A_BORRAR_KEY] = [URL_FOTO]
    with pytest.raises(StopAsyncIteration):
        await gen.__anext__()
    assert programados == [[URL_FOTO]]

    # Failure in the request: rollback, nothing is destroyed.
    programados.clear()
    gen = database.get_db()
    session = await gen.__anext__()
    session.info[MEDIA_A_BORRAR_KEY] = [URL_FOTO]
    with pytest.raises(RuntimeError):
        await gen.athrow(RuntimeError("request failed"))
    assert programados == []
