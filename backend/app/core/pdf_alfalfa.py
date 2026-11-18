"""Numbered alfalfa document (alta / salida) as PDF with xhtml2pdf + Jinja.

Same pattern as `pdf_remito.py`. Receives already-resolved data (no DB)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from io import BytesIO

from jinja2 import Environment, FileSystemLoader
from xhtml2pdf import pisa

from app.core.empresa import EMPRESA_CUIT, EMPRESA_DOMICILIO, EMPRESA_RAZON_SOCIAL
from app.core.pdf_carta import _link_callback
from app.core.pdf_remito import TEMPLATES_DIR, _fmt_fecha, _fmt_kg


@dataclass
class DatosAlfalfaPdf:
    titulo: str  # "Alta de alfalfa" | "Entrega de alfalfa"
    numero: str
    fecha: date
    contraparte_label: str  # "Potrero" | "Comprador"
    contraparte_nombre: str
    vehiculo_patente: str | None
    observaciones: str | None
    # (product label, quantity, kg)
    lineas: list[tuple[str, Decimal, Decimal]]
    kg_total: Decimal
    # Set when the document is annulled; rendered as an ANULADO block on top.
    anulado_el: date | None = None
    motivo_anulacion: str | None = None


def _fmt_cantidad(cantidad: Decimal) -> str:
    # Whole units without decimals (fardos), otherwise es-AR with decimals.
    if cantidad == cantidad.to_integral_value():
        return f"{int(cantidad):,}".replace(",", ".")
    return _fmt_kg(cantidad)


def render_alfalfa_html(d: DatosAlfalfaPdf) -> str:
    context = {
        "empresa": {
            "razon_social": EMPRESA_RAZON_SOCIAL,
            "cuit": EMPRESA_CUIT,
            "domicilio": EMPRESA_DOMICILIO,
        },
        "titulo": d.titulo,
        "numero": d.numero,
        "fecha": _fmt_fecha(d.fecha),
        "contraparte_label": d.contraparte_label,
        "contraparte_nombre": d.contraparte_nombre,
        "vehiculo_patente": d.vehiculo_patente,
        "observaciones": d.observaciones,
        "lineas": [
            {"producto": producto, "cantidad": _fmt_cantidad(cantidad), "kg": _fmt_kg(kg)}
            for producto, cantidad, kg in d.lineas
        ],
        "kg_total": _fmt_kg(d.kg_total),
        "anulado": (
            {"fecha": _fmt_fecha(d.anulado_el), "motivo": d.motivo_anulacion}
            if d.anulado_el is not None
            else None
        ),
    }
    # Autoescape stays ON: motivo_anulacion is free text.
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), autoescape=True)
    return env.get_template("alfalfa_documento.html").render(**context)


def generar_pdf_alfalfa(d: DatosAlfalfaPdf) -> bytes:
    html = render_alfalfa_html(d)

    result = BytesIO()
    pisa_status = pisa.CreatePDF(html, dest=result, link_callback=_link_callback)
    if pisa_status.err:
        raise RuntimeError(f"Error generando el PDF de alfalfa ({pisa_status.err} errores)")
    return result.getvalue()
