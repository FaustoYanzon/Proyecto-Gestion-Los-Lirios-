from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_gerencial_up
from app.models.finanzas import MonedaTipo, TipoEgreso
from app.models.parcela import Parcela
from app.models.presupuesto import ConceptoPresupuesto, MetaProduccion, Presupuesto
from app.models.user import User
from app.schemas.presupuesto import (
    MetaProduccionCreate,
    MetaProduccionResponse,
    MetaProduccionUpdate,
    PresupuestoBulkCreate,
    PresupuestoCreate,
    PresupuestoResponse,
    PresupuestoUpdate,
)

router = APIRouter(prefix="/presupuestos", tags=["Presupuestos"])


def _meta_response(meta: MetaProduccion) -> MetaProduccionResponse:
    resp = MetaProduccionResponse.model_validate(meta)
    resp.parcela_nombre = meta.parcela.nombre if meta.parcela else None
    return resp


# ── Metas de producción (static routes BEFORE /{presupuesto_id}) ──────────────

@router.get("/metas/", response_model=list[MetaProduccionResponse])
async def list_metas(
    temporada: int | None = Query(None),
    parcela_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[MetaProduccionResponse]:
    stmt = (
        select(MetaProduccion)
        .options(selectinload(MetaProduccion.parcela))
        .order_by(MetaProduccion.temporada.desc())
    )
    if temporada is not None:
        stmt = stmt.where(MetaProduccion.temporada == temporada)
    if parcela_id is not None:
        stmt = stmt.where(MetaProduccion.parcela_id == parcela_id)
    metas = (await db.execute(stmt)).scalars().all()
    return [_meta_response(m) for m in metas]


@router.post(
    "/metas/", response_model=MetaProduccionResponse, status_code=status.HTTP_201_CREATED
)
async def create_meta(
    meta_data: MetaProduccionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> MetaProduccionResponse:
    parcela = (
        await db.execute(select(Parcela).where(Parcela.id == meta_data.parcela_id))
    ).scalar_one_or_none()
    if parcela is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcela not found")

    # Enforce one plan per parcela per season with a friendly error
    # (the DB unique constraint is the last line of defense).
    existing = (
        await db.execute(
            select(MetaProduccion).where(
                MetaProduccion.temporada == meta_data.temporada,
                MetaProduccion.parcela_id == meta_data.parcela_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Meta already exists for this parcela/temporada — update it instead",
        )

    meta = MetaProduccion(**meta_data.model_dump(), created_by=current_user.id)
    db.add(meta)
    await db.flush()
    await db.refresh(meta, attribute_names=["parcela"])
    return _meta_response(meta)


@router.put("/metas/{meta_id}", response_model=MetaProduccionResponse)
async def update_meta(
    meta_id: str,
    meta_data: MetaProduccionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> MetaProduccionResponse:
    meta = (
        await db.execute(
            select(MetaProduccion)
            .options(selectinload(MetaProduccion.parcela))
            .where(MetaProduccion.id == meta_id)
        )
    ).scalar_one_or_none()
    if meta is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meta not found")

    for field, value in meta_data.model_dump(exclude_unset=True).items():
        setattr(meta, field, value)
    await db.flush()
    await db.refresh(meta)
    return _meta_response(meta)


@router.delete("/metas/{meta_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meta(
    meta_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    meta = (
        await db.execute(select(MetaProduccion).where(MetaProduccion.id == meta_id))
    ).scalar_one_or_none()
    if meta is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meta not found")
    await db.delete(meta)
    await db.flush()


# ── Presupuestos ──────────────────────────────────────────────────────────────

@router.get("/", response_model=list[PresupuestoResponse])
async def list_presupuestos(
    temporada: int | None = Query(None),
    mes: int | None = Query(None, ge=1, le=12),
    concepto: ConceptoPresupuesto | None = Query(None),
    tipo: TipoEgreso | None = Query(None),
    moneda: MonedaTipo | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[Presupuesto]:
    stmt = select(Presupuesto).order_by(
        Presupuesto.temporada.desc(), Presupuesto.mes.asc()
    )
    if temporada is not None:
        stmt = stmt.where(Presupuesto.temporada == temporada)
    if mes is not None:
        stmt = stmt.where(Presupuesto.mes == mes)
    if concepto is not None:
        stmt = stmt.where(Presupuesto.concepto == concepto)
    if tipo is not None:
        stmt = stmt.where(Presupuesto.tipo == tipo)
    if moneda is not None:
        stmt = stmt.where(Presupuesto.moneda == moneda)
    stmt = stmt.offset(skip).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/", response_model=PresupuestoResponse, status_code=status.HTTP_201_CREATED)
async def create_presupuesto(
    pres_data: PresupuestoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> Presupuesto:
    pres = Presupuesto(**pres_data.model_dump(), created_by=current_user.id)
    db.add(pres)
    await db.flush()
    await db.refresh(pres)
    return pres


@router.post(
    "/bulk", response_model=list[PresupuestoResponse], status_code=status.HTTP_201_CREATED
)
async def create_presupuestos_bulk(
    bulk_data: PresupuestoBulkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> list[Presupuesto]:
    """Bulk load — used for annual budget entry and Excel migration."""
    items = [
        Presupuesto(**item.model_dump(), created_by=current_user.id)
        for item in bulk_data.items
    ]
    db.add_all(items)
    await db.flush()
    for item in items:
        await db.refresh(item)
    return items


@router.put("/{presupuesto_id}", response_model=PresupuestoResponse)
async def update_presupuesto(
    presupuesto_id: str,
    pres_data: PresupuestoUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Presupuesto:
    pres = (
        await db.execute(select(Presupuesto).where(Presupuesto.id == presupuesto_id))
    ).scalar_one_or_none()
    if pres is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Presupuesto not found"
        )
    for field, value in pres_data.model_dump(exclude_unset=True).items():
        setattr(pres, field, value)
    await db.flush()
    await db.refresh(pres)
    return pres


@router.delete("/{presupuesto_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_presupuesto(
    presupuesto_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    pres = (
        await db.execute(select(Presupuesto).where(Presupuesto.id == presupuesto_id))
    ).scalar_one_or_none()
    if pres is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Presupuesto not found"
        )
    await db.delete(pres)
    await db.flush()
