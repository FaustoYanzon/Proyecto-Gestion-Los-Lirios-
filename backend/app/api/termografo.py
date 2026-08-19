from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_gerencial_up
from app.core.termografo_import import FINCA_TZ, decode_csv_bytes, parse_termografo_csv
from app.core import termografo_metrics as metrics
from app.models.termografo import LecturaTermografo, LoteImportacionTermografo
from app.models.user import User
from app.schemas.termografo import (
    EventoHeladaResponse,
    ImportarTermografoResponse,
    LecturaDiariaResponse,
    LecturaTermografoResponse,
    LecturasTermografoResponse,
    LoteImportacionTermografoResponse,
    MetricasTermografoResponse,
)

router = APIRouter(prefix="/produccion/termografo", tags=["Producción - Termógrafo"])

# Por encima de este rango de días, /lecturas agrega por día en vez de
# devolver los puntos crudos de 15 min -- evita mandar decenas de miles de
# puntos a un gráfico de líneas.
RANGO_CRUDO_MAX_DIAS = 45


def _rango_a_datetimes(desde: date, hasta: date) -> tuple[datetime, datetime]:
    # Los límites de día calendario se calculan en FINCA_TZ (así "desde 20/9"
    # corresponde al día calendario real de la finca, no al día calendario en
    # UTC) pero se convierten a UTC antes de usarse en la consulta -- mismo
    # formato en el que se guardan las lecturas (ver termografo_import.py).
    inicio = datetime.combine(desde, time.min, tzinfo=FINCA_TZ).astimezone(timezone.utc)
    fin = datetime.combine(hasta, time.max, tzinfo=FINCA_TZ).astimezone(timezone.utc)
    return inicio, fin


def _como_utc(valor: datetime) -> datetime:
    """SQLite (usado en tests) descarta el tzinfo al guardar/leer una columna
    DateTime(timezone=True) -- lo que vuelve ya está en UTC (ver
    termografo_import.py), solo hay que reetiquetarlo. Postgres (producción)
    sí preserva el offset, así que esto es un no-op ahí."""
    return valor if valor.tzinfo is not None else valor.replace(tzinfo=timezone.utc)


def _fecha_hora_local(l: LecturaTermografo) -> datetime:
    """La lectura vuelve de la DB en UTC (ver _como_utc) -- convertida acá a
    FINCA_TZ para que el día calendario usado en agregaciones (GDD, amplitud
    térmica, agrupación diaria de /lecturas) sea el día real de la finca, no
    el día calendario en UTC (que puede diferir de noche, UTC-3)."""
    return _como_utc(l.fecha_hora).astimezone(FINCA_TZ)


async def _lecturas_en_rango(
    db: AsyncSession, desde: date, hasta: date, device_id: str | None
) -> list[LecturaTermografo]:
    inicio, fin = _rango_a_datetimes(desde, hasta)
    stmt = select(LecturaTermografo).where(
        LecturaTermografo.fecha_hora >= inicio, LecturaTermografo.fecha_hora <= fin
    )
    if device_id is not None:
        stmt = stmt.where(LecturaTermografo.device_id == device_id)
    stmt = stmt.order_by(LecturaTermografo.fecha_hora)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("/importar", response_model=ImportarTermografoResponse, status_code=status.HTTP_201_CREATED)
async def importar_termografo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> ImportarTermografoResponse:
    raw = await file.read()
    try:
        content = decode_csv_bytes(raw)
        parse_result = parse_termografo_csv(content, file.filename or "termografo.csv")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    existing_keys: set[datetime] = set()
    if parse_result.filas:
        result = await db.execute(
            select(LecturaTermografo.fecha_hora).where(
                LecturaTermografo.device_id == parse_result.device_id
            )
        )
        existing_keys = {_como_utc(row[0]) for row in result.all()}

    rango_inicio = min(f.fecha_hora for f in parse_result.filas) if parse_result.filas else None
    rango_fin = max(f.fecha_hora for f in parse_result.filas) if parse_result.filas else None

    lote = LoteImportacionTermografo(
        device_id=parse_result.device_id,
        nombre_archivo=file.filename or "termografo.csv",
        intervalo_seg=parse_result.intervalo_seg,
        rango_inicio=rango_inicio or datetime.now(timezone.utc),
        rango_fin=rango_fin or datetime.now(timezone.utc),
        cantidad_filas=len(parse_result.filas),
        cantidad_nuevas=0,
        cantidad_duplicadas=0,
        importado_por=current_user.id,
    )
    db.add(lote)
    await db.flush()

    nuevos = 0
    duplicados = 0
    seen_in_file: set[datetime] = set()
    for fila in parse_result.filas:
        if fila.fecha_hora in existing_keys or fila.fecha_hora in seen_in_file:
            duplicados += 1
            continue
        seen_in_file.add(fila.fecha_hora)
        db.add(
            LecturaTermografo(
                lote_id=lote.id,
                device_id=parse_result.device_id,
                fecha_hora=fila.fecha_hora,
                temperatura=fila.temperatura,
                humedad=fila.humedad,
            )
        )
        nuevos += 1

    lote.cantidad_nuevas = nuevos
    lote.cantidad_duplicadas = duplicados
    await db.flush()
    await db.refresh(lote)

    return ImportarTermografoResponse(
        lote=LoteImportacionTermografoResponse.model_validate(lote),
        nuevos=nuevos,
        duplicados=duplicados,
        errores=parse_result.errores,
    )


