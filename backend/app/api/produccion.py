from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_encargado_up
from app.models.finanzas import (
    ClasificacionEgreso,
    Egreso,
    Finca,
    FormaPago,
    MonedaTipo,
    OrigenPago,
    TipoEgreso,
)
from app.models.parcela import Parcela, TipoParcela
from app.models.produccion import (
    CLASIFICACION_POR_TAREA,
    CicloCampana,
    ClasificacionTarea,
    EstadoFenologico,
    RegistroFitosanitario,
    RegistroRiego,
    RegistroTrabajo,
    UnidadMedida,
)
from app.models.user import User
from app.schemas.produccion import (
    CicloCampanaCreate,
    CicloCampanaResponse,
    CicloCampanaUpdate,
    EstadoActualResponse,
    RegistroCargaMasiva,
    RegistroFitosanitarioCreate,
    RegistroFitosanitarioResponse,
    RegistroFitosanitarioUpdate,
    RegistroRiegoCreate,
    RegistroRiegoResponse,
    RegistroRiegoUpdate,
    RegistroTrabajoCreate,
    RegistroTrabajoResponse,
    RegistroTrabajoUpdate,
    ResumenTarea,
    ResumenTrabajador,
)

router = APIRouter(prefix="/produccion", tags=["Produccion"])


def _get_clasificacion(tarea: str) -> ClasificacionTarea:
    return ClasificacionTarea(CLASIFICACION_POR_TAREA.get(tarea, "general"))


def _build_egreso_for_trabajo(registro: RegistroTrabajo, user_id: str, parcela_nombre: str | None) -> Egreso:
    parts = [registro.tarea, registro.trabajador_nombre]
    if parcela_nombre:
        parts.append(parcela_nombre)
    return Egreso(
        fecha=registro.fecha,
        tipo=TipoEgreso.sueldos_personal,
        clasificacion=ClasificacionEgreso.obreros,
        descripcion=" | ".join(parts)[:500],
        monto=registro.monto_total,
        moneda=MonedaTipo.ars,
        origen=OrigenPago.no_oficial,
        finca=Finca.media_agua,
        forma_pago=FormaPago.efectivo,
        parcela_id=registro.parcela_id,
        fuente="trabajo_diario",
        referencia_id=registro.id,
        created_by=user_id,
    )


# ── Trabajo diario ─────────────────────────────────────────────────────────────

