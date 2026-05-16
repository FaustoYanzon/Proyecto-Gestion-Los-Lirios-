from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_user,
    get_db,
    require_any_role,
    require_gerencial_up,
    require_super_admin,
)
from app.models.parcela import Parcela, TipoParcela, VariedadUva
from app.models.user import User
from app.schemas.parcela import (
    ParcelaCreate,
    ParcelaMapResponse,
    ParcelaResponse,
    ParcelaUpdate,
)

router = APIRouter(prefix="/parcelas", tags=["Parcelas"])


@router.get("/", response_model=list[ParcelaResponse])
async def list_parcelas(
    tipo: TipoParcela | None = Query(None),
    variedad: VariedadUva | None = Query(None),
    cabezal_riego: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[Parcela]:
    stmt = select(Parcela).where(Parcela.is_active == True)  # noqa: E712
    if tipo is not None:
        stmt = stmt.where(Parcela.tipo == tipo)
    if variedad is not None:
        stmt = stmt.where(Parcela.variedad == variedad)
    if cabezal_riego is not None:
        stmt = stmt.where(Parcela.cabezal_riego == cabezal_riego)
    result = await db.execute(stmt)
    return list(result.scalars().all())


# /mapa must be defined before /{parcela_id} to avoid route shadowing
@router.get("/mapa", response_model=list[ParcelaMapResponse])
async def list_parcelas_mapa(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any_role),
) -> list[Parcela]:
    result = await db.execute(select(Parcela).where(Parcela.is_active == True))  # noqa: E712
    return list(result.scalars().all())


@router.get("/{parcela_id}", response_model=ParcelaResponse)
async def get_parcela(
    parcela_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Parcela:
    result = await db.execute(select(Parcela).where(Parcela.id == parcela_id))
    parcela = result.scalar_one_or_none()
    if parcela is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcela not found")
    return parcela


@router.post("/", response_model=ParcelaResponse, status_code=status.HTTP_201_CREATED)
async def create_parcela(
    parcela_data: ParcelaCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> Parcela:
    result = await db.execute(select(Parcela).where(Parcela.nombre == parcela_data.nombre))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Parcela '{parcela_data.nombre}' already exists",
        )

    parcela = Parcela(**parcela_data.model_dump())
    db.add(parcela)
    await db.flush()
    await db.refresh(parcela)
    return parcela


@router.put("/{parcela_id}", response_model=ParcelaResponse)
async def update_parcela(
    parcela_id: str,
    parcela_data: ParcelaUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> Parcela:
    result = await db.execute(select(Parcela).where(Parcela.id == parcela_id))
    parcela = result.scalar_one_or_none()
    if parcela is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcela not found")

    if parcela_data.nombre is not None and parcela_data.nombre != parcela.nombre:
        dup = await db.execute(select(Parcela).where(Parcela.nombre == parcela_data.nombre))
        if dup.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Parcela '{parcela_data.nombre}' already exists",
            )

    for field, value in parcela_data.model_dump(exclude_unset=True).items():
        setattr(parcela, field, value)

    await db.flush()
    await db.refresh(parcela)
    return parcela


@router.delete("/{parcela_id}", response_model=ParcelaResponse)
async def deactivate_parcela(
    parcela_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> Parcela:
    result = await db.execute(select(Parcela).where(Parcela.id == parcela_id))
    parcela = result.scalar_one_or_none()
    if parcela is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcela not found")

    parcela.is_active = False
    await db.flush()
    await db.refresh(parcela)
    return parcela
