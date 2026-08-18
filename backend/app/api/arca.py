from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_gerencial_up
from app.core.arca_import import decode_csv_bytes, parse_arca_csv
from app.models.arca import ComprobanteArcaImportado, EstadoComprobanteArca, LoteImportacionArca, TipoArchivoArca
from app.models.finanzas import Egreso, EstadoIngreso, Ingreso, MonedaTipo, OrigenPago
from app.models.user import User
from app.schemas.arca import (
    ClasificarEgresoRequest,
    ClasificarIngresoRequest,
    ComprobanteArcaResponse,
    ImportarArcaResponse,
    LoteImportacionArcaResponse,
    ResumenIvaResponse,
)
from app.schemas.finanzas import EgresoResponse, IngresoResponse

router = APIRouter(prefix="/finanzas/arca", tags=["Finanzas - ARCA"])


@router.post("/importar", response_model=ImportarArcaResponse, status_code=status.HTTP_201_CREATED)
async def importar_arca(
    tipo_archivo: TipoArchivoArca = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> ImportarArcaResponse:
    raw = await file.read()
    try:
        content = decode_csv_bytes(raw)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    parse_result = parse_arca_csv(content, tipo_archivo)

    existing_keys: set[tuple[int, int, int, str]] = set()
    if parse_result.filas:
        result = await db.execute(
            select(
                ComprobanteArcaImportado.tipo_comprobante,
                ComprobanteArcaImportado.punto_venta,
                ComprobanteArcaImportado.numero_desde,
                ComprobanteArcaImportado.cuit_contraparte,
            ).where(ComprobanteArcaImportado.tipo_archivo == tipo_archivo)
        )
        existing_keys = {tuple(row) for row in result.all()}

    lote = LoteImportacionArca(
        tipo_archivo=tipo_archivo,
        nombre_archivo=file.filename or "comprobantes.csv",
        cantidad_filas=len(parse_result.filas),
        cantidad_nuevas=0,
        cantidad_duplicadas=0,
        importado_por=current_user.id,
    )
    db.add(lote)
    await db.flush()

    nuevos = 0
    duplicados = 0
    seen_in_file: set[tuple[int, int, int, str]] = set()
    for fila in parse_result.filas:
        key = (fila.tipo_comprobante, fila.punto_venta, fila.numero_desde, fila.cuit_contraparte)
        if key in existing_keys or key in seen_in_file:
            duplicados += 1
            continue
        seen_in_file.add(key)
        db.add(
            ComprobanteArcaImportado(
                lote_id=lote.id,
                tipo_archivo=tipo_archivo,
                fecha_emision=fila.fecha_emision,
                tipo_comprobante=fila.tipo_comprobante,
                tipo_comprobante_desc=fila.tipo_comprobante_desc,
                es_nota_credito=fila.es_nota_credito,
                punto_venta=fila.punto_venta,
                numero_desde=fila.numero_desde,
                numero_hasta=fila.numero_hasta,
                cod_autorizacion=fila.cod_autorizacion,
                cuit_contraparte=fila.cuit_contraparte,
                denominacion_contraparte=fila.denominacion_contraparte,
                moneda=fila.moneda,
                tipo_cambio=fila.tipo_cambio,
                imp_neto_gravado_total=fila.imp_neto_gravado_total,
                imp_no_gravado=fila.imp_no_gravado,
                imp_exentas=fila.imp_exentas,
                otros_tributos=fila.otros_tributos,
                total_iva=fila.total_iva,
                imp_total=fila.imp_total,
            )
        )
        nuevos += 1

    lote.cantidad_nuevas = nuevos
    lote.cantidad_duplicadas = duplicados
    await db.flush()
    await db.refresh(lote)

    return ImportarArcaResponse(
        lote=LoteImportacionArcaResponse.model_validate(lote),
        nuevos=nuevos,
        duplicados=duplicados,
        errores=parse_result.errores,
    )


@router.get("/pendientes", response_model=list[ComprobanteArcaResponse])
async def list_pendientes_arca(
    tipo_archivo: TipoArchivoArca = Query(...),
    estado: EstadoComprobanteArca = Query(EstadoComprobanteArca.pendiente),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[ComprobanteArcaImportado]:
    stmt = (
        select(ComprobanteArcaImportado)
        .where(
            ComprobanteArcaImportado.tipo_archivo == tipo_archivo,
            ComprobanteArcaImportado.estado == estado,
        )
        .order_by(ComprobanteArcaImportado.fecha_emision)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/lotes", response_model=list[LoteImportacionArcaResponse])
async def list_lotes_arca(
    tipo_archivo: TipoArchivoArca | None = Query(None),
    limit: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[LoteImportacionArca]:
    stmt = select(LoteImportacionArca).order_by(LoteImportacionArca.importado_at.desc())
    if tipo_archivo is not None:
        stmt = stmt.where(LoteImportacionArca.tipo_archivo == tipo_archivo)
    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


# Must be declared before /resumen-iva could ever collide with a param route --
# there isn't one here, but kept as a flat list of static routes regardless.
@router.get("/resumen-iva", response_model=ResumenIvaResponse)
async def resumen_iva(
    anio_desde: int | None = Query(None),
    mes_desde: int | None = Query(None, ge=1, le=12),
    anio_hasta: int | None = Query(None),
    mes_hasta: int | None = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> ResumenIvaResponse:
    """Suma IVA compra/venta sobre un rango de meses calendario (inclusive en
    ambos extremos) -- por defecto, si no se pasa nada, el mes actual solo
    (mismo comportamiento que antes de soportar rango).
    """
    now = datetime.now(timezone.utc)
    anio_desde = anio_desde or now.year
    mes_desde = mes_desde or now.month
    anio_hasta = anio_hasta or anio_desde
    mes_hasta = mes_hasta or mes_desde

    result = await db.execute(
        text(
            "SELECT tipo_archivo, SUM(iva) AS iva FROM vw_kpi_iva "
            "WHERE (anio, mes) >= (:anio_desde, :mes_desde) AND (anio, mes) <= (:anio_hasta, :mes_hasta) "
            "GROUP BY tipo_archivo"
        ),
        {"anio_desde": anio_desde, "mes_desde": mes_desde, "anio_hasta": anio_hasta, "mes_hasta": mes_hasta},
    )
    por_tipo = {row.tipo_archivo: Decimal(row.iva) for row in result.all()}
    iva_compra = por_tipo.get("recibido", Decimal("0"))
    iva_venta = por_tipo.get("emitido", Decimal("0"))
    return ResumenIvaResponse(
        anio_desde=anio_desde, mes_desde=mes_desde, anio_hasta=anio_hasta, mes_hasta=mes_hasta,
        iva_compra=iva_compra, iva_venta=iva_venta, iva_saldo=iva_venta - iva_compra,
    )


async def _get_comprobante_pendiente(
    db: AsyncSession, comprobante_id: str, expected_tipo: TipoArchivoArca
) -> ComprobanteArcaImportado:
    result = await db.execute(
        select(ComprobanteArcaImportado).where(ComprobanteArcaImportado.id == comprobante_id)
    )
    comprobante = result.scalar_one_or_none()
    if comprobante is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprobante not found")
    if comprobante.tipo_archivo != expected_tipo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Este comprobante es de tipo {comprobante.tipo_archivo.value}, no {expected_tipo.value}",
        )
    if comprobante.estado != EstadoComprobanteArca.pendiente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Comprobante ya fue clasificado o descartado"
        )
    return comprobante


@router.post(
    "/{comprobante_id}/clasificar-egreso", response_model=EgresoResponse, status_code=status.HTTP_201_CREATED
)
async def clasificar_comprobante_egreso(
    comprobante_id: str,
    data: ClasificarEgresoRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> Egreso:
    comprobante = await _get_comprobante_pendiente(db, comprobante_id, TipoArchivoArca.recibido)

    signo = Decimal("-1") if comprobante.es_nota_credito else Decimal("1")
    egreso = Egreso(
        fecha=comprobante.fecha_emision,
        tipo=data.tipo,
        clasificacion=data.clasificacion,
        descripcion=data.descripcion or comprobante.denominacion_contraparte,
        monto=comprobante.imp_total * signo,
        moneda=MonedaTipo(comprobante.moneda),
        tipo_cambio=comprobante.tipo_cambio if comprobante.moneda == "usd" else None,
        origen=OrigenPago.oficial,
        finca=data.finca,
        forma_pago=data.forma_pago,
        parcela_id=data.parcela_id,
        fuente="arca_csv",
        created_by=current_user.id,
    )
    db.add(egreso)
    await db.flush()
    await db.refresh(egreso)

    comprobante.estado = EstadoComprobanteArca.clasificado
    comprobante.egreso_id = egreso.id
    comprobante.clasificado_por = current_user.id
    comprobante.clasificado_at = datetime.now(timezone.utc)
    await db.flush()

    return egreso


@router.post(
    "/{comprobante_id}/clasificar-ingreso", response_model=IngresoResponse, status_code=status.HTTP_201_CREATED
)
async def clasificar_comprobante_ingreso(
    comprobante_id: str,
    data: ClasificarIngresoRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> Ingreso:
    comprobante = await _get_comprobante_pendiente(db, comprobante_id, TipoArchivoArca.emitido)

    signo = Decimal("-1") if comprobante.es_nota_credito else Decimal("1")
    ingreso = Ingreso(
        fecha=comprobante.fecha_emision,
        destino=data.destino,
        comprador=data.comprador or comprobante.denominacion_contraparte,
        forma_pago=data.forma_pago,
        estado=EstadoIngreso.facturado,
        cuenta_destino=data.cuenta_destino,
        monto=comprobante.imp_total * signo,
        moneda=MonedaTipo(comprobante.moneda),
        tipo_cambio=comprobante.tipo_cambio if comprobante.moneda == "usd" else None,
        origen=OrigenPago.oficial,
        finca=data.finca,
        descripcion=data.descripcion,
        fuente="arca_csv",
        created_by=current_user.id,
    )
    db.add(ingreso)
    await db.flush()
    await db.refresh(ingreso)

    comprobante.estado = EstadoComprobanteArca.clasificado
    comprobante.ingreso_id = ingreso.id
    comprobante.clasificado_por = current_user.id
    comprobante.clasificado_at = datetime.now(timezone.utc)
    await db.flush()

    return ingreso


@router.post("/{comprobante_id}/descartar", status_code=status.HTTP_204_NO_CONTENT)
async def descartar_comprobante_arca(
    comprobante_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> None:
    result = await db.execute(
        select(ComprobanteArcaImportado).where(ComprobanteArcaImportado.id == comprobante_id)
    )
    comprobante = result.scalar_one_or_none()
    if comprobante is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprobante not found")
    if comprobante.estado != EstadoComprobanteArca.pendiente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Comprobante ya fue clasificado o descartado"
        )
    comprobante.estado = EstadoComprobanteArca.descartado
    comprobante.clasificado_por = current_user.id
    comprobante.clasificado_at = datetime.now(timezone.utc)
    await db.flush()


@router.post("/{comprobante_id}/restaurar", response_model=ComprobanteArcaResponse)
async def restaurar_comprobante_arca(
    comprobante_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> ComprobanteArcaImportado:
    """Un comprobante descartado por error vuelve a pendiente -- el único
    camino de vuelta, ya que el índice único de dedupe impide reimportarlo
    desde el mismo CSV."""
    result = await db.execute(
        select(ComprobanteArcaImportado).where(ComprobanteArcaImportado.id == comprobante_id)
    )
    comprobante = result.scalar_one_or_none()
    if comprobante is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprobante not found")
    if comprobante.estado != EstadoComprobanteArca.descartado:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comprobante no está descartado")
    comprobante.estado = EstadoComprobanteArca.pendiente
    comprobante.clasificado_por = None
    comprobante.clasificado_at = None
    await db.flush()
    await db.refresh(comprobante)
    return comprobante


@router.delete("/{comprobante_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_comprobante_arca(
    comprobante_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    """Borrado definitivo -- solo para comprobantes ya descartados (no para
    pendientes ni clasificados: esos primero se descartan o, si ya generaron
    un Egreso/Ingreso, se borran desde ahí). A diferencia de descartar (que
    bloquea reimportar el mismo comprobante vía el índice único), borrar
    libera esa clave -- si el mismo CSV se reimporta más adelante, ese
    comprobante vuelve a aparecer como pendiente nuevo. Es la diferencia real
    entre "descartar" (decisión registrada, reversible) y "eliminar" (como si
    nunca se hubiera importado)."""
    result = await db.execute(
        select(ComprobanteArcaImportado).where(ComprobanteArcaImportado.id == comprobante_id)
    )
    comprobante = result.scalar_one_or_none()
    if comprobante is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprobante not found")
    if comprobante.estado != EstadoComprobanteArca.descartado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Solo se pueden borrar comprobantes descartados"
        )
    await db.delete(comprobante)
    await db.flush()
