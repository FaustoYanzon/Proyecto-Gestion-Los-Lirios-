from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_up, require_gerencial_up
from app.models.insumo import Insumo
from app.models.parcela import VariedadUva
from app.models.produccion import OrdenAplicacion, PlanFitosanitario, RegistroFitosanitario
from app.models.user import User
from app.schemas.produccion import (
    AvanceItem,
    AvanceParcela,
    ContrasteLineaOut,
    ContrasteRequest,
    ContrasteVariedad,
    NecesidadInsumoItem,
    PlanFitosanitarioCreate,
    PlanFitosanitarioResponse,
    PlanFitosanitarioUpdate,
)
from app.services.plan_avance import calcular_avance, pendiente_por_insumo
from app.services.plan_contraste import LineaContraste, ParcelaElegida, calcular_contraste

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


@router.get("/avance", response_model=list[AvanceItem])
async def avance_plan_fitosanitario(
    temporada: int = Query(...),
    mes: int | None = Query(None, ge=1, le=12),
    variedad: VariedadUva | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[AvanceItem]:
    """Plan vs applied by variety, month and product (all months without `mes`)."""
    claves = await calcular_avance(db, temporada, mes, variedad)
    return [
        AvanceItem(
            variedad=c.variedad, mes=c.mes, insumo_id=c.insumo_id, insumo_nombre=c.insumo_nombre,
            unidad=c.unidad, dosis_plan=c.dosis_plan, dosis_aplicada_promedio=c.dosis_aplicada_promedio,
            porcentaje=c.porcentaje, estado=c.estado.value, ha_total=c.ha_total,
            parcelas=[
                AvanceParcela(
                    id=p.parcela_id, nombre=p.nombre, ha=p.ha, dosis_aplicada=p.dosis_aplicada,
                    porcentaje=p.porcentaje, estado=p.estado.value,
                )
                for p in c.parcelas
            ],
        )
        for c in claves
    ]


@router.post("/contraste", response_model=list[ContrasteLineaOut])
async def contraste_orden(
    body: ContrasteRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[ContrasteLineaOut]:
    """Read-only: how each product line of a draft order fits the monthly plan."""
    lineas = await calcular_contraste(
        db, body.fecha,
        [ParcelaElegida(p.parcela_id, tuple(p.valvula_ids)) for p in body.parcelas],
        [LineaContraste(ln.insumo_id, ln.dosis_por_ha) for ln in body.lineas],
    )
    return [
        ContrasteLineaOut(
            insumo_id=ln.insumo_id,
            variedades=[
                ContrasteVariedad(
                    variedad=v.variedad, estado=v.estado.value, dosis_plan=v.dosis_plan,
                    dosis_aplicada_promedio=v.dosis_aplicada_promedio,
                    dosis_proyectada_promedio=v.dosis_proyectada_promedio,
                    porcentaje_proyectado=v.porcentaje_proyectado,
                )
                for v in ln.variedades
            ],
        )
        for ln in lineas
    ]


@router.get("/necesidad-stock", response_model=list[NecesidadInsumoItem])
async def necesidad_stock(
    temporada: int = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[NecesidadInsumoItem]:
    pendientes = await pendiente_por_insumo(db, temporada, date.today())
    if not pendientes:
        return []

    insumos = {
        i.id: i
        for i in (
            await db.execute(select(Insumo).where(Insumo.id.in_(pendientes.keys())))
        ).scalars().all()
    }

    items: list[NecesidadInsumoItem] = []
    for insumo_id, cantidad_pendiente in pendientes.items():
        insumo = insumos.get(insumo_id)
        if insumo is None:
            continue
        stock_actual = Decimal(str(insumo.stock_actual))
        faltante = max(Decimal("0"), cantidad_pendiente - stock_actual)
        items.append(
            NecesidadInsumoItem(
                insumo_id=insumo_id,
                insumo_nombre=insumo.nombre,
                unidad=insumo.unidad,
                cantidad_pendiente=float(round(cantidad_pendiente, 2)),
                stock_actual=stock_actual,
                faltante=float(round(faltante, 2)),
            )
        )
    items.sort(key=lambda x: x.faltante, reverse=True)
    return items


async def _verificar_clave_libre(
    db: AsyncSession, temporada: int, variedad: VariedadUva, numero_aplicacion: int,
    insumo_id: str, excepto_id: str | None = None,
) -> None:
    """409 when (temporada, variedad, ronda, insumo) already has a row: a twin
    would silently double the monthly target (unique index is the backstop)."""
    stmt = select(PlanFitosanitario.id).where(
        PlanFitosanitario.temporada == temporada,
        PlanFitosanitario.variedad == variedad,
        PlanFitosanitario.numero_aplicacion == numero_aplicacion,
        PlanFitosanitario.insumo_id == insumo_id,
    )
    if excepto_id is not None:
        stmt = stmt.where(PlanFitosanitario.id != excepto_id)
    if (await db.execute(stmt.limit(1))).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya existe una fila del plan {temporada} para {variedad.value}, "
                f"ronda {numero_aplicacion} y ese producto."
            ),
        )


async def _verificar_mes_libre(
    db: AsyncSession, temporada: int, variedad: VariedadUva, mes: int, insumo_id: str,
    excepto_id: str | None = None,
) -> None:
    """409 when the product already has a dose for that variety and month: the
    target is one dose per key, so the existing row must be edited instead."""
    stmt = select(PlanFitosanitario.id).where(
        PlanFitosanitario.temporada == temporada,
        PlanFitosanitario.variedad == variedad,
        PlanFitosanitario.mes == mes,
        PlanFitosanitario.insumo_id == insumo_id,
    )
    if excepto_id is not None:
        stmt = stmt.where(PlanFitosanitario.id != excepto_id)
    if (await db.execute(stmt.limit(1))).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ese producto ya está en el plan de {variedad.value} para ese mes: "
                "editá la dosis de la fila existente."
            ),
        )


