from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_encargado_up, require_gerencial_up
from app.core.normalizacion import normalizar_nombre
from app.models.insumo import Insumo, MovimientoStock, TipoMovimientoStock
from app.models.user import User, UserRole
from app.schemas.insumo import (
    InsumoCreate,
    InsumoResponse,
    InsumoUpdate,
    MovimientoStockCreate,
    MovimientoStockResponse,
)

router = APIRouter(prefix="/insumos", tags=["Insumos"])


@router.get("/", response_model=list[InsumoResponse])
async def list_insumos(
    is_active: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[Insumo]:
    stmt = select(Insumo).order_by(Insumo.nombre.asc())
    if is_active is not None:
        stmt = stmt.where(Insumo.is_active == is_active)
    return list((await db.execute(stmt)).scalars().all())


@router.get("/{insumo_id}", response_model=InsumoResponse)
async def get_insumo(
    insumo_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Insumo:
    insumo = await db.get(Insumo, insumo_id)
    if insumo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Insumo not found")
    return insumo


@router.post("/", response_model=InsumoResponse, status_code=status.HTTP_201_CREATED)
async def create_insumo(
    data: InsumoCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Insumo:
    nombre_normalizado = normalizar_nombre(data.nombre)
    existentes = (
        await db.execute(select(Insumo).where(Insumo.is_active.is_(True)))
    ).scalars().all()
    for existente in existentes:
        if normalizar_nombre(existente.nombre) == nombre_normalizado:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f'Ya existe un insumo activo con ese nombre: "{existente.nombre}".',
            )

    insumo = Insumo(**data.model_dump())
    db.add(insumo)
    await db.flush()
    await db.refresh(insumo)
    return insumo


@router.put("/{insumo_id}", response_model=InsumoResponse)
async def update_insumo(
    insumo_id: str,
    data: InsumoUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Insumo:
    insumo = await db.get(Insumo, insumo_id)
    if insumo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Insumo not found")

    update_data = data.model_dump(exclude_unset=True)
    if "nombre" in update_data:
        nombre_normalizado = normalizar_nombre(update_data["nombre"])
        existentes = (
            await db.execute(
                select(Insumo).where(Insumo.is_active.is_(True), Insumo.id != insumo_id)
            )
        ).scalars().all()
        for existente in existentes:
            if normalizar_nombre(existente.nombre) == nombre_normalizado:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f'Ya existe un insumo activo con ese nombre: "{existente.nombre}".',
                )

    for field, value in update_data.items():
        setattr(insumo, field, value)

    await db.flush()
    await db.refresh(insumo)
    return insumo


@router.post(
    "/{insumo_id}/movimientos",
    response_model=MovimientoStockResponse,
    status_code=status.HTTP_201_CREATED,
)
async def registrar_movimiento(
    insumo_id: str,
    data: MovimientoStockCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> MovimientoStock:
    if data.tipo == TipoMovimientoStock.egreso_aplicacion:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El egreso por aplicación se genera automáticamente al registrar un Fitosanitario, no se carga a mano.",
        )
    if data.tipo == TipoMovimientoStock.ajuste and current_user.role not in (
        UserRole.super_admin,
        UserRole.gerencial,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un ajuste de stock requiere rol gerencial o superior.",
        )

    insumo = await db.get(Insumo, insumo_id)
    if insumo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Insumo not found")

    signo = 1 if data.tipo in (TipoMovimientoStock.ingreso, TipoMovimientoStock.ajuste) else -1
    insumo.stock_actual = insumo.stock_actual + (signo * data.cantidad)

    movimiento = MovimientoStock(
        insumo_id=insumo_id,
        tipo=data.tipo,
        cantidad=data.cantidad,
        fecha=data.fecha,
        observacion=data.observacion,
        created_by=current_user.id,
    )
    db.add(movimiento)
    await db.flush()
    await db.refresh(movimiento)
    return movimiento


@router.get("/{insumo_id}/movimientos", response_model=list[MovimientoStockResponse])
async def list_movimientos(
    insumo_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[MovimientoStock]:
    insumo = await db.get(Insumo, insumo_id)
    if insumo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Insumo not found")
    stmt = (
        select(MovimientoStock)
        .where(MovimientoStock.insumo_id == insumo_id)
        .order_by(MovimientoStock.fecha.desc(), MovimientoStock.created_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())
