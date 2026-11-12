from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_encargado_estricto, require_gerencial_up
from app.core.cloudinary_client import encolar_borrado, upload_foto_maquinaria_orden
from app.core.database import get_db
from app.models.finanzas import Finca
from app.models.maquinaria import (
    FotoOrdenMaquinaria,
    GravedadFalla,
    Maquina,
    OrdenMaquinaria,
    PagoMaquinaria,
    PresupuestoMaquinaria,
    TipoMaquina,
)
from app.models.maquinaria import EstadoOrdenMaquinaria as E
from app.models.user import User
from app.schemas.maquinaria import (
    FotoOrdenResponse,
    HistorialMaquinaResponse,
    HistorialOrden,
    MaquinaCreate,
    MaquinaResponse,
    MaquinaUpdate,
    OrdenCreate,
    OrdenDetalleResponse,
    OrdenResponse,
    OrdenUpdate,
    PagoCreate,
    PagoResponse,
    PresupuestoCreate,
    PresupuestoResolver,
    PresupuestoResponse,
    TransicionRequest,
)
from app.services import maquinaria as svc

# Whole module is encargado+ (decision 2); manage/approve/pay endpoints add
# require_gerencial_up on top.
router = APIRouter(
    prefix="/maquinaria",
    tags=["Maquinaria"],
    dependencies=[Depends(require_encargado_estricto)],
)

_ORDEN_DETALLE_OPTS = (
    selectinload(OrdenMaquinaria.maquina),
    selectinload(OrdenMaquinaria.fotos),
    selectinload(OrdenMaquinaria.presupuestos),
    selectinload(OrdenMaquinaria.pago),
    selectinload(OrdenMaquinaria.eventos),
)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _serialize_orden(
    db: AsyncSession, orden: OrdenMaquinaria, user: User
) -> OrdenDetalleResponse:
    """Detail response with money fields nulled for roles below gerencial.
    Choice: rejection reasons (`motivo_rechazo`) and timeline notes stay visible
    to the encargado; amounts and attachments/invoices never do."""
    resp = OrdenDetalleResponse.model_validate(orden)
    # One lookup for every actor in the timeline (users list is super_admin only,
    # so the client cannot resolve names by itself).
    ids = {ev.usuario_id for ev in resp.eventos}
    if ids:
        rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
        nombres = {uid: nombre for uid, nombre in rows.all()}
        for ev in resp.eventos:
            ev.usuario_nombre = nombres.get(ev.usuario_id)
    if not svc.es_gerencial_up(user):
        for presupuesto in resp.presupuestos:
            presupuesto.monto = None
            presupuesto.adjunto_url = None
        if resp.pago is not None:
            resp.pago.monto_real = None
            resp.pago.factura_url = None
    return resp


def _maquina_response(maquina: Maquina, pares: list[tuple[E, GravedadFalla]]) -> MaquinaResponse:
    estado = svc.estado_maquina(pares)
    data = {c.key: getattr(maquina, c.key) for c in Maquina.__table__.columns}
    data["icono"] = maquina.icono_resuelto
    return MaquinaResponse(
        **data,
        estado=estado,
        semaforo=svc.SEMAFORO[estado],
        ordenes_abiertas=sum(1 for e, _ in pares if e in svc.ESTADOS_ABIERTOS),
    )


async def _pares_abiertos(
    db: AsyncSession, maquina_ids: list[str]
) -> dict[str, list[tuple[E, GravedadFalla]]]:
    pares: dict[str, list[tuple[E, GravedadFalla]]] = {mid: [] for mid in maquina_ids}
    if not maquina_ids:
        return pares
    res = await db.execute(
        select(OrdenMaquinaria.maquina_id, OrdenMaquinaria.estado, OrdenMaquinaria.gravedad).where(
            OrdenMaquinaria.maquina_id.in_(maquina_ids),
            OrdenMaquinaria.estado.in_(list(svc.ESTADOS_ABIERTOS)),
        )
    )
    for maquina_id, estado, gravedad in res.all():
        pares[maquina_id].append((estado, gravedad))
    return pares


