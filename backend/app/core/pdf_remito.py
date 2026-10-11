"""Remito de entrega en PDF (comprobante interno, NO fiscal) con xhtml2pdf +
Jinja, mismo patrón que `pdf_carta.py`. Recibe datos ya resueltos (sin DB)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from io import BytesIO

from jinja2 import Environment, FileSystemLoader
from xhtml2pdf import pisa

from app.core.empresa import EMPRESA_CUIT, EMPRESA_DOMICILIO, EMPRESA_RAZON_SOCIAL
from app.core.pdf_carta import _link_callback

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")


@dataclass
class DatosRemitoPdf:
    numero: str
    fecha: date
    kg_total: Decimal
    # DE
    origen_propio: bool
    de_nombre: str
    variedad: str | None
    temporada: int
    # PARA
    para_tipo_label: str  # "Comprador" | "Bodega" | "Pasero"
    para_nombre: str | None
    destino_label: str
    es_pasero: bool
    lineas: list[tuple[date, str, Decimal]]
    carros: int | None = None
    fichas: int | None = None
    carro_incompleto: bool = False
    ubicacion: str | None = None
    vehiculo_patente: str | None = None
    cuadrilla: str | None = None
    acarreo: str | None = None
    n_ciu: str | None = None
    observaciones: str | None = None


def _fmt_fecha(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _fmt_kg(kg: Decimal) -> str:
    # 1.234,50 (formato es-AR)
    return f"{kg:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def generar_pdf_remito(d: DatosRemitoPdf) -> bytes:
    context = {
        "empresa": {
            "razon_social": EMPRESA_RAZON_SOCIAL,
            "cuit": EMPRESA_CUIT,
            "domicilio": EMPRESA_DOMICILIO,
        },
        "remito": {"numero": d.numero, "fecha": _fmt_fecha(d.fecha)},
        "de": {
            "propio": d.origen_propio,
            "nombre": d.de_nombre,
            "variedad": d.variedad,
            "temporada_label": f"{d.temporada}/{d.temporada + 1}",
        },
        "para": {
            "tipo_label": d.para_tipo_label,
            "nombre": d.para_nombre,
            "destino_label": d.destino_label,
            "es_pasero": d.es_pasero,
            "carros": d.carros,
            "fichas": d.fichas,
            "carro_incompleto": d.carro_incompleto,
            "ubicacion": d.ubicacion,
        },
        "lineas": [{"fecha": _fmt_fecha(f), "detalle": txt, "kg": _fmt_kg(kg)} for f, txt, kg in d.lineas],
        "kg_total": _fmt_kg(d.kg_total),
        "extra": {
            "vehiculo_patente": d.vehiculo_patente,
            "cuadrilla": d.cuadrilla,
            "acarreo": d.acarreo,
            "n_ciu": d.n_ciu,
            "observaciones": d.observaciones,
        },
    }
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), autoescape=True)
    html = env.get_template("remito_entrega.html").render(**context)

    result = BytesIO()
    pisa_status = pisa.CreatePDF(html, dest=result, link_callback=_link_callback)
    if pisa_status.err:
        raise RuntimeError(f"Error generando el PDF del remito ({pisa_status.err} errores)")
    return result.getvalue()
