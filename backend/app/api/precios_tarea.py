from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_up, require_gerencial_up
from app.models.parcela import Parcela
from app.models.precio_tarea import PrecioTarea
from app.models.user import User
from app.schemas.precio_tarea import PrecioTareaCreate, PrecioTareaResponse, PrecioTareaUpdate

router = APIRouter(prefix="/precios-tarea", tags=["Precios Tarea"])


def _precio_response(precio: PrecioTarea) -> PrecioTareaResponse:
    resp = PrecioTareaResponse.model_validate(precio)
    resp.parcela_nombre = precio.parcela.nombre if precio.parcela else None
    return resp


@router.get("/", response_model=list[PrecioTareaResponse])
async def list_precios_tarea(
    temporada: int | None = Query(None),
    tarea: str | None = Query(None),
    parcela_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    # encargado_up (no solo gerencial) -- lo necesita cualquiera que cargue
    # tareas en mobile (regador/obrero) para que el autocompletado funcione.
    _: User = Depends(require_encargado_up),
) -> list[PrecioTareaResponse]:
    stmt = (
        select(PrecioTarea)
        .options(selectinload(PrecioTarea.parcela))
        .order_by(PrecioTarea.temporada.desc(), PrecioTarea.tarea.asc())
    )
    if temporada is not None:
        stmt = stmt.where(PrecioTarea.temporada == temporada)
    if tarea is not None:
        stmt = stmt.where(PrecioTarea.tarea == tarea)
    if parcela_id is not None:
        stmt = stmt.where(PrecioTarea.parcela_id == parcela_id)
    precios = (await db.execute(stmt)).scalars().all()
    return [_precio_response(p) for p in precios]


@router.post("/", response_model=PrecioTareaResponse, status_code=status.HTTP_201_CREATED)
async def create_precio_tarea(
    data: PrecioTareaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> PrecioTareaResponse:
    if data.parcela_id is not None:
        parcela = (
            await db.execute(select(Parcela).where(Parcela.id == data.parcela_id))
        ).scalar_one_or_none()
        if parcela is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcela not found")

    # Chequeo amigable antes del insert -- el índice único parcial de la DB
    # es la última línea de defensa, no la primera.
    existing = (
        await db.execute(
            select(PrecioTarea).where(
                PrecioTarea.temporada == data.temporada,
                PrecioTarea.tarea == data.tarea,
                PrecioTarea.parcela_id == data.parcela_id,
                PrecioTarea.unidad_medida == data.unidad_medida,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un precio para esta tarea/parcela/unidad en esta temporada — editalo en vez de crear uno nuevo",
        )

    precio = PrecioTarea(**data.model_dump(), created_by=current_user.id)
    db.add(precio)
    await db.flush()
    await db.refresh(precio, attribute_names=["parcela"])
    return _precio_response(precio)


@router.put("/{precio_id}", response_model=PrecioTareaResponse)
async def update_precio_tarea(
    precio_id: str,
    data: PrecioTareaUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> PrecioTareaResponse:
    precio = await db.get(PrecioTarea, precio_id, options=[selectinload(PrecioTarea.parcela)])
    if precio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Precio not found")
    precio.precio_unitario = data.precio_unitario
    await db.flush()
    return _precio_response(precio)


@router.delete("/{precio_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_precio_tarea(
    precio_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    precio = await db.get(PrecioTarea, precio_id)
    if precio is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Precio not found")
    await db.delete(precio)
    await db.flush()
