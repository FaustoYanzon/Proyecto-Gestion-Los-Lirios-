from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_any_role, require_encargado_estricto, require_encargado_up
from app.api.produccion import (
    _aplicar_movimiento_stock,
    _calcular_cantidad_total,
    _resolve_insumo,
    _resolve_responsable_nombre,
)
from app.core.cloudinary_client import upload_foto_orden_aplicacion
from app.core.push import notificar_tokens
from app.models.parcela import Parcela, VariedadUva
from app.models.valvula import Valvula
from app.models.produccion import (
    EstadoOrdenAplicacion,
    EstadoOrdenAplicacionParcela,
    FotoRegistroFitosanitario,
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrdenAplicacionValvula,
    OrigenOrdenAplicacion,
    PlanFitosanitario,
    RegistroFitosanitario,
    ResultadoValvula,
)
from app.models.user import User, UserRole
from app.schemas.produccion import (
    ConfirmarAplicacionRequest,
    ConfirmarValvulaRequest,
    FotoRegistroFitosanitarioResponse,
    OrdenAplicacionCreateDesdePlan,
    OrdenAplicacionCreateExtra,
    OrdenAplicacionParcelaResponse,
    OrdenAplicacionResponse,
    OrdenAplicacionUpdateExtra,
    OrdenAplicacionValvulaResponse,
    ValvulaARevisarResponse,
)

router = APIRouter(prefix="/ordenes-aplicacion", tags=["Ordenes Aplicacion"])

_ORDEN_LOAD_OPTS = (
    selectinload(OrdenAplicacion.insumo),
    selectinload(OrdenAplicacion.parcelas).selectinload(OrdenAplicacionParcela.parcela),
    selectinload(OrdenAplicacion.parcelas)
    .selectinload(OrdenAplicacionParcela.valvulas)
    .selectinload(OrdenAplicacionValvula.valvula),
)


def _valvula_response(item: OrdenAplicacionValvula) -> OrdenAplicacionValvulaResponse:
    return OrdenAplicacionValvulaResponse(
        id=item.id,
        valvula_id=item.valvula_id,
        valvula_nombre=item.valvula.nombre,
        superficie_ha=item.valvula.superficie_ha,
        estado=item.estado,
        resultado=item.resultado,
        responsable=item.responsable,
        observaciones=item.observaciones,
        registro_fitosanitario_id=item.registro_fitosanitario_id,
        confirmada_at=item.confirmada_at,
    )


def _valvulas_ordenadas(item: OrdenAplicacionParcela) -> list[OrdenAplicacionValvula]:
    # Oeste->este (`Valvula.orden`); las sin orden fisico conocido, al final.
    return sorted(
        item.valvulas,
        key=lambda v: (v.valvula.orden is None, v.valvula.orden or 0, v.valvula.nombre),
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
                valvulas=[_valvula_response(v) for v in _valvulas_ordenadas(item)],
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


def _avisar_orden_nueva(background_tasks: BackgroundTasks, orden: OrdenAplicacion) -> None:
    """Push a todos los celulares: salió una orden de aplicación nueva."""
    nombres = [p.parcela.nombre for p in orden.parcelas]
    parcelas = ", ".join(nombres[:3]) + (f" y {len(nombres) - 3} más" if len(nombres) > 3 else "")
    background_tasks.add_task(
        notificar_tokens,
        "Nueva orden de aplicación",
        f"{orden.insumo.nombre} · {parcelas}",
        user_ids=None,
        data={"tipo": "orden_aplicacion", "orden_id": orden.id},
    )


async def _avisar_revision(
    db: AsyncSession,
    background_tasks: BackgroundTasks,
    fila: OrdenAplicacionValvula,
    parcela: Parcela,
) -> None:
    """Push a encargados y superiores: una válvula quedó sin aplicar o con
    observaciones (ver `requiere_revision`)."""
    destinatarios = (
        await db.execute(
            select(User.id).where(
                User.is_active.is_(True),
                User.role.in_(
                    [UserRole.super_admin, UserRole.gerencial, UserRole.encargado]
                ),
            )
        )
    ).scalars().all()
    que = "no se aplicó" if fila.resultado == ResultadoValvula.no_aplicada else "se aplicó con observaciones"
    obs = (fila.observaciones or "")[:120]
    background_tasks.add_task(
        notificar_tokens,
        "Revisar aplicación",
        f"{parcela.nombre} · válvula {fila.valvula.nombre}: {que}. {obs}".strip(),
        user_ids=list(destinatarios),
        data={"tipo": "revisar_valvula", "orden_valvula_id": fila.id},
    )


async def _validar_valvula_ids(
    db: AsyncSession, parcelas: list[Parcela], valvula_ids: list[str] | None
) -> dict[str, set[str]]:
    """Con `valvula_ids=None` devuelve {} (todas las válvulas de cada parcela).
    Con valores, comprueba que existan, estén activas y pertenezcan a las
    parcelas elegidas, y que cada parcela conserve al menos una (si no, esa
    parcela quedaría confirmable entera, que no es lo que se pidió).
    Devuelve {parcela_id: {valvula_id, ...}}."""
    if valvula_ids is None:
        return {}
    if not valvula_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="valvula_ids no puede ser una lista vacía (omitila para incluir todas).",
        )
    valvulas = (
        await db.execute(select(Valvula).where(Valvula.id.in_(valvula_ids)))
    ).scalars().all()
    ids_parcelas = {p.id for p in parcelas}
    invalidas = (set(valvula_ids) - {v.id for v in valvulas}) | {
        v.id for v in valvulas if not v.is_active or v.parcela_id not in ids_parcelas
    }
    if invalidas:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hay válvulas inexistentes, inactivas o que no son de las parcelas elegidas.",
        )
    por_parcela: dict[str, set[str]] = {}
    for v in valvulas:
        por_parcela.setdefault(v.parcela_id, set()).add(v.id)
    sin_valvula = [p.nombre for p in parcelas if p.id not in por_parcela]
    if sin_valvula:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Estas parcelas quedarían sin ninguna de las válvulas elegidas: {', '.join(sin_valvula)}",
        )
    return por_parcela


