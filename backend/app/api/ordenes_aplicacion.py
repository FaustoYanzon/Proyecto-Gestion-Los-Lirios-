from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_any_role, require_encargado_up
from app.api.produccion import (
    _aplicar_movimiento_stock,
    _calcular_cantidad_total,
    _resolve_insumo,
    _resolve_responsable_nombre,
)
from app.core.cloudinary_client import upload_foto_orden_aplicacion
from app.models.parcela import Parcela, VariedadUva
from app.models.produccion import (
    EstadoOrdenAplicacion,
    EstadoOrdenAplicacionParcela,
    FotoRegistroFitosanitario,
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrigenOrdenAplicacion,
    PlanFitosanitario,
    RegistroFitosanitario,
)
from app.models.user import User, UserRole
from app.schemas.produccion import (
    ConfirmarAplicacionRequest,
    FotoRegistroFitosanitarioResponse,
    OrdenAplicacionCreateDesdePlan,
    OrdenAplicacionCreateExtra,
    OrdenAplicacionParcelaResponse,
    OrdenAplicacionResponse,
)

router = APIRouter(prefix="/ordenes-aplicacion", tags=["Ordenes Aplicacion"])

_ORDEN_LOAD_OPTS = (
    selectinload(OrdenAplicacion.insumo),
    selectinload(OrdenAplicacion.parcelas).selectinload(OrdenAplicacionParcela.parcela),
)


def _to_response(orden: OrdenAplicacion) -> OrdenAplicacionResponse:
    return OrdenAplicacionResponse(
        id=orden.id,
        temporada=orden.temporada,
        origen=orden.origen,
        plan_fitosanitario_id=orden.plan_fitosanitario_id,
        variedad=orden.variedad,
        insumo_id=orden.insumo_id,
        insumo_nombre=orden.insumo.nombre,
        insumo_unidad=orden.insumo.unidad,
        dosis_por_ha=orden.dosis_por_ha,
        objetivo=orden.objetivo,
        dias_carencia=orden.dias_carencia,
        dias_reingreso=orden.dias_reingreso,
        fecha_planificada=orden.fecha_planificada,
        estado=orden.estado,
        notas=orden.notas,
        created_by=orden.created_by,
        created_at=orden.created_at,
        parcelas=[
            OrdenAplicacionParcelaResponse(
                id=item.id,
                parcela_id=item.parcela_id,
                parcela_nombre=item.parcela.nombre,
                estado=item.estado,
                registro_fitosanitario_id=item.registro_fitosanitario_id,
            )
            for item in orden.parcelas
        ],
    )


async def _resolve_parcelas_orden(
    db: AsyncSession, variedad: VariedadUva, parcela_ids: list[str] | None
) -> list[Parcela]:
    """Resuelve las parcelas que entran en una orden nueva. `parcela_ids=None`
    significa "toda la variedad" (todas las parcelas activas de esa variedad);
    una lista explícita restringe la orden a esas parcelas puntuales -- deben
    ser de la misma variedad."""
    if parcela_ids is not None:
        if not parcela_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="parcela_ids no puede ser una lista vacía (omitila para incluir toda la variedad).",
            )
        parcelas = (
            await db.execute(select(Parcela).where(Parcela.id.in_(parcela_ids)))
        ).scalars().all()
        encontrados = {p.id for p in parcelas}
        faltantes = set(parcela_ids) - encontrados
        if faltantes:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Parcelas no encontradas: {', '.join(sorted(faltantes))}",
            )
        fuera_de_variedad = [p.nombre for p in parcelas if p.variedad != variedad]
        if fuera_de_variedad:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Estas parcelas no son de la variedad {variedad.value}: {', '.join(fuera_de_variedad)}",
            )
        return list(parcelas)

    parcelas = (
        await db.execute(
            select(Parcela).where(Parcela.is_active.is_(True), Parcela.variedad == variedad)
        )
    ).scalars().all()
    if not parcelas:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No hay parcelas activas para la variedad {variedad.value}.",
        )
    return list(parcelas)


