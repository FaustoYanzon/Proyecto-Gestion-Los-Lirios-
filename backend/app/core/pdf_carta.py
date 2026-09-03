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

from app.core import labels
from app.core.empresa import EMPRESA_CUIT, EMPRESA_DOMICILIO, EMPRESA_RAZON_SOCIAL
from app.core.qr import generar_qr_data_uri

if TYPE_CHECKING:
    from app.models.parcela import Parcela
    from app.models.produccion import RegistroCosecha, RegistroFitosanitario, RegistroRiego
    from app.models.trazabilidad import AnalisisCalidad, Foto
    from app.schemas.trazabilidad import (
        ComplianceFitosanitario,
        CumplimientoEstadoItem,
        ResumenDestinoItem,
        TareaResumenItem,
    )

ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets")
TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")

COMPLIANCE_ROW_CLASS = {
    "cumplido": "fila-cumplido", "incumplido": "fila-incumplido", "pendiente": "fila-pendiente",
}


def _fmt_fecha(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _link_callback(uri: str, _rel: str) -> str:
    # Los data: URIs (el QR va embebido asi) ya traen la imagen adentro --
    # xhtml2pdf los resuelve solo, no hay que tocarlos. Sin este early return
    # caerian en el os.path.join de abajo y se buscaria un archivo llamado
    # como la cola del base64 -> el QR no se dibujaba (bug real de la Fase 3).
    if uri.startswith(("http://", "https://", "data:")):
        return uri
    return os.path.join(ASSETS_DIR, os.path.basename(uri))


def generar_pdf_carta(
    *,
    parcela: Parcela,
    riegos: list[RegistroRiego],
    fitosanitarios: list[RegistroFitosanitario],
    cosechas: list[RegistroCosecha],
    fotos: list[Foto],
    analisis: list[AnalisisCalidad],
    compliance: list[ComplianceFitosanitario],
    parcela_variedad_descripcion: str | None,
    parcela_centroide: tuple[float, float] | None,
    parcela_tipo_riego: str | None,
    parcela_cobertura_invierno: str | None,
    cumplimiento_riego_por_estado: list[CumplimientoEstadoItem],
    resumen_destino: list[ResumenDestinoItem],
    tareas_resumen: list[TareaResumenItem],
    horas_de_frio: float | None,
    mm_objetivo_anual: float,
    meta_produccion_kg: float | None,
    desde: date,
    hasta: date,
    generado_por: str,
    publico: bool = False,
    publico_url: str | None = None,
) -> bytes:
    # `publico=True`: la carta se sirve desde el enlace publico sin login, asi
    # que se omiten los datos internos (responsable de riego/fito, comprador de
    # cosecha) -- un `if publico` puntual en las comprehensions de abajo, no un
    # context paralelo. `publico_url` (tipicamente en la descarga interna,
    # cuando ya existe un enlace activo para ese rango) hace que se embeba el
    # QR de esa pagina publica.
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
            "responsable": None if publico else f.responsable,
            "estado_label": labels.COMPLIANCE_LABELS[estado],
            "row_class": COMPLIANCE_ROW_CLASS[estado],
        })

    kg_total = sum(c.kg_total for c in cosechas)
    litros_riego_total = sum(r.litros_aplicados for r in riegos)
    mm_riego_total = sum(r.mm_aplicados or 0 for r in riegos)
    fitos_cumplidos = sum(1 for c in compliance if c.estado == "cumplido")
    fitos_pendientes = sum(1 for c in compliance if c.estado == "pendiente")
    fitos_incumplidos = sum(1 for c in compliance if c.estado == "incumplido")

    context = {
        "publico": publico,
        "qr_data_uri": generar_qr_data_uri(publico_url) if publico_url else None,
        "publico_url": publico_url,
        "empresa": {
            "razon_social": EMPRESA_RAZON_SOCIAL,
            "cuit": EMPRESA_CUIT,
            "domicilio": EMPRESA_DOMICILIO,
        },
        "parcela": {
            "nombre": parcela.nombre,
            "tipo_label": labels.TIPO_LABELS.get(parcela.tipo.value, parcela.tipo.value),
            "variedad_label": parcela.variedad.value.replace("_", " ").title() if parcela.variedad else None,
            "variedad_descripcion": parcela_variedad_descripcion,
            "superficie_ha": parcela.superficie_ha,
            "finca_label": labels.FINCA_LABELS.get(parcela.finca.value, parcela.finca.value) if parcela.finca else None,
            "tipo_riego": parcela_tipo_riego,
            "cobertura_invierno": parcela_cobertura_invierno,
            "ubicacion": f"{parcela_centroide[0]}, {parcela_centroide[1]}" if parcela_centroide else None,
            "maps_url": (
                f"https://www.google.com/maps?q={parcela_centroide[0]},{parcela_centroide[1]}"
                if parcela_centroide else None
            ),
        },
        "desde": _fmt_fecha(desde),
        "hasta": _fmt_fecha(hasta),
        "generado_por": generado_por,
        "generado_en": datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC"),
        "resumen": {
            "kg_total": round(kg_total, 1),
            "meta_produccion_kg": meta_produccion_kg,
            "pct_meta_produccion": (
                round(kg_total / meta_produccion_kg * 100, 1) if meta_produccion_kg else None
            ),
            "litros_riego_total": round(litros_riego_total),
            "mm_riego_total": round(mm_riego_total, 1),
            "mm_objetivo_anual": mm_objetivo_anual,
            "pct_objetivo_riego": (
                round(mm_riego_total / mm_objetivo_anual * 100, 1) if mm_objetivo_anual else None
            ),
            "horas_de_frio": horas_de_frio,
            "fitos_cumplidos": fitos_cumplidos,
            "fitos_pendientes": fitos_pendientes,
            "fitos_incumplidos": fitos_incumplidos,
        },
        "riegos": [{
            "fecha": _fmt_fecha(r.fecha), "cabezal": r.cabezal, "valvula": r.valvula,
            "mm_aplicados": r.mm_aplicados, "litros_aplicados": round(r.litros_aplicados),
            "responsable": None if publico else r.responsable,
        } for r in riegos],
        "fitosanitarios": fitosanitarios_ctx,
        "cosechas": [{
            "fecha": _fmt_fecha(c.fecha), "kg_total": c.kg_total,
            "destino_label": labels.DESTINO_LABELS.get(c.destino.value, c.destino.value),
            "comprador": None if publico else c.comprador, "n_remito": c.n_remito,
        } for c in cosechas],
        "tareas_resumen": [{
            "tarea": t.tarea,
            "fecha_inicio": _fmt_fecha(t.fecha_inicio), "fecha_fin": _fmt_fecha(t.fecha_fin),
            "registros": t.registros,
        } for t in tareas_resumen],
        "riego_por_estado": [{
            "estado_label": e.estado_campana_label,
            "fecha_inicio": _fmt_fecha(e.fecha_inicio), "fecha_fin": _fmt_fecha(e.fecha_fin),
            "riegos_esperados": e.riegos_esperados, "mm_aplicados": e.mm_aplicados,
            "cumplimiento_pct": e.cumplimiento_pct,
            "row_class": "fila-cumplido" if e.cumplido else "fila-incumplido",
        } for e in cumplimiento_riego_por_estado],
        "destino_resumen": [{
            "destino_label": d.destino_label, "kg_total": d.kg_total,
            "n_registros": d.n_registros, "pct_del_total": d.pct_del_total,
        } for d in resumen_destino],
        "analisis": [{
            "fecha": _fmt_fecha(a.fecha),
            "origen_label": labels.ORIGEN_ANALISIS_LABELS[a.origen.value],
            "brix": a.brix, "acidez": a.acidez, "ph": a.ph,
            "estado_sanitario_label": labels.ESTADO_SANITARIO_LABELS.get(a.estado_sanitario.value) if a.estado_sanitario else None,
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
