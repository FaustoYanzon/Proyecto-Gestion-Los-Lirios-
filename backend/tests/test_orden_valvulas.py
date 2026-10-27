"""Confirmación de órdenes de aplicación por válvula.

Spec: docs/superpowers/specs/2026-10-23-fito-confirmacion-por-valvula-design.md
"""
from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.finanzas import Finca
from app.models.insumo import Insumo
from app.models.produccion import (
    FotoRegistroFitosanitario,
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrdenAplicacionValvula,
    OrigenOrdenAplicacion,
    RegistroFitosanitario,
)
from app.models.trabajador import Trabajador
from app.models.parcela import VariedadUva
from app.models.user import UserRole


async def test_orden_valvula_unica_por_parcela_de_orden(
    db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    user = await create_user(email="ger@test.com")
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)
    valvula = await create_valvula(parcela_id=parcela.id, nombre="21", superficie_ha=1.5)

    session = db_session
    orden = OrdenAplicacion(
        temporada=2026, origen=OrigenOrdenAplicacion.extra, variedad=VariedadUva.flame,
        insumo_id=insumo.id, dosis_por_ha=1.0, objetivo="Oidio", dias_carencia=7,
        dias_reingreso=2, fecha_planificada=date(2026, 10, 15), created_by=user.id,
    )
    item = OrdenAplicacionParcela(parcela_id=parcela.id)
    orden.parcelas.append(item)
    session.add(orden)
    await session.flush()
    session.add(OrdenAplicacionValvula(orden_parcela_id=item.id, valvula_id=valvula.id))
    session.add(OrdenAplicacionValvula(orden_parcela_id=item.id, valvula_id=valvula.id))
    with pytest.raises(IntegrityError):
        await session.flush()


# ── Helpers de API ───────────────────────────────────────────────────────────


async def _auth(client, create_user, **kwargs):
    kwargs.setdefault("email", "ger@test.com")
    kwargs.setdefault("password", "Password123!")
    kwargs.setdefault("role", UserRole.gerencial)
    user = await create_user(**kwargs)
    resp = await client.post(
        "/auth/login", data={"username": user.email, "password": kwargs["password"]},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, user


async def _parral2_con_valvulas(create_parcela, create_valvula, superficies=(1.0, 2.0, 3.0)):
    """Parral 2 con las válvulas reales 21/22/23 (el cabezal no importa acá)."""
    parcela = await create_parcela(
        nombre="Parral 2", variedad="flame", finca=Finca.media_agua, superficie_ha=sum(superficies),
    )
    valvulas = [
        await create_valvula(parcela_id=parcela.id, nombre=n, orden=i + 1, superficie_ha=ha)
        for i, (n, ha) in enumerate(zip(("21", "22", "23"), superficies))
    ]
    return parcela, valvulas


def _payload_extra(insumo_id, parcela_ids, **extra):
    body = {
        "temporada": 2026, "variedad": "flame", "insumo_id": insumo_id, "dosis_por_ha": 2.0,
        "objetivo": "Oidio", "dias_carencia": 7, "dias_reingreso": 2,
        "fecha_planificada": "2026-10-15", "parcela_ids": parcela_ids,
    }
    body.update(extra)
    return body


# ── Task 3: filas de válvula al crear/editar ─────────────────────────────────


async def test_orden_extra_trae_las_valvulas_de_cada_parcela_ordenadas(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela, _v = await _parral2_con_valvulas(create_parcela, create_valvula)

    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [parcela.id]), headers=headers,
    )
    assert resp.status_code == 201, resp.text
    valvulas = resp.json()["parcelas"][0]["valvulas"]
    assert [v["valvula_nombre"] for v in valvulas] == ["21", "22", "23"]
    assert {v["estado"] for v in valvulas} == {"pendiente"}
    assert [v["superficie_ha"] for v in valvulas] == ["1.0000", "2.0000", "3.0000"]


