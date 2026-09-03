import secrets
from dataclasses import dataclass
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from app.api.deps import get_db, require_any_role, require_encargado_up, require_gerencial_up
from app.core import ciclo_campana, labels, termografo_metrics
from app.core.cloudinary_client import upload_foto_parcela, upload_informe_analisis
from app.core.config import settings
from app.core.empresa import EMPRESA_CUIT, EMPRESA_DOMICILIO, EMPRESA_RAZON_SOCIAL
from app.core.geo import centroide_poligono
from app.core.pdf_carta import generar_pdf_carta
from app.core.termografo_import import FINCA_TZ
from app.core.variedades import VARIEDAD_DESCRIPCIONES
from app.models.parcela import Parcela
from app.models.presupuesto import MetaProduccion
from app.models.produccion import (
    CicloCampana,
    RegistroCosecha,
    RegistroFitosanitario,
    RegistroRiego,
    RegistroTrabajo,
)
from app.models.termografo import LecturaTermografo
from app.models.trazabilidad import (
    AnalisisCalidad,
    EnlacePublico,
    EstadoSanitarioAnalisis,
    Foto,
    OrigenAnalisis,
)
from app.models.user import User
from app.schemas.trazabilidad import (
    AnalisisCalidadCreate,
    AnalisisCalidadResponse,
    AnalisisPublicoItem,
    CentroideItem,
    ComplianceFitosanitario,
    CumplimientoEstadoItem,
    EmpresaItem,
    EnlacePublicoCreate,
    EnlacePublicoResponse,
    FitosanitarioPublicoItem,
    FotoCreate,
    FotoPublicaItem,
    FotoResponse,
    HistorialParcelaResponse,
    HistorialPublicoResponse,
    ResumenDestinoItem,
    ResumenPublicoItem,
    TareaResumenItem,
)

router = APIRouter(prefix="/trazabilidad", tags=["Trazabilidad"])


def _url_publica(token: str) -> str:
    return f"{settings.PUBLIC_BASE_URL}/trazabilidad/publica/{token}"

# 1mm sobre 1ha = 10.000 L -- el objetivo en mm no depende de la superficie.
# Mismo valor que ya usan el mapa web/mobile (LITROS_OBJETIVO_ANUAL_POR_HA /
# 10_000), derivado de la constante del modelo en vez de un numero suelto.
MM_OBJETIVO_ANUAL = RegistroRiego.LITROS_OBJETIVO_ANUAL_POR_HA / 10_000


# ── Aggregador ──────────────────────────────────────────────────────────────

@dataclass
class HistorialData:
    """Resultado de _fetch_historial -- compartido entre el endpoint JSON y
    el de PDF, para no duplicar las queries ni los calculos (semaforo de
    carencia, cumplimiento de riego por estado, resumen de tareas/destino)
    en dos lugares."""

    parcela: Parcela
    riegos: list[RegistroRiego]
    fitosanitarios: list[RegistroFitosanitario]
    trabajos: list[RegistroTrabajo]
    cosechas: list[RegistroCosecha]
    ciclos_campana: list[CicloCampana]
    fotos: list[Foto]
    analisis_calidad: list[AnalisisCalidad]
    compliance_fitosanitarios: list[ComplianceFitosanitario]
    parcela_variedad_descripcion: str | None
    parcela_centroide: tuple[float, float] | None
    parcela_tipo_riego: str | None
    parcela_cobertura_invierno: str | None
    cumplimiento_riego_por_estado: list[CumplimientoEstadoItem]
    resumen_destino: list[ResumenDestinoItem]
    tareas_resumen: list[TareaResumenItem]
    horas_de_frio: float | None
    meta_produccion_kg: float | None


async def _get_parcela_or_404(db: AsyncSession, parcela_id: str) -> Parcela:
    parcela = (await db.execute(
        select(Parcela).where(Parcela.id == parcela_id)
    )).scalar_one_or_none()
    if parcela is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcela not found")
    return parcela

