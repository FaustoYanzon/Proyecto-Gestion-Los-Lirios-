import logging
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_any_role, require_encargado_estricto, require_encargado_up
from app.api.produccion import (
    _aplicar_movimiento_stock,
    _resolve_insumo,
    _resolve_responsable_nombre,
)
from app.core.cloudinary_client import upload_foto_orden_aplicacion
from app.core.push import lanzar_aviso, notificar_tokens
from app.models.insumo import Insumo
from app.models.parcela import Parcela, VariedadUva
from app.models.valvula import Valvula
from app.models.produccion import (
    EstadoOrdenAplicacion,
    EstadoOrdenAplicacionParcela,
    FotoRegistroFitosanitario,
    OrdenAplicacion,
    OrdenAplicacionInsumo,
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
    OrdenAplicacionCreate,
    OrdenAplicacionCreateDesdePlan,
    OrdenAplicacionLineaCreate,
    OrdenAplicacionLineaResponse,
    OrdenAplicacionParcelaResponse,
    OrdenAplicacionResponse,
    OrdenAplicacionUpdate,
    OrdenAplicacionValvulaResponse,
    ValvulaARevisarResponse,
)
from app.services.aplicaciones import (
    bloquear_orden,
    deshacer_fila_valvula,
    recalcular_estado_orden,
)
from app.services.plan_vinculo import resolver_plan_id

logger = logging.getLogger("app")

router = APIRouter(prefix="/ordenes-aplicacion", tags=["Ordenes Aplicacion"])

_ORDEN_LOAD_OPTS = (
    selectinload(OrdenAplicacion.insumo),
    selectinload(OrdenAplicacion.lineas).selectinload(OrdenAplicacionInsumo.insumo),
    selectinload(OrdenAplicacion.parcelas).selectinload(OrdenAplicacionParcela.parcela),
    selectinload(OrdenAplicacion.parcelas).selectinload(OrdenAplicacionParcela.registros),
    selectinload(OrdenAplicacion.parcelas)
    .selectinload(OrdenAplicacionParcela.valvulas)
    .selectinload(OrdenAplicacionValvula.valvula),
    selectinload(OrdenAplicacion.parcelas)
    .selectinload(OrdenAplicacionParcela.valvulas)
    .selectinload(OrdenAplicacionValvula.registros),
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


def _variedades_orden(orden: OrdenAplicacion) -> list[VariedadUva]:
    """Distinct varieties of the order's parcels, sorted for a stable payload.
    Requires `orden.parcelas[*].parcela` loaded."""
    return sorted(
        {item.parcela.variedad for item in orden.parcelas if item.parcela.variedad is not None},
        key=lambda v: v.value,
    )


def _variedad_principal(parcelas: list[Parcela]) -> VariedadUva | None:
    """Variety of the largest parcel (unknown area counts as zero; ties go to
    the parcel name) -- the single `variedad` old clients still read."""
    con_variedad = [p for p in parcelas if p.variedad is not None]
    if not con_variedad:
        return None
    mayor = max(con_variedad, key=lambda p: (p.superficie_ha or 0.0, p.nombre))
    return mayor.variedad


def _linea_response(linea: OrdenAplicacionInsumo) -> OrdenAplicacionLineaResponse:
    return OrdenAplicacionLineaResponse(
        id=linea.id,
        insumo_id=linea.insumo_id,
        insumo_nombre=linea.insumo.nombre,
        insumo_unidad=linea.insumo.unidad,
        dosis_por_ha=linea.dosis_por_ha,
        dias_carencia=linea.dias_carencia,
        dias_reingreso=linea.dias_reingreso,
        numero_aplicacion=linea.numero_aplicacion,
    )


def _to_response(orden: OrdenAplicacion) -> OrdenAplicacionResponse:
    # Shim fields come from the order columns, which `_sincronizar_shim` keeps
    # equal to the first line (and to the largest parcel's variety).
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
        lineas=[_linea_response(linea) for linea in orden.lineas],
        variedades=_variedades_orden(orden),
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
    db: AsyncSession, variedad: VariedadUva | None, parcela_ids: list[str] | None
) -> list[Parcela]:
    """Resuelve las parcelas de una orden. Una lista explícita de
    `parcela_ids` puede mezclar variedades (deben estar activas); si además
    viene `variedad` (body viejo de un producto) todas deben ser de esa
    variedad. `parcela_ids=None` + `variedad` = todas las parcelas activas de
    esa variedad. Sin ninguno de los dos no hay orden posible."""
    if parcela_ids is not None:
        if not parcela_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="parcela_ids no puede ser una lista vacía (omitila para incluir toda la variedad).",
            )
        parcelas = list(
            (await db.execute(select(Parcela).where(Parcela.id.in_(parcela_ids)))).scalars().all()
        )
        encontrados = {p.id for p in parcelas}
        faltantes = set(parcela_ids) - encontrados
        if faltantes:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Parcelas no encontradas: {', '.join(sorted(faltantes))}",
            )
        inactivas = [p.nombre for p in parcelas if not p.is_active]
        if inactivas:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Estas parcelas están inactivas: {', '.join(inactivas)}",
            )
        if variedad is not None:
            fuera_de_variedad = [p.nombre for p in parcelas if p.variedad != variedad]
            if fuera_de_variedad:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Estas parcelas no son de la variedad {variedad.value}: {', '.join(fuera_de_variedad)}",
                )
        # The legacy `variedad` column is NOT NULL: some parcel must carry one.
        if _variedad_principal(parcelas) is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ninguna de las parcelas elegidas tiene variedad cargada.",
            )
        return parcelas

    if variedad is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Elegí las parcelas de la orden (o una variedad para incluirla entera).",
        )
    parcelas = list(
        (
            await db.execute(
                select(Parcela).where(Parcela.is_active.is_(True), Parcela.variedad == variedad)
            )
        ).scalars().all()
    )
    if not parcelas:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No hay parcelas activas para la variedad {variedad.value}.",
        )
    return parcelas