async def _crear_filas_valvula(
    db: AsyncSession, item: OrdenAplicacionParcela, solo_ids: set[str] | None = None
) -> None:
    """Agrega a `item` una fila pendiente por cada válvula activa de su
    parcela (o solo las de `solo_ids`). Una parcela sin válvulas queda sin
    filas: se confirma entera. `item` debe nacer con `valvulas=[]`: la query de
    acá dispara un autoflush y una colección sin cargar haría lazy-load."""
    stmt = select(Valvula).where(
        Valvula.parcela_id == item.parcela_id, Valvula.is_active.is_(True)
    )
    if solo_ids is not None:
        stmt = stmt.where(Valvula.id.in_(solo_ids))
    for valvula in (await db.execute(stmt)).scalars().all():
        fila = OrdenAplicacionValvula(valvula_id=valvula.id)
        fila.valvula = valvula
        item.valvulas.append(fila)


@router.post(
    "/desde-plan", response_model=OrdenAplicacionResponse, status_code=status.HTTP_201_CREATED
)
async def crear_orden_desde_plan(
    data: OrdenAplicacionCreateDesdePlan,
    background_tasks: BackgroundTasks,
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
        item = OrdenAplicacionParcela(parcela_id=parcela.id, valvulas=[])
        item.parcela = parcela
        orden.parcelas.append(item)
        await _crear_filas_valvula(db, item)

    await db.flush()
    _avisar_orden_nueva(background_tasks, orden)
    return _to_response(orden)


@router.post("/", response_model=OrdenAplicacionResponse, status_code=status.HTTP_201_CREATED)
async def crear_orden_extra(
    data: OrdenAplicacionCreateExtra,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> OrdenAplicacionResponse:
    insumo = await _resolve_insumo(db, data.insumo_id)
    parcelas = await _resolve_parcelas_orden(db, data.variedad, data.parcela_ids)
    valvulas_por_parcela = await _validar_valvula_ids(db, parcelas, data.valvula_ids)

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
        item = OrdenAplicacionParcela(parcela_id=parcela.id, valvulas=[])
        item.parcela = parcela
        orden.parcelas.append(item)
        await _crear_filas_valvula(db, item, valvulas_por_parcela.get(parcela.id))

    await db.flush()
    _avisar_orden_nueva(background_tasks, orden)
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


def requiere_revision(valvula: OrdenAplicacionValvula) -> bool:
    """Una válvula pide revisión si ya se confirmó, nadie la revisó todavía y
    o no se aplicó, o se aplicó con observaciones (la forma de dejar dicho
    "se aplicó a medias": no existe resultado parcial)."""
    if valvula.estado != EstadoOrdenAplicacionParcela.aplicada or valvula.revisada_at is not None:
        return False
    return valvula.resultado == ResultadoValvula.no_aplicada or bool(
        (valvula.observaciones or "").strip()
    )


@router.get("/a-revisar", response_model=list[ValvulaARevisarResponse])
async def list_valvulas_a_revisar(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> list[ValvulaARevisarResponse]:
    """Válvulas confirmadas con problemas o con observaciones, sin revisar.
    Los encargados ven solo su finca; gerencia y super_admin ven todo."""
    stmt = (
        select(OrdenAplicacionValvula)
        .options(
            selectinload(OrdenAplicacionValvula.valvula),
            selectinload(OrdenAplicacionValvula.fotos),
            selectinload(OrdenAplicacionValvula.orden_parcela).selectinload(
                OrdenAplicacionParcela.parcela
            ),
            selectinload(OrdenAplicacionValvula.orden_parcela)
            .selectinload(OrdenAplicacionParcela.orden)
            .selectinload(OrdenAplicacion.insumo),
        )
        .where(
            OrdenAplicacionValvula.estado == EstadoOrdenAplicacionParcela.aplicada,
            OrdenAplicacionValvula.revisada_at.is_(None),
        )
        .order_by(OrdenAplicacionValvula.confirmada_at.desc())
    )
    filas = (await db.execute(stmt)).scalars().all()
    ve_todo = current_user.role in (UserRole.super_admin, UserRole.gerencial)
    resultado: list[ValvulaARevisarResponse] = []
    for fila in filas:
        if not requiere_revision(fila):
            continue
        parcela = fila.orden_parcela.parcela
        if not ve_todo and parcela.finca != current_user.finca:
            continue
        orden = fila.orden_parcela.orden
        resultado.append(
            ValvulaARevisarResponse(
                id=fila.id,
                orden_id=orden.id,
                parcela_id=parcela.id,
                parcela_nombre=parcela.nombre,
                valvula_id=fila.valvula_id,
                valvula_nombre=fila.valvula.nombre,
                variedad=orden.variedad,
                insumo_id=orden.insumo_id,
                insumo_nombre=orden.insumo.nombre,
                dosis_por_ha=orden.dosis_por_ha,
                objetivo=orden.objetivo,
                resultado=fila.resultado,
                responsable=fila.responsable,
                observaciones=fila.observaciones,
                confirmada_at=fila.confirmada_at,
                fotos=[f.url for f in fila.fotos],
            )
        )
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


async def _get_orden_extra_editable(db: AsyncSession, orden_id: str) -> OrdenAplicacion:
    """Solo las órdenes extra (fuera de plan) se editan/eliminan -- las del
    plan se regeneran desde el plan. Y solo mientras ningún operario haya
    confirmado nada: una vez que hay RegistroFitosanitario real (con stock ya
    descontado) la orden deja de ser un borrador."""
    orden = await db.get(OrdenAplicacion, orden_id, options=list(_ORDEN_LOAD_OPTS))
    if orden is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden not found")
    if orden.origen != OrigenOrdenAplicacion.extra:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Las órdenes del plan no se editan ni eliminan desde acá.",
        )
    if any(
        p.estado == EstadoOrdenAplicacionParcela.aplicada
        or any(v.estado == EstadoOrdenAplicacionParcela.aplicada for v in p.valvulas)
        for p in orden.parcelas
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La orden ya tiene aplicaciones confirmadas, no se puede modificar.",
        )
    return orden


@router.put("/{orden_id}", response_model=OrdenAplicacionResponse)
async def actualizar_orden_extra(
    orden_id: str,
    data: OrdenAplicacionUpdateExtra,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> OrdenAplicacionResponse:
    orden = await _get_orden_extra_editable(db, orden_id)
    insumo = await _resolve_insumo(db, data.insumo_id)
    parcelas = await _resolve_parcelas_orden(db, data.variedad, data.parcela_ids)

    orden.variedad = data.variedad
    orden.insumo_id = data.insumo_id
    orden.insumo = insumo
    orden.dosis_por_ha = data.dosis_por_ha
    orden.objetivo = data.objetivo
    orden.dias_carencia = data.dias_carencia
    orden.dias_reingreso = data.dias_reingreso
    orden.fecha_planificada = data.fecha_planificada
    orden.notas = data.notas

    # Todas las filas siguen pendientes (lo garantiza _get_orden_extra_editable):
    # se conservan las parcelas que siguen, se agregan las nuevas y se
    # quitan las que salieron (delete-orphan).
    nuevas_ids = {p.id for p in parcelas}
    orden.parcelas = [item for item in orden.parcelas if item.parcela_id in nuevas_ids]
    existentes = {item.parcela_id for item in orden.parcelas}
    for parcela in parcelas:
        if parcela.id not in existentes:
            item = OrdenAplicacionParcela(parcela_id=parcela.id, valvulas=[])
            item.parcela = parcela
            orden.parcelas.append(item)
            await _crear_filas_valvula(db, item)

    await db.flush()
    return _to_response(orden)


@router.delete("/{orden_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_orden_extra(
    orden_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> None:
    orden = await _get_orden_extra_editable(db, orden_id)
    await db.delete(orden)
    await db.flush()


async def _recalcular_estado_orden(db: AsyncSession, orden: OrdenAplicacion) -> None:
    """completada si todas las parcelas están aplicadas; en_curso si alguna
    parcela o alguna válvula ya se confirmó."""
    await db.refresh(orden, attribute_names=["parcelas"])
    estados = {p.estado for p in orden.parcelas}
    if estados == {EstadoOrdenAplicacionParcela.aplicada}:
        orden.estado = EstadoOrdenAplicacion.completada
        await db.flush()
        return
    valvulas_aplicadas = (
        await db.execute(
            select(func.count(OrdenAplicacionValvula.id))
            .join(OrdenAplicacionParcela)
            .where(
                OrdenAplicacionParcela.orden_id == orden.id,
                OrdenAplicacionValvula.estado == EstadoOrdenAplicacionParcela.aplicada,
            )
        )
    ).scalar_one()
    if EstadoOrdenAplicacionParcela.aplicada in estados or valvulas_aplicadas:
        orden.estado = EstadoOrdenAplicacion.en_curso
    await db.flush()


def _calcular_cantidad_valvula(dosis_por_ha: float, valvula: Valvula) -> Decimal:
    if valvula.superficie_ha is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"La válvula {valvula.nombre} no tiene hectáreas cargadas — no se puede calcular la cantidad aplicada.",
        )
    return (Decimal(str(dosis_por_ha)) * Decimal(str(valvula.superficie_ha))).quantize(Decimal("0.01"))


@router.post(
    "/{orden_id}/valvulas/{orden_valvula_id}/confirmar",
    response_model=OrdenAplicacionValvulaResponse,
)
async def confirmar_valvula(
    orden_id: str,
    orden_valvula_id: str,
    data: ConfirmarValvulaRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_role),
) -> OrdenAplicacionValvulaResponse:
    orden = await db.get(OrdenAplicacion, orden_id, options=[selectinload(OrdenAplicacion.insumo)])
    if orden is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden not found")

    # FOR UPDATE: un doble toque o un reintento de red no puede confirmar (y
    # descontar stock) dos veces la misma válvula.
    fila = await db.get(
        OrdenAplicacionValvula,
        orden_valvula_id,
        options=[
            selectinload(OrdenAplicacionValvula.valvula),
            selectinload(OrdenAplicacionValvula.orden_parcela).selectinload(
                OrdenAplicacionParcela.parcela
            ),
        ],
        with_for_update=True,
    )
    if fila is None or fila.orden_parcela.orden_id != orden_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Válvula de la orden not found"
        )
    if fila.estado == EstadoOrdenAplicacionParcela.aplicada:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Esta válvula ya fue confirmada"
        )

    item = fila.orden_parcela
    parcela = item.parcela
    if current_user.role not in (UserRole.super_admin, UserRole.gerencial):
        if parcela.finca != current_user.finca:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No podés confirmar aplicaciones fuera de tu finca.",
            )

    observaciones = (data.observaciones or "").strip() or None
    if data.resultado == ResultadoValvula.no_aplicada and observaciones is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Si la válvula no se aplicó, contá por qué en las observaciones.",
        )

    responsable_id = data.responsable_id or current_user.trabajador_id
    responsable_nombre = current_user.full_name
    if responsable_id:
        responsable_nombre = await _resolve_responsable_nombre(db, responsable_id)

    if data.resultado == ResultadoValvula.completa:
        cantidad_total = _calcular_cantidad_valvula(orden.dosis_por_ha, fila.valvula)
        fito = RegistroFitosanitario(
            fecha=date.today(),
            parcela_id=parcela.id,
            valvula_id=fila.valvula_id,
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
            observaciones=observaciones,
            created_by=current_user.id,
        )
        db.add(fito)
        await db.flush()
        await _aplicar_movimiento_stock(db, fito, orden.insumo, cantidad_total, current_user.id)
        fila.registro_fitosanitario_id = fito.id

    fila.estado = EstadoOrdenAplicacionParcela.aplicada
    fila.resultado = data.resultado
    fila.responsable_id = responsable_id
    fila.responsable = responsable_nombre
    fila.observaciones = observaciones
    fila.confirmada_at = datetime.now(timezone.utc)
    await db.flush()

    pendientes = (
        await db.execute(
            select(func.count(OrdenAplicacionValvula.id)).where(
                OrdenAplicacionValvula.orden_parcela_id == item.id,
                OrdenAplicacionValvula.estado == EstadoOrdenAplicacionParcela.pendiente,
            )
        )
    ).scalar_one()
    if pendientes == 0:
        item.estado = EstadoOrdenAplicacionParcela.aplicada
        await db.flush()
    await _recalcular_estado_orden(db, orden)

    if requiere_revision(fila):
        await _avisar_revision(db, background_tasks, fila, parcela)

    return _valvula_response(fila)


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
        options=[
            selectinload(OrdenAplicacionParcela.parcela),
            selectinload(OrdenAplicacionParcela.valvulas),
        ],
    )
    if item is None or item.orden_id != orden_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Parcela de la orden not found"
        )
    if item.estado == EstadoOrdenAplicacionParcela.aplicada:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Esta parcela ya fue confirmada"
        )
    if item.valvulas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta parcela se confirma válvula por válvula.",
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

    await _recalcular_estado_orden(db, orden)

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