@router.get("/lotes", response_model=list[LoteImportacionTermografoResponse])
async def list_lotes_termografo(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[LoteImportacionTermografo]:
    stmt = (
        select(LoteImportacionTermografo)
        .order_by(LoteImportacionTermografo.importado_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/lecturas", response_model=LecturasTermografoResponse)
async def get_lecturas_termografo(
    desde: date = Query(...),
    hasta: date = Query(...),
    device_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> LecturasTermografoResponse:
    if hasta < desde:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "'hasta' no puede ser anterior a 'desde'")

    lecturas = await _lecturas_en_rango(db, desde, hasta, device_id)

    if (hasta - desde).days <= RANGO_CRUDO_MAX_DIAS:
        return LecturasTermografoResponse(
            granularidad="cruda",
            puntos=[
                LecturaTermografoResponse(
                    fecha_hora=_fecha_hora_local(l), temperatura=l.temperatura, humedad=l.humedad
                )
                for l in lecturas
            ],
        )

    por_dia: dict[date, list[LecturaTermografo]] = {}
    for l in lecturas:
        por_dia.setdefault(_fecha_hora_local(l).date(), []).append(l)

    puntos_diarios = [
        LecturaDiariaResponse(
            dia=dia,
            temp_min=min(l.temperatura for l in filas),
            temp_max=max(l.temperatura for l in filas),
            temp_avg=sum((l.temperatura for l in filas), Decimal("0")) / len(filas),
            humedad_avg=sum((l.humedad for l in filas), Decimal("0")) / len(filas),
        )
        for dia, filas in sorted(por_dia.items())
    ]
    return LecturasTermografoResponse(granularidad="diaria", puntos=puntos_diarios)


def _fecha_brotacion_mas_reciente(hasta: date) -> date:
    """Ancla de Brotación del calendario de Ciclo de Campaña (9/20, ver
    app/core/ciclo_campana.py) más reciente <= hasta."""
    candidata = date(hasta.year, 9, 20)
    if candidata > hasta:
        candidata = date(hasta.year - 1, 9, 20)
    return candidata


@router.get("/metricas", response_model=MetricasTermografoResponse)
async def get_metricas_termografo(
    desde: date = Query(...),
    hasta: date = Query(...),
    device_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> MetricasTermografoResponse:
    if hasta < desde:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "'hasta' no puede ser anterior a 'desde'")

    filas = await _lecturas_en_rango(db, desde, hasta, device_id)
    lecturas = [
        metrics.Lectura(fecha_hora=_fecha_hora_local(l), temperatura=l.temperatura, humedad=l.humedad)
        for l in filas
    ]
    intervalo_seg = metrics.intervalo_efectivo_seg(lecturas)

    brotacion_inicio = _fecha_brotacion_mas_reciente(hasta)
    if brotacion_inicio >= desde:
        gdd_desde_brotacion = metrics.gdd_acumulado(lecturas)
    else:
        filas_brotacion = await _lecturas_en_rango(db, brotacion_inicio, hasta, device_id)
        lecturas_brotacion = [
            metrics.Lectura(fecha_hora=_fecha_hora_local(l), temperatura=l.temperatura, humedad=l.humedad)
            for l in filas_brotacion
        ]
        gdd_desde_brotacion = metrics.gdd_acumulado(lecturas_brotacion) if lecturas_brotacion else None

    return MetricasTermografoResponse(
        desde=desde,
        hasta=hasta,
        cantidad_lecturas=len(lecturas),
        horas_bajo_cero=metrics.horas_bajo_cero(lecturas, intervalo_seg),
        horas_sobre_30=metrics.horas_sobre_30(lecturas, intervalo_seg),
        horas_de_frio=metrics.horas_de_frio(lecturas, intervalo_seg),
        horas_riesgo_fungico=metrics.horas_riesgo_fungico(lecturas, intervalo_seg),
        gdd_acumulado=metrics.gdd_acumulado(lecturas),
        gdd_acumulado_desde_brotacion=gdd_desde_brotacion,
        amplitud_termica_promedio=metrics.amplitud_termica_diaria_promedio(lecturas),
        eventos_helada=[
            EventoHeladaResponse(
                inicio=e.inicio, fin=e.fin, duracion_horas=e.duracion_horas, minima=e.minima
            )
            for e in metrics.eventos_helada(lecturas, intervalo_seg)
        ],
    )