@router.get("/trabajo/", response_model=list[RegistroTrabajoResponse])
async def list_trabajo(
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    parcela_id: str | None = Query(None),
    trabajador_nombre: str | None = Query(None),
    tarea: str | None = Query(None),
    clasificacion: ClasificacionTarea | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[RegistroTrabajo]:
    stmt = select(RegistroTrabajo).order_by(RegistroTrabajo.fecha.desc())
    if fecha_desde is not None:
        stmt = stmt.where(RegistroTrabajo.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(RegistroTrabajo.fecha <= fecha_hasta)
    if parcela_id is not None:
        stmt = stmt.where(RegistroTrabajo.parcela_id == parcela_id)
    if trabajador_nombre is not None:
        stmt = stmt.where(RegistroTrabajo.trabajador_nombre.ilike(f"%{trabajador_nombre}%"))
    if tarea is not None:
        stmt = stmt.where(RegistroTrabajo.tarea == tarea)
    if clasificacion is not None:
        stmt = stmt.where(RegistroTrabajo.clasificacion == clasificacion)
    stmt = stmt.offset(skip).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


# Static sub-routes must be defined before /{registro_id} to avoid shadowing

@router.post(
    "/trabajo/masivo",
    response_model=list[RegistroTrabajoResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_trabajo_masivo(
    carga: RegistroCargaMasiva,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> list[RegistroTrabajo]:
    clasificacion = _get_clasificacion(carga.tarea)
    parcela_nombre: str | None = None
    if carga.parcela_id:
        p = await db.get(Parcela, carga.parcela_id)
        if p:
            parcela_nombre = p.nombre

    registros: list[RegistroTrabajo] = []
    for item in carga.trabajadores:
        registro = RegistroTrabajo(
            fecha=carga.fecha,
            parcela_id=carga.parcela_id,
            trabajador_nombre=item.trabajador_nombre,
            clasificacion=clasificacion,
            tarea=carga.tarea,
            cantidad=item.cantidad,
            unidad_medida=carga.unidad_medida,
            precio_unitario=carga.precio_unitario,
            detalle=carga.detalle,
            created_by=current_user.id,
        )
        db.add(registro)
        registros.append(registro)

    await db.flush()
    for r in registros:
        await db.refresh(r)
        egreso = _build_egreso_for_trabajo(r, current_user.id, parcela_nombre)
        db.add(egreso)

    return registros


@router.get("/trabajo/resumen/por-trabajador", response_model=list[ResumenTrabajador])
async def resumen_por_trabajador(
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    parcela_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[ResumenTrabajador]:
    stmt = select(RegistroTrabajo)
    if fecha_desde is not None:
        stmt = stmt.where(RegistroTrabajo.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(RegistroTrabajo.fecha <= fecha_hasta)
    if parcela_id is not None:
        stmt = stmt.where(RegistroTrabajo.parcela_id == parcela_id)
    records = (await db.execute(stmt)).scalars().all()

    agg: dict[str, dict] = defaultdict(
        lambda: {"total_jornales": Decimal("0"), "monto_total": Decimal("0"), "tareas": set()}
    )
    for r in records:
        w = agg[r.trabajador_nombre]
        w["total_jornales"] += r.cantidad
        w["monto_total"] += r.monto_total
        w["tareas"].add(r.tarea)

    result = [
        ResumenTrabajador(
            trabajador_nombre=nombre,
            total_jornales=data["total_jornales"],
            monto_total=data["monto_total"],
            tareas_realizadas=sorted(data["tareas"]),
        )
        for nombre, data in agg.items()
    ]
    return sorted(result, key=lambda x: x.monto_total, reverse=True)


@router.get("/trabajo/resumen/por-tarea", response_model=list[ResumenTarea])
async def resumen_por_tarea(
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[ResumenTarea]:
    stmt = select(RegistroTrabajo)
    if fecha_desde is not None:
        stmt = stmt.where(RegistroTrabajo.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(RegistroTrabajo.fecha <= fecha_hasta)
    records = (await db.execute(stmt)).scalars().all()

    agg: dict[str, dict] = defaultdict(
        lambda: {"clasificacion": None, "count": 0, "cantidad_total": Decimal("0"), "monto_total": Decimal("0")}
    )
    for r in records:
        t = agg[r.tarea]
        t["clasificacion"] = r.clasificacion
        t["count"] += 1
        t["cantidad_total"] += r.cantidad
        t["monto_total"] += r.monto_total

    result = [
        ResumenTarea(
            tarea=tarea,
            clasificacion=data["clasificacion"],
            total_registros=data["count"],
            cantidad_total=data["cantidad_total"],
            monto_total=data["monto_total"],
        )
        for tarea, data in agg.items()
    ]
    return sorted(result, key=lambda x: x.monto_total, reverse=True)


@router.get("/trabajo/{registro_id}", response_model=RegistroTrabajoResponse)
async def get_trabajo(
    registro_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RegistroTrabajo:
    result = await db.execute(select(RegistroTrabajo).where(RegistroTrabajo.id == registro_id))
    registro = result.scalar_one_or_none()
    if registro is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registro not found")
    return registro


@router.post("/trabajo/", response_model=RegistroTrabajoResponse, status_code=status.HTTP_201_CREATED)
async def create_trabajo(
    trabajo_data: RegistroTrabajoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> RegistroTrabajo:
    data = trabajo_data.model_dump()
    data["clasificacion"] = _get_clasificacion(trabajo_data.tarea)
    data["created_by"] = current_user.id
    registro = RegistroTrabajo(**data)
    db.add(registro)
    await db.flush()
    await db.refresh(registro)

    parcela_nombre: str | None = None
    if registro.parcela_id:
        p = await db.get(Parcela, registro.parcela_id)
        if p:
            parcela_nombre = p.nombre
    db.add(_build_egreso_for_trabajo(registro, current_user.id, parcela_nombre))

    return registro


@router.put("/trabajo/{registro_id}", response_model=RegistroTrabajoResponse)
async def update_trabajo(
    registro_id: str,
    trabajo_data: RegistroTrabajoUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RegistroTrabajo:
    result = await db.execute(select(RegistroTrabajo).where(RegistroTrabajo.id == registro_id))
    registro = result.scalar_one_or_none()
    if registro is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registro not found")

    update_data = trabajo_data.model_dump(exclude_unset=True)
    if "tarea" in update_data:
        update_data["clasificacion"] = _get_clasificacion(update_data["tarea"])
    for field, value in update_data.items():
        setattr(registro, field, value)
    if "cantidad" in update_data or "precio_unitario" in update_data:
        registro.monto_total = registro.cantidad * registro.precio_unitario

    await db.flush()
    await db.refresh(registro)

    # Sync linked egreso
    egreso_res = await db.execute(
        select(Egreso).where(Egreso.fuente == "trabajo_diario", Egreso.referencia_id == registro_id)
    )
    linked = egreso_res.scalar_one_or_none()
    if linked is not None:
        parcela_nombre: str | None = None
        if registro.parcela_id:
            p = await db.get(Parcela, registro.parcela_id)
            if p:
                parcela_nombre = p.nombre
        parts = [registro.tarea, registro.trabajador_nombre]
        if parcela_nombre:
            parts.append(parcela_nombre)
        linked.fecha = registro.fecha
        linked.monto = registro.monto_total
        linked.parcela_id = registro.parcela_id
        linked.descripcion = " | ".join(parts)[:500]

    return registro


@router.delete("/trabajo/{registro_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trabajo(
    registro_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> None:
    result = await db.execute(select(RegistroTrabajo).where(RegistroTrabajo.id == registro_id))
    registro = result.scalar_one_or_none()
    if registro is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registro not found")

    egreso_res = await db.execute(
        select(Egreso).where(Egreso.fuente == "trabajo_diario", Egreso.referencia_id == registro_id)
    )
    linked = egreso_res.scalar_one_or_none()
    if linked is not None:
        await db.delete(linked)

    await db.delete(registro)
    await db.flush()


# ── Riego ──────────────────────────────────────────────────────────────────────

@router.get("/riego/", response_model=list[RegistroRiegoResponse])
async def list_riego(
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    parcela_id: str | None = Query(None),
    cabezal: str | None = Query(None),
    responsable: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[RegistroRiego]:
    stmt = select(RegistroRiego).order_by(RegistroRiego.fecha.desc())
    if fecha_desde is not None:
        stmt = stmt.where(RegistroRiego.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(RegistroRiego.fecha <= fecha_hasta)
    if parcela_id is not None:
        stmt = stmt.where(RegistroRiego.parcela_id == parcela_id)
    if cabezal is not None:
        stmt = stmt.where(RegistroRiego.cabezal == cabezal)
    if responsable is not None:
        stmt = stmt.where(RegistroRiego.responsable.ilike(f"%{responsable}%"))
    stmt = stmt.offset(skip).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


@router.get("/riego/{riego_id}", response_model=RegistroRiegoResponse)
async def get_riego(
    riego_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RegistroRiego:
    result = await db.execute(select(RegistroRiego).where(RegistroRiego.id == riego_id))
    riego = result.scalar_one_or_none()
    if riego is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Riego not found")
    return riego


@router.post("/riego/", response_model=RegistroRiegoResponse, status_code=status.HTTP_201_CREATED)
async def create_riego(
    riego_data: RegistroRiegoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> RegistroRiego:
    data = riego_data.model_dump()
    data["created_by"] = current_user.id
    # duracion_horas computed by RegistroRiego.__init__
    riego = RegistroRiego(**data)
    db.add(riego)
    await db.flush()
    await db.refresh(riego)
    return riego


@router.put("/riego/{riego_id}", response_model=RegistroRiegoResponse)
async def update_riego(
    riego_id: str,
    riego_data: RegistroRiegoUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RegistroRiego:
    result = await db.execute(select(RegistroRiego).where(RegistroRiego.id == riego_id))
    riego = result.scalar_one_or_none()
    if riego is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Riego not found")

    update_data = riego_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(riego, field, value)
    if "inicio" in update_data or "fin" in update_data:
        riego.duracion_horas = (riego.fin - riego.inicio).total_seconds() / 3600

    await db.flush()
    await db.refresh(riego)
    return riego


@router.delete("/riego/{riego_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_riego(
    riego_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> None:
    result = await db.execute(select(RegistroRiego).where(RegistroRiego.id == riego_id))
    riego = result.scalar_one_or_none()
    if riego is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Riego not found")
    await db.delete(riego)
    await db.flush()


# ── Fitosanitarios ─────────────────────────────────────────────────────────────

@router.get("/fitosanitarios/", response_model=list[RegistroFitosanitarioResponse])
async def list_fitosanitarios(
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    parcela_id: str | None = Query(None),
    producto_nombre: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[RegistroFitosanitario]:
    stmt = select(RegistroFitosanitario).order_by(RegistroFitosanitario.fecha.desc())
    if fecha_desde is not None:
        stmt = stmt.where(RegistroFitosanitario.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(RegistroFitosanitario.fecha <= fecha_hasta)
    if parcela_id is not None:
        stmt = stmt.where(RegistroFitosanitario.parcela_id == parcela_id)
    if producto_nombre is not None:
        stmt = stmt.where(RegistroFitosanitario.producto_nombre.ilike(f"%{producto_nombre}%"))
    stmt = stmt.offset(skip).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


# Static route — must be before /{fitosanitario_id} on same method+depth
# (3-segment path vs 2-segment path — no conflict, but kept here for clarity)
@router.get("/fitosanitarios/alertas/carencia", response_model=list[RegistroFitosanitarioResponse])
async def alertas_carencia(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[RegistroFitosanitario]:
    today = date.today()
    stmt = (
        select(RegistroFitosanitario)
        .where(RegistroFitosanitario.fecha_habilitacion_cosecha >= today)
        .order_by(RegistroFitosanitario.fecha_habilitacion_cosecha.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


@router.get("/fitosanitarios/{fitosanitario_id}", response_model=RegistroFitosanitarioResponse)
async def get_fitosanitario(
    fitosanitario_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RegistroFitosanitario:
    result = await db.execute(
        select(RegistroFitosanitario).where(RegistroFitosanitario.id == fitosanitario_id)
    )
    fito = result.scalar_one_or_none()
    if fito is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registro not found")
    return fito


@router.post(
    "/fitosanitarios/",
    response_model=RegistroFitosanitarioResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_fitosanitario(
    fito_data: RegistroFitosanitarioCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> RegistroFitosanitario:
    data = fito_data.model_dump()
    data["created_by"] = current_user.id
    # fecha_habilitacion_* computed by RegistroFitosanitario.__init__
    fito = RegistroFitosanitario(**data)
    db.add(fito)
    await db.flush()
    await db.refresh(fito)
    return fito


@router.put("/fitosanitarios/{fitosanitario_id}", response_model=RegistroFitosanitarioResponse)
async def update_fitosanitario(
    fitosanitario_id: str,
    fito_data: RegistroFitosanitarioUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> RegistroFitosanitario:
    result = await db.execute(
        select(RegistroFitosanitario).where(RegistroFitosanitario.id == fitosanitario_id)
    )
    fito = result.scalar_one_or_none()
    if fito is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registro not found")

    update_data = fito_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(fito, field, value)
    if "fecha" in update_data or "dias_carencia" in update_data:
        fito.fecha_habilitacion_cosecha = fito.fecha + timedelta(days=fito.dias_carencia)
    if "fecha" in update_data or "dias_reingreso" in update_data:
        fito.fecha_habilitacion_reingreso = fito.fecha + timedelta(days=fito.dias_reingreso)

    await db.flush()
    await db.refresh(fito)
    return fito


@router.delete("/fitosanitarios/{fitosanitario_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_fitosanitario(
    fitosanitario_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> None:
    result = await db.execute(
        select(RegistroFitosanitario).where(RegistroFitosanitario.id == fitosanitario_id)
    )
    fito = result.scalar_one_or_none()
    if fito is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registro not found")
    await db.delete(fito)
    await db.flush()


# ── Ciclo Campaña ──────────────────────────────────────────────────────────────

@router.get("/campana/", response_model=list[CicloCampanaResponse])
async def list_campana(
    parcela_id: str | None = Query(None),
    anio: int | None = Query(None),
    estado_fenologico: EstadoFenologico | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[CicloCampana]:
    stmt = select(CicloCampana).order_by(CicloCampana.fecha_estado.desc())
    if parcela_id is not None:
        stmt = stmt.where(CicloCampana.parcela_id == parcela_id)
    if anio is not None:
        stmt = stmt.where(CicloCampana.anio == anio)
    if estado_fenologico is not None:
        stmt = stmt.where(CicloCampana.estado_fenologico == estado_fenologico)
    return list((await db.execute(stmt)).scalars().all())


# Must be before /campana/{campana_id} — same method (GET) + same path depth
@router.get("/campana/estado-actual/", response_model=list[EstadoActualResponse])
async def estado_actual(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[EstadoActualResponse]:
    subq = (
        select(
            CicloCampana.parcela_id,
            func.max(CicloCampana.fecha_estado).label("max_fecha"),
        )
        .join(Parcela, CicloCampana.parcela_id == Parcela.id)
        .where(Parcela.is_active.is_(True), Parcela.tipo == TipoParcela.parral)
        .group_by(CicloCampana.parcela_id)
        .subquery()
    )
    stmt = (
        select(
            CicloCampana.id,
            CicloCampana.parcela_id,
            Parcela.nombre.label("parcela_nombre"),
            CicloCampana.anio,
            CicloCampana.estado_fenologico,
            CicloCampana.fecha_estado,
        )
        .join(Parcela, CicloCampana.parcela_id == Parcela.id)
        .join(
            subq,
            (CicloCampana.parcela_id == subq.c.parcela_id)
            & (CicloCampana.fecha_estado == subq.c.max_fecha),
        )
        .order_by(Parcela.nombre.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        EstadoActualResponse(
            id=row.id,
            parcela_id=row.parcela_id,
            parcela_nombre=row.parcela_nombre,
            anio=row.anio,
            estado_fenologico=row.estado_fenologico,
            fecha_estado=row.fecha_estado,
        )
        for row in rows
    ]


@router.get("/campana/{campana_id}", response_model=CicloCampanaResponse)
async def get_campana(
    campana_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> CicloCampana:
    result = await db.execute(select(CicloCampana).where(CicloCampana.id == campana_id))
    campana = result.scalar_one_or_none()
    if campana is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ciclo not found")
    return campana


@router.post("/campana/", response_model=CicloCampanaResponse, status_code=status.HTTP_201_CREATED)
async def create_campana(
    campana_data: CicloCampanaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> CicloCampana:
    campana = CicloCampana(**campana_data.model_dump(), created_by=current_user.id)
    db.add(campana)
    await db.flush()
    await db.refresh(campana)
    return campana


@router.put("/campana/{campana_id}", response_model=CicloCampanaResponse)
async def update_campana(
    campana_id: str,
    campana_data: CicloCampanaUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> CicloCampana:
    result = await db.execute(select(CicloCampana).where(CicloCampana.id == campana_id))
    campana = result.scalar_one_or_none()
    if campana is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ciclo not found")
    for field, value in campana_data.model_dump(exclude_unset=True).items():
        setattr(campana, field, value)
    await db.flush()
    await db.refresh(campana)
    return campana


@router.delete("/campana/{campana_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campana(
    campana_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> None:
    result = await db.execute(select(CicloCampana).where(CicloCampana.id == campana_id))
    campana = result.scalar_one_or_none()
    if campana is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ciclo not found")
    await db.delete(campana)
    await db.flush()