async def _calcular_compliance(
    db: AsyncSession, parcela_id: str, fitosanitarios: list[RegistroFitosanitario],
) -> list[ComplianceFitosanitario]:
    """Para cada aplicacion fitosanitaria, compara su fecha_habilitacion_cosecha
    contra las cosechas reales de la parcela (sin acotar por el rango
    consultado -- una cosecha posterior igual define si la aplicacion se
    cumplio). A diferencia de /produccion/fitosanitarios/alertas/carencia
    (que solo compara contra la fecha de hoy), esto evalua el resultado real.
    """
    resultado: list[ComplianceFitosanitario] = []
    for fito in fitosanitarios:
        cosechas = (await db.execute(
            select(RegistroCosecha)
            .where(
                RegistroCosecha.parcela_id == parcela_id,
                RegistroCosecha.fecha >= fito.fecha,
            )
            .order_by(RegistroCosecha.fecha)
        )).scalars().all()

        conflictivas = [c for c in cosechas if c.fecha < fito.fecha_habilitacion_cosecha]
        if conflictivas:
            estado = "incumplido"
            conflictiva = conflictivas[0]
            conflictiva_id, conflictiva_fecha = conflictiva.id, conflictiva.fecha
        elif cosechas:
            estado = "cumplido"
            conflictiva_id, conflictiva_fecha = None, None
        else:
            estado = "pendiente"
            conflictiva_id, conflictiva_fecha = None, None

        resultado.append(ComplianceFitosanitario(
            fitosanitario_id=fito.id,
            fecha_aplicacion=fito.fecha,
            producto_nombre=fito.producto_nombre,
            fecha_habilitacion_cosecha=fito.fecha_habilitacion_cosecha,
            estado=estado,
            cosecha_conflictiva_id=conflictiva_id,
            cosecha_conflictiva_fecha=conflictiva_fecha,
        ))
    return resultado


def _cumplimiento_riego_por_estado(
    riegos: list[RegistroRiego], desde: date, hasta: date,
) -> list[CumplimientoEstadoItem]:
    """Cumplimiento de riego por CADA estado de campaña que cayo dentro del
    rango elegido -- a diferencia de /produccion/estado-campana/cumplimiento-riego,
    que solo resuelve el estado vigente hoy. Reusa los `riegos` ya traidos por
    _fetch_historial, no dispara queries nuevas."""
    items: list[CumplimientoEstadoItem] = []
    for estado, v_desde, v_hasta in ciclo_campana.ventanas_en_rango(desde, hasta):
        mm = sum(r.mm_aplicados or 0.0 for r in riegos if v_desde <= r.fecha <= v_hasta)
        esperados = ciclo_campana.riegos_esperados(estado)
        equivalentes = round(mm / ciclo_campana.MM_POR_RIEGO_ESTANDAR, 2)
        pct = round(equivalentes / esperados * 100, 1) if esperados else 0.0
        items.append(CumplimientoEstadoItem(
            estado_campana=estado,
            estado_campana_label=ciclo_campana.ESTADO_CAMPANA_LABELS[estado],
            fecha_inicio=v_desde,
            fecha_fin=v_hasta,
            riegos_esperados=esperados,
            mm_aplicados=round(mm, 1),
            riegos_equivalentes=equivalentes,
            cumplimiento_pct=pct,
            cumplido=pct >= 100,
        ))
    return items


def _resumen_destino(cosechas: list[RegistroCosecha]) -> list[ResumenDestinoItem]:
    """Agrupa las cosechas ya traidas por destino -- mismo patron que
    cosecha_totales en app/api/produccion.py (agrupar por destino.value, sumar
    kg, contar filas), con el agregado del porcentaje sobre el total."""
    por_destino: dict[str, dict] = {}
    kg_total_general = 0.0
    for c in cosechas:
        d = por_destino.setdefault(c.destino.value, {"kg": 0.0, "n": 0})
        d["kg"] += c.kg_total
        d["n"] += 1
        kg_total_general += c.kg_total

    items = [
        ResumenDestinoItem(
            destino=destino,
            destino_label=labels.DESTINO_LABELS.get(destino, destino),
            kg_total=round(v["kg"], 2),
            n_registros=v["n"],
            pct_del_total=round(v["kg"] / kg_total_general * 100, 1) if kg_total_general else 0.0,
        )
        for destino, v in por_destino.items()
    ]
    return sorted(items, key=lambda i: i.kg_total, reverse=True)


