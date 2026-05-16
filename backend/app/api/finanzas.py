from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_gerencial_up
from app.models.finanzas import (
    ClasificacionEgreso,
    Egreso,
    Finca,
    Ingreso,
    MonedaTipo,
    OrigenPago,
    ProductoIngreso,
    TipoEgreso,
)
from app.models.parcela import VariedadUva
from app.models.user import User
from app.schemas.finanzas import (
    EgresoCreate,
    EgresoResponse,
    EgresoUpdate,
    FlujoAnualResponse,
    FlujoMensual,
    IngresoCreate,
    IngresoResponse,
    IngresoUpdate,
    ResumenEgresoPorTipo,
)

router = APIRouter(prefix="/finanzas", tags=["Finanzas"])

_MONTH_NAMES_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}


# ── Egresos ────────────────────────────────────────────────────────────────────

@router.get("/egresos/", response_model=list[EgresoResponse])
async def list_egresos(
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    tipo: TipoEgreso | None = Query(None),
    clasificacion: ClasificacionEgreso | None = Query(None),
    origen: OrigenPago | None = Query(None),
    finca: Finca | None = Query(None),
    moneda: MonedaTipo | None = Query(None),
    fuente: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[Egreso]:
    stmt = select(Egreso).order_by(Egreso.fecha.desc())
    if fecha_desde is not None:
        stmt = stmt.where(Egreso.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(Egreso.fecha <= fecha_hasta)
    if tipo is not None:
        stmt = stmt.where(Egreso.tipo == tipo)
    if clasificacion is not None:
        stmt = stmt.where(Egreso.clasificacion == clasificacion)
    if origen is not None:
        stmt = stmt.where(Egreso.origen == origen)
    if finca is not None:
        stmt = stmt.where(Egreso.finca == finca)
    if moneda is not None:
        stmt = stmt.where(Egreso.moneda == moneda)
    if fuente is not None:
        stmt = stmt.where(Egreso.fuente == fuente)
    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


# Must be declared before /egresos/{egreso_id} to avoid shadowing
@router.get("/egresos/resumen/por-tipo", response_model=list[ResumenEgresoPorTipo])
async def egresos_resumen_por_tipo(
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    finca: Finca | None = Query(None),
    moneda: MonedaTipo | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[ResumenEgresoPorTipo]:
    stmt = select(
        Egreso.tipo,
        Egreso.clasificacion,
        Egreso.moneda,
        func.coalesce(func.sum(Egreso.monto), 0).label("total"),
    ).group_by(Egreso.tipo, Egreso.clasificacion, Egreso.moneda)

    if fecha_desde is not None:
        stmt = stmt.where(Egreso.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(Egreso.fecha <= fecha_hasta)
    if finca is not None:
        stmt = stmt.where(Egreso.finca == finca)
    if moneda is not None:
        stmt = stmt.where(Egreso.moneda == moneda)

    rows = (await db.execute(stmt)).all()
    return [
        ResumenEgresoPorTipo(
            tipo=row.tipo,
            clasificacion=row.clasificacion,
            moneda=row.moneda,
            total=Decimal(str(row.total)),
        )
        for row in rows
    ]


@router.get("/egresos/{egreso_id}", response_model=EgresoResponse)
async def get_egreso(
    egreso_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Egreso:
    result = await db.execute(select(Egreso).where(Egreso.id == egreso_id))
    egreso = result.scalar_one_or_none()
    if egreso is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Egreso not found")
    return egreso


@router.post("/egresos/", response_model=EgresoResponse, status_code=status.HTTP_201_CREATED)
async def create_egreso(
    egreso_data: EgresoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> Egreso:
    egreso = Egreso(**egreso_data.model_dump(), created_by=current_user.id)
    db.add(egreso)
    await db.flush()
    await db.refresh(egreso)
    return egreso


@router.put("/egresos/{egreso_id}", response_model=EgresoResponse)
async def update_egreso(
    egreso_id: str,
    egreso_data: EgresoUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Egreso:
    result = await db.execute(select(Egreso).where(Egreso.id == egreso_id))
    egreso = result.scalar_one_or_none()
    if egreso is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Egreso not found")
    for field, value in egreso_data.model_dump(exclude_unset=True).items():
        setattr(egreso, field, value)
    await db.flush()
    await db.refresh(egreso)
    return egreso


@router.delete("/egresos/{egreso_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_egreso(
    egreso_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    result = await db.execute(select(Egreso).where(Egreso.id == egreso_id))
    egreso = result.scalar_one_or_none()
    if egreso is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Egreso not found")
    await db.delete(egreso)
    await db.flush()


# ── Ingresos ───────────────────────────────────────────────────────────────────

@router.get("/ingresos/", response_model=list[IngresoResponse])
async def list_ingresos(
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    cliente: str | None = Query(None),
    producto: ProductoIngreso | None = Query(None),
    origen: OrigenPago | None = Query(None),
    finca: Finca | None = Query(None),
    moneda: MonedaTipo | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[Ingreso]:
    stmt = select(Ingreso).order_by(Ingreso.fecha.desc())
    if fecha_desde is not None:
        stmt = stmt.where(Ingreso.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(Ingreso.fecha <= fecha_hasta)
    if cliente is not None:
        stmt = stmt.where(Ingreso.cliente.ilike(f"%{cliente}%"))
    if producto is not None:
        stmt = stmt.where(Ingreso.producto == producto)
    if origen is not None:
        stmt = stmt.where(Ingreso.origen == origen)
    if finca is not None:
        stmt = stmt.where(Ingreso.finca == finca)
    if moneda is not None:
        stmt = stmt.where(Ingreso.moneda == moneda)
    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/ingresos/{ingreso_id}", response_model=IngresoResponse)
async def get_ingreso(
    ingreso_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Ingreso:
    result = await db.execute(select(Ingreso).where(Ingreso.id == ingreso_id))
    ingreso = result.scalar_one_or_none()
    if ingreso is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingreso not found")
    return ingreso


@router.post("/ingresos/", response_model=IngresoResponse, status_code=status.HTTP_201_CREATED)
async def create_ingreso(
    ingreso_data: IngresoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> Ingreso:
    ingreso = Ingreso(**ingreso_data.model_dump(), created_by=current_user.id)
    db.add(ingreso)
    await db.flush()
    await db.refresh(ingreso)
    return ingreso


@router.put("/ingresos/{ingreso_id}", response_model=IngresoResponse)
async def update_ingreso(
    ingreso_id: str,
    ingreso_data: IngresoUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> Ingreso:
    result = await db.execute(select(Ingreso).where(Ingreso.id == ingreso_id))
    ingreso = result.scalar_one_or_none()
    if ingreso is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingreso not found")
    for field, value in ingreso_data.model_dump(exclude_unset=True).items():
        setattr(ingreso, field, value)
    await db.flush()
    await db.refresh(ingreso)
    return ingreso


@router.delete("/ingresos/{ingreso_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ingreso(
    ingreso_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    result = await db.execute(select(Ingreso).where(Ingreso.id == ingreso_id))
    ingreso = result.scalar_one_or_none()
    if ingreso is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingreso not found")
    await db.delete(ingreso)
    await db.flush()


# ── Flujo anual ────────────────────────────────────────────────────────────────

@router.get("/flujo-anual/", response_model=FlujoAnualResponse)
async def flujo_anual(
    anio_inicio: int = Query(..., ge=2000, le=2100),
    anio_fin: int = Query(..., ge=2001, le=2101),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> FlujoAnualResponse:
    if anio_fin != anio_inicio + 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="anio_fin must equal anio_inicio + 1 (agricultural campaign is 12 months)",
        )

    start = date(anio_inicio, 5, 1)
    end = date(anio_fin, 4, 30)

    egresos = list(
        (await db.execute(select(Egreso).where(Egreso.fecha >= start, Egreso.fecha <= end)))
        .scalars()
        .all()
    )
    ingresos = list(
        (await db.execute(select(Ingreso).where(Ingreso.fecha >= start, Ingreso.fecha <= end)))
        .scalars()
        .all()
    )

    # Build ordered campaign months: May → April
    campaign_months: list[tuple[int, int]] = []
    y, m = anio_inicio, 5
    for _ in range(12):
        campaign_months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1

    zero = Decimal("0")
    monthly: dict[tuple[int, int], dict[str, Decimal]] = {
        key: {
            "ingresos_ars": zero, "egresos_ars": zero,
            "ingresos_usd": zero, "egresos_usd": zero,
        }
        for key in campaign_months
    }

    for e in egresos:
        key = (e.fecha.year, e.fecha.month)
        if key in monthly:
            if e.moneda == MonedaTipo.ars:
                monthly[key]["egresos_ars"] += e.monto
            else:
                monthly[key]["egresos_usd"] += e.monto

    for i in ingresos:
        key = (i.fecha.year, i.fecha.month)
        if key in monthly:
            if i.moneda == MonedaTipo.ars:
                monthly[key]["ingresos_ars"] += i.monto
            else:
                monthly[key]["ingresos_usd"] += i.monto

    meses: list[FlujoMensual] = []
    totals: dict[str, Decimal] = {
        "ingresos_ars": zero, "egresos_ars": zero,
        "ingresos_usd": zero, "egresos_usd": zero,
    }

    for y, m in campaign_months:
        d = monthly[(y, m)]
        meses.append(FlujoMensual(
            mes=f"{_MONTH_NAMES_ES[m]} {y}",
            ingresos_ars=d["ingresos_ars"],
            egresos_ars=d["egresos_ars"],
            saldo_ars=d["ingresos_ars"] - d["egresos_ars"],
            ingresos_usd=d["ingresos_usd"],
            egresos_usd=d["egresos_usd"],
            saldo_usd=d["ingresos_usd"] - d["egresos_usd"],
        ))
        for k in totals:
            totals[k] += d[k]

    return FlujoAnualResponse(
        campana=f"{anio_inicio}-{anio_fin}",
        meses=meses,
        total_ingresos_ars=totals["ingresos_ars"],
        total_egresos_ars=totals["egresos_ars"],
        saldo_total_ars=totals["ingresos_ars"] - totals["egresos_ars"],
        total_ingresos_usd=totals["ingresos_usd"],
        total_egresos_usd=totals["egresos_usd"],
        saldo_total_usd=totals["ingresos_usd"] - totals["egresos_usd"],
    )
