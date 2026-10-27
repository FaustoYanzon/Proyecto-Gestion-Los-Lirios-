from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_up, require_gerencial_up
from app.models.insumo import Insumo
from app.models.parcela import Parcela, VariedadUva
from app.models.produccion import PlanFitosanitario
from app.models.user import User
from app.schemas.produccion import (
    CumplimientoPlanItem,
    NecesidadInsumoItem,
    PlanFitosanitarioCreate,
    PlanFitosanitarioResponse,
    PlanFitosanitarioUpdate,
    RondaPendiente,
    RondaPendienteLinea,
    RondaPendienteParcela,
    RondaPendienteVariedad,
)
from app.services.plan_cobertura import CoberturaParcela, analizar_plan

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


def _estado(cubiertas: Decimal, total: Decimal, aplicadas: int, parcelas: int) -> str:
    if total > 0:
        if cubiertas <= 0:
            return "pendiente"
        return "completo" if cubiertas >= total else "parcial"
    # No surface loaded anywhere: fall back to parcel counts.
    if aplicadas == 0:
        return "pendiente"
    return "completo" if aplicadas == parcelas else "parcial"


def _porcentaje(cubiertas: Decimal, total: Decimal) -> int:
    """Rounded percentage that never reads 100 while something is missing nor
    0 once something was applied (999.6 of 1000 ha is not "complete")."""
    porcentaje = int(round(100 * cubiertas / total))
    if cubiertas < total:
        porcentaje = min(porcentaje, 99)
    if cubiertas > 0:
        porcentaje = max(porcentaje, 1)
    return porcentaje


async def _calcular_cumplimiento(
    db: AsyncSession, temporada: int, variedad: VariedadUva | None = None,
) -> tuple[list[CumplimientoPlanItem], dict[str, Decimal]]:
    """Plan vs. applied, by hectares, from the explicit plan link on each
    record (see app.services.plan_cobertura). Returns the rows and the pending
    quantity per insumo (dosis_plan x pendiente_ha summed over its rows)."""
    analisis = await analizar_plan(db, temporada, variedad)
    coberturas_por_plan: dict[str, list[CoberturaParcela]] = defaultdict(list)
    for cob in analisis.coberturas:
        coberturas_por_plan[cob.plan_id].append(cob)

    resultado: list[CumplimientoPlanItem] = []
    pendiente_por_insumo: dict[str, Decimal] = defaultdict(Decimal)
    for plan in analisis.planes:
        coberturas = coberturas_por_plan.get(plan.id, [])
        ha_total = sum((c.ha_parcela for c in coberturas), Decimal("0"))
        ha_cubiertas = sum((c.ha_cubiertas for c in coberturas), Decimal("0"))
        pendiente_ha = max(ha_total - ha_cubiertas, Decimal("0"))
        pendiente_cantidad = Decimal(str(plan.dosis_por_ha)) * pendiente_ha
        if pendiente_cantidad > 0:
            pendiente_por_insumo[plan.insumo_id] += pendiente_cantidad

        parcelas_total = len(coberturas)
        parcelas_aplicadas = sum(
            1
            for c in coberturas
            # A parcel without surface is trivially "covered"; require a record.
            if (c.ha_cubiertas >= c.ha_parcela if c.ha_parcela > 0 else c.tiene_registros)
        )
        if ha_total > 0:
            porcentaje = _porcentaje(ha_cubiertas, ha_total)
        elif parcelas_total:
            porcentaje = _porcentaje(Decimal(parcelas_aplicadas), Decimal(parcelas_total))
        else:
            porcentaje = 0
        dosis_real = analisis.dosis_real_promedio.get(plan.id)

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
                estado=_estado(ha_cubiertas, ha_total, parcelas_aplicadas, parcelas_total),
                ha_total=float(round(ha_total, 4)),
                ha_cubiertas=float(round(ha_cubiertas, 4)),
                pendiente_ha=float(round(pendiente_ha, 4)),
                pendiente_cantidad=float(round(pendiente_cantidad, 2)),
                dosis_real_promedio=float(round(dosis_real, 4)) if dosis_real is not None else None,
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


def _linea_pendiente(cob: CoberturaParcela) -> bool:
    """The plan row still needs this parcel (same rule as parcelas_aplicadas:
    a parcel without surface is pending until it has a linked record)."""
    if cob.ha_parcela > 0:
        return cob.ha_cubiertas < cob.ha_parcela
    return not cob.tiene_registros


def _ha_float(value: Decimal) -> float:
    return float(round(value, 4))


_TarjetaKey = tuple[int, str, frozenset[tuple[str, Decimal]]]


def _orden_campania(mes: int) -> int:
    """Position of a calendar month in the campaign (May=0 ... April=11)."""
    return (mes - 5) % 12