def _tareas_resumen(trabajos: list[RegistroTrabajo]) -> list[TareaResumenItem]:
    """Agrupa las tareas ya traidas por (tarea, unidad_medida) -- primer y
    ultimo registro + cantidad, sin sumar cantidades (a diferencia de un
    resumen anterior que sumaba `cantidad`, sacado a pedido explicito).
    Usado tanto por la pantalla (Timeline) como por el PDF -- un solo calculo,
    no dos implementaciones que se puedan desincronizar."""
    grupos: dict[tuple[str, str], dict] = {}
    for t in trabajos:
        unidad = t.unidad_medida.value if hasattr(t.unidad_medida, "value") else str(t.unidad_medida)
        clave = (t.tarea, unidad)
        g = grupos.setdefault(clave, {
            "tarea": t.tarea, "unidad": unidad, "fecha_inicio": t.fecha, "fecha_fin": t.fecha, "registros": 0,
        })
        g["fecha_inicio"] = min(g["fecha_inicio"], t.fecha)
        g["fecha_fin"] = max(g["fecha_fin"], t.fecha)
        g["registros"] += 1

    items = [
        TareaResumenItem(
            tarea=g["tarea"],
            unidad_medida_label=labels.UNIDAD_LABELS.get(g["unidad"], g["unidad"]),
            fecha_inicio=g["fecha_inicio"],
            fecha_fin=g["fecha_fin"],
            registros=g["registros"],
        )
        for g in grupos.values()
    ]
    return sorted(items, key=lambda i: (i.fecha_inicio, i.tarea))


async def _horas_de_frio(db: AsyncSession, desde: date, hasta: date) -> float | None:
    """Horas de frio (0-7 C) del periodo, sobre las lecturas del termografo
    de campo -- dato de TODA la finca, no de la parcela puntual (un solo
    dispositivo mide el clima general, ver app/models/termografo.py). None si
    no hay lecturas cargadas en el rango (distinto de "0 horas")."""
    inicio = datetime.combine(desde, time.min, tzinfo=FINCA_TZ).astimezone(timezone.utc)
    fin = datetime.combine(hasta, time.max, tzinfo=FINCA_TZ).astimezone(timezone.utc)
    filas = (await db.execute(
        select(LecturaTermografo)
        .where(LecturaTermografo.fecha_hora >= inicio, LecturaTermografo.fecha_hora <= fin)
        .order_by(LecturaTermografo.fecha_hora)
    )).scalars().all()
    if not filas:
        return None

    # SQLite (tests) descarta el tzinfo al guardar una columna DateTime(timezone=True);
    # Postgres (produccion) lo preserva. Mismo criterio que termografo.py:_como_utc.
    lecturas = [
        termografo_metrics.Lectura(
            fecha_hora=f.fecha_hora if f.fecha_hora.tzinfo is not None else f.fecha_hora.replace(tzinfo=timezone.utc),
            temperatura=f.temperatura,
            humedad=f.humedad,
        )
        for f in filas
    ]
    intervalo = termografo_metrics.intervalo_efectivo_seg(lecturas)
    return round(termografo_metrics.horas_de_frio(lecturas, intervalo), 1)


async def _meta_produccion_kg(db: AsyncSession, parcela_id: str, desde: date) -> float | None:
    temporada = desde.year if desde.month >= 5 else desde.year - 1
    meta = (await db.execute(
        select(MetaProduccion).where(
            MetaProduccion.parcela_id == parcela_id, MetaProduccion.temporada == temporada,
        )
    )).scalar_one_or_none()
    return float(meta.kg_plan) if meta is not None else None


