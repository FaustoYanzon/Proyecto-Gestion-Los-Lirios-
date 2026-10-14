"""PDF de lotes de pasa con xhtml2pdf + Jinja (mismo patrón que `pdf_remito.py`):

- Tarja de un bin/bolsón: media hoja A4 horizontal (A5), con los mismos datos de
  los dos lados para poder doblarla / pegarla por ambas caras.
- Hoja del lote: A4 con los datos del lote y el listado de bines.

Reciben datos ya resueltos (sin DB).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO

from jinja2 import Environment, FileSystemLoader
from xhtml2pdf import pisa

from app.core.empresa import EMPRESA_CUIT, EMPRESA_DOMICILIO, EMPRESA_RAZON_SOCIAL
from app.core.pdf_carta import _link_callback

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")

CALIDAD_LABELS = {1: "1 (buena)", 2: "2 (mala)"}


def _fmt_fecha(d: date | datetime | None) -> str:
    return d.strftime("%d/%m/%Y") if d else "—"


def _fmt_kg(kg: Decimal) -> str:
    # 1.234,50 (formato es-AR)
    return f"{kg:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


@dataclass
class DatosTarjaPdf:
    tarja: str
    fecha: date
    variedad: str
    calidad: int
    temporada: int
    lote_numero: int
    bin_numero: int
    bin_total: int | None
    kg: Decimal
    observaciones: str | None = None


@dataclass
class BinFilaPdf:
    numero: int
    tarja: str
    fecha: date
    pasero: str
    kg: Decimal
    observaciones: str | None = None


@dataclass
class DatosLotePdf:
    variedad: str
    calidad: int
    temporada: int
    numero: int
    estado: str
    deposito: str | None
    abierto_el: date
    cerrado_el: date | None
    tope_bines: int | None
    kg_total: Decimal
    kg_nominal_total: Decimal
    merma_kg: Decimal
    bines: list[BinFilaPdf] = field(default_factory=list)


def _render(template: str, context: dict) -> bytes:
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), autoescape=True)
    html = env.get_template(template).render(**context)
    result = BytesIO()
    pisa_status = pisa.CreatePDF(html, dest=result, link_callback=_link_callback)
    if pisa_status.err:
        raise RuntimeError(f"Error generando el PDF ({pisa_status.err} errores)")
    return result.getvalue()


def generar_pdf_tarja(d: DatosTarjaPdf) -> bytes:
    return _render(
        "tarja_bin.html",
        {
            "empresa": {"razon_social": EMPRESA_RAZON_SOCIAL},
            "t": {
                "tarja": d.tarja,
                "fecha": _fmt_fecha(d.fecha),
                "variedad": d.variedad,
                "calidad": CALIDAD_LABELS.get(d.calidad, str(d.calidad)),
                "lote": f"N° {d.lote_numero} · campaña {d.temporada}/{d.temporada + 1}",
                "bin": f"{d.bin_numero} de {d.bin_total}" if d.bin_total else str(d.bin_numero),
                "kg": _fmt_kg(d.kg),
                "observaciones": d.observaciones,
            },
        },
    )


def generar_pdf_lote(d: DatosLotePdf) -> bytes:
    return _render(
        "hoja_lote.html",
        {
            "empresa": {
                "razon_social": EMPRESA_RAZON_SOCIAL,
                "cuit": EMPRESA_CUIT,
                "domicilio": EMPRESA_DOMICILIO,
            },
            "l": {
                "variedad": d.variedad,
                "calidad": CALIDAD_LABELS.get(d.calidad, str(d.calidad)),
                "temporada": f"{d.temporada}/{d.temporada + 1}",
                "numero": d.numero,
                "estado": d.estado,
                "deposito": d.deposito or "—",
                "abierto_el": _fmt_fecha(d.abierto_el),
                "cerrado_el": _fmt_fecha(d.cerrado_el),
                "bines": f"{len(d.bines)} de {d.tope_bines}" if d.tope_bines else str(len(d.bines)),
                "kg_total": _fmt_kg(d.kg_total),
                "kg_nominal_total": _fmt_kg(d.kg_nominal_total),
                "merma_kg": _fmt_kg(d.merma_kg),
            },
            "filas": [
                {
                    "numero": b.numero,
                    "tarja": b.tarja,
                    "fecha": _fmt_fecha(b.fecha),
                    "pasero": b.pasero,
                    "kg": _fmt_kg(b.kg),
                    "observaciones": b.observaciones or "",
                }
                for b in d.bines
            ],
        },
    )