def _avisar_orden_nueva(orden: OrdenAplicacion) -> None:
    """Push a todos los celulares: salió una orden de aplicación nueva."""
    nombres = [p.parcela.nombre for p in orden.parcelas]
    parcelas = ", ".join(nombres[:3]) + (f" y {len(nombres) - 3} más" if len(nombres) > 3 else "")
    # One product keeps the pre-multiproduct text so existing users see no change.
    productos = orden.lineas[0].insumo.nombre
    if len(orden.lineas) > 1:
        productos += f" +{len(orden.lineas) - 1} más"
    lanzar_aviso(
        notificar_tokens(
            "Nueva orden de aplicación",
            f"{productos} · {parcelas}",
            user_ids=None,
            data={"tipo": "orden_aplicacion", "orden_id": orden.id},
        )
    )


async def _avisar_revision(
    db: AsyncSession,
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
    lanzar_aviso(
        notificar_tokens(
            "Revisar aplicación",
            f"{parcela.nombre} · válvula {fila.valvula.nombre}: {que}. {obs}".strip(),
            user_ids=list(destinatarios),
            data={"tipo": "revisar_valvula", "orden_valvula_id": fila.id},
        )
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


async def _resolver_insumos(
    db: AsyncSession, lineas: list[OrdenAplicacionLineaCreate]
) -> dict[str, Insumo]:
    """Insumo of every line (404 if one does not exist), keyed by id."""
    return {linea.insumo_id: await _resolve_insumo(db, linea.insumo_id) for linea in lineas}


PlanesPorRonda = dict[tuple[int, str], list[PlanFitosanitario]]


async def _validar_rondas_plan(
    db: AsyncSession,
    temporada: int,
    lineas: list[OrdenAplicacionLineaCreate],
    parcelas: list[Parcela],
    insumos: dict[str, Insumo],
) -> PlanesPorRonda:
    """A line with `numero_aplicacion` must match a plan row
    (temporada, numero_aplicacion, insumo) for at least one variety of the
    chosen parcels; otherwise it would count against a round that does not
    exist. Returns the matching plan rows keyed by (numero_aplicacion, insumo_id)."""
    con_ronda = [linea for linea in lineas if linea.numero_aplicacion is not None]
    if not con_ronda:
        return {}
    variedades = {p.variedad for p in parcelas if p.variedad is not None}
    filas = (
        await db.execute(
            select(PlanFitosanitario).where(
                PlanFitosanitario.temporada == temporada,
                PlanFitosanitario.numero_aplicacion.in_({l.numero_aplicacion for l in con_ronda}),
                PlanFitosanitario.insumo_id.in_({l.insumo_id for l in con_ronda}),
                PlanFitosanitario.variedad.in_(variedades),
            )
        )
    ).scalars().all()
    planes: PlanesPorRonda = {}
    for fila in sorted(filas, key=lambda f: (f.variedad.value, f.id)):
        planes.setdefault((fila.numero_aplicacion, fila.insumo_id), []).append(fila)
    for linea in con_ronda:
        if (linea.numero_aplicacion, linea.insumo_id) not in planes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"La ronda {linea.numero_aplicacion} del plan {temporada} no tiene "
                    f"{insumos[linea.insumo_id].nombre} para las variedades de las parcelas elegidas."
                ),
            )
    return planes