async def _fetch_historial(
    db: AsyncSession, parcela: Parcela, desde: date, hasta: date,
) -> HistorialData:
    parcela_id = parcela.id

    # Consultas directas al ORM, sin limit -- los endpoints de lista de
    # /produccion truncan en 100 (max 1000) filas incluso filtrados por
    # parcela, no sirven para traer el historial completo de una campaña.
    # Excluye riegos en curso (fin IS NULL) -- mismo criterio que GET
    # /produccion/riego/, duracion_horas/litros_aplicados no tienen sentido
    # todavia para un registro sin terminar.
    riegos = (await db.execute(
        select(RegistroRiego)
        .where(
            RegistroRiego.parcela_id == parcela_id,
            RegistroRiego.fecha.between(desde, hasta),
            RegistroRiego.fin.is_not(None),
        )
        .order_by(RegistroRiego.fecha)
    )).scalars().all()

    fitosanitarios = (await db.execute(
        select(RegistroFitosanitario)
        .where(
            RegistroFitosanitario.parcela_id == parcela_id,
            RegistroFitosanitario.fecha.between(desde, hasta),
        )
        .order_by(RegistroFitosanitario.fecha)
    )).scalars().all()

    trabajos = (await db.execute(
        select(RegistroTrabajo)
        .where(RegistroTrabajo.parcela_id == parcela_id, RegistroTrabajo.fecha.between(desde, hasta))
        .order_by(RegistroTrabajo.fecha)
    )).scalars().all()

    cosechas = (await db.execute(
        select(RegistroCosecha)
        .where(RegistroCosecha.parcela_id == parcela_id, RegistroCosecha.fecha.between(desde, hasta))
        .order_by(RegistroCosecha.fecha)
    )).scalars().all()

    ciclos = (await db.execute(
        select(CicloCampana)
        .where(CicloCampana.parcela_id == parcela_id, CicloCampana.fecha_estado.between(desde, hasta))
        .order_by(CicloCampana.fecha_estado)
    )).scalars().all()

    fotos = (await db.execute(
        select(Foto)
        .where(Foto.parcela_id == parcela_id, Foto.fecha.between(desde, hasta))
        .order_by(Foto.fecha)
    )).scalars().all()

    analisis = (await db.execute(
        select(AnalisisCalidad)
        .where(AnalisisCalidad.parcela_id == parcela_id, AnalisisCalidad.fecha.between(desde, hasta))
        .order_by(AnalisisCalidad.fecha)
    )).scalars().all()

    compliance = await _calcular_compliance(db, parcela_id, list(fitosanitarios))
    horas_de_frio = await _horas_de_frio(db, desde, hasta)
    meta_produccion_kg = await _meta_produccion_kg(db, parcela_id, desde)

    variedad_descripcion = (
        VARIEDAD_DESCRIPCIONES.get(parcela.variedad.value) if parcela.variedad else None
    )
    tipo_riego_label = (
        labels.TIPO_RIEGO_LABELS.get(parcela.tipo_riego.value) if parcela.tipo_riego else None
    )
    cobertura_invierno = None
    if parcela.usa_cobertura_invierno:
        cobertura_invierno = (
            f"Sí — {parcela.especie_cobertura_invierno}" if parcela.especie_cobertura_invierno else "Sí"
        )

    return HistorialData(
        parcela=parcela,
        riegos=list(riegos),
        fitosanitarios=list(fitosanitarios),
        trabajos=list(trabajos),
        cosechas=list(cosechas),
        ciclos_campana=list(ciclos),
        fotos=list(fotos),
        analisis_calidad=list(analisis),
        compliance_fitosanitarios=compliance,
        parcela_variedad_descripcion=variedad_descripcion,
        parcela_centroide=centroide_poligono(parcela.coordenadas),
        parcela_tipo_riego=tipo_riego_label,
        parcela_cobertura_invierno=cobertura_invierno,
        cumplimiento_riego_por_estado=_cumplimiento_riego_por_estado(list(riegos), desde, hasta),
        resumen_destino=_resumen_destino(list(cosechas)),
        tareas_resumen=_tareas_resumen(list(trabajos)),
        horas_de_frio=horas_de_frio,
        meta_produccion_kg=meta_produccion_kg,
    )


