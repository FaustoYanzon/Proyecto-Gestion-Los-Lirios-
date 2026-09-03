"""Genera la carta de trazabilidad en PDF a partir de los datos ya agregados
por _fetch_historial (backend/app/api/trazabilidad.py). Motor: xhtml2pdf
(Python puro, sin dependencias de sistema tipo Pango/Cairo -- ver la nota en
el plan de la feature sobre por que se descarto WeasyPrint en este proyecto).
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from io import BytesIO
from typing import TYPE_CHECKING

from jinja2 import Environment, FileSystemLoader
from xhtml2pdf import pisa

from app.core.empresa import EMPRESA_CUIT, EMPRESA_DOMICILIO, EMPRESA_RAZON_SOCIAL

if TYPE_CHECKING:
    from app.models.parcela import Parcela
    from app.models.produccion import (
        CicloCampana,
        RegistroCosecha,
        RegistroFitosanitario,
        RegistroRiego,
        RegistroTrabajo,
    )
    from app.models.trazabilidad import AnalisisCalidad, Foto
    from app.schemas.trazabilidad import ComplianceFitosanitario

ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets")
TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")

TIPO_LABELS = {"parral": "Parral", "potrero": "Potrero", "pasero": "Pasero", "cabezal": "Cabezal"}

VARIEDAD_LABELS = {
    "flame": "Flame", "red_globe": "Red Globe", "fiesta": "Fiesta", "bonarda": "Bonarda",
    "sultanina": "Sultanina", "syrah": "Syrah", "aspirant": "Aspirant", "alfalfa": "Alfalfa",
    "otro": "Otro",
}

FINCA_LABELS = {"los_mimbres": "Los Mimbres", "media_agua": "Media Agua", "caucete": "Caucete"}

DESTINO_LABELS = {
    "MI": "Mercado Interno", "BODEGA": "Bodega", "EXPO": "Exportación", "PASAS": "Pasas",
    "RAMA_PASA": "Rama Pasa", "SEMILLA": "Semilla", "DESC": "Descarte", "FARDO": "Fardo",
}

UNIDAD_LABELS = {
    "dias": "días", "plantas": "plantas", "melgas": "melgas", "metros": "metros",
    "vines": "vines", "cajas": "cajas", "gamelas": "gamelas", "otros": "otros",
}

ORIGEN_ANALISIS_LABELS = {"propio": "Medición propia", "laboratorio": "Informe de laboratorio"}

ESTADO_SANITARIO_LABELS = {
    "sano": "Sano", "con_observaciones": "Con observaciones", "rechazado": "Rechazado",
}

COMPLIANCE_LABELS = {"cumplido": "Cumplido", "incumplido": "Incumplido", "pendiente": "Pendiente"}
COMPLIANCE_ROW_CLASS = {
    "cumplido": "fila-cumplido", "incumplido": "fila-incumplido", "pendiente": "fila-pendiente",
}


def _fmt_fecha(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _resumen_tareas(trabajos: list[RegistroTrabajo]) -> list[dict]:
    """Agrupa las tareas por (tarea, unidad_medida) -- la carta muestra
    totales, no el listado evento por evento (decision explicita: en pantalla
    si se ve completo, en el PDF de presentacion no tiene sentido)."""
    grupos: dict[tuple[str, str], dict] = {}
    for t in trabajos:
        unidad = t.unidad_medida.value if hasattr(t.unidad_medida, "value") else str(t.unidad_medida)
        clave = (t.tarea, unidad)
        if clave not in grupos:
            grupos[clave] = {"tarea": t.tarea, "unidad": UNIDAD_LABELS.get(unidad, unidad), "registros": 0, "cantidad_total": 0}
        grupos[clave]["registros"] += 1
        grupos[clave]["cantidad_total"] += float(t.cantidad)
    return sorted(grupos.values(), key=lambda g: (g["tarea"], g["unidad"]))


def _link_callback(uri: str, _rel: str) -> str:
    if uri.startswith("http://") or uri.startswith("https://"):
        return uri
    return os.path.join(ASSETS_DIR, os.path.basename(uri))


def generar_pdf_carta(
    *,
    parcela: Parcela,
    riegos: list[RegistroRiego],
    fitosanitarios: list[RegistroFitosanitario],
    trabajos: list[RegistroTrabajo],
    cosechas: list[RegistroCosecha],
    fotos: list[Foto],
    analisis: list[AnalisisCalidad],
    compliance: list[ComplianceFitosanitario],
    desde: date,
    hasta: date,
    generado_por: str,
) -> bytes:
    compliance_por_id = {c.fitosanitario_id: c for c in compliance}

    fitosanitarios_ctx = []
    for f in fitosanitarios:
        c = compliance_por_id.get(f.id)
        estado = c.estado if c else "pendiente"
        fitosanitarios_ctx.append({
            "fecha": _fmt_fecha(f.fecha),
            "producto_nombre": f.producto_nombre,
            "dosis_lt_ha": f.dosis_lt_ha,
            "dias_carencia": f.dias_carencia,
            "fecha_habilitacion_cosecha": _fmt_fecha(f.fecha_habilitacion_cosecha),
            "dias_reingreso": f.dias_reingreso,
            "fecha_habilitacion_reingreso": _fmt_fecha(f.fecha_habilitacion_reingreso),
            "responsable": f.responsable,
            "estado_label": COMPLIANCE_LABELS[estado],
            "row_class": COMPLIANCE_ROW_CLASS[estado],
        })

    kg_total = sum(c.kg_total for c in cosechas)
    litros_riego_total = sum(r.litros_aplicados for r in riegos)
    mm_riego_total = sum(r.mm_aplicados or 0 for r in riegos)
    fitos_cumplidos = sum(1 for c in compliance if c.estado == "cumplido")
    fitos_pendientes = sum(1 for c in compliance if c.estado == "pendiente")
    fitos_incumplidos = sum(1 for c in compliance if c.estado == "incumplido")

    context = {
        "empresa": {
            "razon_social": EMPRESA_RAZON_SOCIAL,
            "cuit": EMPRESA_CUIT,
            "domicilio": EMPRESA_DOMICILIO,
        },
        "parcela": {
            "nombre": parcela.nombre,
            "tipo_label": TIPO_LABELS.get(parcela.tipo.value, parcela.tipo.value),
            "variedad_label": VARIEDAD_LABELS.get(parcela.variedad.value, parcela.variedad.value) if parcela.variedad else None,
            "superficie_ha": parcela.superficie_ha,
            "finca_label": FINCA_LABELS.get(parcela.finca.value, parcela.finca.value) if parcela.finca else None,
        },
        "desde": _fmt_fecha(desde),
        "hasta": _fmt_fecha(hasta),
        "generado_por": generado_por,
        "generado_en": datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC"),
        "resumen": {
            "kg_total": round(kg_total, 1),
            "litros_riego_total": round(litros_riego_total),
            "mm_riego_total": round(mm_riego_total, 1),
            "fitos_cumplidos": fitos_cumplidos,
            "fitos_pendientes": fitos_pendientes,
            "fitos_incumplidos": fitos_incumplidos,
        },
        "riegos": [{
            "fecha": _fmt_fecha(r.fecha), "cabezal": r.cabezal, "valvula": r.valvula,
            "mm_aplicados": r.mm_aplicados, "litros_aplicados": round(r.litros_aplicados),
            "responsable": r.responsable,
        } for r in riegos],
        "fitosanitarios": fitosanitarios_ctx,
        "cosechas": [{
            "fecha": _fmt_fecha(c.fecha), "kg_total": c.kg_total,
            "destino_label": DESTINO_LABELS.get(c.destino.value, c.destino.value),
            "comprador": c.comprador, "n_remito": c.n_remito,
        } for c in cosechas],
        "tareas_resumen": _resumen_tareas(trabajos),
        "analisis": [{
            "fecha": _fmt_fecha(a.fecha),
            "origen_label": ORIGEN_ANALISIS_LABELS[a.origen.value],
            "brix": a.brix, "acidez": a.acidez, "ph": a.ph,
            "estado_sanitario_label": ESTADO_SANITARIO_LABELS.get(a.estado_sanitario.value) if a.estado_sanitario else None,
            "laboratorio_nombre": a.laboratorio_nombre,
            "informe_url": a.informe_url,
        } for a in analisis],
        "fotos": [{"url": f.url, "categoria": f.categoria, "fecha": _fmt_fecha(f.fecha)} for f in fotos],
    }

    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), autoescape=True)
    template = env.get_template("carta_trazabilidad.html")
    html = template.render(**context)

    result = BytesIO()
    pisa_status = pisa.CreatePDF(html, dest=result, link_callback=_link_callback)
    if pisa_status.err:
        raise RuntimeError(f"Error generando el PDF de trazabilidad ({pisa_status.err} errores)")
    return result.getvalue()