async def _get_maquina(db: AsyncSession, maquina_id: str, user: User) -> Maquina:
    maquina = await db.get(Maquina, maquina_id)
    # 404 (not 403) for other fincas so an encargado cannot probe for ids.
    if maquina is None or not svc.puede_ver_finca(user, maquina.finca):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Máquina no encontrada")
    return maquina


async def _get_orden(db: AsyncSession, orden_id: str, user: User) -> OrdenMaquinaria:
    """Order with all relations loaded (fresh from the DB), visible to `user`."""
    res = await db.execute(
        select(OrdenMaquinaria)
        .where(OrdenMaquinaria.id == orden_id)
        .options(*_ORDEN_DETALLE_OPTS)
        .execution_options(populate_existing=True)
    )
    orden = res.scalar_one_or_none()
    if orden is None or not svc.puede_ver_finca(user, orden.finca):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden no encontrada")
    return orden


async def _validar_tractor(db: AsyncSession, tractor_id: str | None, self_id: str | None) -> None:
    """tractor_id must be an active tractor, not the machine itself, with no cycle."""
    if tractor_id is None:
        return
    error = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="El tractor asociado no existe, está dado de baja o no es un tractor.",
    )
    tractor = await db.get(Maquina, tractor_id)
    if tractor is None or tractor.tipo != TipoMaquina.tractor or not tractor.is_active:
        raise error
    if self_id is not None:
        # Walk the chain upwards; reaching the machine itself means a cycle.
        visitados: set[str] = set()
        actual: Maquina | None = tractor
        while actual is not None and actual.id not in visitados:
            if actual.id == self_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El tractor asociado generaría una referencia circular.",
                )
            visitados.add(actual.id)
            actual = await db.get(Maquina, actual.tractor_id) if actual.tractor_id else None


# ── Máquinas ──────────────────────────────────────────────────────────────────