async def _siguiente_numero(
    db: AsyncSession, temporada: int, variedad: VariedadUva, insumo_id: str,
) -> int:
    """Next free legacy round number for the unique index (not user-facing)."""
    maximo = (
        await db.execute(
            select(func.max(PlanFitosanitario.numero_aplicacion)).where(
                PlanFitosanitario.temporada == temporada,
                PlanFitosanitario.variedad == variedad,
                PlanFitosanitario.insumo_id == insumo_id,
            )
        )
    ).scalar()
    return (maximo or 0) + 1


@router.post("/", response_model=list[PlanFitosanitarioResponse], status_code=status.HTTP_201_CREATED)
async def create_plan_fitosanitario(
    data: PlanFitosanitarioCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_gerencial_up),
) -> list[PlanFitosanitarioResponse]:
    insumo = await db.get(Insumo, data.insumo_id)
    if insumo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Insumo not found")

    numeros: dict[VariedadUva, int] = {}
    for variedad in data.variedades:
        if data.numero_aplicacion is not None:
            # Explicit round (legacy clients): same-month twins stay allowed and add up.
            await _verificar_clave_libre(
                db, data.temporada, variedad, data.numero_aplicacion, data.insumo_id)
            numeros[variedad] = data.numero_aplicacion
        else:
            await _verificar_mes_libre(db, data.temporada, variedad, data.mes, data.insumo_id)
            numeros[variedad] = await _siguiente_numero(db, data.temporada, variedad, data.insumo_id)

    creados: list[PlanFitosanitario] = []
    for variedad in data.variedades:
        plan = PlanFitosanitario(
            temporada=data.temporada,
            variedad=variedad,
            numero_aplicacion=numeros[variedad],
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
    clave = {
        k: update_data.get(k, getattr(plan, k))
        for k in ("temporada", "variedad", "numero_aplicacion", "insumo_id")
    }
    if any(k in update_data for k in clave):
        await _verificar_clave_libre(db, excepto_id=plan.id, **clave)
    destino = {k: update_data.get(k, getattr(plan, k)) for k in ("temporada", "variedad", "mes", "insumo_id")}
    if any(k in update_data for k in ("variedad", "mes", "insumo_id")):
        # Moving a row onto an occupied (variety, month, product) would double its target.
        await _verificar_mes_libre(db, excepto_id=plan.id, **destino)
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
    # Progress is measured by date now; clear the legacy links (FKs) so old
    # orders/records that still point at this row do not block the delete.
    await db.execute(
        update(RegistroFitosanitario)
        .where(RegistroFitosanitario.plan_fitosanitario_id == plan_id)
        .values(plan_fitosanitario_id=None)
    )
    await db.execute(
        update(OrdenAplicacion)
        .where(OrdenAplicacion.plan_fitosanitario_id == plan_id)
        .values(plan_fitosanitario_id=None)
    )
    await db.delete(plan)
    await db.flush()