def _resumen_publico(data: HistorialData) -> ResumenPublicoItem:
    """Mismo calculo que el resumen ejecutivo de la carta PDF
    (app/core/pdf_carta.py) -- kg cosechados, mm de riego, horas de frio y
    conteo del semaforo de carencia. Sin nombres ni datos comerciales."""
    kg_total = sum(c.kg_total for c in data.cosechas)
    mm_riego_total = sum(r.mm_aplicados or 0 for r in data.riegos)
    cumplidos = sum(1 for c in data.compliance_fitosanitarios if c.estado == "cumplido")
    pendientes = sum(1 for c in data.compliance_fitosanitarios if c.estado == "pendiente")
    incumplidos = sum(1 for c in data.compliance_fitosanitarios if c.estado == "incumplido")
    return ResumenPublicoItem(
        kg_total=round(kg_total, 1),
        meta_produccion_kg=data.meta_produccion_kg,
        pct_meta_produccion=(
            round(kg_total / data.meta_produccion_kg * 100, 1)
            if data.meta_produccion_kg else None
        ),
        mm_riego_total=round(mm_riego_total, 1),
        mm_objetivo_anual=MM_OBJETIVO_ANUAL,
        pct_objetivo_riego=(
            round(mm_riego_total / MM_OBJETIVO_ANUAL * 100, 1) if MM_OBJETIVO_ANUAL else None
        ),
        horas_de_frio=data.horas_de_frio,
        fitos_cumplidos=cumplidos,
        fitos_pendientes=pendientes,
        fitos_incumplidos=incumplidos,
    )


def _build_historial_publico(
    data: HistorialData, desde: date, hasta: date,
) -> HistorialPublicoResponse:
    """Arma la respuesta de la vista publica a mano, campo por campo -- nunca
    pasa por los schemas internos (que arrastran responsable/comprador)."""
    parcela = data.parcela
    estado_por_fito = {
        c.fitosanitario_id: c.estado for c in data.compliance_fitosanitarios
    }
    return HistorialPublicoResponse(
        parcela_nombre=parcela.nombre,
        parcela_tipo=labels.TIPO_LABELS.get(parcela.tipo.value, parcela.tipo.value),
        parcela_variedad=(
            parcela.variedad.value.replace("_", " ").title() if parcela.variedad else None
        ),
        parcela_variedad_descripcion=data.parcela_variedad_descripcion,
        parcela_superficie_ha=parcela.superficie_ha,
        parcela_finca=(
            labels.FINCA_LABELS.get(parcela.finca.value, parcela.finca.value)
            if parcela.finca else None
        ),
        parcela_tipo_riego=data.parcela_tipo_riego,
        parcela_cobertura_invierno=data.parcela_cobertura_invierno,
        parcela_centroide=(
            CentroideItem(lat=data.parcela_centroide[0], lng=data.parcela_centroide[1])
            if data.parcela_centroide else None
        ),
        desde=desde,
        hasta=hasta,
        resumen=_resumen_publico(data),
        fitosanitarios=[
            FitosanitarioPublicoItem(
                fecha=f.fecha,
                producto_nombre=f.producto_nombre,
                dosis_lt_ha=f.dosis_lt_ha,
                dias_carencia=f.dias_carencia,
                fecha_habilitacion_cosecha=f.fecha_habilitacion_cosecha,
                dias_reingreso=f.dias_reingreso,
                fecha_habilitacion_reingreso=f.fecha_habilitacion_reingreso,
                estado_compliance=estado_por_fito.get(f.id, "pendiente"),
            )
            for f in data.fitosanitarios
        ],
        cumplimiento_riego_por_estado=data.cumplimiento_riego_por_estado,
        resumen_destino=data.resumen_destino,
        tareas_resumen=data.tareas_resumen,
        fotos=[
            FotoPublicaItem(
                url=f.url, categoria=f.categoria, fecha=f.fecha, descripcion=f.descripcion,
            )
            for f in data.fotos
        ],
        analisis_calidad=[
            AnalisisPublicoItem(
                fecha=a.fecha,
                origen=a.origen,
                brix=a.brix,
                acidez=a.acidez,
                ph=a.ph,
                estado_sanitario=a.estado_sanitario,
                laboratorio_nombre=a.laboratorio_nombre,
                informe_url=a.informe_url,
            )
            for a in data.analisis_calidad
        ],
        empresa=EmpresaItem(
            razon_social=EMPRESA_RAZON_SOCIAL,
            cuit=EMPRESA_CUIT,
            domicilio=EMPRESA_DOMICILIO,
        ),
    )


async def _enlace_activo_por_rango(
    db: AsyncSession, parcela_id: str, desde: date, hasta: date,
) -> EnlacePublico | None:
    """Enlace publico activo para exactamente esa parcela + ese rango. Usado
    para auto-embeber el QR en la carta PDF interna sin cambiar sus permisos."""
    return (await db.execute(
        select(EnlacePublico)
        .where(
            EnlacePublico.parcela_id == parcela_id,
            EnlacePublico.desde == desde,
            EnlacePublico.hasta == hasta,
            EnlacePublico.activo.is_(True),
        )
        .order_by(EnlacePublico.created_at.desc())
    )).scalars().first()


