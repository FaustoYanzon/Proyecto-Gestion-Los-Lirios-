"""Parser for ARCA (ex-AFIP) "Mis Comprobantes" CSV exports.

Two file types share almost the same layout: recibidos (purchases, the
counterparty is the "Emisor" columns) and emitidos (sales, the counterparty
is the "Receptor" columns). Pure parsing logic, no DB/FastAPI dependencies --
callers decode the uploaded bytes and pass a str.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

from app.models.arca import TipoArchivoArca

# AFIP "tipo de comprobante" catalog (RG 1415 / WSFE), code -> (descripcion, es_nota_credito).
# A code missing here is treated as an error row rather than guessed -- getting
# the nota-de-credito sign wrong silently corrupts the IVA totals.
TIPOS_COMPROBANTE: dict[int, tuple[str, bool]] = {
    1: ("Factura A", False),
    2: ("Nota de Débito A", False),
    3: ("Nota de Crédito A", True),
    4: ("Recibo A", False),
    5: ("Nota de Venta al Contado A", False),
    6: ("Factura B", False),
    7: ("Nota de Débito B", False),
    8: ("Nota de Crédito B", True),
    9: ("Recibo B", False),
    10: ("Nota de Venta al Contado B", False),
    11: ("Factura C", False),
    12: ("Nota de Débito C", False),
    13: ("Nota de Crédito C", True),
    15: ("Recibo C", False),
    19: ("Factura de Exportación", False),
    20: ("Nota de Débito por Operaciones con el Exterior", False),
    21: ("Nota de Crédito por Operaciones con el Exterior", True),
    39: ("Otros comprobantes A (RG 3419)", False),
    40: ("Otros comprobantes B (RG 3419)", False),
    41: ("Otros comprobantes C (RG 3419)", False),
    51: ("Factura M", False),
    52: ("Nota de Débito M", False),
    53: ("Nota de Crédito M", True),
    54: ("Recibo M", False),
    60: ("Cuenta de Venta y Líquido Producto A", False),
    61: ("Cuenta de Venta y Líquido Producto B", False),
    63: ("Liquidación A", False),
    64: ("Liquidación B", False),
    81: ("Tique Factura A", False),
    82: ("Tique Factura B", False),
    83: ("Tique", False),
    110: ("Tique Nota de Crédito", True),
    111: ("Tique Nota de Crédito A", True),
    112: ("Tique Nota de Crédito B", True),
    113: ("Tique Nota de Crédito C", True),
    118: ("Tique Nota de Débito", False),
    201: ("Factura de Crédito Electrónica MiPyME A", False),
    202: ("Nota de Débito Electrónica MiPyME A", False),
    203: ("Nota de Crédito Electrónica MiPyME A", True),
    206: ("Factura de Crédito Electrónica MiPyME B", False),
    207: ("Nota de Débito Electrónica MiPyME B", False),
    208: ("Nota de Crédito Electrónica MiPyME B", True),
    211: ("Factura de Crédito Electrónica MiPyME C", False),
    212: ("Nota de Débito Electrónica MiPyME C", False),
    213: ("Nota de Crédito Electrónica MiPyME C", True),
}

_MONEDA_MAP = {"$": "ars", "u$s": "usd", "US$": "usd", "USD": "usd"}


@dataclass
class ParsedComprobante:
    fecha_emision: date
    tipo_comprobante: int
    tipo_comprobante_desc: str
    es_nota_credito: bool
    punto_venta: int
    numero_desde: int
    numero_hasta: int
    cod_autorizacion: str | None
    cuit_contraparte: str
    denominacion_contraparte: str
    moneda: str
    tipo_cambio: Decimal
    imp_neto_gravado_total: Decimal
    imp_no_gravado: Decimal
    imp_exentas: Decimal
    otros_tributos: Decimal
    total_iva: Decimal
    imp_total: Decimal


@dataclass
class ParseResult:
    filas: list[ParsedComprobante]
    errores: list[str]


def _parse_decimal(raw: str) -> Decimal:
    raw = raw.strip()
    if raw == "":
        return Decimal("0")
    # Argentine formatting: '.' thousands separator, ',' decimal separator.
    return Decimal(raw.replace(".", "").replace(",", "."))


def _parse_fecha(raw: str) -> date:
    raw = raw.strip()
    if "-" in raw:
        return date.fromisoformat(raw)
    # ARCA's "Mis Comprobantes" export uses D/M/YYYY, not necessarily
    # zero-padded (e.g. "1/7/2026").
    day, month, year = raw.split("/")
    return date(int(year), int(month), int(day))


def _parse_moneda(raw: str) -> str:
    key = raw.strip()
    if key not in _MONEDA_MAP:
        raise ValueError(f"moneda no reconocida: {key!r}")
    return _MONEDA_MAP[key]


def parse_arca_csv(content: str, tipo_archivo: TipoArchivoArca) -> ParseResult:
    reader = csv.DictReader(io.StringIO(content), delimiter=";")
    cuit_field = "Nro. Doc. Emisor" if tipo_archivo == TipoArchivoArca.recibido else "Nro. Doc. Receptor"
    denom_field = "Denominación Emisor" if tipo_archivo == TipoArchivoArca.recibido else "Denominación Receptor"

    filas: list[ParsedComprobante] = []
    errores: list[str] = []

    for i, row in enumerate(reader, start=2):  # start=2: header is line 1
        # Trailing/blank lines in the export (no comprobante data at all) --
        # skip silently rather than reporting a confusing error for a row
        # that was never a real comprobante to begin with.
        if not row.get("Tipo de Comprobante", "").strip():
            continue
        try:
            tipo_comprobante = int(row["Tipo de Comprobante"])
            catalogo = TIPOS_COMPROBANTE.get(tipo_comprobante)
            if catalogo is None:
                errores.append(
                    f"Línea {i}: tipo de comprobante desconocido ({tipo_comprobante}), no importada"
                )
                continue
            tipo_comprobante_desc, es_nota_credito = catalogo

            filas.append(
                ParsedComprobante(
                    fecha_emision=_parse_fecha(row["Fecha de Emisión"]),
                    tipo_comprobante=tipo_comprobante,
                    tipo_comprobante_desc=tipo_comprobante_desc,
                    es_nota_credito=es_nota_credito,
                    punto_venta=int(row["Punto de Venta"]),
                    numero_desde=int(row["Número Desde"]),
                    numero_hasta=int(row["Número Hasta"]),
                    cod_autorizacion=row["Cód. Autorización"].strip() or None,
                    cuit_contraparte=row[cuit_field].strip(),
                    denominacion_contraparte=row[denom_field].strip(),
                    moneda=_parse_moneda(row["Moneda"]),
                    tipo_cambio=_parse_decimal(row["Tipo Cambio"]) or Decimal("1"),
                    imp_neto_gravado_total=_parse_decimal(row["Imp. Neto Gravado Total"]),
                    imp_no_gravado=_parse_decimal(row["Imp. Neto No Gravado"]),
                    imp_exentas=_parse_decimal(row["Imp. Op. Exentas"]),
                    otros_tributos=_parse_decimal(row["Otros Tributos"]),
                    total_iva=_parse_decimal(row["Total IVA"]),
                    imp_total=_parse_decimal(row["Imp. Total"]),
                )
            )
        except (KeyError, ValueError, InvalidOperation) as exc:
            errores.append(f"Línea {i}: {exc}")

    return ParseResult(filas=filas, errores=errores)


def decode_csv_bytes(raw: bytes) -> str:
    """ARCA exports are usually UTF-8 (with BOM); fall back to latin-1 for
    older/locale-affected exports rather than failing the whole import."""
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("No se pudo decodificar el archivo (encoding no reconocido)")