async def test_orden_desde_plan_trae_las_valvulas(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    await _parral2_con_valvulas(create_parcela, create_valvula)
    plan = await client.post(
        "/plan-fitosanitario/",
        json={
            "temporada": 2026, "variedades": ["flame"], "numero_aplicacion": 1, "mes": 10,
            "insumo_id": insumo.id, "objetivo": "Oidio", "dosis_por_ha": 1.5,
        },
        headers=headers,
    )
    resp = await client.post(
        "/ordenes-aplicacion/desde-plan",
        json={
            "plan_fitosanitario_id": plan.json()[0]["id"], "dias_carencia": 7,
            "dias_reingreso": 2, "fecha_planificada": "2026-10-15",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    assert len(resp.json()["parcelas"][0]["valvulas"]) == 3


async def test_parcela_sin_valvulas_queda_con_lista_vacia(
    client, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Cobre")
    potrero = await create_parcela(nombre="Potrero 3", variedad="flame", finca=Finca.media_agua)

    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [potrero.id]), headers=headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["parcelas"][0]["valvulas"] == []


async def test_orden_extra_con_valvula_ids_solo_incluye_esas(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela, (v21, _v22, _v23) = await _parral2_con_valvulas(create_parcela, create_valvula)

    resp = await client.post(
        "/ordenes-aplicacion/",
        json=_payload_extra(insumo.id, [parcela.id], valvula_ids=[v21.id]),
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    assert [v["valvula_nombre"] for v in resp.json()["parcelas"][0]["valvulas"]] == ["21"]


async def test_valvula_ids_de_otra_parcela_es_422(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela, _v = await _parral2_con_valvulas(create_parcela, create_valvula)
    otra = await create_parcela(nombre="Parral 6", variedad="flame", finca=Finca.media_agua)
    ajena = await create_valvula(parcela_id=otra.id, nombre="61")

    resp = await client.post(
        "/ordenes-aplicacion/",
        json=_payload_extra(insumo.id, [parcela.id], valvula_ids=[ajena.id]),
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


async def test_editar_orden_extra_regenera_las_filas_de_valvula(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    p2, _v = await _parral2_con_valvulas(create_parcela, create_valvula)
    p6 = await create_parcela(nombre="Parral 6", variedad="flame", finca=Finca.media_agua)
    await create_valvula(parcela_id=p6.id, nombre="61", superficie_ha=1.0)

    creada = await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [p2.id]), headers=headers,
    )
    orden_id = creada.json()["id"]

    resp = await client.put(
        f"/ordenes-aplicacion/{orden_id}",
        json=_payload_extra(insumo.id, [p6.id]),
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    parcelas = resp.json()["parcelas"]
    assert [p["parcela_nombre"] for p in parcelas] == ["Parral 6"]
    assert [v["valvula_nombre"] for v in parcelas[0]["valvulas"]] == ["61"]


# ── Task 4: confirmar por válvula ────────────────────────────────────────────


async def _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula, **kw):
    """Orden extra (dosis 2.0/ha) sobre Parral 2 con válvulas 21/22/23 de 1/2/3 ha."""
    insumo = await create_insumo(nombre="Azufre", stock_actual=100.0)
    parcela, valvulas = await _parral2_con_valvulas(create_parcela, create_valvula, **kw)
    resp = await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [parcela.id]), headers=headers,
    )
    assert resp.status_code == 201, resp.text
    orden = resp.json()
    filas = {v["valvula_nombre"]: v["id"] for v in orden["parcelas"][0]["valvulas"]}
    return orden, filas, insumo


def _url(orden, fila_id):
    return f"/ordenes-aplicacion/{orden['id']}/valvulas/{fila_id}/confirmar"


async def _stock(db_session, insumo) -> float:
    fresco = await db_session.get(Insumo, insumo.id)
    await db_session.refresh(fresco)
    return float(fresco.stock_actual)


async def test_confirmar_valvula_completa_crea_registro_y_descuenta_stock(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)

    resp = await client.post(_url(orden, filas["22"]), json={"resultado": "completa"}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "aplicada"
    assert resp.json()["resultado"] == "completa"

    registro = (await db_session.execute(select(RegistroFitosanitario))).scalar_one()
    assert registro.valvula_id is not None
    assert float(registro.cantidad_total) == 4.0  # dosis 2.0/ha x 2 ha de la válvula 22
    assert await _stock(db_session, insumo) == 96.0


async def test_parcela_y_orden_se_cierran_al_resolver_todas_las_valvulas_en_cualquier_orden(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)

    async def estado():
        body = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
        return body["estado"], body["parcelas"][0]["estado"]

    assert await estado() == ("pendiente", "pendiente")
    for nombre, esperado in (("23", ("en_curso", "pendiente")), ("21", ("en_curso", "pendiente")),
                             ("22", ("completada", "aplicada"))):
        r = await client.post(_url(orden, filas[nombre]), json={"resultado": "completa"}, headers=headers)
        assert r.status_code == 200, r.text
        assert await estado() == esperado


async def test_confirmar_dos_veces_la_misma_valvula_es_409_sin_doble_descuento(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    url = _url(orden, filas["21"])

    assert (await client.post(url, json={"resultado": "completa"}, headers=headers)).status_code == 200
    assert (await client.post(url, json={"resultado": "completa"}, headers=headers)).status_code == 409
    assert await _stock(db_session, insumo) == 98.0  # solo 1 ha x 2.0


async def test_valvula_sin_superficie_es_422_y_no_deja_rastro(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)
    await create_valvula(parcela_id=parcela.id, nombre="21", superficie_ha=None)
    creada = await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [parcela.id]), headers=headers,
    )
    orden = creada.json()
    fila = orden["parcelas"][0]["valvulas"][0]["id"]

    resp = await client.post(_url(orden, fila), json={"resultado": "completa"}, headers=headers)
    assert resp.status_code == 422, resp.text
    assert (await db_session.execute(select(RegistroFitosanitario))).first() is None
    assert await _stock(db_session, insumo) == 100.0


async def test_no_aplicada_exige_observaciones(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)

    for body in ({"resultado": "no_aplicada"}, {"resultado": "no_aplicada", "observaciones": "   "}):
        r = await client.post(_url(orden, filas["21"]), json=body, headers=headers)
        assert r.status_code == 422, r.text


async def test_no_aplicada_no_crea_registro_ni_mueve_stock_pero_resuelve_la_valvula(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)

    for nombre in ("21", "22", "23"):
        r = await client.post(
            _url(orden, filas[nombre]),
            json={"resultado": "no_aplicada", "observaciones": "Se cortó el agua"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["registro_fitosanitario_id"] is None

    assert (await db_session.execute(select(RegistroFitosanitario))).first() is None
    assert await _stock(db_session, insumo) == 100.0
    body = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
    assert body["parcelas"][0]["estado"] == "aplicada"
    assert body["estado"] == "completada"


async def test_responsable_por_defecto_es_el_usuario_y_uno_invalido_es_404(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)

    r = await client.post(
        _url(orden, filas["21"]), json={"resultado": "completa", "responsable_id": "no-existe"},
        headers=headers,
    )
    assert r.status_code == 404, r.text

    r = await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["responsable"] == "Test User"

    trabajador = Trabajador(nombre_completo="Marcos Regador")
    db_session.add(trabajador)
    await db_session.commit()
    r = await client.post(
        _url(orden, filas["22"]), json={"resultado": "completa", "responsable_id": trabajador.id},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["responsable"] == "Marcos Regador"
    registro = (
        await db_session.execute(
            select(RegistroFitosanitario).where(RegistroFitosanitario.responsable_id == trabajador.id)
        )
    ).scalar_one()
    assert registro.responsable == "Marcos Regador"


async def test_operario_de_otra_finca_no_puede_confirmar_una_valvula(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    ajeno, _u = await _auth(
        client, create_user, email="reg@test.com", role=UserRole.regador, finca=Finca.caucete,
    )

    r = await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=ajeno)
    assert r.status_code == 403, r.text


async def test_confirmar_parcela_entera_con_valvulas_es_409(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, _filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    item_id = orden["parcelas"][0]["id"]

    r = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{item_id}/confirmar", json={}, headers=headers,
    )
    assert r.status_code == 409, r.text
    assert "válvula" in r.json()["detail"]


async def test_confirmar_parcela_entera_sin_valvulas_sigue_andando(
    client, db_session, create_user, create_insumo, create_parcela,
):
    headers, _ = await _auth(client, create_user)
    insumo = await create_insumo(nombre="Cobre", stock_actual=100.0)
    potrero = await create_parcela(
        nombre="Potrero 3", variedad="flame", finca=Finca.media_agua, superficie_ha=2.0,
    )
    orden = (await client.post(
        "/ordenes-aplicacion/", json=_payload_extra(insumo.id, [potrero.id]), headers=headers,
    )).json()

    r = await client.post(
        f"/ordenes-aplicacion/{orden['id']}/parcelas/{orden['parcelas'][0]['id']}/confirmar",
        json={}, headers=headers,
    )
    assert r.status_code == 200, r.text
    assert await _stock(db_session, insumo) == 96.0


async def test_foto_de_valvula_exige_confirmacion_previa_y_se_guarda_en_el_registro(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    async def _fake_upload(raw, content_type, ident):
        return f"https://fotos.test/{ident}.jpg"

    monkeypatch.setattr("app.api.ordenes_aplicacion.upload_foto_orden_aplicacion", _fake_upload)
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    foto = {"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}

    antes = await client.post(f"/ordenes-aplicacion/valvulas/{filas['21']}/fotos", files=foto, headers=headers)
    assert antes.status_code == 409, antes.text

    await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=headers)
    despues = await client.post(f"/ordenes-aplicacion/valvulas/{filas['21']}/fotos", files=foto, headers=headers)
    assert despues.status_code == 201, despues.text
    registro = (await db_session.execute(select(RegistroFitosanitario))).scalar_one()
    fotos = (await db_session.execute(
        select(FotoRegistroFitosanitario).where(
            FotoRegistroFitosanitario.registro_fitosanitario_id == registro.id
        )
    )).scalars().all()
    assert len(fotos) == 1


async def test_foto_de_valvula_no_aplicada_se_guarda_sin_registro(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    async def _fake_upload(raw, content_type, ident):
        return f"https://fotos.test/{ident}.jpg"

    monkeypatch.setattr("app.api.ordenes_aplicacion.upload_foto_orden_aplicacion", _fake_upload)
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(
        _url(orden, filas["21"]),
        json={"resultado": "no_aplicada", "observaciones": "Caño roto"}, headers=headers,
    )

    r = await client.post(
        f"/ordenes-aplicacion/valvulas/{filas['21']}/fotos",
        files={"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}, headers=headers,
    )
    assert r.status_code == 201, r.text
    foto = (await db_session.execute(select(FotoRegistroFitosanitario))).scalar_one()
    assert foto.orden_valvula_id == filas["21"]
    assert foto.registro_fitosanitario_id is None


async def test_orden_con_una_valvula_confirmada_no_se_edita_ni_se_elimina(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=headers)

    borrar = await client.delete(f"/ordenes-aplicacion/{orden['id']}", headers=headers)
    assert borrar.status_code == 409, borrar.text
    editar = await client.put(
        f"/ordenes-aplicacion/{orden['id']}",
        json=_payload_extra(insumo.id, [orden["parcelas"][0]["parcela_id"]]), headers=headers,
    )
    assert editar.status_code == 409, editar.text


# ── Task 5: "A revisar" y orden de repaso ────────────────────────────────────


async def test_a_revisar_lista_no_aplicadas_y_completas_con_observaciones(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=headers)
    await client.post(
        _url(orden, filas["22"]),
        json={"resultado": "completa", "observaciones": "Alcanzó para la mitad"}, headers=headers,
    )
    await client.post(
        _url(orden, filas["23"]),
        json={"resultado": "no_aplicada", "observaciones": "Se cortó el agua"}, headers=headers,
    )

    resp = await client.get("/ordenes-aplicacion/a-revisar", headers=headers)
    assert resp.status_code == 200, resp.text
    por_valvula = {r["valvula_nombre"]: r for r in resp.json()}
    assert set(por_valvula) == {"22", "23"}  # la 21, completa y sin observaciones, no se revisa
    assert por_valvula["23"]["resultado"] == "no_aplicada"
    assert por_valvula["22"]["observaciones"] == "Alcanzó para la mitad"
    assert por_valvula["22"]["parcela_nombre"] == "Parral 2"
    assert por_valvula["22"]["orden_id"] == orden["id"]
    assert por_valvula["22"]["insumo_nombre"] == "Azufre"


async def test_revisar_saca_la_valvula_del_listado_y_es_idempotente(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, ger = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(
        _url(orden, filas["23"]),
        json={"resultado": "no_aplicada", "observaciones": "Se cortó el agua"}, headers=headers,
    )

    for _ in range(2):
        r = await client.post(f"/ordenes-aplicacion/valvulas/{filas['23']}/revisar", headers=headers)
        assert r.status_code == 204, r.text
    assert (await client.get("/ordenes-aplicacion/a-revisar", headers=headers)).json() == []


async def test_revisar_una_valvula_pendiente_es_409(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)

    r = await client.post(f"/ordenes-aplicacion/valvulas/{filas['21']}/revisar", headers=headers)
    assert r.status_code == 409, r.text


async def test_operario_no_ve_ni_resuelve_las_revisiones(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    regador, _u = await _auth(client, create_user, email="reg@test.com", role=UserRole.regador)

    assert (await client.get("/ordenes-aplicacion/a-revisar", headers=regador)).status_code == 403
    r = await client.post(f"/ordenes-aplicacion/valvulas/{filas['21']}/revisar", headers=regador)
    assert r.status_code == 403


def test_requiere_revision_predicado():
    from app.api.ordenes_aplicacion import requiere_revision
    from app.models.produccion import EstadoOrdenAplicacionParcela as E, ResultadoValvula as R

    def fila(estado, resultado, obs, revisada=None):
        return OrdenAplicacionValvula(
            estado=estado, resultado=resultado, observaciones=obs, revisada_at=revisada,
        )

    assert not requiere_revision(fila(E.pendiente, None, None))
    assert not requiere_revision(fila(E.aplicada, R.completa, None))
    assert not requiere_revision(fila(E.aplicada, R.completa, "  "))
    assert requiere_revision(fila(E.aplicada, R.completa, "faltó producto"))
    assert requiere_revision(fila(E.aplicada, R.no_aplicada, "sin agua"))
    assert not requiere_revision(fila(E.aplicada, R.no_aplicada, "sin agua", revisada=datetime.now()))


async def test_encargado_solo_ve_las_revisiones_de_su_finca(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(
        _url(orden, filas["23"]),
        json={"resultado": "no_aplicada", "observaciones": "Se cortó el agua"}, headers=headers,
    )
    propio, _u = await _auth(
        client, create_user, email="enc1@test.com", role=UserRole.encargado, finca=Finca.media_agua,
    )
    ajeno, _u2 = await _auth(
        client, create_user, email="enc2@test.com", role=UserRole.encargado, finca=Finca.caucete,
    )

    assert len((await client.get("/ordenes-aplicacion/a-revisar", headers=propio)).json()) == 1
    assert (await client.get("/ordenes-aplicacion/a-revisar", headers=ajeno)).json() == []
    r = await client.post(f"/ordenes-aplicacion/valvulas/{filas['23']}/revisar", headers=ajeno)
    assert r.status_code == 403, r.text


async def test_operario_de_otra_finca_no_puede_subir_foto_a_una_valvula(
    client, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    async def _fake_upload(raw, content_type, ident):
        return f"https://fotos.test/{ident}.jpg"

    monkeypatch.setattr("app.api.ordenes_aplicacion.upload_foto_orden_aplicacion", _fake_upload)
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=headers)
    ajeno, _u = await _auth(
        client, create_user, email="reg@test.com", role=UserRole.regador, finca=Finca.caucete,
    )

    r = await client.post(
        f"/ordenes-aplicacion/valvulas/{filas['21']}/fotos",
        files={"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}, headers=ajeno,
    )
    assert r.status_code == 403, r.text


# ── Deshacer la confirmación de una válvula ──────────────────────────────────


def _url_deshacer(orden, fila_id):
    return f"/ordenes-aplicacion/{orden['id']}/valvulas/{fila_id}/deshacer"


async def test_deshacer_valvula_completa_devuelve_stock_y_borra_registro(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    from app.models.insumo import MovimientoStock

    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(_url(orden, filas["22"]), json={"resultado": "completa"}, headers=headers)
    assert await _stock(db_session, insumo) == 96.0

    resp = await client.post(_url_deshacer(orden, filas["22"]), headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["estado"] == "pendiente"
    assert body["resultado"] is None
    assert body["confirmada_at"] is None
    assert body["registro_fitosanitario_id"] is None
    assert await _stock(db_session, insumo) == 100.0
    db_session.expire_all()
    assert (await db_session.execute(select(RegistroFitosanitario))).first() is None
    assert (await db_session.execute(select(MovimientoStock))).first() is None


async def test_deshacer_valvula_no_aplicada_no_toca_stock(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    async def _fake_upload(raw, content_type, ident):
        return f"https://fotos.test/{ident}.jpg"

    monkeypatch.setattr("app.api.ordenes_aplicacion.upload_foto_orden_aplicacion", _fake_upload)
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(
        _url(orden, filas["21"]),
        json={"resultado": "no_aplicada", "observaciones": "Caño roto"}, headers=headers,
    )
    foto = await client.post(
        f"/ordenes-aplicacion/valvulas/{filas['21']}/fotos",
        files={"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}, headers=headers,
    )
    assert foto.status_code == 201, foto.text

    resp = await client.post(_url_deshacer(orden, filas["21"]), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "pendiente"
    assert resp.json()["observaciones"] is None
    assert await _stock(db_session, insumo) == 100.0
    db_session.expire_all()
    assert (await db_session.execute(select(FotoRegistroFitosanitario))).first() is None


async def test_deshacer_valvula_completa_borra_sus_fotos(
    client, db_session, monkeypatch, create_user, create_insumo, create_parcela, create_valvula,
):
    async def _fake_upload(raw, content_type, ident):
        return f"https://fotos.test/{ident}.jpg"

    monkeypatch.setattr("app.api.ordenes_aplicacion.upload_foto_orden_aplicacion", _fake_upload)
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=headers)
    await client.post(
        f"/ordenes-aplicacion/valvulas/{filas['21']}/fotos",
        files={"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}, headers=headers,
    )

    resp = await client.post(_url_deshacer(orden, filas["21"]), headers=headers)
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    assert (await db_session.execute(select(FotoRegistroFitosanitario))).first() is None
    assert (await db_session.execute(select(RegistroFitosanitario))).first() is None


async def test_deshacer_ultima_valvula_baja_parcela_y_orden(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    for nombre in ("21", "22", "23"):
        await client.post(_url(orden, filas[nombre]), json={"resultado": "completa"}, headers=headers)
    body = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
    assert (body["estado"], body["parcelas"][0]["estado"]) == ("completada", "aplicada")

    r = await client.post(_url_deshacer(orden, filas["23"]), headers=headers)
    assert r.status_code == 200, r.text
    body = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
    assert (body["estado"], body["parcelas"][0]["estado"]) == ("en_curso", "pendiente")


async def test_deshacer_unica_valvula_deja_orden_pendiente(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(_url(orden, filas["21"]), json={"resultado": "completa"}, headers=headers)
    body = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
    assert body["estado"] == "en_curso"

    r = await client.post(_url_deshacer(orden, filas["21"]), headers=headers)
    assert r.status_code == 200, r.text
    body = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
    assert body["estado"] == "pendiente"


async def test_deshacer_valvula_pendiente_da_409(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)

    r = await client.post(_url_deshacer(orden, filas["21"]), headers=headers)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "Esta válvula todavía no fue confirmada"


async def test_deshacer_dos_veces_da_409_y_stock_se_devuelve_una_vez(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(_url(orden, filas["22"]), json={"resultado": "completa"}, headers=headers)

    assert (await client.post(_url_deshacer(orden, filas["22"]), headers=headers)).status_code == 200
    assert (await client.post(_url_deshacer(orden, filas["22"]), headers=headers)).status_code == 409
    assert await _stock(db_session, insumo) == 100.0


async def test_deshacer_limpia_revision(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    await client.post(
        _url(orden, filas["23"]),
        json={"resultado": "no_aplicada", "observaciones": "Se cortó el agua"}, headers=headers,
    )
    revisar = await client.post(f"/ordenes-aplicacion/valvulas/{filas['23']}/revisar", headers=headers)
    assert revisar.status_code == 204

    r = await client.post(_url_deshacer(orden, filas["23"]), headers=headers)
    assert r.status_code == 200, r.text
    db_session.expire_all()
    fila = await db_session.get(OrdenAplicacionValvula, filas["23"])
    assert fila.revisada_at is None
    assert fila.revisada_por is None
    assert (await client.get("/ordenes-aplicacion/a-revisar", headers=headers)).json() == []

    # Re-confirming as no_aplicada must put it back in the review list.
    again = await client.post(
        _url(orden, filas["23"]),
        json={"resultado": "no_aplicada", "observaciones": "Otra vez sin agua"}, headers=headers,
    )
    assert again.status_code == 200, again.text
    pendientes = (await client.get("/ordenes-aplicacion/a-revisar", headers=headers)).json()
    assert [r["valvula_nombre"] for r in pendientes] == ["23"]


async def test_deshacer_roles(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    for nombre in ("21", "22", "23"):
        await client.post(_url(orden, filas[nombre]), json={"resultado": "completa"}, headers=headers)

    regador, _u = await _auth(
        client, create_user, email="reg@test.com", role=UserRole.regador, finca=Finca.media_agua,
    )
    obrero, _u = await _auth(
        client, create_user, email="obr@test.com", role=UserRole.obrero, finca=Finca.media_agua,
    )
    ajeno, _u = await _auth(
        client, create_user, email="enc2@test.com", role=UserRole.encargado, finca=Finca.caucete,
    )
    propio, _u = await _auth(
        client, create_user, email="enc1@test.com", role=UserRole.encargado, finca=Finca.media_agua,
    )

    assert (await client.post(_url_deshacer(orden, filas["21"]), headers=regador)).status_code == 403
    assert (await client.post(_url_deshacer(orden, filas["21"]), headers=obrero)).status_code == 403
    assert (await client.post(_url_deshacer(orden, filas["21"]), headers=ajeno)).status_code == 403
    assert (await client.post(_url_deshacer(orden, filas["21"]), headers=propio)).status_code == 200
    assert (await client.post(_url_deshacer(orden, filas["22"]), headers=headers)).status_code == 200


async def test_deshacer_valvula_o_orden_inexistente_es_404(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)

    r = await client.post(_url_deshacer(orden, "no-existe"), headers=headers)
    assert r.status_code == 404, r.text
    r = await client.post(
        f"/ordenes-aplicacion/no-existe/valvulas/{filas['21']}/deshacer", headers=headers,
    )
    assert r.status_code == 404, r.text


async def test_deshacer_y_reconfirmar_no_viola_uniques(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    from app.models.insumo import MovimientoStock
    from sqlalchemy import func

    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    for nombre in ("21", "22", "23"):
        r = await client.post(_url(orden, filas[nombre]), json={"resultado": "completa"}, headers=headers)
        assert r.status_code == 200, r.text
    stock_completo = await _stock(db_session, insumo)

    assert (await client.post(_url_deshacer(orden, filas["22"]), headers=headers)).status_code == 200
    r = await client.post(_url(orden, filas["22"]), json={"resultado": "completa"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["registro_fitosanitario_id"]

    # 100 - (1 + 2 + 3 ha) x 2 per ha
    assert await _stock(db_session, insumo) == stock_completo == 88.0
    db_session.expire_all()
    registros = (await db_session.execute(select(func.count(RegistroFitosanitario.id)))).scalar_one()
    movimientos = (await db_session.execute(select(func.count(MovimientoStock.id)))).scalar_one()
    assert (registros, movimientos) == (3, 3)
    body = (await client.get(f"/ordenes-aplicacion/{orden['id']}", headers=headers)).json()
    assert (body["estado"], body["parcelas"][0]["estado"]) == ("completada", "aplicada")


async def test_deshacer_encargado_ajeno_sobre_pendiente_da_403_no_409(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    ajeno, _u = await _auth(
        client, create_user, email="enc3@test.com", role=UserRole.encargado, finca=Finca.caucete,
    )

    # Finca check must run before the state check so state is not leaked across fincas.
    r = await client.post(_url_deshacer(orden, filas["21"]), headers=ajeno)
    assert r.status_code == 403, r.text


async def test_deshacer_valvula_de_otra_orden_da_404(
    client, create_user, create_insumo, create_parcela, create_valvula,
):
    headers, _ = await _auth(client, create_user)
    orden, filas, _i = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    otra = await client.post(
        "/ordenes-aplicacion/",
        json=_payload_extra(_i.id, [(await _otra_parcela(create_parcela, create_valvula)).id]),
        headers=headers,
    )
    assert otra.status_code == 201, otra.text
    fila_otra = otra.json()["parcelas"][0]["valvulas"][0]["id"]
    await client.post(_url(otra.json(), fila_otra), json={"resultado": "completa"}, headers=headers)

    r = await client.post(_url_deshacer(orden, fila_otra), headers=headers)
    assert r.status_code == 404, r.text


async def _otra_parcela(create_parcela, create_valvula):
    parcela = await create_parcela(nombre="Parral 9", variedad="flame", finca=Finca.media_agua, superficie_ha=1.0)
    await create_valvula(parcela_id=parcela.id, nombre="91", superficie_ha=1.0)
    return parcela


async def test_borrar_registro_de_valvula_lo_saca_de_la_orden(
    client, db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    # Used to be a 409 ("deshacela desde la válvula"); Eliminar now removes the
    # application and its valve row from the order. Reactivar is the "undo".
    from app.models.insumo import MovimientoStock
    from sqlalchemy import func

    headers, _ = await _auth(client, create_user)
    orden, filas, insumo = await _orden_parral2(client, headers, create_insumo, create_parcela, create_valvula)
    conf = await client.post(_url(orden, filas["22"]), json={"resultado": "completa"}, headers=headers)
    registro_id = conf.json()["registro_fitosanitario_id"]
    assert await _stock(db_session, insumo) == 96.0

    resp = await client.delete(f"/produccion/fitosanitarios/{registro_id}", headers=headers)
    assert resp.status_code == 204, resp.text

    assert await _stock(db_session, insumo) == 100.0
    db_session.expire_all()
    assert (await db_session.execute(select(func.count(RegistroFitosanitario.id)))).scalar_one() == 0
    assert (await db_session.execute(select(func.count(MovimientoStock.id)))).scalar_one() == 0
    assert await db_session.get(OrdenAplicacionValvula, filas["22"]) is None