def _aplicar_lineas(
    orden: OrdenAplicacion,
    lineas: list[OrdenAplicacionLineaCreate],
    insumos: dict[str, Insumo],
) -> None:
    """Replace the order's lines with `lineas` (removed ones go via
    delete-orphan). A product already on the order keeps its row, updated in
    place: deleting and re-inserting the same (orden_id, insumo_id) in one
    flush would hit the unique index, since the unit of work inserts first."""
    existentes = {linea.insumo_id: linea for linea in orden.lineas}
    nuevas: list[OrdenAplicacionInsumo] = []
    for posicion, data in enumerate(lineas):
        linea = existentes.get(data.insumo_id) or OrdenAplicacionInsumo(insumo_id=data.insumo_id)
        linea.insumo = insumos[data.insumo_id]
        linea.dosis_por_ha = data.dosis_por_ha
        linea.dias_carencia = data.dias_carencia
        linea.dias_reingreso = data.dias_reingreso
        linea.numero_aplicacion = data.numero_aplicacion
        linea.posicion = posicion
        nuevas.append(linea)
    orden.lineas = nuevas


def _sincronizar_shim(orden: OrdenAplicacion) -> None:
    """Write the deprecated single-product columns (still NOT NULL until the
    cleanup migration) from the first line and the largest parcel's variety,
    and derive `origen` from the lines. Requires `orden.lineas` (with
    `insumo`) and `orden.parcelas[*].parcela` in memory. The legacy
    `plan_fitosanitario_id` needs the plan rows: see `_plan_id_shim`."""
    primera = orden.lineas[0]
    orden.insumo_id = primera.insumo_id
    orden.insumo = primera.insumo
    orden.dosis_por_ha = primera.dosis_por_ha
    orden.dias_carencia = primera.dias_carencia
    orden.dias_reingreso = primera.dias_reingreso
    variedad = _variedad_principal([item.parcela for item in orden.parcelas])
    if variedad is not None:  # Guaranteed by _resolve_parcelas_orden.
        orden.variedad = variedad
    orden.origen = (
        OrigenOrdenAplicacion.plan
        if any(linea.numero_aplicacion is not None for linea in orden.lineas)
        else OrigenOrdenAplicacion.extra
    )


def _plan_id_shim(orden: OrdenAplicacion, planes: PlanesPorRonda) -> str | None:
    """Legacy `plan_fitosanitario_id`: the plan row of the first line,
    preferring the shim variety. Keeps the current value while it still
    matches, so an edit never swaps it for a twin row."""
    primera = orden.lineas[0]
    if primera.numero_aplicacion is None:
        return None
    candidatos = planes.get((primera.numero_aplicacion, primera.insumo_id), [])
    if orden.plan_fitosanitario_id in {fila.id for fila in candidatos}:
        return orden.plan_fitosanitario_id
    for fila in candidatos:
        if fila.variedad == orden.variedad:
            return fila.id
    return candidatos[0].id if candidatos else None


async def _crear_orden(
    db: AsyncSession, data: OrdenAplicacionCreate, user: User
) -> OrdenAplicacion:
    """Shared by POST / and POST /desde-plan: validate, build the order with
    its lines, parcels and valve rows, and flush."""
    insumos = await _resolver_insumos(db, data.lineas)
    parcelas = await _resolve_parcelas_orden(db, data.variedad, data.parcela_ids)
    valvulas_por_parcela = await _validar_valvula_ids(db, parcelas, data.valvula_ids)
    planes = await _validar_rondas_plan(db, data.temporada, data.lineas, parcelas, insumos)

    orden = OrdenAplicacion(
        temporada=data.temporada,
        objetivo=data.objetivo,
        fecha_planificada=data.fecha_planificada,
        notas=data.notas,
        created_by=user.id,
    )
    _aplicar_lineas(orden, data.lineas, insumos)
    for parcela in parcelas:
        item = OrdenAplicacionParcela(parcela_id=parcela.id, valvulas=[])
        item.parcela = parcela
        orden.parcelas.append(item)
    # Shim columns are NOT NULL: set them before the valve queries autoflush.
    _sincronizar_shim(orden)
    orden.plan_fitosanitario_id = _plan_id_shim(orden, planes)
    db.add(orden)
    for item in orden.parcelas:
        await _crear_filas_valvula(db, item, valvulas_por_parcela.get(item.parcela_id))

    await db.flush()
    return orden


