"""Ingreso de uva al pasero (con báscula), raqueo y stock de uva fresca."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_encargado_up
from app.models.alta_produccion import Bin, IngresoPasero, Lote, Productor, UbicacionPasero
from app.models.parcela import Parcela, TipoParcela, VariedadUva
from app.models.produccion import DestinoCosecha, OrigenCosecha, RegistroCosecha
from app.models.user import User
from app.schemas.alta_produccion import (
    IngresoPaseroCreate,
    IngresoPaseroResponse,
    StockPaseroItem,
    UbicacionPaseroCreate,
    UbicacionPaseroResponse,
)
from app.services import mermas
from app.services.alta_produccion import get_parametros

router = APIRouter(prefix="/pasero", tags=["Pasero"])

DESTINOS_PASA = {DestinoCosecha.pasas, DestinoCosecha.rama_pasa}


async def get_pasero_or_404(db: AsyncSession, pasero_id: str, for_update: bool = False) -> Parcela:
    """`for_update` serializa las levantadas sobre el mismo pasero: la uva
    disponible es un saldo derivado, no una columna con su propio lock."""
    if for_update:
        pasero = (
            await db.execute(select(Parcela).where(Parcela.id == pasero_id).with_for_update())
        ).scalar_one_or_none()
    else:
        pasero = await db.get(Parcela, pasero_id)
    if pasero is None or pasero.tipo != TipoParcela.pasero:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pasero not found")
    return pasero


# ── Rutas estáticas primero ──────────────────────────────────────────────────

@router.get("/stock", response_model=list[StockPaseroItem])
async def stock_pasero(
    pasero_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[StockPaseroItem]:
    """Uva fresca en pasero por variedad, con lo levantado y el balance 4:1."""
    params = await get_parametros(db)

    stmt_ing = select(
        IngresoPasero.pasero_id, IngresoPasero.variedad, func.sum(IngresoPasero.kg_real)
    ).group_by(IngresoPasero.pasero_id, IngresoPasero.variedad)
    stmt_bin = (
        select(Bin.pasero_id, Lote.variedad, func.sum(Bin.kg_real), func.sum(Bin.uva_consumida_kg))
        .join(Lote, Lote.id == Bin.lote_id)
        .group_by(Bin.pasero_id, Lote.variedad)
    )
    if pasero_id:
        stmt_ing = stmt_ing.where(IngresoPasero.pasero_id == pasero_id)
        stmt_bin = stmt_bin.where(Bin.pasero_id == pasero_id)

    ingresos = {(p, v): Decimal(kg) for p, v, kg in (await db.execute(stmt_ing)).all()}
    levantado = {
        (p, v): (Decimal(pasa), Decimal(uva)) for p, v, pasa, uva in (await db.execute(stmt_bin)).all()
    }
    claves = set(ingresos) | set(levantado)
    nombres = {
        p.id: p.nombre
        for p in (
            await db.execute(select(Parcela).where(Parcela.id.in_({c[0] for c in claves})))
        ).scalars().all()
    } if claves else {}

    items: list[StockPaseroItem] = []
    for (p_id, variedad) in sorted(claves, key=lambda c: (nombres.get(c[0], ""), c[1].value)):
        uva_in = ingresos.get((p_id, variedad), Decimal("0"))
        pasa, uva_cons = levantado.get((p_id, variedad), (Decimal("0"), Decimal("0")))
        balance = mermas.balance_levantada(uva_in, pasa, params.ratio_uva_pasa)
        items.append(
            StockPaseroItem(
                pasero_id=p_id,
                pasero_nombre=nombres.get(p_id, ""),
                variedad=variedad,
                uva_ingresada_kg=balance["uva_ingresada_kg"],
                uva_consumida_kg=uva_cons,
                uva_disponible_kg=uva_in - uva_cons,
                pasa_levantada_kg=balance["pasa_levantada_kg"],
                pasa_esperada_kg=balance["pasa_esperada_kg"],
                diferencia_pasa_kg=balance["diferencia_pasa_kg"],
            )
        )
    return items


@router.get("/ubicaciones", response_model=list[UbicacionPaseroResponse])
async def list_ubicaciones(
    pasero_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[UbicacionPasero]:
    stmt = select(UbicacionPasero).order_by(
        UbicacionPasero.pasero_id, UbicacionPasero.hilera, UbicacionPasero.parte
    )
    if pasero_id:
        stmt = stmt.where(UbicacionPasero.pasero_id == pasero_id)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/ubicaciones", response_model=UbicacionPaseroResponse, status_code=status.HTTP_201_CREATED)
async def create_ubicacion(
    data: UbicacionPaseroCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> UbicacionPasero:
    await get_pasero_or_404(db, data.pasero_id)
    existente = await db.scalar(
        select(UbicacionPasero).where(
            UbicacionPasero.pasero_id == data.pasero_id,
            UbicacionPasero.hilera == data.hilera,
            UbicacionPasero.parte == data.parte,
        )
    )
    if existente is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La ubicación ya existe")
    ubicacion = UbicacionPasero(**data.model_dump())
    db.add(ubicacion)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La ubicación ya existe") from exc
    await db.refresh(ubicacion)
    return ubicacion


@router.get("/ingresos", response_model=list[IngresoPaseroResponse])
async def list_ingresos(
    pasero_id: str | None = Query(None),
    variedad: VariedadUva | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[IngresoPasero]:
    stmt = select(IngresoPasero).order_by(IngresoPasero.fecha.desc(), IngresoPasero.created_at.desc())
    if pasero_id:
        stmt = stmt.where(IngresoPasero.pasero_id == pasero_id)
    if variedad:
        stmt = stmt.where(IngresoPasero.variedad == variedad)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/ingresos", response_model=IngresoPaseroResponse, status_code=status.HTTP_201_CREATED)
async def create_ingreso(
    data: IngresoPaseroCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> IngresoPasero:
    await get_pasero_or_404(db, data.pasero_id)

    if data.origen == OrigenCosecha.tercero and data.productor_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Un ingreso de origen tercero requiere productor_id",
        )
    if data.productor_id is not None and await db.get(Productor, data.productor_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Productor not found")
    if data.ubicacion_id is not None:
        ubicacion = await db.get(UbicacionPasero, data.ubicacion_id)
        if ubicacion is None or ubicacion.pasero_id != data.pasero_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La ubicación no pertenece al pasero indicado",
            )
    if data.cosecha_id is not None:
        cosecha = await db.get(RegistroCosecha, data.cosecha_id)
        if cosecha is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registro de cosecha not found")
        if cosecha.destino not in DESTINOS_PASA:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"La cosecha tiene destino {cosecha.destino.value}: solo una cosecha "
                "destinada a pasa puede ingresar al pasero",
            )

    params = await get_parametros(db)
    fichas = data.fichas if data.fichas is not None else data.carros * params.fichas_por_carro
    kg_teorico = mermas.kg_teorico_ingreso(fichas, params.kg_por_ficha)

    ingreso = IngresoPasero(
        fecha=data.fecha,
        pasero_id=data.pasero_id,
        ubicacion_id=data.ubicacion_id,
        cosecha_id=data.cosecha_id,
        variedad=data.variedad,
        origen=data.origen,
        productor_id=data.productor_id,
        carros=data.carros,
        fichas=fichas,
        kg_teorico=kg_teorico,
        kg_real=data.kg_real,
        merma_kg=mermas.merma_ingreso(kg_teorico, data.kg_real),
        observaciones=data.observaciones,
        created_by=current_user.id,
    )
    db.add(ingreso)
    await db.flush()
    await db.refresh(ingreso)
    return ingreso