@router.get("/rondas-pendientes", response_model=list[RondaPendiente])
async def rondas_pendientes(
    temporada: int = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> list[RondaPendiente]:
    """Pending plan rounds as cards for the order form.

    Plan rows are grouped per variety by (numero_aplicacion, objetivo); the
    varieties whose set of STILL-PENDING (insumo, dosis) is identical share
    one card, a different dose means a separate card. A round applied with 3
    of its 4 products comes back with the missing one alone; fully covered
    parcels, varieties and cards are left out. Months follow the campaign
    (May -> April).
    """
    analisis = await analizar_plan(db, temporada)
    coberturas_por_plan: dict[str, list[CoberturaParcela]] = defaultdict(list)
    for cob in analisis.coberturas:
        coberturas_por_plan[cob.plan_id].append(cob)

    filas_por_ronda: dict[tuple[int, str, VariedadUva], list[PlanFitosanitario]] = defaultdict(list)
    for plan in analisis.planes:
        filas_por_ronda[(plan.numero_aplicacion, plan.objetivo, plan.variedad)].append(plan)

    # Card key -> [(variety, its rows of that round still pending somewhere)].
    # Keyed by the STILL-PENDING set, not the planned one: orders go variety
    # by variety, so with flame done on 3 of 4 products and bonarda untouched
    # flame gets a one-tap card with the 4th product alone (its parcels
    # ticked) and bonarda the full 4-line card.
    tarjetas: dict[_TarjetaKey, list[tuple[VariedadUva, list[PlanFitosanitario]]]] = defaultdict(list)
    for (numero, objetivo, variedad), filas in filas_por_ronda.items():
        pendientes = [
            f for f in filas
            if any(_linea_pendiente(c) for c in coberturas_por_plan.get(f.id, []))
        ]
        if not pendientes:
            continue
        # str() so a float dose (1.5) keys equal however it was loaded.
        productos = frozenset((f.insumo_id, Decimal(str(f.dosis_por_ha))) for f in pendientes)
        tarjetas[(numero, objetivo, productos)].append((variedad, pendientes))

    parcela_ids = {c.parcela_id for c in analisis.coberturas}
    nombres: dict[str, str] = {}
    if parcela_ids:
        nombres = {
            pid: nombre
            for pid, nombre in (
                await db.execute(select(Parcela.id, Parcela.nombre).where(Parcela.id.in_(parcela_ids)))
            ).all()
        }

    resultado: list[RondaPendiente] = []
    for (numero, objetivo, _productos), grupo in tarjetas.items():
        variedades: list[RondaPendienteVariedad] = []
        for variedad, filas in sorted(grupo, key=lambda g: g[0].value):
            # parcel id -> coverage of each line of the card, in parcel order.
            por_parcela: dict[str, list[CoberturaParcela]] = {}
            for fila in filas:
                for cob in coberturas_por_plan.get(fila.id, []):
                    por_parcela.setdefault(cob.parcela_id, []).append(cob)

            parcelas: list[RondaPendienteParcela] = []
            ha_variedad = Decimal("0")
            for parcela_id, coberturas in por_parcela.items():
                faltantes = [c for c in coberturas if _linea_pendiente(c)]
                if not faltantes:
                    continue
                ha_pendientes = max(
                    max(c.ha_parcela - c.ha_cubiertas, Decimal("0")) for c in faltantes
                )
                ha_variedad += ha_pendientes
                parcelas.append(
                    RondaPendienteParcela(
                        id=parcela_id,
                        nombre=nombres.get(parcela_id, ""),
                        ha_pendientes=_ha_float(ha_pendientes),
                        # Any line of the card already (even partly) applied here
                        # -> parcial on purpose, also when only some valves got the
                        # round: re-ticking would re-spray the covered valves.
                        parcial=any(c.ha_cubiertas > 0 or c.tiene_registros for c in coberturas),
                    )
                )
            # Never empty: the variety only joined the card with a pending row.
            variedades.append(
                RondaPendienteVariedad(
                    variedad=variedad, ha_pendientes=_ha_float(ha_variedad), parcelas=parcelas,
                )
            )

        # Every variety of the card has the same pending (insumo, dosis) set:
        # the rows of the first one describe the lines.
        lineas = [
            RondaPendienteLinea(
                insumo_id=fila.insumo_id,
                insumo_nombre=fila.insumo.nombre,
                unidad=fila.insumo.unidad,
                dosis_por_ha=fila.dosis_por_ha,
            )
            for fila in sorted(grupo[0][1], key=lambda f: (f.insumo.nombre, f.insumo_id))
        ]
        resultado.append(
            RondaPendiente(
                numero_aplicacion=numero,
                objetivo=objetivo,
                # Varieties may plan the same round in different months: the
                # earliest in campaign order (May -> April), real month number.
                mes=min((f.mes for _v, filas in grupo for f in filas), key=_orden_campania),
                lineas=lineas,
                variedades=variedades,
            )
        )

    resultado.sort(
        key=lambda t: (
            t.numero_aplicacion, _orden_campania(t.mes), t.objetivo, t.variedades[0].variedad.value,
        )
    )
    return resultado


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
