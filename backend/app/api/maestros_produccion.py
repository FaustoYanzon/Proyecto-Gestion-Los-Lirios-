"""Maestros del módulo Alta de Producción: productores, compradores,
depósitos y parámetros configurables (kg por ficha, ratio uva/pasa, etc.)."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_encargado_up, require_gerencial_up
from app.core.normalizacion import normalizar_nombre
from app.models.alta_produccion import (
    Comprador,
    Deposito,
    ParametroProduccion,
    Productor,
)
from app.models.user import User
from app.schemas.alta_produccion import (
    CompradorCreate,
    CompradorResponse,
    CompradorUpdate,
    DepositoCreate,
    DepositoResponse,
    DepositoUpdate,
    ParametrosResponse,
    ParametrosUpdate,
    ProductorCreate,
    ProductorResponse,
    ProductorUpdate,
)
from app.services.alta_produccion import get_parametros

router = APIRouter(prefix="/alta-produccion", tags=["Alta de Producción — maestros"])


async def _validar_nombre_unico(
    db: AsyncSession, modelo: type, nombre: str, etiqueta: str, excluir_id: str | None = None
) -> None:
    """409 si ya hay un registro activo con el mismo nombre (sin tildes ni
    mayúsculas), mismo criterio que Insumo."""
    objetivo = normalizar_nombre(nombre)
    existentes = (await db.execute(select(modelo).where(modelo.is_active.is_(True)))).scalars().all()
    for existente in existentes:
        if existente.id != excluir_id and normalizar_nombre(existente.nombre) == objetivo:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe {etiqueta} con ese nombre: {existente.nombre}",
            )


# ── Parámetros (rutas estáticas) ─────────────────────────────────────────────

@router.get("/parametros", response_model=ParametrosResponse)
async def get_parametros_produccion(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> ParametrosResponse:
    p = await get_parametros(db)
    return ParametrosResponse(**p.__dict__)


@router.patch("/parametros", response_model=ParametrosResponse)
async def update_parametros_produccion(
    data: ParametrosUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> ParametrosResponse:
    cambios = data.model_dump(exclude_unset=True)
    for clave, valor in cambios.items():
        fila = await db.get(ParametroProduccion, clave)
        if valor is None:
            # Solo `tope_bines_lote` admite null: quita el tope.
            if clave != "tope_bines_lote":
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"{clave} no admite null",
                )
            if fila is not None:
                await db.delete(fila)
            continue
        if fila is None:
            db.add(ParametroProduccion(clave=clave, valor=Decimal(valor)))
        else:
            fila.valor = Decimal(valor)
    await db.flush()
    p = await get_parametros(db)
    return ParametrosResponse(**p.__dict__)


# ── Productores ──────────────────────────────────────────────────────────────

@router.get("/productores", response_model=list[ProductorResponse])
async def list_productores(
    is_active: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[Productor]:
    stmt = select(Productor).order_by(Productor.nombre.asc())
    if is_active is not None:
        stmt = stmt.where(Productor.is_active == is_active)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/productores", response_model=ProductorResponse, status_code=status.HTTP_201_CREATED)
async def create_productor(
    data: ProductorCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Productor:
    await _validar_nombre_unico(db, Productor, data.nombre, "un productor")
    productor = Productor(**data.model_dump())
    db.add(productor)
    await db.flush()
    await db.refresh(productor)
    return productor


@router.patch("/productores/{productor_id}", response_model=ProductorResponse)
async def update_productor(
    productor_id: str,
    data: ProductorUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Productor:
    productor = await db.get(Productor, productor_id)
    if productor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Productor not found")
    cambios = data.model_dump(exclude_unset=True)
    if "nombre" in cambios:
        await _validar_nombre_unico(db, Productor, cambios["nombre"], "un productor", productor_id)
    for campo, valor in cambios.items():
        setattr(productor, campo, valor)
    await db.flush()
    await db.refresh(productor)
    return productor


# ── Compradores ──────────────────────────────────────────────────────────────

@router.get("/compradores", response_model=list[CompradorResponse])
async def list_compradores(
    is_active: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[Comprador]:
    stmt = select(Comprador).order_by(Comprador.nombre.asc())
    if is_active is not None:
        stmt = stmt.where(Comprador.is_active == is_active)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/compradores", response_model=CompradorResponse, status_code=status.HTTP_201_CREATED)
async def create_comprador(
    data: CompradorCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Comprador:
    await _validar_nombre_unico(db, Comprador, data.nombre, "un comprador")
    comprador = Comprador(**data.model_dump())
    db.add(comprador)
    await db.flush()
    await db.refresh(comprador)
    return comprador


@router.patch("/compradores/{comprador_id}", response_model=CompradorResponse)
async def update_comprador(
    comprador_id: str,
    data: CompradorUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Comprador:
    comprador = await db.get(Comprador, comprador_id)
    if comprador is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprador not found")
    cambios = data.model_dump(exclude_unset=True)
    if "nombre" in cambios:
        await _validar_nombre_unico(db, Comprador, cambios["nombre"], "un comprador", comprador_id)
    for campo, valor in cambios.items():
        setattr(comprador, campo, valor)
    await db.flush()
    await db.refresh(comprador)
    return comprador


# ── Depósitos ────────────────────────────────────────────────────────────────

@router.get("/depositos", response_model=list[DepositoResponse])
async def list_depositos(
    is_active: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[Deposito]:
    stmt = select(Deposito).order_by(Deposito.nombre.asc())
    if is_active is not None:
        stmt = stmt.where(Deposito.is_active == is_active)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/depositos", response_model=DepositoResponse, status_code=status.HTTP_201_CREATED)
async def create_deposito(
    data: DepositoCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Deposito:
    await _validar_nombre_unico(db, Deposito, data.nombre, "un depósito")
    deposito = Deposito(**data.model_dump())
    db.add(deposito)
    await db.flush()
    await db.refresh(deposito)
    return deposito


@router.patch("/depositos/{deposito_id}", response_model=DepositoResponse)
async def update_deposito(
    deposito_id: str,
    data: DepositoUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Deposito:
    deposito = await db.get(Deposito, deposito_id)
    if deposito is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deposito not found")
    cambios = data.model_dump(exclude_unset=True)
    if "nombre" in cambios:
        await _validar_nombre_unico(db, Deposito, cambios["nombre"], "un depósito", deposito_id)
    for campo, valor in cambios.items():
        setattr(deposito, campo, valor)
    await db.flush()
    await db.refresh(deposito)
    return deposito