@router.post(
    "/desde-plan", response_model=OrdenAplicacionResponse, status_code=status.HTTP_201_CREATED
)
async def crear_orden_desde_plan(
    data: OrdenAplicacionCreateDesdePlan,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> OrdenAplicacionResponse:
    plan = await db.get(
        PlanFitosanitario,
        data.plan_fitosanitario_id,
        options=[selectinload(PlanFitosanitario.insumo)],
    )
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    parcelas = await _resolve_parcelas_orden(db, plan.variedad, data.parcela_ids)

    orden = OrdenAplicacion(
        temporada=plan.temporada,
        origen=OrigenOrdenAplicacion.plan,
        plan_fitosanitario_id=plan.id,
        variedad=plan.variedad,
        insumo_id=plan.insumo_id,
        dosis_por_ha=plan.dosis_por_ha,
        objetivo=plan.objetivo,
        dias_carencia=data.dias_carencia,
        dias_reingreso=data.dias_reingreso,
        fecha_planificada=data.fecha_planificada,
        notas=data.notas,
        created_by=current_user.id,
    )
    orden.insumo = plan.insumo
    db.add(orden)
    for parcela in parcelas:
        item = OrdenAplicacionParcela(parcela_id=parcela.id)
        item.parcela = parcela
        orden.parcelas.append(item)

    await db.flush()
    return _to_response(orden)


@router.post("/", response_model=OrdenAplicacionResponse, status_code=status.HTTP_201_CREATED)
async def crear_orden_extra(
    data: OrdenAplicacionCreateExtra,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> OrdenAplicacionResponse:
    insumo = await _resolve_insumo(db, data.insumo_id)
    parcelas = await _resolve_parcelas_orden(db, data.variedad, data.parcela_ids)

    orden = OrdenAplicacion(
        temporada=data.temporada,
        origen=OrigenOrdenAplicacion.extra,
        plan_fitosanitario_id=None,
        variedad=data.variedad,
        insumo_id=data.insumo_id,
        dosis_por_ha=data.dosis_por_ha,
        objetivo=data.objetivo,
        dias_carencia=data.dias_carencia,
        dias_reingreso=data.dias_reingreso,
        fecha_planificada=data.fecha_planificada,
        notas=data.notas,
        created_by=current_user.id,
    )
    orden.insumo = insumo
    db.add(orden)
    for parcela in parcelas:
        item = OrdenAplicacionParcela(parcela_id=parcela.id)
        item.parcela = parcela
        orden.parcelas.append(item)

    await db.flush()
    return _to_response(orden)


@router.get("/pendientes", response_model=list[OrdenAplicacionResponse])
async def list_ordenes_pendientes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_role),
) -> list[OrdenAplicacionResponse]:
    """Pool de órdenes con algo por confirmar, para la pantalla del operario
    en mobile. super_admin/gerencial ven todo; el resto ve solo su finca
    (sin asignación nominal a una persona -- cualquiera del equipo puede
    confirmar lo que efectivamente aplicó)."""
    stmt = (
        select(OrdenAplicacion)
        .options(*_ORDEN_LOAD_OPTS)
        .where(OrdenAplicacion.estado != EstadoOrdenAplicacion.completada)
        .order_by(OrdenAplicacion.fecha_planificada.asc())
    )
    ordenes = (await db.execute(stmt)).scalars().all()

    if current_user.role in (UserRole.super_admin, UserRole.gerencial):
        return [_to_response(o) for o in ordenes]

    resultado: list[OrdenAplicacionResponse] = []
    for orden in ordenes:
        parcelas_finca_ids = {
            item.parcela_id for item in orden.parcelas if item.parcela.finca == current_user.finca
        }
        if not parcelas_finca_ids:
            continue
        resp = _to_response(orden)
        resp.parcelas = [p for p in resp.parcelas if p.parcela_id in parcelas_finca_ids]
        resultado.append(resp)
    return resultado


@router.get("/", response_model=list[OrdenAplicacionResponse])
async def list_ordenes(
    temporada: int = Query(...),
    estado: EstadoOrdenAplicacion | None = Query(None),
    variedad: VariedadUva | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[OrdenAplicacionResponse]:
    stmt = (
        select(OrdenAplicacion)
        .options(*_ORDEN_LOAD_OPTS)
        .where(OrdenAplicacion.temporada == temporada)
        .order_by(OrdenAplicacion.fecha_planificada.desc())
    )
    if estado is not None:
        stmt = stmt.where(OrdenAplicacion.estado == estado)
    if variedad is not None:
        stmt = stmt.where(OrdenAplicacion.variedad == variedad)
    ordenes = (await db.execute(stmt)).scalars().all()
    return [_to_response(o) for o in ordenes]


@router.get("/{orden_id}", response_model=OrdenAplicacionResponse)
async def get_orden(
    orden_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any_role),
) -> OrdenAplicacionResponse:
    orden = await db.get(OrdenAplicacion, orden_id, options=list(_ORDEN_LOAD_OPTS))
    if orden is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden not found")
    return _to_response(orden)


