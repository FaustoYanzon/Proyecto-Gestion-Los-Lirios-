"""Tests for the thermograph CSV import feature: parser correctness (device
id from filename, logging interval, negative/positive temperatures, malformed
rows) and the import endpoint, including dedup on re-import.

Header layout below mirrors the real export
(C:\\claude-projects\\CSV Termografo\\Excel_CD0DD0709BB6_000003.csv) but with
a handful of synthetic data rows instead of the real ~8800, to keep the suite
fast -- confirmed manually against the real file separately (see plan
verification: first import nuevos=8847/duplicados=0, reimport
nuevos=0/duplicados=8847).
"""
from __future__ import annotations

from decimal import Decimal

from app.core.termografo_import import device_id_from_filename, parse_termografo_csv
from app.models.user import UserRole

FILENAME = "Excel_CD0DD0709BB6_000003.csv"

_HEADER = """Device Info,,,,,,
******************************,,,,,,
Device type:,BT04B,,,,,
Firmware Ver:,27,,,,,
ID:,11312494,,,,,
Start Delay:,0 min,,,,,
Logging Interval:,900 sec,,,,,
Description:,,,,,,
All Times shown are based on UTC -3:00 and 24-Hour clock [MM/DD/YY HH:MM:SS],,,,,,
,,,,,,
Logging Summary,,,,,,
******************************,,,,,,
First Point:,04/20/2026 21:34:19,,,,,
Stop Time:,07/21/2026 18:04:01,,,,,
Number of Points:,5,,,,,
Trip Lenght:,00d 01h 00m 00s ,,,,,
Start Mode:,--,,,,,
Stop Mode:,Recording,,,,,
Max:,35.2°C(Temp)/88.0%RH(Humidity),,,,,
Min:,-10.6°C(Temp)/13.0%RH(Humidity),,,,,
Avg:,8.4°C(Temp)/63.9%RH(Humidity),,,,,
MKT:,12.0°C,,,,,
,,,,,,
Mark event,,,,,,
******************************,,,,,,
N/A,,,,,,
,,,,,,
Alarm Condition    \t ,Alarm Delay    \t ,Alarm Type    \t ,First Point Time        \t ,Time of Violations        \t ,No. of Violations        \t ,Alarm Status
******,******,******,******,******,******,******
H2:N/A,,,,,,
H1:Over 100.0°C,00h 00m 00s , Single,00/00/00 00:00:00,00h 00m 00s ,0,OK
L1:Below -20.0°C,00h 00m 00s , Single,00/00/00 00:00:00,00h 00m 00s ,0,OK
L2:N/A,,,,,,
,,,,,,
NO.,Date,DateTime,Temperature,Humidity,,
******,******,******,******,******,,"""

_DATA_ROWS = [
    "1,04/20/2026,21:34:19, 20.8°C,28.0%,,",
    "2,04/20/2026,21:49:19, -1.5°C,30.0%,,",
    "3,04/20/2026,22:04:19, 31.0°C,32.0%,,",
    "4,04/20/2026,22:19:19, 18.2°C,85.0%,,",
    "5,04/20/2026,22:34:19, 17.9°C,86.0%,,",
]

FULL_CSV = _HEADER + "\n" + "\n".join(_DATA_ROWS)


# --- parser ------------------------------------------------------------------


def test_device_id_from_filename():
    assert device_id_from_filename(FILENAME) == "CD0DD0709BB6"
    assert device_id_from_filename("no-id-here.csv") is None


def test_parser_extracts_device_id_and_intervalo():
    result = parse_termografo_csv(FULL_CSV, FILENAME)
    assert result.device_id == "CD0DD0709BB6"
    assert result.intervalo_seg == 900
    assert result.errores == []


def test_parser_reads_all_rows_including_negative_and_over_30():
    result = parse_termografo_csv(FULL_CSV, FILENAME)
    assert len(result.filas) == 5
    assert result.filas[1].temperatura == Decimal("-1.5")
    assert result.filas[2].temperatura == Decimal("31.0")
    assert result.filas[0].humedad == Decimal("28.0")