@router.post(
    "/desde-plan", response_model=OrdenAplicacionResponse, status_code=status.HTTP_201_CREATED
)
async def crear_orden_desde_plan(
    data: OrdenAplicacionCreateDesdePlan,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> OrdenAplicacionResponse:
    """Compatible shortcut: a one-line order from a single plan row."""
    plan = await db.get(PlanFitosanitario, data.plan_fitosanitario_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    try:
        orden_data = OrdenAplicacionCreate(
            temporada=plan.temporada,
            objetivo=plan.objetivo,
            fecha_planificada=data.fecha_planificada,
            lineas=[
                OrdenAplicacionLineaCreate(
                    insumo_id=plan.insumo_id,
                    dosis_por_ha=plan.dosis_por_ha,
                    dias_carencia=data.dias_carencia,
                    dias_reingreso=data.dias_reingreso,
                    numero_aplicacion=plan.numero_aplicacion,
                )
            ],
            parcela_ids=data.parcela_ids,
            # Restricts explicit parcels to the plan row's variety, as before.
            variedad=plan.variedad,
            notas=data.notas,
        )
    except ValidationError as exc:
        # Only reachable with a bad plan row (e.g. dosis 0): a 422, not a 500.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fila del plan tiene datos inválidos para armar una orden (revisá la dosis).",
        ) from exc

    orden = await _crear_orden(db, orden_data, current_user)
    # The exact row the user picked (the round lookup could match a twin row).
    orden.plan_fitosanitario_id = plan.id
    await db.flush()
    _avisar_orden_nueva(orden)
    return _to_response(orden)


@router.post("/", response_model=OrdenAplicacionResponse, status_code=status.HTTP_201_CREATED)
async def crear_orden(
    data: OrdenAplicacionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> OrdenAplicacionResponse:
    """Unified create: N product lines over parcels of one or more varieties.
    Also accepts the old single-product body (see OrdenAplicacionCreate)."""
    orden = await _crear_orden(db, data, current_user)
    _avisar_orden_nueva(orden)
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


async def _get_orden_editable(db: AsyncSession, orden_id: str) -> OrdenAplicacion:
    """Toda orden (del plan o extra) se edita/elimina mientras ningún operario
    haya confirmado nada: una vez que hay RegistroFitosanitario real (con
    stock ya descontado) la orden deja de ser un borrador."""
    orden = await db.get(OrdenAplicacion, orden_id, options=list(_ORDEN_LOAD_OPTS))
    if orden is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden not found")
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
async def actualizar_orden(
    orden_id: str,
    data: OrdenAplicacionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> OrdenAplicacionResponse:
    orden = await _get_orden_editable(db, orden_id)
    insumos = await _resolver_insumos(db, data.lineas)
    parcelas = await _resolve_parcelas_orden(db, data.variedad, data.parcela_ids)
    valvulas_por_parcela = await _validar_valvula_ids(db, parcelas, data.valvula_ids)
    planes = await _validar_rondas_plan(db, orden.temporada, data.lineas, parcelas, insumos)

    orden.objetivo = data.objetivo
    orden.fecha_planificada = data.fecha_planificada
    orden.notas = data.notas
    _aplicar_lineas(orden, data.lineas, insumos)

    # Todas las filas siguen pendientes (lo garantiza _get_orden_editable):
    # se conservan las parcelas que siguen, se agregan las nuevas y se
    # quitan las que salieron (delete-orphan).
    nuevas_ids = {p.id for p in parcelas}
    orden.parcelas = [item for item in orden.parcelas if item.parcela_id in nuevas_ids]
    conservadas = list(orden.parcelas)
    existentes = {item.parcela_id for item in conservadas}
    agregadas: list[OrdenAplicacionParcela] = []
    for parcela in parcelas:
        if parcela.id not in existentes:
            item = OrdenAplicacionParcela(parcela_id=parcela.id, valvulas=[])
            item.parcela = parcela
            orden.parcelas.append(item)
            agregadas.append(item)
    # Before any query below autoflushes the order.
    _sincronizar_shim(orden)
    orden.plan_fitosanitario_id = _plan_id_shim(orden, planes)

    for item in agregadas:
        await _crear_filas_valvula(db, item, valvulas_por_parcela.get(item.parcela_id))
    if data.valvula_ids is not None:
        # Explicit valves also reshape the parcels the order already had.
        for item in conservadas:
            elegidas = valvulas_por_parcela[item.parcela_id]
            item.valvulas = [v for v in item.valvulas if v.valvula_id in elegidas]
            faltantes = elegidas - {v.valvula_id for v in item.valvulas}
            if faltantes:
                await _crear_filas_valvula(db, item, faltantes)

    await db.flush()
    return _to_response(orden)


@router.delete("/{orden_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_orden(
    orden_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> None:
    orden = await _get_orden_editable(db, orden_id)
    await db.delete(orden)
    await db.flush()


def _superficie_valvula(valvula: Valvula) -> Decimal:
    if valvula.superficie_ha is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"La válvula {valvula.nombre} no tiene hectáreas cargadas — no se puede calcular la cantidad aplicada.",
        )
    return Decimal(str(valvula.superficie_ha))


def _superficie_parcela(parcela: Parcela) -> Decimal:
    if parcela.superficie_ha is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La parcela no tiene hectáreas cargadas — no se puede calcular la cantidad total aplicada.",
        )
    return Decimal(str(parcela.superficie_ha))


async def _crear_registros_orden(
    db: AsyncSession,
    *,
    orden: OrdenAplicacion,
    parcela: Parcela,
    item: OrdenAplicacionParcela,
    fila: OrdenAplicacionValvula | None,
    superficie_ha: Decimal,
    fecha: date,
    responsable: str,
    responsable_id: str | None,
    observaciones: str | None,
    user_id: str,
) -> list[RegistroFitosanitario]:
    """One RegistroFitosanitario (plus its stock movement) per order line, in
    line order. Requires `orden.lineas[*].insumo` loaded and the order locked.

    Quantities and plan links are all resolved before the first `db.add`, so
    a validation failure leaves nothing pending in the session (get_db's
    rollback is only the safety net). Returns the records; the first one is
    the legacy link callers write on the parcel/valve row."""
    if not orden.lineas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La orden no tiene productos cargados.",
        )

    preparadas: list[tuple[OrdenAplicacionInsumo, Decimal, str | None]] = []
    for linea in orden.lineas:
        cantidad = (Decimal(str(linea.dosis_por_ha)) * superficie_ha).quantize(Decimal("0.01"))
        # A parcel without variety cannot match any plan row (variedad is NOT NULL there).
        plan_id = (
            await resolver_plan_id(
                db,
                temporada=orden.temporada,
                variedad=parcela.variedad,
                insumo_id=linea.insumo_id,
                numero_aplicacion=linea.numero_aplicacion,
            )
            if parcela.variedad is not None
            else None
        )
        preparadas.append((linea, cantidad, plan_id))

    registros: list[RegistroFitosanitario] = []
    for linea, cantidad, plan_id in preparadas:
        fito = RegistroFitosanitario(
            fecha=fecha,
            parcela_id=parcela.id,
            valvula_id=fila.valvula_id if fila is not None else None,
            producto_nombre=linea.insumo.nombre,
            dosis_por_ha=linea.dosis_por_ha,
            insumo_id=linea.insumo_id,
            unidad=linea.insumo.unidad,
            cantidad_total=cantidad,
            motivo=orden.objetivo,
            dias_carencia=linea.dias_carencia,
            dias_reingreso=linea.dias_reingreso,
            responsable=responsable,
            responsable_id=responsable_id,
            observaciones=observaciones,
            plan_fitosanitario_id=plan_id,
            orden_insumo_id=linea.id,
            orden_parcela_id=item.id,
            orden_valvula_id=fila.id if fila is not None else None,
            created_by=user_id,
        )
        db.add(fito)
        registros.append(fito)
    # Flush once so every record has its id before the movements reference it.
    await db.flush()
    for fito, (linea, cantidad, _plan_id) in zip(registros, preparadas):
        await _aplicar_movimiento_stock(db, fito, linea.insumo, cantidad, user_id)
    return registros


@router.post(
    "/{orden_id}/valvulas/{orden_valvula_id}/confirmar",
    response_model=OrdenAplicacionValvulaResponse,
)
async def confirmar_valvula(
    orden_id: str,
    orden_valvula_id: str,
    data: ConfirmarValvulaRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_role),
) -> OrdenAplicacionValvulaResponse:
    orden = await db.get(
        OrdenAplicacion,
        orden_id,
        options=[selectinload(OrdenAplicacion.lineas).selectinload(OrdenAplicacionInsumo.insumo)],
    )
    if orden is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden not found")

    await bloquear_orden(db, orden_id)
    fila = await db.get(
        OrdenAplicacionValvula,
        orden_valvula_id,
        options=[
            selectinload(OrdenAplicacionValvula.valvula),
            selectinload(OrdenAplicacionValvula.orden_parcela).selectinload(
                OrdenAplicacionParcela.parcela
            ),
        ],
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
        registros = await _crear_registros_orden(
            db,
            orden=orden,
            parcela=parcela,
            item=item,
            fila=fila,
            superficie_ha=_superficie_valvula(fila.valvula),
            fecha=date.today(),
            responsable=responsable_nombre,
            responsable_id=responsable_id,
            observaciones=observaciones,
            user_id=current_user.id,
        )
        # Legacy 1-1 link (old clients, photos): the first line's record.
        fila.registro_fitosanitario_id = registros[0].id

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
    await recalcular_estado_orden(db, orden)

    if requiere_revision(fila):
        await _avisar_revision(db, fila, parcela)

    return _valvula_response(fila)


@router.post(
    "/{orden_id}/valvulas/{orden_valvula_id}/deshacer",
    response_model=OrdenAplicacionValvulaResponse,
)
async def deshacer_valvula(
    orden_id: str,
    orden_valvula_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> OrdenAplicacionValvulaResponse:
    """Revierte la confirmación de una válvula: devuelve el stock, borra el
    registro fitosanitario y sus fotos, y deja la fila (y la parcela/orden) en
    pendiente para poder confirmarla de nuevo."""
    orden = await db.get(OrdenAplicacion, orden_id)
    if orden is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden not found")

    await bloquear_orden(db, orden_id)
    fila = await db.get(
        OrdenAplicacionValvula,
        orden_valvula_id,
        options=[
            selectinload(OrdenAplicacionValvula.valvula),
            selectinload(OrdenAplicacionValvula.orden_parcela).selectinload(
                OrdenAplicacionParcela.parcela
            ),
            selectinload(OrdenAplicacionValvula.registros),
        ],
    )
    if fila is None or fila.orden_parcela.orden_id != orden_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Válvula de la orden not found"
        )

    item = fila.orden_parcela
    parcela = item.parcela
    if current_user.role not in (UserRole.super_admin, UserRole.gerencial):
        if parcela.finca != current_user.finca:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No podés deshacer aplicaciones fuera de tu finca.",
            )

    # Checked after the lock so a concurrent double undo gets 409, not a double refund.
    if fila.estado == EstadoOrdenAplicacionParcela.pendiente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Esta válvula todavía no fue confirmada"
        )

    # Shared with POST /produccion/fitosanitarios/{id}/reactivar.
    registro_id = await deshacer_fila_valvula(db, fila, orden)

    # The action deletes data (registro, photos, stock movement): leave an audit trail.
    logger.info(
        "deshacer_valvula user=%s orden=%s valvula_fila=%s registro=%s",
        current_user.id, orden_id, orden_valvula_id, registro_id,
    )
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
    orden = await db.get(
        OrdenAplicacion,
        orden_id,
        options=[selectinload(OrdenAplicacion.lineas).selectinload(OrdenAplicacionInsumo.insumo)],
    )
    if orden is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden not found")

    await bloquear_orden(db, orden_id)
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

    registros = await _crear_registros_orden(
        db,
        orden=orden,
        parcela=parcela,
        item=item,
        fila=None,
        superficie_ha=_superficie_parcela(parcela),
        fecha=date.today(),
        responsable=responsable_nombre,
        responsable_id=responsable_id,
        observaciones=data.observaciones,
        user_id=current_user.id,
    )

    item.estado = EstadoOrdenAplicacionParcela.aplicada
    # Legacy 1-1 link (old clients, photos): the first line's record.
    item.registro_fitosanitario_id = registros[0].id
    await db.flush()

    await recalcular_estado_orden(db, orden)

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
                detail="No podés subir fotos fuera de tu finca.",
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