async def _get_enlace_por_token_or_404(db: AsyncSession, token: str) -> EnlacePublico:
    """Un solo 404 generico para "token inexistente" y "token revocado" -- no
    se distingue por el mensaje si alguien prueba un token viejo."""
    enlace = (await db.execute(
        select(EnlacePublico).where(EnlacePublico.token == token)
    )).scalar_one_or_none()
    if enlace is None or not enlace.activo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Enlace no disponible",
        )
    return enlace


@router.get("/parcela/{parcela_id}/historial", response_model=HistorialParcelaResponse)
async def historial_parcela(
    parcela_id: str,
    desde: date = Query(...),
    hasta: date = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any_role),
) -> HistorialParcelaResponse:
    parcela = await _get_parcela_or_404(db, parcela_id)
    data = await _fetch_historial(db, parcela, desde, hasta)
    return HistorialParcelaResponse(
        parcela_id=data.parcela.id,
        parcela_nombre=data.parcela.nombre,
        desde=desde,
        hasta=hasta,
        riegos=data.riegos,
        fitosanitarios=data.fitosanitarios,
        trabajos=data.trabajos,
        cosechas=data.cosechas,
        ciclos_campana=data.ciclos_campana,
        fotos=data.fotos,
        analisis_calidad=data.analisis_calidad,
        compliance_fitosanitarios=data.compliance_fitosanitarios,
        parcela_variedad_descripcion=data.parcela_variedad_descripcion,
        parcela_centroide=(
            CentroideItem(lat=data.parcela_centroide[0], lng=data.parcela_centroide[1])
            if data.parcela_centroide else None
        ),
        parcela_tipo_riego=data.parcela_tipo_riego,
        parcela_cobertura_invierno=data.parcela_cobertura_invierno,
        cumplimiento_riego_por_estado=data.cumplimiento_riego_por_estado,
        resumen_destino=data.resumen_destino,
        tareas_resumen=data.tareas_resumen,
        horas_de_frio=data.horas_de_frio,
        mm_objetivo_anual=MM_OBJETIVO_ANUAL,
        meta_produccion_kg=data.meta_produccion_kg,
    )


@router.get("/parcela/{parcela_id}/carta-pdf")
async def carta_pdf_parcela(
    parcela_id: str,
    desde: date = Query(...),
    hasta: date = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_role),
) -> Response:
    parcela = await _get_parcela_or_404(db, parcela_id)
    data = await _fetch_historial(db, parcela, desde, hasta)

    # Si ya existe un enlace publico activo para esta parcela + este rango
    # exacto, la carta embebe su QR. Si no, se genera igual que siempre (sin
    # QR) -- crear el enlace sigue siendo exclusivo de gerencial_up, cualquiera
    # que descargue el PDF despues simplemente hereda el QR si ya existe.
    enlace = await _enlace_activo_por_rango(db, parcela_id, desde, hasta)
    publico_url = _url_publica(enlace.token) if enlace else None

    # xhtml2pdf/reportlab son sincronicos y CPU-bound -- correrlos inline
    # bloquearia el event loop async para todas las demas requests mientras
    # se genera el PDF. Mismo cuidado que el proyecto ya tiene con Cloudinary
    # (httpx async en vez del SDK sincronico).
    pdf_bytes = await run_in_threadpool(
        generar_pdf_carta,
        parcela=data.parcela,
        publico_url=publico_url,
        riegos=data.riegos,
        fitosanitarios=data.fitosanitarios,
        cosechas=data.cosechas,
        fotos=data.fotos,
        analisis=data.analisis_calidad,
        compliance=data.compliance_fitosanitarios,
        parcela_variedad_descripcion=data.parcela_variedad_descripcion,
        parcela_centroide=data.parcela_centroide,
        parcela_tipo_riego=data.parcela_tipo_riego,
        parcela_cobertura_invierno=data.parcela_cobertura_invierno,
        cumplimiento_riego_por_estado=data.cumplimiento_riego_por_estado,
        resumen_destino=data.resumen_destino,
        tareas_resumen=data.tareas_resumen,
        horas_de_frio=data.horas_de_frio,
        mm_objetivo_anual=MM_OBJETIVO_ANUAL,
        meta_produccion_kg=data.meta_produccion_kg,
        desde=desde,
        hasta=hasta,
        generado_por=current_user.full_name,
    )

    filename = f"trazabilidad-{data.parcela.nombre}-{desde}_{hasta}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Enlaces publicos: gestion (gerencial+) ──────────────────────────────────

