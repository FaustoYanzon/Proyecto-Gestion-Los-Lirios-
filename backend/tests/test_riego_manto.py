"""Riego a manto por superficie (2026-10-26): la parcela entera, sin cabezal ni
valvulas; caudal = ceil(superficie_ha) valvulas equivalentes al 25%. Los manto
historicos (n_valvulas_manto NULL) conservan el 40% sobre sus valvulas.
Run with: pytest
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.parcela import TipoParcela, TipoRiego
from app.models.produccion import RegistroRiego
from app.models.user import User, UserRole


async def _login(client, create_user, role: UserRole = UserRole.encargado) -> tuple[dict, User]:
    user = await create_user(email="encargado@test.com", password="Password123!", role=role)
    resp = await client.post(
        "/auth/login",
        data={"username": "encargado@test.com", "password": "Password123!"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, user


async def _auth(client, create_user, role: UserRole = UserRole.encargado) -> dict:
    headers, _ = await _login(client, create_user, role)
    return headers


def _payload(parcela_id: str, **extra) -> dict:
    """Manto-shaped payload by default (no cabezal/valvula); goteo tests add them."""
    return {
        "fecha": "2026-10-05",
        "parcela_id": parcela_id,
        "inicio": "2026-10-05T08:00:00",
        "fin": "2026-10-05T18:00:00",
        "responsable": "Juan Perez",
        **extra,
    }


def _goteo(parcela_id: str, **extra) -> dict:
    return _payload(parcela_id, cabezal="1", valvula="1,2", **extra)


def _iniciar(parcela_id: str, **extra) -> dict:
    return {"parcela_id": parcela_id, "tipo": "manto", "responsable": "Juan Perez", **extra}


async def test_riego_sin_tipo_es_goteo(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    resp = await client.post("/produccion/riego/", json=_goteo(parcela.id), headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["tipo"] == "goteo"
    assert data["litros_aplicados"] == 10 * 16_000 * 2
    assert data["mm_aplicados"] == 16.0
    assert data["factor_aplicado"] == 1.0


async def test_manto_calcula_por_superficie(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    resp = await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["tipo"] == "manto"
    assert data["n_valvulas"] == 3
    assert data["litros_aplicados"] == 120_000
    assert data["mm_aplicados"] == 4.0
    assert data["cabezal"] is None
    assert data["valvula"] == ""
    assert data["factor_aplicado"] == 0.25


async def test_manto_parcela_menor_a_una_ha(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=0.4)
    resp = await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )

    assert resp.status_code == 201
    assert resp.json()["n_valvulas"] == 1
    assert resp.json()["litros_aplicados"] == 40_000


async def test_manto_ignora_cabezal_y_valvula_de_cliente_viejo(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    resp = await client.post(
        "/produccion/riego/",
        json=_payload(parcela.id, tipo="manto", cabezal="1", valvula="1,2"),
        headers=headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["cabezal"] is None
    assert data["valvula"] == ""
    assert data["n_valvulas"] == 3
    assert data["litros_aplicados"] == 120_000


async def test_manto_rechaza_fertirriego(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    resp = await client.post(
        "/produccion/riego/",
        json=_payload(parcela.id, tipo="manto", fertilizante_nombre="Urea"),
        headers=headers,
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "El riego a manto no lleva fertirriego."

    resp = await client.post(
        "/produccion/riego/iniciar",
        json=_iniciar(parcela.id, fertilizante_dosis_lt_ha=2.0),
        headers=headers,
    )
    assert resp.status_code == 422


async def test_manto_sin_superficie_422(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    for superficie in (None, 0):
        parcela = await create_parcela(nombre=f"P {superficie}", superficie_ha=superficie)
        resp = await client.post(
            "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
        )
        assert resp.status_code == 422, superficie
        assert resp.json()["detail"] == (
            "El riego a manto necesita un parral o potrero con superficie cargada."
        )
        resp = await client.post(
            "/produccion/riego/iniciar", json=_iniciar(parcela.id), headers=headers
        )
        assert resp.status_code == 422, superficie


async def test_manto_en_cabezal_o_pasero_422(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    for tipo in (TipoParcela.cabezal, TipoParcela.pasero):
        parcela = await create_parcela(nombre=f"P {tipo.value}", tipo=tipo, superficie_ha=2.0)
        resp = await client.post(
            "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
        )
        assert resp.status_code == 422, tipo


async def test_manto_en_potrero_ok(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(tipo=TipoParcela.potrero, superficie_ha=3.0)
    resp = await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )
    assert resp.status_code == 201
    assert resp.json()["n_valvulas"] == 3


async def test_goteo_sin_cabezal_o_valvula_422(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela()
    for extra in ({}, {"cabezal": "1"}, {"valvula": "1,2"}, {"cabezal": "", "valvula": "1"}):
        resp = await client.post("/produccion/riego/", json=_payload(parcela.id, **extra), headers=headers)
        assert resp.status_code == 422, extra
        resp = await client.post(
            "/produccion/riego/iniciar", json=_iniciar(parcela.id, tipo="goteo", **extra), headers=headers
        )
        assert resp.status_code == 422, extra
    resp = await client.post("/produccion/riego/", json=_payload(parcela.id), headers=headers)
    assert resp.json()["detail"] == "El riego por goteo necesita cabezal y válvulas."


async def test_iniciar_y_terminar_manto(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    iniciado = await client.post("/produccion/riego/iniciar", json=_iniciar(parcela.id), headers=headers)
    assert iniciado.status_code == 201
    assert iniciado.json()["tipo"] == "manto"
    assert iniciado.json()["n_valvulas"] == 3
    assert iniciado.json()["factor_aplicado"] == 0.25
    assert iniciado.json()["cabezal"] is None

    en_curso = await client.get("/produccion/riego/en-curso", headers=headers)
    assert en_curso.status_code == 200
    assert en_curso.json()[0]["n_valvulas"] == 3

    inicio = iniciado.json()["inicio"].replace("Z", "+00:00")
    fin = (datetime.fromisoformat(inicio) + timedelta(hours=5)).isoformat()
    terminado = await client.post(
        f"/produccion/riego/{iniciado.json()['id']}/terminar", json={"fin": fin}, headers=headers
    )

    assert terminado.status_code == 200
    assert terminado.json()["mm_aplicados"] == 2.0
    assert terminado.json()["litros_aplicados"] == 60_000


async def test_segundo_manto_en_curso_misma_parcela_409(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    primero = await client.post("/produccion/riego/iniciar", json=_iniciar(parcela.id), headers=headers)
    assert primero.status_code == 201

    segundo = await client.post("/produccion/riego/iniciar", json=_iniciar(parcela.id), headers=headers)
    assert segundo.status_code == 409
    assert segundo.json()["detail"] == "Ya hay un riego a manto en curso en esta parcela."


async def test_reintento_idempotente_de_iniciar_manto_no_da_409(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    key = "11111111-1111-1111-1111-111111111111"
    primero = await client.post(
        "/produccion/riego/iniciar", json=_iniciar(parcela.id, idempotency_key=key), headers=headers
    )
    segundo = await client.post(
        "/produccion/riego/iniciar", json=_iniciar(parcela.id, idempotency_key=key), headers=headers
    )

    assert primero.status_code == 201
    assert segundo.status_code == 201
    assert segundo.json()["id"] == primero.json()["id"]


async def test_indice_unico_un_manto_en_curso_por_parcela(client, create_user, create_parcela, db_session):
    # DB-level guard behind the 409: two requests that both pass the check at
    # the same time must not both insert.
    _headers, user = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    ahora = datetime.now(timezone.utc)

    def fila(tipo: TipoRiego, fin: datetime | None) -> RegistroRiego:
        return RegistroRiego(
            fecha=ahora.date(), parcela_id=parcela.id, tipo=tipo, inicio=ahora, fin=fin,
            responsable="Juan Perez", created_by=user.id,
        )

    # Allowed: a finished manto and a goteo in progress next to the one in progress.
    db_session.add_all([fila(TipoRiego.manto, ahora), fila(TipoRiego.goteo, None), fila(TipoRiego.manto, None)])
    await db_session.commit()

    db_session.add(fila(TipoRiego.manto, None))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_manto_en_curso_en_otra_parcela_ok(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    a = await create_parcela(nombre="A", superficie_ha=2.3)
    b = await create_parcela(nombre="B", superficie_ha=1.0)
    assert (await client.post("/produccion/riego/iniciar", json=_iniciar(a.id), headers=headers)).status_code == 201
    assert (await client.post("/produccion/riego/iniciar", json=_iniciar(b.id), headers=headers)).status_code == 201


async def test_put_manto_historico_conserva_factor_04(client, create_user, create_parcela, db_session):
    headers, user = await _login(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=2.3)
    historico = RegistroRiego(
        fecha=datetime(2026, 10, 5).date(),
        parcela_id=parcela.id,
        cabezal="1",
        valvula="1,2",
        tipo=TipoRiego.manto,
        n_valvulas_manto=None,
        inicio=datetime(2026, 10, 5, 8, tzinfo=timezone.utc),
        fin=datetime(2026, 10, 5, 18, tzinfo=timezone.utc),
        responsable="Juan Perez",
        created_by=user.id,
    )
    db_session.add(historico)
    await db_session.commit()

    resp = await client.put(
        f"/produccion/riego/{historico.id}", json={"fin": "2026-10-05T20:00:00Z"}, headers=headers
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["litros_aplicados"] == 12 * 16_000 * 0.4 * 2 == 153_600.0
    assert data["mm_aplicados"] == 7.68
    assert data["n_valvulas"] == 2
    assert data["factor_aplicado"] == 0.4
    assert data["valvula"] == "1,2"
    await db_session.refresh(historico)
    assert historico.n_valvulas_manto is None


async def test_put_goteo_a_manto_fija_n_valvulas(client, create_user, create_parcela):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=2.3)
    creado = (await client.post("/produccion/riego/", json=_goteo(parcela.id), headers=headers)).json()

    resp = await client.put(f"/produccion/riego/{creado['id']}", json={"tipo": "manto"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["n_valvulas"] == 3
    assert data["mm_aplicados"] == 4.0
    assert data["litros_aplicados"] == 120_000
    assert data["cabezal"] is None
    assert data["valvula"] == ""
    assert data["factor_aplicado"] == 0.25


async def test_put_manto_a_goteo_sin_cabezal_422(client, create_user, create_parcela):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=2.3)
    creado = (await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )).json()

    resp = await client.put(f"/produccion/riego/{creado['id']}", json={"tipo": "goteo"}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "El riego por goteo necesita cabezal y válvulas."


async def test_put_manto_a_goteo_con_cabezal_y_valvula_ok(client, create_user, create_parcela, db_session):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=2.3)
    creado = (await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )).json()

    resp = await client.put(
        f"/produccion/riego/{creado['id']}",
        json={"tipo": "goteo", "cabezal": "1", "valvula": "1,2"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["factor_aplicado"] == 1.0
    assert data["n_valvulas"] == 2
    assert data["mm_aplicados"] == 16.0
    assert data["litros_aplicados"] == 320_000
    guardado = await db_session.get(RegistroRiego, creado["id"])
    assert guardado.n_valvulas_manto is None


async def test_put_manto_nuevo_cambia_parcela_recalcula_n(client, create_user, create_parcela):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    a = await create_parcela(nombre="A", superficie_ha=2.3)
    b = await create_parcela(nombre="B", superficie_ha=0.4)
    creado = (await client.post(
        "/produccion/riego/", json=_payload(a.id, tipo="manto"), headers=headers
    )).json()

    resp = await client.put(f"/produccion/riego/{creado['id']}", json={"parcela_id": b.id}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["n_valvulas"] == 1
    assert resp.json()["litros_aplicados"] == 40_000


# --- Model rules: manto by surface (no DB) ---

from datetime import datetime, timezone  # noqa: E402

import pytest  # noqa: E402

from app.models.parcela import TipoRiego  # noqa: E402
from app.models.produccion import RegistroRiego  # noqa: E402


def _registro(**extra) -> RegistroRiego:
    return RegistroRiego(
        inicio=datetime(2026, 10, 5, 8, tzinfo=timezone.utc),
        fin=datetime(2026, 10, 5, 18, tzinfo=timezone.utc),
        **extra,
    )


def test_manto_nuevo_usa_factor_025_y_n_guardado() -> None:
    r = _registro(tipo=TipoRiego.manto, n_valvulas_manto=3, cabezal=None, valvula=None)
    assert r.litros_aplicados == 120_000.0
    assert r.mm_aplicados == 4.0
    assert r.n_valvulas == 3
    assert r.factor_aplicado == 0.25


def test_manto_historico_conserva_factor_04() -> None:
    r = _registro(tipo=TipoRiego.manto, valvula="1,2", n_valvulas_manto=None)
    assert r.litros_aplicados == 128_000.0
    assert r.mm_aplicados == 6.4
    assert r.n_valvulas == 2
    assert r.factor_aplicado == 0.4


def test_goteo_no_cambia() -> None:
    r = _registro(tipo=TipoRiego.goteo, valvula="1,2")
    assert r.litros_aplicados == 320_000.0
    assert r.mm_aplicados == 16.0
    assert r.factor_aplicado == 1.0


@pytest.mark.parametrize(
    "ha,esperado",
    [(3.0, 3), (2.3, 3), (2.85, 3), (1.0, 1), (0.4, 1), (3.0000000000000004, 3)],
)
def test_valvulas_manto_de(ha: float, esperado: int) -> None:
    assert RegistroRiego.valvulas_manto_de(ha) == esperado


async def _crear_manto_y_cambiar_superficie(
    client, create_parcela, db_session, headers, nueva, nombre: str = "Parcela Test"
) -> tuple[dict, str]:
    from app.models.parcela import Parcela

    parcela = await create_parcela(nombre=nombre, superficie_ha=2.3)
    creado = (await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )).json()
    guardada = await db_session.get(Parcela, parcela.id)
    guardada.superficie_ha = nueva
    await db_session.commit()
    return creado, parcela.id


async def test_put_manto_nuevo_no_recalcula_n_si_cambia_superficie(
    client, create_user, create_parcela, db_session
):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    creado, _ = await _crear_manto_y_cambiar_superficie(client, create_parcela, db_session, headers, 3.2)

    resp = await client.put(f"/produccion/riego/{creado['id']}", json={"responsable": "X"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["n_valvulas"] == 3
    assert resp.json()["litros_aplicados"] == creado["litros_aplicados"] == 120_000
    assert resp.json()["responsable"] == "X"


async def test_put_manto_nuevo_editable_si_se_borra_superficie(
    client, create_user, create_parcela, db_session
):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    for nueva in (None, 0):
        creado, _ = await _crear_manto_y_cambiar_superficie(
            client, create_parcela, db_session, headers, nueva, nombre=f"P {nueva}"
        )

        resp = await client.put(
            f"/produccion/riego/{creado['id']}", json={"responsable": "X"}, headers=headers
        )

        assert resp.status_code == 200, nueva
        assert resp.json()["n_valvulas"] == 3
        assert resp.json()["litros_aplicados"] == 120_000


async def test_put_manto_nuevo_sigue_rechazando_fertirriego(client, create_user, create_parcela, db_session):
    headers = await _auth(client, create_user, role=UserRole.gerencial)
    creado, _ = await _crear_manto_y_cambiar_superficie(client, create_parcela, db_session, headers, 2.3)

    resp = await client.put(
        f"/produccion/riego/{creado['id']}", json={"fertilizante_nombre": "Urea"}, headers=headers
    )
    assert resp.status_code == 422
    resp = await client.put(
        f"/produccion/riego/{creado['id']}", json={"cabezal": "1", "valvula": "1,2"}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["cabezal"] is None
    assert resp.json()["valvula"] == ""


# --- API compatibility: pre-manto clients call valvula.split(',') ---


async def test_manto_nuevo_responde_valvula_vacia_no_null(client, create_user, create_parcela, db_session):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    creado = await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )
    iniciado = await client.post("/produccion/riego/iniciar", json=_iniciar(parcela.id), headers=headers)
    assert creado.status_code == 201
    assert iniciado.status_code == 201

    listado = await client.get("/produccion/riego/", headers=headers)
    uno = await client.get(f"/produccion/riego/{creado.json()['id']}", headers=headers)
    en_curso = await client.get("/produccion/riego/en-curso", headers=headers)

    items = [
        creado.json(),
        iniciado.json(),
        next(r for r in listado.json() if r["id"] == creado.json()["id"]),
        uno.json(),
        next(r for r in en_curso.json() if r["id"] == iniciado.json()["id"]),
    ]
    for item in items:
        assert item["valvula"] == ""
        assert item["cabezal"] is None
    # The database keeps NULL; only the API output changes.
    guardado = await db_session.get(RegistroRiego, creado.json()["id"])
    assert guardado.valvula is None


async def test_manto_nuevo_ignora_mm_de_cliente_viejo(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    resp = await client.post(
        "/produccion/riego/",
        json=_payload(parcela.id, tipo="manto", mm_aplicados=6.4),
        headers=headers,
    )

    assert resp.status_code == 201
    assert resp.json()["mm_aplicados"] == 4.0


# --- Mixed goteo / historical manto / new manto ---


def _manto_historico(parcela_id: str, user_id: str, fin: datetime | None) -> RegistroRiego:
    return RegistroRiego(
        fecha=datetime(2026, 10, 5).date(),
        parcela_id=parcela_id,
        cabezal="1",
        valvula="1,2",
        tipo=TipoRiego.manto,
        n_valvulas_manto=None,
        inicio=datetime(2026, 10, 5, 8, tzinfo=timezone.utc),
        fin=fin,
        responsable="Juan Perez",
        created_by=user_id,
    )


async def test_eficiencia_hidrica_suma_goteo_manto_historico_y_nuevo(
    client, create_user, create_parcela, db_session
):
    headers, user = await _login(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    goteo = await client.post("/produccion/riego/", json=_goteo(parcela.id), headers=headers)
    nuevo = await client.post(
        "/produccion/riego/", json=_payload(parcela.id, tipo="manto"), headers=headers
    )
    historico = _manto_historico(parcela.id, user.id, datetime(2026, 10, 5, 18, tzinfo=timezone.utc))
    db_session.add(historico)
    await db_session.commit()
    assert goteo.status_code == 201
    assert nuevo.status_code == 201

    resp = await client.get("/produccion/dashboard/eficiencia-hidrica?anio=2026", headers=headers)

    assert resp.status_code == 200
    fila = next(r for r in resp.json() if r["parcela_id"] == parcela.id)
    litros_registros = [
        goteo.json()["litros_aplicados"],
        historico.litros_aplicados,
        nuevo.json()["litros_aplicados"],
    ]
    assert litros_registros == [320_000, 128_000, 120_000]
    assert fila["litros_totales"] == sum(litros_registros) == 568_000
    assert fila["mm_aplicados_total"] == 16.0 + 6.4 + 4.0


async def test_iniciar_manto_desde_cliente_viejo_con_cabezal_y_valvula(client, create_user, create_parcela):
    headers = await _auth(client, create_user)
    parcela = await create_parcela(superficie_ha=2.3)
    resp = await client.post(
        "/produccion/riego/iniciar",
        json=_iniciar(parcela.id, cabezal="1", valvula="1,2"),
        headers=headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["cabezal"] is None
    assert data["valvula"] == ""
    assert data["n_valvulas"] == 3
    assert data["factor_aplicado"] == 0.25


async def test_en_curso_expone_factor_aplicado(client, create_user, create_parcela, db_session):
    headers, user = await _login(client, create_user)
    a = await create_parcela(nombre="A", superficie_ha=2.3)
    b = await create_parcela(nombre="B", superficie_ha=2.3)
    c = await create_parcela(nombre="C", superficie_ha=2.3)
    goteo = await client.post(
        "/produccion/riego/iniciar",
        json=_iniciar(a.id, tipo="goteo", cabezal="1", valvula="1,2"),
        headers=headers,
    )
    nuevo = await client.post("/produccion/riego/iniciar", json=_iniciar(b.id), headers=headers)
    historico = _manto_historico(c.id, user.id, fin=None)
    db_session.add(historico)
    await db_session.commit()

    resp = await client.get("/produccion/riego/en-curso", headers=headers)

    assert resp.status_code == 200
    por_id = {r["id"]: r for r in resp.json()}
    assert por_id[goteo.json()["id"]]["factor_aplicado"] == 1.0
    assert por_id[nuevo.json()["id"]]["factor_aplicado"] == 0.25
    assert por_id[historico.id]["factor_aplicado"] == 0.4
    assert por_id[historico.id]["n_valvulas"] == 2
    assert por_id[historico.id]["valvula"] == "1,2"


async def test_put_manto_historico_con_payload_de_la_web(client, create_user, create_parcela, db_session):
    headers, user = await _login(client, create_user, role=UserRole.gerencial)
    parcela = await create_parcela(superficie_ha=2.3)
    historico = _manto_historico(parcela.id, user.id, datetime(2026, 10, 5, 18, tzinfo=timezone.utc))
    db_session.add(historico)
    await db_session.commit()

    # Exactly what the new web RiegoForm sends for a historical manto.
    resp = await client.put(
        f"/produccion/riego/{historico.id}",
        json={
            "fecha": "2026-10-05",
            "tipo": "manto",
            "inicio": "2026-10-05T05:00:00-03:00",
            "fin": "2026-10-05T17:00:00-03:00",
            "responsable": "Pedro Gomez",
            "responsable_id": None,
        },
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["litros_aplicados"] == 12 * 16_000 * 0.4 * 2 == 153_600.0
    assert data["mm_aplicados"] == 7.68
    assert data["factor_aplicado"] == 0.4
    assert data["n_valvulas"] == 2
    assert data["cabezal"] == "1"
    assert data["valvula"] == "1,2"
    assert data["responsable"] == "Pedro Gomez"
    await db_session.refresh(historico)
    assert historico.n_valvulas_manto is None
    assert historico.valvula == "1,2"