def test_parser_combines_date_and_time_and_converts_finca_tz_to_utc():
    # 04/20/2026 21:34:19 en FINCA_TZ (UTC-3) == 04/21/2026 00:34:19 UTC.
    result = parse_termografo_csv(FULL_CSV, FILENAME)
    primera = result.filas[0].fecha_hora
    assert primera.utcoffset().total_seconds() == 0
    assert (primera.year, primera.month, primera.day) == (2026, 4, 21)
    assert (primera.hour, primera.minute, primera.second) == (0, 34, 19)


def test_parser_reports_malformed_row_without_dropping_the_rest():
    csv_con_error = FULL_CSV.replace("31.0°C", "NO_ES_UN_NUMERO")
    result = parse_termografo_csv(csv_con_error, FILENAME)
    assert len(result.filas) == 4
    assert len(result.errores) == 1
    assert "Línea" in result.errores[0]


def test_parser_skips_trailing_blank_lines():
    csv_con_blancos = FULL_CSV + "\n\n"
    result = parse_termografo_csv(csv_con_blancos, FILENAME)
    assert len(result.filas) == 5
    assert result.errores == []


# --- endpoint -----------------------------------------------------------------


async def _auth(client, create_user):
    await create_user(email="gerencial@test.com", password="Password123!", role=UserRole.gerencial)
    resp = await client.post(
        "/auth/login", data={"username": "gerencial@test.com", "password": "Password123!"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_importar_termografo_creates_lecturas_and_dedupes_on_reimport(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": (FILENAME, FULL_CSV.encode("utf-8"), "text/csv")}

    first = await client.post("/produccion/termografo/importar", files=files, headers=headers)
    assert first.status_code == 201
    body = first.json()
    assert body["nuevos"] == 5
    assert body["duplicados"] == 0
    assert body["errores"] == []
    assert body["lote"]["device_id"] == "CD0DD0709BB6"
    assert body["lote"]["intervalo_seg"] == 900

    second = await client.post("/produccion/termografo/importar", files=files, headers=headers)
    assert second.status_code == 201
    assert second.json()["nuevos"] == 0
    assert second.json()["duplicados"] == 5


async def test_importar_termografo_rechaza_encargado(client, create_user):
    await create_user(email="encargado@test.com", password="Password123!", role=UserRole.encargado)
    resp = await client.post(
        "/auth/login", data={"username": "encargado@test.com", "password": "Password123!"}
    )
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    files = {"file": (FILENAME, FULL_CSV.encode("utf-8"), "text/csv")}

    resp = await client.post("/produccion/termografo/importar", files=files, headers=headers)
    assert resp.status_code == 403


async def test_get_lecturas_rango_corto_devuelve_puntos_crudos(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": (FILENAME, FULL_CSV.encode("utf-8"), "text/csv")}
    await client.post("/produccion/termografo/importar", files=files, headers=headers)

    resp = await client.get(
        "/produccion/termografo/lecturas",
        params={"desde": "2026-04-20", "hasta": "2026-04-21"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["granularidad"] == "cruda"
    assert len(body["puntos"]) == 5


async def test_get_lecturas_rango_largo_agrega_por_dia(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": (FILENAME, FULL_CSV.encode("utf-8"), "text/csv")}
    await client.post("/produccion/termografo/importar", files=files, headers=headers)

    resp = await client.get(
        "/produccion/termografo/lecturas",
        params={"desde": "2026-01-01", "hasta": "2026-12-31"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["granularidad"] == "diaria"
    assert len(body["puntos"]) == 1
    dia = body["puntos"][0]
    assert dia["dia"] == "2026-04-20"
    assert Decimal(dia["temp_max"]) == Decimal("31.0")
    assert Decimal(dia["temp_min"]) == Decimal("-1.5")


async def test_get_metricas_termografo(client, create_user):
    headers = await _auth(client, create_user)
    files = {"file": (FILENAME, FULL_CSV.encode("utf-8"), "text/csv")}
    await client.post("/produccion/termografo/importar", files=files, headers=headers)

    resp = await client.get(
        "/produccion/termografo/metricas",
        params={"desde": "2026-04-20", "hasta": "2026-04-21"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cantidad_lecturas"] == 5
    assert body["horas_bajo_cero"] > 0
    assert body["horas_sobre_30"] > 0
    assert len(body["eventos_helada"]) == 1
    assert Decimal(body["eventos_helada"][0]["minima"]) == Decimal("-1.5")
