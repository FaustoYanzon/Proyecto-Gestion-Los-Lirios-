"""Tests for the ARCA CSV import feature: parser correctness (notas de
credito, USD, unknown comprobante codes) and the import/classify/discard
endpoints, including dedup on re-import.

resumen-iva is NOT covered here: it reads from vw_kpi_iva, a Postgres view
created by a raw-SQL migration -- the in-memory SQLite test DB (see
conftest.py) only has tables created from the SQLAlchemy models, not that
view. Same gap as the rest of kpis.py, which has no test coverage either;
verified manually against real Postgres with the user's actual CSVs instead.
"""
from __future__ import annotations

from decimal import Decimal

from app.core.arca_import import parse_arca_csv
from app.models.arca import TipoArchivoArca
from app.models.user import UserRole

_RECIBIDOS_HEADER = (
    '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";'
    '"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";'
    '"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Tipo Cambio";"Moneda";'
    '"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";"IVA 5%";'
    '"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";'
    '"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";'
    '"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"'
)
_FACTURA_A = (
    "2026-07-02;1;2;91;91;86272144043445;80;20222182884;SASU NESTOR DANIEL;80;33673268809;1,00;$;"
    ";;;;;135450,00;1290000,00;;;;;1290000,00;0,00;0,00;0,00;135450,00;1425450,00"
)
_NOTA_CREDITO_A = (
    "2026-07-27;3;3;1271;1271;86305596166737;80;20111183415;MARTINEZ JORGE ROBERTO;80;33673268809;1,00;$;"
    ";;;;;;;10589,88;50428,00;;;50428,00;0,00;0,00;0,00;10589,88;61017,88"
)
_TIPO_DESCONOCIDO = _FACTURA_A.replace(";1;2;91;91;", ";999;2;92;92;", 1)

RECIBIDOS_CSV = "\n".join([_RECIBIDOS_HEADER, _FACTURA_A, _NOTA_CREDITO_A])

_EMITIDOS_HEADER = (
    '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";'
    '"Cód. Autorización";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Denominación Receptor";'
    '"Tipo Cambio";"Moneda";"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";'
    '"IVA 5%";"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";'
    '"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";'
    '"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"'
)
_FACTURA_A_VENTA = (
    "2026-07-03;1;2;160;160;86272255766566;80;30691865076;OVAR S. A.;1,00;$;"
    ";;;;;3839778,60;36569320,00;;;;;36569320,00;0,00;0,00;0,00;3839778,60;40409098,60"
)
EMITIDOS_CSV = "\n".join([_EMITIDOS_HEADER, _FACTURA_A_VENTA])


# --- parser ------------------------------------------------------------------


def test_parser_flags_nota_credito_and_computes_totals():
    result = parse_arca_csv(RECIBIDOS_CSV, TipoArchivoArca.recibido)
    assert result.errores == []
    assert len(result.filas) == 2

    factura, nc = result.filas
    assert factura.es_nota_credito is False
    assert factura.total_iva == Decimal("135450.00")
    assert factura.cuit_contraparte == "20222182884"
    assert factura.denominacion_contraparte == "SASU NESTOR DANIEL"

    assert nc.tipo_comprobante == 3
    assert nc.es_nota_credito is True
    assert nc.total_iva == Decimal("10589.88")


def test_parser_maps_moneda_pesos():
    result = parse_arca_csv(RECIBIDOS_CSV, TipoArchivoArca.recibido)
    assert all(fila.moneda == "ars" for fila in result.filas)


def test_parser_reports_unknown_tipo_comprobante_as_error_not_guess():
    csv_content = "\n".join([_RECIBIDOS_HEADER, _TIPO_DESCONOCIDO])
    result = parse_arca_csv(csv_content, TipoArchivoArca.recibido)
    assert result.filas == []
    assert len(result.errores) == 1
    assert "999" in result.errores[0]


def test_parser_emitidos_uses_receptor_as_contraparte():
    result = parse_arca_csv(EMITIDOS_CSV, TipoArchivoArca.emitido)
    assert len(result.filas) == 1
    assert result.filas[0].cuit_contraparte == "30691865076"
    assert result.filas[0].denominacion_contraparte == "OVAR S. A."


def test_parser_accepts_non_zero_padded_arca_date_format():
    """Real ARCA exports use D/M/YYYY (e.g. "1/7/2026"), not ISO -- the
    original sample files this suite is based on had already-normalized
    ISO dates, which masked this in production."""
    fila_fecha_arg = _FACTURA_A.replace("2026-07-02;", "1/7/2026;", 1)
    csv_content = "\n".join([_RECIBIDOS_HEADER, fila_fecha_arg])
    result = parse_arca_csv(csv_content, TipoArchivoArca.recibido)
    assert result.errores == []
    assert len(result.filas) == 1
    assert result.filas[0].fecha_emision.isoformat() == "2026-07-01"


def test_parser_skips_blank_trailing_rows_without_reporting_error():
    fila_vacia = ";" * (_RECIBIDOS_HEADER.count(";"))
    csv_content = "\n".join([_RECIBIDOS_HEADER, _FACTURA_A, fila_vacia, fila_vacia])
    result = parse_arca_csv(csv_content, TipoArchivoArca.recibido)
    assert len(result.filas) == 1
    assert result.errores == []


# --- endpoints -----------------------------------------------------------------