@router.post(
    "/valvulas/{orden_valvula_id}/fotos",
    response_model=FotoRegistroFitosanitarioResponse,
    status_code=status.HTTP_201_CREATED,
)
async def subir_foto_valvula(
    orden_valvula_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_role),
) -> FotoRegistroFitosanitarioResponse:
    fila = await db.get(OrdenAplicacionValvula, orden_valvula_id)
    if fila is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Válvula de la orden not found"
        )
    if fila.estado != EstadoOrdenAplicacionParcela.aplicada:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Primero hay que confirmar la válvula antes de subir fotos.",
        )

    raw = await file.read()
    url = await upload_foto_orden_aplicacion(raw, file.content_type or "", orden_valvula_id)

    # Una válvula no_aplicada no tiene registro: la foto cuelga solo de la fila.
    foto = FotoRegistroFitosanitario(
        registro_fitosanitario_id=fila.registro_fitosanitario_id,
        orden_valvula_id=fila.id,
        url=url,
        created_by=current_user.id,
    )
    db.add(foto)
    await db.flush()
    await db.refresh(foto)
    return foto


@router.post("/valvulas/{orden_valvula_id}/revisar", status_code=status.HTTP_204_NO_CONTENT)
async def revisar_valvula(
    orden_valvula_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> None:
    """Marca la válvula como revisada (con o sin orden de repaso): sale del
    listado "A revisar". Idempotente."""
    fila = await db.get(
        OrdenAplicacionValvula,
        orden_valvula_id,
        options=[
            selectinload(OrdenAplicacionValvula.orden_parcela).selectinload(
                OrdenAplicacionParcela.parcela
            )
        ],
    )
    if fila is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Válvula de la orden not found"
        )
    if current_user.role not in (UserRole.super_admin, UserRole.gerencial):
        if fila.orden_parcela.parcela.finca != current_user.finca:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No podés revisar válvulas fuera de tu finca.",
            )
    if fila.estado != EstadoOrdenAplicacionParcela.aplicada:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La válvula todavía no se confirmó, no hay nada que revisar.",
        )
    if fila.revisada_at is None:
        fila.revisada_at = datetime.now(timezone.utc)
        fila.revisada_por = current_user.id
        await db.flush()