@router.get("/maquinas", response_model=list[MaquinaResponse])
async def listar_maquinas(
    finca: Finca | None = None,
    tipo: TipoMaquina | None = None,
    estado: svc.EstadoMaquina | None = None,
    incluir_inactivas: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> list[MaquinaResponse]:
    stmt = select(Maquina).order_by(Maquina.tipo, Maquina.marca, Maquina.modelo)
    if not incluir_inactivas:
        stmt = stmt.where(Maquina.is_active.is_(True))
    if tipo is not None:
        stmt = stmt.where(Maquina.tipo == tipo)
    if svc.es_gerencial_up(current_user):
        if finca is not None:
            stmt = stmt.where(Maquina.finca == finca)
    else:
        stmt = stmt.where(Maquina.finca == current_user.finca)
    maquinas = list((await db.execute(stmt)).scalars().all())
    pares = await _pares_abiertos(db, [m.id for m in maquinas])
    respuestas = [_maquina_response(m, pares[m.id]) for m in maquinas]
    if estado is not None:
        respuestas = [r for r in respuestas if r.estado == estado]
    return respuestas


@router.post("/maquinas", response_model=MaquinaResponse, status_code=status.HTTP_201_CREATED)
async def crear_maquina(
    data: MaquinaCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> MaquinaResponse:
    await _validar_tractor(db, data.tractor_id, None)
    maquina = Maquina(**data.model_dump())
    db.add(maquina)
    await db.flush()
    await db.refresh(maquina)
    return _maquina_response(maquina, [])


# Argentina is UTC-3 all year (no DST): campaign boundaries are local midnight.
_AR_TZ = timezone(timedelta(hours=-3))


def _temporada_de(fecha: date) -> int:
    """Campaña mayo -> abril (same rule as lotes_pasa.temporada_de)."""
    return fecha.year if fecha.month >= 5 else fecha.year - 1


@router.get("/maquinas/{maquina_id}/historial", response_model=HistorialMaquinaResponse)
async def historial_maquina(
    maquina_id: str,
    temporada: int | None = Query(default=None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> HistorialMaquinaResponse:
    maquina = await _get_maquina(db, maquina_id, current_user)
    if temporada is None:
        temporada = _temporada_de(datetime.now(_AR_TZ).date())
    # Campaña [May 1 of `temporada`, May 1 of the next year), Argentina local time.
    desde = datetime(temporada, 5, 1, tzinfo=_AR_TZ).astimezone(timezone.utc)
    hasta = datetime(temporada + 1, 5, 1, tzinfo=_AR_TZ).astimezone(timezone.utc)
    stmt = (
        select(OrdenMaquinaria)
        .where(
            OrdenMaquinaria.maquina_id == maquina.id,
            OrdenMaquinaria.created_at >= desde,
            OrdenMaquinaria.created_at < hasta,
        )
        .options(selectinload(OrdenMaquinaria.eventos), selectinload(OrdenMaquinaria.pago))
        .order_by(OrdenMaquinaria.created_at.desc())
    )
    gerencial = svc.es_gerencial_up(current_user)
    if not gerencial:
        # Orders keep the finca snapshot: after a transfer, the new finca's
        # encargado must not see the previous finca's history.
        stmt = stmt.where(OrdenMaquinaria.finca == current_user.finca)
    res = await db.execute(stmt)
    items: list[HistorialOrden] = []
    costo_total = Decimal("0")
    dias_total = Decimal("0")
    for orden in res.scalars().all():
        # Cost is only visible to gerencial+ (money data).
        costo = orden.pago.monto_real if orden.pago is not None else None
        dias = svc.dias_fuera_servicio(orden.created_at, orden.gravedad, orden.eventos)
        if costo is not None:
            costo_total += costo
        dias_total += dias
        cierres = [ev.created_at for ev in orden.eventos if ev.estado_hasta == E.cerrada]
        items.append(
            HistorialOrden(
                id=orden.id,
                numero=orden.numero,
                estado=orden.estado,
                gravedad=orden.gravedad,
                descripcion=orden.descripcion,
                taller=orden.taller,
                created_at=orden.created_at,
                fecha_pago=orden.pago.fecha if orden.pago is not None else None,
                cerrada_at=max(cierres) if cierres else None,
                costo=costo if gerencial else None,
                dias_fuera_servicio=dias,
            )
        )
    return HistorialMaquinaResponse(
        maquina_id=maquina.id,
        temporada=temporada,
        ordenes_count=len(items),
        costo_total=costo_total if gerencial else None,
        dias_fuera_servicio_total=dias_total,
        ordenes=items,
    )


@router.get("/maquinas/{maquina_id}", response_model=MaquinaResponse)
async def obtener_maquina(
    maquina_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> MaquinaResponse:
    maquina = await _get_maquina(db, maquina_id, current_user)
    pares = await _pares_abiertos(db, [maquina.id])
    return _maquina_response(maquina, pares[maquina.id])


@router.patch("/maquinas/{maquina_id}", response_model=MaquinaResponse)
async def actualizar_maquina(
    maquina_id: str,
    data: MaquinaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> MaquinaResponse:
    maquina = await _get_maquina(db, maquina_id, current_user)
    cambios = data.model_dump(exclude_unset=True)
    for campo in ("tipo", "marca", "modelo", "finca", "is_active"):
        # Non-nullable columns: an explicit null is a client error, not a no-op.
        if campo in cambios and cambios[campo] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{campo}' no puede ser nulo.",
            )
    if "tractor_id" in cambios:
        await _validar_tractor(db, cambios["tractor_id"], maquina.id)
    if cambios.get("tipo", maquina.tipo) != TipoMaquina.tractor and maquina.tipo == TipoMaquina.tractor:
        implementos = await db.execute(
            select(func.count(Maquina.id)).where(Maquina.tractor_id == maquina.id)
        )
        if implementos.scalar_one() > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Hay implementos asociados a este tractor: reasignalos antes de cambiar su tipo.",
            )
    for campo, valor in cambios.items():
        setattr(maquina, campo, valor)
    await db.flush()
    await db.refresh(maquina)
    pares = await _pares_abiertos(db, [maquina.id])
    return _maquina_response(maquina, pares[maquina.id])


# ── Órdenes ───────────────────────────────────────────────────────────────────

@router.get("/ordenes", response_model=list[OrdenResponse])
async def listar_ordenes(
    estado: E | None = None,
    maquina_id: str | None = None,
    finca: Finca | None = None,
    abiertas: bool | None = None,
    numero: int | None = Query(default=None, ge=1),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> list[OrdenMaquinaria]:
    stmt = (
        select(OrdenMaquinaria)
        .options(selectinload(OrdenMaquinaria.maquina))
        .order_by(OrdenMaquinaria.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if svc.es_gerencial_up(current_user):
        if finca is not None:
            stmt = stmt.where(OrdenMaquinaria.finca == finca)
    else:
        stmt = stmt.where(OrdenMaquinaria.finca == current_user.finca)
    if estado is not None:
        stmt = stmt.where(OrdenMaquinaria.estado == estado)
    if maquina_id is not None:
        stmt = stmt.where(OrdenMaquinaria.maquina_id == maquina_id)
    if numero is not None:
        stmt = stmt.where(OrdenMaquinaria.numero == numero)
    if abiertas is True:
        stmt = stmt.where(OrdenMaquinaria.estado.in_(list(svc.ESTADOS_ABIERTOS)))
    elif abiertas is False:
        stmt = stmt.where(OrdenMaquinaria.estado.not_in(list(svc.ESTADOS_ABIERTOS)))
    return list((await db.execute(stmt)).scalars().all())


@router.post("/ordenes", response_model=OrdenDetalleResponse, status_code=status.HTTP_201_CREATED)
async def crear_orden(
    data: OrdenCreate,
    idempotency_key_header: str | None = Header(
        default=None, alias="Idempotency-Key", min_length=1, max_length=36
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> OrdenDetalleResponse:
    key = data.idempotency_key or idempotency_key_header

    async def _existente() -> OrdenMaquinaria | None:
        res = await db.execute(
            select(OrdenMaquinaria).where(OrdenMaquinaria.idempotency_key == key)
        )
        return res.scalar_one_or_none()

    async def _replay(orden: OrdenMaquinaria) -> OrdenDetalleResponse:
        # Same neutral 404 as an unknown machine, so a key from another finca
        # does not confirm that an order exists.
        if not svc.puede_ver_finca(current_user, orden.finca):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Máquina no encontrada"
            )
        return await _serialize_orden(db, await _get_orden(db, orden.id, current_user), current_user)

    # Offline retry of the same report: return what was already created.
    if key:
        existente = await _existente()
        if existente is not None:
            return await _replay(existente)

    maquina = await _get_maquina(db, data.maquina_id, current_user)
    if not maquina.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="La máquina está dada de baja."
        )
    try:
        async with db.begin_nested():
            orden = await svc.crear_orden(
                db, maquina, current_user, data.descripcion, data.gravedad, key
            )
    except IntegrityError:
        # Lost the race against a concurrent retry with the same key.
        existente = await _existente() if key else None
        if existente is None:
            raise
        return await _replay(existente)
    return await _serialize_orden(db, await _get_orden(db, orden.id, current_user), current_user)


@router.get("/ordenes/{orden_id}", response_model=OrdenDetalleResponse)
async def obtener_orden(
    orden_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> OrdenDetalleResponse:
    return await _serialize_orden(db, await _get_orden(db, orden_id, current_user), current_user)


@router.patch("/ordenes/{orden_id}", response_model=OrdenDetalleResponse)
async def actualizar_orden(
    orden_id: str,
    data: OrdenUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> OrdenDetalleResponse:
    orden = await _get_orden(db, orden_id, current_user)
    if orden.estado not in svc.ESTADOS_ABIERTOS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="La orden ya está cerrada o cancelada."
        )
    cambios = data.model_dump(exclude_unset=True)
    if cambios.get("descripcion", "x") is None or cambios.get("gravedad", "x") is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'descripcion' y 'gravedad' no pueden ser nulos.",
        )
    for campo, valor in cambios.items():
        setattr(orden, campo, valor)
    await db.flush()
    return await _serialize_orden(db, await _get_orden(db, orden.id, current_user), current_user)


@router.post("/ordenes/{orden_id}/transicion", response_model=OrdenDetalleResponse)
async def transicionar_orden(
    orden_id: str,
    data: TransicionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> OrdenDetalleResponse:
    orden = await _get_orden(db, orden_id, current_user)
    await svc.transicionar(db, orden, data.a_estado, current_user, data.nota)
    return await _serialize_orden(db, await _get_orden(db, orden.id, current_user), current_user)


@router.post(
    "/ordenes/{orden_id}/presupuestos",
    response_model=OrdenDetalleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def cargar_presupuesto(
    orden_id: str,
    data: PresupuestoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> OrdenDetalleResponse:
    orden = await _get_orden(db, orden_id, current_user)
    await svc.registrar_presupuesto(
        db, orden, current_user, data.taller, data.monto, data.detalle, data.adjunto_url
    )
    return await _serialize_orden(db, await _get_orden(db, orden.id, current_user), current_user)


@router.post("/ordenes/{orden_id}/pago", response_model=PagoResponse, status_code=status.HTTP_201_CREATED)
async def registrar_pago(
    orden_id: str,
    data: PagoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> PagoMaquinaria:
    orden = await _get_orden(db, orden_id, current_user)
    pago = await svc.registrar_pago(
        db, orden, current_user, data.monto_real, data.fecha or date.today(), data.factura_url,
        data.origen, data.forma_pago,
    )
    await db.refresh(pago)
    return pago


@router.delete("/ordenes/{orden_id}/pago", status_code=status.HTTP_204_NO_CONTENT)
async def anular_pago(
    orden_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> None:
    orden = await _get_orden(db, orden_id, current_user)
    await svc.anular_pago(db, orden, current_user)


@router.post(
    "/ordenes/{orden_id}/fotos",
    response_model=FotoOrdenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def subir_foto_orden(
    orden_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> FotoOrdenMaquinaria:
    orden = await _get_orden(db, orden_id, current_user)
    # Lock first so two concurrent uploads cannot both pass the limit check.
    await svc.lock_orden(db, orden)
    if orden.estado not in svc.ESTADOS_ABIERTOS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="La orden ya está cerrada o cancelada."
        )
    cantidad = (
        await db.execute(
            select(func.count(FotoOrdenMaquinaria.id)).where(
                FotoOrdenMaquinaria.orden_id == orden.id
            )
        )
    ).scalar_one()
    if cantidad >= svc.MAX_FOTOS_REPORTE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La orden ya tiene el máximo de {svc.MAX_FOTOS_REPORTE} fotos.",
        )
    raw = await file.read()
    url = await upload_foto_maquinaria_orden(raw, file.content_type or "", orden.id)
    foto = FotoOrdenMaquinaria(orden_id=orden.id, url=url, subida_por=current_user.id)
    db.add(foto)
    await db.flush()
    await db.refresh(foto)
    return foto


@router.delete(
    "/ordenes/{orden_id}/fotos/{foto_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def borrar_foto_orden(
    orden_id: str,
    foto_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> None:
    orden = await _get_orden(db, orden_id, current_user)
    await svc.lock_orden(db, orden)
    if orden.estado not in svc.ESTADOS_ABIERTOS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La orden ya está cerrada o cancelada: sus fotos no se pueden borrar.",
        )
    res = await db.execute(
        select(FotoOrdenMaquinaria).where(
            FotoOrdenMaquinaria.id == foto_id, FotoOrdenMaquinaria.orden_id == orden.id
        )
    )
    foto = res.scalar_one_or_none()
    if foto is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Foto no encontrada")
    if not svc.es_gerencial_up(current_user) and foto.subida_por != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Solo podés borrar tus propias fotos."
        )
    # The Cloudinary file is destroyed after the commit (deferred-delete helper).
    encolar_borrado(db, foto.url)
    await db.delete(foto)
    await db.flush()


# ── Presupuestos ──────────────────────────────────────────────────────────────

@router.post("/presupuestos/{presupuesto_id}/resolver", response_model=PresupuestoResponse)
async def resolver_presupuesto(
    presupuesto_id: str,
    data: PresupuestoResolver,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> PresupuestoMaquinaria:
    presupuesto = await db.get(PresupuestoMaquinaria, presupuesto_id)
    if presupuesto is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Presupuesto no encontrado")
    orden = await _get_orden(db, presupuesto.orden_id, current_user)
    await svc.resolver_presupuesto(
        db, orden, presupuesto, current_user, data.aprobar, data.motivo
    )
    await db.refresh(presupuesto)
    return presupuesto
