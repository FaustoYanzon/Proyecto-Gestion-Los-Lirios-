from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_up, require_gerencial_up
from app.models.insumo import Insumo
from app.models.parcela import Parcela, VariedadUva
from app.models.produccion import PlanFitosanitario, RegistroFitosanitario
from app.models.user import User
from app.schemas.produccion import (
    CumplimientoPlanItem,
    NecesidadInsumoItem,
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


async def _calcular_cumplimiento(
    db: AsyncSession, temporada: int, variedad: VariedadUva | None = None,
) -> tuple[list[CumplimientoPlanItem], dict[str, float]]:
    """Cruza el plan cargado a mano contra lo realmente aplicado (RegistroFitosanitario)
    dentro de la ventana de campaña (mayo->abril). No hay vínculo explícito entre una
    aplicación real y una fila del plan (decisión de Fausto: no tocar el formulario de
    Fitosanitarios) -- se hace matching automático por variedad+insumo, y cuando el mismo
    insumo tiene varias rondas planificadas para una variedad, la N-ésima aplicación real
    de ese insumo en una parcela (por orden cronológico) cubre la N-ésima ronda planificada.
    Heurística razonable, no infalible si las rondas se aplican fuera de orden.
    """
    planes_stmt = (
        select(PlanFitosanitario)
        .options(selectinload(PlanFitosanitario.insumo))
        .where(PlanFitosanitario.temporada == temporada)
        .order_by(PlanFitosanitario.variedad, PlanFitosanitario.insumo_id, PlanFitosanitario.numero_aplicacion)
    )
    if variedad is not None:
        planes_stmt = planes_stmt.where(PlanFitosanitario.variedad == variedad)
    planes = (await db.execute(planes_stmt)).scalars().all()
    if not planes:
        return [], {}

    variedades_en_plan = {p.variedad for p in planes}
    parcelas = (
        await db.execute(
            select(Parcela).where(
                Parcela.is_active.is_(True), Parcela.variedad.in_(variedades_en_plan)
            )
        )
    ).scalars().all()
    parcelas_por_variedad: dict[VariedadUva, list[Parcela]] = defaultdict(list)
    for p in parcelas:
        parcelas_por_variedad[p.variedad].append(p)

    desde = date(temporada, 5, 1)
    hasta = date(temporada + 1, 4, 30)
    aplicaciones: dict[tuple[str, str], list[date]] = defaultdict(list)
    parcela_ids = [p.id for p in parcelas]
    if parcela_ids:
        registros = (
            await db.execute(
                select(RegistroFitosanitario).where(
                    RegistroFitosanitario.parcela_id.in_(parcela_ids),
                    RegistroFitosanitario.fecha >= desde,
                    RegistroFitosanitario.fecha <= hasta,
                    RegistroFitosanitario.insumo_id.is_not(None),
                )
            )
        ).scalars().all()
        for r in registros:
            aplicaciones[(r.parcela_id, r.insumo_id)].append(r.fecha)
        for fechas in aplicaciones.values():
            fechas.sort()

    contador_grupo: dict[tuple[VariedadUva, str], int] = defaultdict(int)
    resultado: list[CumplimientoPlanItem] = []
    pendiente_por_insumo: dict[str, float] = defaultdict(float)

    for plan in planes:
        grupo_key = (plan.variedad, plan.insumo_id)
        indice = contador_grupo[grupo_key]
        contador_grupo[grupo_key] += 1

        parcelas_variedad = parcelas_por_variedad.get(plan.variedad, [])
        parcelas_total = len(parcelas_variedad)
        parcelas_aplicadas = 0

        for parcela in parcelas_variedad:
            fechas = aplicaciones.get((parcela.id, plan.insumo_id), [])
            if len(fechas) > indice:
                parcelas_aplicadas += 1
            elif parcela.superficie_ha:
                pendiente_por_insumo[plan.insumo_id] += plan.dosis_por_ha * parcela.superficie_ha

        porcentaje = round(100 * parcelas_aplicadas / parcelas_total) if parcelas_total else 0
        if parcelas_aplicadas == 0:
            estado = "pendiente"
        elif parcelas_aplicadas == parcelas_total:
            estado = "completo"
        else:
            estado = "parcial"

        resultado.append(
            CumplimientoPlanItem(
                plan_id=plan.id,
                variedad=plan.variedad,
                numero_aplicacion=plan.numero_aplicacion,
                mes=plan.mes,
                insumo_nombre=plan.insumo.nombre,
                objetivo=plan.objetivo,
                dosis_por_ha=plan.dosis_por_ha,
                parcelas_total=parcelas_total,
                parcelas_aplicadas=parcelas_aplicadas,
                porcentaje=porcentaje,
                estado=estado,
            )
        )

    return resultado, dict(pendiente_por_insumo)


@router.get("/cumplimiento", response_model=list[CumplimientoPlanItem])
async def cumplimiento_plan_fitosanitario(
    temporada: int = Query(...),
    variedad: VariedadUva | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[CumplimientoPlanItem]:
    resultado, _pendiente = await _calcular_cumplimiento(db, temporada, variedad)
    return resultado


@router.get("/necesidad-stock", response_model=list[NecesidadInsumoItem])
async def necesidad_stock(
    temporada: int = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[NecesidadInsumoItem]:
    _resultado, pendiente_por_insumo = await _calcular_cumplimiento(db, temporada)
    if not pendiente_por_insumo:
        return []

    insumos = {
        i.id: i
        for i in (
            await db.execute(select(Insumo).where(Insumo.id.in_(pendiente_por_insumo.keys())))
        ).scalars().all()
    }

    items: list[NecesidadInsumoItem] = []
    for insumo_id, cantidad_pendiente in pendiente_por_insumo.items():
        insumo = insumos.get(insumo_id)
        if insumo is None:
            continue
        stock_actual = Decimal(str(insumo.stock_actual))
        faltante = max(0.0, cantidad_pendiente - float(stock_actual))
        items.append(
            NecesidadInsumoItem(
                insumo_id=insumo_id,
                insumo_nombre=insumo.nombre,
                unidad=insumo.unidad,
                cantidad_pendiente=round(cantidad_pendiente, 2),
                stock_actual=stock_actual,
                faltante=round(faltante, 2),
            )
        )
    items.sort(key=lambda x: x.faltante, reverse=True)
    return items


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