@router.post(
    "/parcela/{parcela_id}/enlaces",
    response_model=EnlacePublicoResponse,
    status_code=status.HTTP_201_CREATED,
)
async def crear_enlace_publico(
    parcela_id: str,
    body: EnlacePublicoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> EnlacePublico:
    await _get_parcela_or_404(db, parcela_id)
    enlace = EnlacePublico(
        parcela_id=parcela_id,
        token=secrets.token_urlsafe(24),
        desde=body.desde,
        hasta=body.hasta,
        created_by=current_user.id,
    )
    db.add(enlace)
    await db.flush()
    await db.refresh(enlace)
    return enlace


@router.get(
    "/parcela/{parcela_id}/enlaces",
    response_model=list[EnlacePublicoResponse],
)
async def list_enlaces_publicos(
    parcela_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[EnlacePublico]:
    filas = (await db.execute(
        select(EnlacePublico)
        .where(EnlacePublico.parcela_id == parcela_id)
        .order_by(EnlacePublico.activo.desc(), EnlacePublico.created_at.desc())
    )).scalars().all()
    return list(filas)


@router.post(
    "/enlaces/{enlace_id}/revocar",
    response_model=EnlacePublicoResponse,
)
async def revocar_enlace_publico(
    enlace_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> EnlacePublico:
    enlace = (await db.execute(
        select(EnlacePublico).where(EnlacePublico.id == enlace_id)
    )).scalar_one_or_none()
    if enlace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enlace not found")
    # Soft: no se borra el historial -- mismo criterio que "descartar" en ARCA.
    if enlace.activo:
        enlace.activo = False
        enlace.revoked_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(enlace)
    return enlace


# ── Enlaces publicos: vista publica (sin auth) ─────────────────────────────

@router.get("/publica/{token}", response_model=HistorialPublicoResponse)
async def historial_publico(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> HistorialPublicoResponse:
    enlace = await _get_enlace_por_token_or_404(db, token)
    parcela = await _get_parcela_or_404(db, enlace.parcela_id)
    data = await _fetch_historial(db, parcela, enlace.desde, enlace.hasta)
    return _build_historial_publico(data, enlace.desde, enlace.hasta)


@router.get("/publica/{token}/pdf")
async def carta_pdf_publica(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> Response:
    enlace = await _get_enlace_por_token_or_404(db, token)
    parcela = await _get_parcela_or_404(db, enlace.parcela_id)
    data = await _fetch_historial(db, parcela, enlace.desde, enlace.hasta)

    pdf_bytes = await run_in_threadpool(
        generar_pdf_carta,
        parcela=data.parcela,
        publico=True,
        publico_url=_url_publica(enlace.token),
        riegos=data.riegos,
        fitosanitarios=data.fitosanitarios,
        cosechas=data.cosechas,
        fotos=data.fotos,
        analisis=data.analisis_calidad,
        compliance=data.compliance_fitosanitarios,
        parcela_variedad_descripcion=data.parcela_variedad_descripcion,
        parcela_centroide=data.parcela_centroide,
        parcela_tipo_riego=data.parcela_tipo_riego,
        parcela_cobertura_invierno=data.parcela_cobertura_invierno,
        cumplimiento_riego_por_estado=data.cumplimiento_riego_por_estado,
        resumen_destino=data.resumen_destino,
        tareas_resumen=data.tareas_resumen,
        horas_de_frio=data.horas_de_frio,
        mm_objetivo_anual=MM_OBJETIVO_ANUAL,
        meta_produccion_kg=data.meta_produccion_kg,
        desde=enlace.desde,
        hasta=enlace.hasta,
        generado_por=EMPRESA_RAZON_SOCIAL,
    )

    filename = f"trazabilidad-{data.parcela.nombre}-{enlace.desde}_{enlace.hasta}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Fotos ───────────────────────────────────────────────────────────────────

@router.post("/fotos/", response_model=FotoResponse, status_code=status.HTTP_201_CREATED)
async def create_foto(
    parcela_id: str = Form(...),
    fecha: date = Form(...),
    categoria: str = Form(...),
    descripcion: str | None = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> Foto:
    data = FotoCreate(
        parcela_id=parcela_id, fecha=fecha, categoria=categoria, descripcion=descripcion,
    )
    raw = await file.read()
    secure_url = await upload_foto_parcela(raw, file.content_type or "", data.parcela_id)

    foto = Foto(**data.model_dump(), url=secure_url, created_by=current_user.id)
    db.add(foto)
    await db.flush()
    await db.refresh(foto)
    return foto


@router.get("/fotos/", response_model=list[FotoResponse])
async def list_fotos(
    parcela_id: str | None = Query(None),
    desde: date | None = Query(None),
    hasta: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any_role),
) -> list[Foto]:
    stmt = select(Foto)
    if parcela_id is not None:
        stmt = stmt.where(Foto.parcela_id == parcela_id)
    if desde is not None:
        stmt = stmt.where(Foto.fecha >= desde)
    if hasta is not None:
        stmt = stmt.where(Foto.fecha <= hasta)
    stmt = stmt.order_by(Foto.fecha.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.delete("/fotos/{foto_id}", response_model=FotoResponse)
async def delete_foto(
    foto_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Foto:
    foto = (await db.execute(select(Foto).where(Foto.id == foto_id))).scalar_one_or_none()
    if foto is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Foto not found")
    await db.delete(foto)
    await db.flush()
    return foto


# ── Analisis de Calidad ───────────────────────────────────────────────────────

@router.post("/analisis/", response_model=AnalisisCalidadResponse, status_code=status.HTTP_201_CREATED)
async def create_analisis(
    parcela_id: str = Form(...),
    fecha: date = Form(...),
    origen: OrigenAnalisis = Form(...),
    brix: float | None = Form(None),
    acidez: float | None = Form(None),
    ph: float | None = Form(None),
    estado_sanitario: EstadoSanitarioAnalisis | None = Form(None),
    laboratorio_nombre: str | None = Form(None),
    observaciones: str | None = Form(None),
    file: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> AnalisisCalidad:
    data = AnalisisCalidadCreate(
        parcela_id=parcela_id, fecha=fecha, origen=origen, brix=brix, acidez=acidez, ph=ph,
        estado_sanitario=estado_sanitario, laboratorio_nombre=laboratorio_nombre,
        observaciones=observaciones,
    )
    analisis = AnalisisCalidad(**data.model_dump(), created_by=current_user.id)
    db.add(analisis)
    # flush sin commit para obtener el id -- el informe se sube a Cloudinary
    # con public_id = analisis.id, no existe todavia antes de este punto.
    await db.flush()

    if file is not None:
        raw = await file.read()
        analisis.informe_url = await upload_informe_analisis(
            raw, file.content_type or "", analisis.id,
        )
        await db.flush()

    await db.refresh(analisis)
    return analisis


@router.get("/analisis/", response_model=list[AnalisisCalidadResponse])
async def list_analisis(
    parcela_id: str | None = Query(None),
    desde: date | None = Query(None),
    hasta: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any_role),
) -> list[AnalisisCalidad]:
    stmt = select(AnalisisCalidad)
    if parcela_id is not None:
        stmt = stmt.where(AnalisisCalidad.parcela_id == parcela_id)
    if desde is not None:
        stmt = stmt.where(AnalisisCalidad.fecha >= desde)
    if hasta is not None:
        stmt = stmt.where(AnalisisCalidad.fecha <= hasta)
    stmt = stmt.order_by(AnalisisCalidad.fecha.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.delete("/analisis/{analisis_id}", response_model=AnalisisCalidadResponse)
async def delete_analisis(
    analisis_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> AnalisisCalidad:
    analisis = (await db.execute(
        select(AnalisisCalidad).where(AnalisisCalidad.id == analisis_id)
    )).scalar_one_or_none()
    if analisis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analisis not found")
    await db.delete(analisis)
    await db.flush()
    return analisis