async def _auth(client, create_user):
    await create_user(email="gerencial@test.com", password="Password123!", role=UserRole.gerencial)
    resp = await client.post(
        "/auth/login", data={"username": "gerencial@test.com", "password": "Password123!"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_importar_recibidos_creates_pendientes_and_dedupes_on_reimport(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": ("recibidos.csv", RECIBIDOS_CSV.encode("utf-8"), "text/csv")}

    first = await client.post(
        "/finanzas/arca/importar", data={"tipo_archivo": "recibido"}, files=files, headers=headers
    )
    assert first.status_code == 201
    body = first.json()
    assert body["nuevos"] == 2
    assert body["duplicados"] == 0
    assert body["errores"] == []

    second = await client.post(
        "/finanzas/arca/importar", data={"tipo_archivo": "recibido"}, files=files, headers=headers
    )
    assert second.status_code == 201
    assert second.json()["nuevos"] == 0
    assert second.json()["duplicados"] == 2

    pendientes = await client.get(
        "/finanzas/arca/pendientes", params={"tipo_archivo": "recibido"}, headers=headers
    )
    assert len(pendientes.json()) == 2


async def test_clasificar_egreso_from_factura_uses_positive_monto(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": ("recibidos.csv", RECIBIDOS_CSV.encode("utf-8"), "text/csv")}
    await client.post("/finanzas/arca/importar", data={"tipo_archivo": "recibido"}, files=files, headers=headers)
    pendientes = (
        await client.get("/finanzas/arca/pendientes", params={"tipo_archivo": "recibido"}, headers=headers)
    ).json()
    factura = next(c for c in pendientes if not c["es_nota_credito"])

    resp = await client.post(
        f"/finanzas/arca/{factura['id']}/clasificar-egreso",
        json={
            "tipo": "insumos_varios",
            "clasificacion": "insumos_otros",
            "finca": "media_agua",
            "forma_pago": "transferencia",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    egreso = resp.json()
    assert Decimal(egreso["monto"]) == Decimal("1425450.00")
    assert egreso["origen"] == "oficial"
    assert egreso["fuente"] == "arca_csv"

    # Reclassifying the same comprobante must be rejected -- it's no longer pendiente.
    again = await client.post(
        f"/finanzas/arca/{factura['id']}/clasificar-egreso",
        json={
            "tipo": "insumos_varios",
            "clasificacion": "insumos_otros",
            "finca": "media_agua",
            "forma_pago": "transferencia",
        },
        headers=headers,
    )
    assert again.status_code == 400


async def test_clasificar_egreso_from_nota_credito_uses_negative_monto(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": ("recibidos.csv", RECIBIDOS_CSV.encode("utf-8"), "text/csv")}
    await client.post("/finanzas/arca/importar", data={"tipo_archivo": "recibido"}, files=files, headers=headers)
    pendientes = (
        await client.get("/finanzas/arca/pendientes", params={"tipo_archivo": "recibido"}, headers=headers)
    ).json()
    nc = next(c for c in pendientes if c["es_nota_credito"])

    resp = await client.post(
        f"/finanzas/arca/{nc['id']}/clasificar-egreso",
        json={
            "tipo": "insumos_varios",
            "clasificacion": "insumos_otros",
            "finca": "media_agua",
            "forma_pago": "transferencia",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert Decimal(resp.json()["monto"]) == Decimal("-61017.88")


async def test_clasificar_ingreso_marks_facturado_and_prefills_comprador(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": ("emitidos.csv", EMITIDOS_CSV.encode("utf-8"), "text/csv")}
    await client.post("/finanzas/arca/importar", data={"tipo_archivo": "emitido"}, files=files, headers=headers)
    pendientes = (
        await client.get("/finanzas/arca/pendientes", params={"tipo_archivo": "emitido"}, headers=headers)
    ).json()
    comprobante = pendientes[0]

    resp = await client.post(
        f"/finanzas/arca/{comprobante['id']}/clasificar-ingreso",
        json={"destino": "bodega", "finca": "media_agua", "forma_pago": "transferencia"},
        headers=headers,
    )
    assert resp.status_code == 201
    ingreso = resp.json()
    assert ingreso["estado"] == "facturado"
    assert ingreso["comprador"] == "OVAR S. A."
    assert ingreso["fuente"] == "arca_csv"
    assert Decimal(ingreso["monto"]) == Decimal("40409098.60")


async def test_clasificar_recibido_as_ingreso_is_rejected(client, create_user):
    """A comprobante's tipo_archivo must match the classify endpoint used --
    a recibido (purchase) can't be turned into an Ingreso."""
    headers = await _auth(client, create_user)
    files = {"file": ("recibidos.csv", RECIBIDOS_CSV.encode("utf-8"), "text/csv")}
    await client.post("/finanzas/arca/importar", data={"tipo_archivo": "recibido"}, files=files, headers=headers)
    pendientes = (
        await client.get("/finanzas/arca/pendientes", params={"tipo_archivo": "recibido"}, headers=headers)
    ).json()

    resp = await client.post(
        f"/finanzas/arca/{pendientes[0]['id']}/clasificar-ingreso",
        json={"destino": "bodega", "finca": "media_agua", "forma_pago": "transferencia"},
        headers=headers,
    )
    assert resp.status_code == 400


async def test_descartar_comprobante(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": ("recibidos.csv", RECIBIDOS_CSV.encode("utf-8"), "text/csv")}
    await client.post("/finanzas/arca/importar", data={"tipo_archivo": "recibido"}, files=files, headers=headers)
    pendientes = (
        await client.get("/finanzas/arca/pendientes", params={"tipo_archivo": "recibido"}, headers=headers)
    ).json()

    resp = await client.post(f"/finanzas/arca/{pendientes[0]['id']}/descartar", headers=headers)
    assert resp.status_code == 204

    pendientes_after = (
        await client.get("/finanzas/arca/pendientes", params={"tipo_archivo": "recibido"}, headers=headers)
    ).json()
    assert len(pendientes_after) == len(pendientes) - 1
