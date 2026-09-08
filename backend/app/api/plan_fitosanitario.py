from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_up, require_gerencial_up
from app.models.insumo import Insumo
from app.models.parcela import VariedadUva
from app.models.produccion import PlanFitosanitario
from app.models.user import User
from app.schemas.produccion import (
    PlanFitosanitarioCreate,
    PlanFitosanitarioResponse,
    PlanFitosanitarioUpdate,
)

router = APIRouter(prefix="/plan-fitosanitario", tags=["Plan Fitosanitario"])


def _to_response(plan: PlanFitosanitario) -> PlanFitosanitarioResponse:
    return PlanFitosanitarioResponse(
        id=plan.id,
        temporada=plan.temporada,
        variedad=plan.variedad,
        numero_aplicacion=plan.numero_aplicacion,
        mes=plan.mes,
        insumo_id=plan.insumo_id,
        insumo_nombre=plan.insumo.nombre,
        insumo_unidad=plan.insumo.unidad,
        objetivo=plan.objetivo,
        dosis_por_ha=plan.dosis_por_ha,
        notas=plan.notas,
        created_by=plan.created_by,
        created_at=plan.created_at,
    )


@router.get("/", response_model=list[PlanFitosanitarioResponse])
async def list_plan_fitosanitario(
    temporada: int = Query(...),
    variedad: VariedadUva | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[PlanFitosanitarioResponse]:
    stmt = (
        select(PlanFitosanitario)
        .options(selectinload(PlanFitosanitario.insumo))
        .where(PlanFitosanitario.temporada == temporada)
        .order_by(PlanFitosanitario.numero_aplicacion.asc(), PlanFitosanitario.mes.asc())
    )
    if variedad is not None:
        stmt = stmt.where(PlanFitosanitario.variedad == variedad)
    planes = (await db.execute(stmt)).scalars().all()
    return [_to_response(p) for p in planes]


@router.post("/", response_model=list[PlanFitosanitarioResponse], status_code=status.HTTP_201_CREATED)
async def create_plan_fitosanitario(
    data: PlanFitosanitarioCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> list[PlanFitosanitarioResponse]:
    insumo = await db.get(Insumo, data.insumo_id)
    if insumo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Insumo not found")

    creados: list[PlanFitosanitario] = []
    for variedad in data.variedades:
        plan = PlanFitosanitario(
            temporada=data.temporada,
            variedad=variedad,
            numero_aplicacion=data.numero_aplicacion,
            mes=data.mes,
            insumo_id=data.insumo_id,
            objetivo=data.objetivo,
            dosis_por_ha=data.dosis_por_ha,
            notas=data.notas,
            created_by=current_user.id,
        )
        db.add(plan)
        creados.append(plan)

    await db.flush()
    for plan in creados:
        plan.insumo = insumo
    return [_to_response(p) for p in creados]


@router.put("/{plan_id}", response_model=PlanFitosanitarioResponse)
async def update_plan_fitosanitario(
    plan_id: str,
    data: PlanFitosanitarioUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> PlanFitosanitarioResponse:
    plan = await db.get(PlanFitosanitario, plan_id, options=[selectinload(PlanFitosanitario.insumo)])
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    update_data = data.model_dump(exclude_unset=True)
    if "insumo_id" in update_data:
        insumo = await db.get(Insumo, update_data["insumo_id"])
        if insumo is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Insumo not found")
        plan.insumo = insumo
    for field, value in update_data.items():
        setattr(plan, field, value)

    await db.flush()
    await db.refresh(plan)
    return _to_response(plan)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan_fitosanitario(
    plan_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    plan = await db.get(PlanFitosanitario, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    await db.delete(plan)
    await db.flush()
