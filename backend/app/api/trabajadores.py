from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_encargado_up, require_gerencial_up
from app.models.produccion import RegistroFitosanitario, RegistroRiego, RegistroTrabajo
from app.models.trabajador import RolTrabajador, Trabajador
from app.models.user import User
from app.schemas.produccion import RegistroTrabajoResponse
from app.schemas.trabajador import TrabajadorCreate, TrabajadorResponse, TrabajadorUpdate

router = APIRouter(prefix="/trabajadores", tags=["Trabajadores"])


@router.get("/", response_model=list[TrabajadorResponse])
async def list_trabajadores(
    is_active: bool | None = Query(None),
    rol: RolTrabajador | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[Trabajador]:
    stmt = select(Trabajador).order_by(Trabajador.nombre_completo.asc())
    if is_active is not None:
        stmt = stmt.where(Trabajador.is_active == is_active)
    if rol is not None:
        stmt = stmt.where(Trabajador.rol == rol)
    return list((await db.execute(stmt)).scalars().all())


@router.get("/{trabajador_id}", response_model=TrabajadorResponse)
async def get_trabajador(
    trabajador_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Trabajador:
    trabajador = await db.get(Trabajador, trabajador_id)
    if trabajador is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trabajador not found")
    return trabajador


@router.post("/", response_model=TrabajadorResponse, status_code=status.HTTP_201_CREATED)
async def create_trabajador(
    data: TrabajadorCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Trabajador:
    trabajador = Trabajador(**data.model_dump())
    db.add(trabajador)
    await db.flush()
    await db.refresh(trabajador)
    return trabajador


@router.put("/{trabajador_id}", response_model=TrabajadorResponse)
async def update_trabajador(
    trabajador_id: str,
    data: TrabajadorUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Trabajador:
    trabajador = await db.get(Trabajador, trabajador_id)
    if trabajador is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trabajador not found")
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(trabajador, field, value)

    # El nombre queda congelado como texto en cada registro de tarea/riego/fito
    # al momento de cargarlo (trabajador_nombre/responsable) -- si se corrige acá,
    # se propaga a todo lo ya cargado que esté vinculado por trabajador_id/responsable_id,
    # para que no queden nombres viejos huerfanos en los historicos.
    if "nombre_completo" in update_data:
        nombre_nuevo = update_data["nombre_completo"]
        await db.execute(
            update(RegistroTrabajo)
            .where(RegistroTrabajo.trabajador_id == trabajador_id)
            .values(trabajador_nombre=nombre_nuevo)
        )
        await db.execute(
            update(RegistroRiego)
            .where(RegistroRiego.responsable_id == trabajador_id)
            .values(responsable=nombre_nuevo)
        )
        await db.execute(
            update(RegistroFitosanitario)
            .where(RegistroFitosanitario.responsable_id == trabajador_id)
            .values(responsable=nombre_nuevo)
        )

    await db.flush()
    await db.refresh(trabajador)
    return trabajador


@router.delete("/{trabajador_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trabajador(
    trabajador_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    trabajador = await db.get(Trabajador, trabajador_id)
    if trabajador is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trabajador not found")
    trabajador.is_active = False
    await db.flush()


@router.get("/{trabajador_id}/historial", response_model=list[RegistroTrabajoResponse])
async def historial_trabajador(
    trabajador_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[RegistroTrabajo]:
    trabajador = await db.get(Trabajador, trabajador_id)
    if trabajador is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trabajador not found")
    stmt = (
        select(RegistroTrabajo)
        .where(RegistroTrabajo.trabajador_id == trabajador_id)
        .order_by(RegistroTrabajo.fecha.desc())
        .offset(skip)
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())