@router.post(
    "/{orden_id}/parcelas/{orden_parcela_id}/confirmar",
    response_model=OrdenAplicacionParcelaResponse,
)
async def confirmar_aplicacion(
    orden_id: str,
    orden_parcela_id: str,
    data: ConfirmarAplicacionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_role),
) -> OrdenAplicacionParcelaResponse:
    orden = await db.get(OrdenAplicacion, orden_id, options=[selectinload(OrdenAplicacion.insumo)])
    if orden is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden not found")

    item = await db.get(
        OrdenAplicacionParcela,
        orden_parcela_id,
        options=[selectinload(OrdenAplicacionParcela.parcela)],
    )
    if item is None or item.orden_id != orden_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Parcela de la orden not found"
        )
    if item.estado == EstadoOrdenAplicacionParcela.aplicada:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Esta parcela ya fue confirmada"
        )

    parcela = item.parcela
    if current_user.role not in (UserRole.super_admin, UserRole.gerencial):
        if parcela.finca != current_user.finca:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No podés confirmar aplicaciones fuera de tu finca.",
            )

    responsable_id = current_user.trabajador_id
    responsable_nombre = current_user.full_name
    if responsable_id:
        responsable_nombre = await _resolve_responsable_nombre(db, responsable_id)

    cantidad_total = _calcular_cantidad_total(orden.dosis_por_ha, parcela)

    fito = RegistroFitosanitario(
        fecha=date.today(),
        parcela_id=parcela.id,
        producto_nombre=orden.insumo.nombre,
        dosis_por_ha=orden.dosis_por_ha,
        insumo_id=orden.insumo_id,
        unidad=orden.insumo.unidad,
        cantidad_total=cantidad_total,
        motivo=orden.objetivo,
        dias_carencia=orden.dias_carencia,
        dias_reingreso=orden.dias_reingreso,
        responsable=responsable_nombre,
        responsable_id=responsable_id,
        observaciones=data.observaciones,
        created_by=current_user.id,
    )
    db.add(fito)
    await db.flush()

    await _aplicar_movimiento_stock(db, fito, orden.insumo, cantidad_total, current_user.id)

    item.estado = EstadoOrdenAplicacionParcela.aplicada
    item.registro_fitosanitario_id = fito.id
    await db.flush()

    await db.refresh(orden, attribute_names=["parcelas"])
    estados = {p.estado for p in orden.parcelas}
    if estados == {EstadoOrdenAplicacionParcela.aplicada}:
        orden.estado = EstadoOrdenAplicacion.completada
    elif EstadoOrdenAplicacionParcela.aplicada in estados:
        orden.estado = EstadoOrdenAplicacion.en_curso
    await db.flush()

    return OrdenAplicacionParcelaResponse(
        id=item.id,
        parcela_id=item.parcela_id,
        parcela_nombre=parcela.nombre,
        estado=item.estado,
        registro_fitosanitario_id=item.registro_fitosanitario_id,
    )


@router.post(
    "/parcelas/{orden_parcela_id}/fotos",
    response_model=FotoRegistroFitosanitarioResponse,
    status_code=status.HTTP_201_CREATED,
)
async def subir_foto_aplicacion(
    orden_parcela_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_role),
) -> FotoRegistroFitosanitarioResponse:
    item = await db.get(OrdenAplicacionParcela, orden_parcela_id)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Parcela de la orden not found"
        )
    if item.registro_fitosanitario_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Primero hay que confirmar la aplicación antes de subir fotos.",
        )

    raw = await file.read()
    url = await upload_foto_orden_aplicacion(raw, file.content_type or "", orden_parcela_id)

    foto = FotoRegistroFitosanitario(
        registro_fitosanitario_id=item.registro_fitosanitario_id,
        url=url,
        created_by=current_user.id,
    )
    db.add(foto)
    await db.flush()
    await db.refresh(foto)
    return foto
