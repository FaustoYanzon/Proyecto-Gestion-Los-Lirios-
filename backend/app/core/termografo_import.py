"""Parser for thermograph (BLE data-logger, "Excel_<device_id>_NNNNNN.csv")
exports. Pure parsing logic, no DB/FastAPI dependencies -- callers decode the
uploaded bytes and pass a str.

Real file layout confirmed against the user's actual export
(C:\\claude-projects\\CSV Termografo\\Excel_CD0DD0709BB6_000003.csv):

    Device Info,,,,,,
    ...
    ID:,11312494,,,,,
    ...
    Logging Interval:,900 sec,,,,,
    ...
    First Point:,04/20/2026 21:34:19,,,,,
    Stop Time:,07/21/2026 18:04:01,,,,,
    ...
    NO.,Date,DateTime,Temperature,Humidity,,
    ******,******,******,******,******,,
    1,04/20/2026,21:34:19, 20.8°C,28.0%,,
    ...

Date column is MM/DD/YYYY (4-digit year). All times are UTC-3 (declared in the header, matches the finca's own
timezone) -- combined with ZoneInfo("America/Argentina/San_Juan"), same
pattern already used in app/api/produccion.py.

The device_id used for dedupe is the filename's embedded ID (e.g.
"CD0DD0709BB6"), not the numeric "ID:" field in the header -- the header ID
is the logger's serial number, but the filename ID is what's guaranteed
present and stable across exports of the same physical device.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

FINCA_TZ = ZoneInfo("America/Argentina/San_Juan")

_LOGGING_INTERVAL_RE = re.compile(r"(\d+)\s*sec")
_DEVICE_ID_FROM_FILENAME_RE = re.compile(r"Excel_([0-9A-Fa-f]+)_\d+", re.IGNORECASE)
_DATA_HEADER_ROW = "NO."


@dataclass
class ParsedLectura:
    fecha_hora: datetime
    temperatura: Decimal
    humedad: Decimal


@dataclass
class ParseResult:
    device_id: str
    intervalo_seg: int
    filas: list[ParsedLectura]
    errores: list[str]


def device_id_from_filename(filename: str) -> str | None:
    match = _DEVICE_ID_FROM_FILENAME_RE.search(filename)
    return match.group(1) if match else None


def _parse_temperatura(raw: str) -> Decimal:
    # " 20.8°C" -> Decimal("20.8"). Device uses a plain decimal point (unlike
    # ARCA's comma-decimal Argentine formatting), confirmed against the real file.
    cleaned = raw.strip().rstrip("C").rstrip("°").strip()
    return Decimal(cleaned)


def _parse_humedad(raw: str) -> Decimal:
    cleaned = raw.strip().rstrip("%").strip()
    return Decimal(cleaned)


def _parse_fecha_hora(fecha_raw: str, hora_raw: str) -> datetime:
    # Date column is MM/DD/YYYY (4-digit year, confirmed against the real
    # export -- e.g. "04/20/2026"), DateTime column is HH:MM:SS, both in
    # FINCA_TZ (declared in the header as UTC-3). Converted to UTC right away
    # so every downstream comparison (dedup, range queries) works against a
    # single consistent representation -- SQLite (used in tests) drops
    # tzinfo on DateTime(timezone=True) round-trips, so storing/comparing in
    # a fixed zone (UTC) instead of the finca's local zone avoids silent
    # aware-vs-naive mismatches. Postgres (production) preserves the offset
    # regardless, so this is a no-op there.
    naive_local = datetime.strptime(f"{fecha_raw.strip()} {hora_raw.strip()}", "%m/%d/%Y %H:%M:%S")
    return naive_local.replace(tzinfo=FINCA_TZ).astimezone(timezone.utc)


def _extract_intervalo_seg(lines: list[str]) -> int | None:
    for line in lines:
        if line.startswith("Logging Interval:"):
            match = _LOGGING_INTERVAL_RE.search(line)
            if match:
                return int(match.group(1))
    return None


def parse_termografo_csv(content: str, filename: str) -> ParseResult:
    lines = content.splitlines()

    device_id = device_id_from_filename(filename)
    if device_id is None:
        raise ValueError(
            f"No se pudo extraer el ID del dispositivo del nombre de archivo: {filename!r}"
        )

    intervalo_seg = _extract_intervalo_seg(lines)
    if intervalo_seg is None:
        raise ValueError("No se encontró 'Logging Interval:' en la cabecera del archivo")

    # Find the real data header row ("NO.,Date,DateTime,Temperature,Humidity"),
    # then skip the "******" separator row right after it -- everything before
    # that is device metadata, not tabular data.
    header_idx = next(
        (i for i, line in enumerate(lines) if line.startswith(_DATA_HEADER_ROW)), None
    )
    if header_idx is None:
        raise ValueError("No se encontró la fila de encabezado de datos ('NO.,Date,DateTime,...')")

    data_lines = lines[header_idx + 2:]  # +1 header, +1 "******" separator
    reader = csv.reader(data_lines)

    filas: list[ParsedLectura] = []
    errores: list[str] = []
    for offset, row in enumerate(reader):
        line_no = header_idx + 3 + offset
        if not row or not row[0].strip():
            continue  # trailing blank line, not a real data row
        try:
            _no, fecha_raw, hora_raw, temp_raw, hum_raw = row[:5]
            filas.append(
                ParsedLectura(
                    fecha_hora=_parse_fecha_hora(fecha_raw, hora_raw),
                    temperatura=_parse_temperatura(temp_raw),
                    humedad=_parse_humedad(hum_raw),
                )
            )
        except (ValueError, InvalidOperation, IndexError) as exc:
            errores.append(f"Línea {line_no}: {exc}")

    return ParseResult(
        device_id=device_id, intervalo_seg=intervalo_seg, filas=filas, errores=errores
    )


def decode_csv_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("No se pudo decodificar el archivo (encoding no reconocido)")
