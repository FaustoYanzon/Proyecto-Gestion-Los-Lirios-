"""KPI endpoints for Cambio 5 dashboards.

Thin read-only layer over the vw_kpi_* / vw_presupuesto_vs_real SQL views
(migration d4e7b2c9f1a5). All KPI math lives in the views so FastAPI and
Power BI always report identical numbers.
"""

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_gerencial_up
from app.models.user import User
from app.schemas.kpis import (
    CompradorKpi,
    ManoObraMensualKpi,
    ManoObraParcelaKpi,
    ManoObraParcelaMesKpi,
    PresupuestoVsRealItem,
    ProduccionParcelaKpi,
    ProduccionVariedadKpi,
)

router = APIRouter(prefix="/kpis", tags=["KPIs"])


async def _fetch(
    db: AsyncSession, view: str, filters: dict[str, Any], order_by: str
) -> list[dict[str, Any]]:
    """Run a filtered SELECT over a whitelisted view with bound parameters.

    `view` and `order_by` are hardcoded by the callers below (never
    user input), so interpolating them is safe; values go through binds.
    """
    conditions = " AND ".join(f"{k} = :{k}" for k, v in filters.items() if v is not None)
    where = f"WHERE {conditions}" if conditions else ""
    stmt = text(f"SELECT * FROM {view} {where} ORDER BY {order_by}")
    params = {k: v for k, v in filters.items() if v is not None}
    result = await db.execute(stmt, params)
    return [dict(row) for row in result.mappings().all()]


@router.get("/presupuesto-vs-real", response_model=list[PresupuestoVsRealItem])
async def presupuesto_vs_real(
    temporada: int = Query(...),
    mes: int | None = Query(None, ge=1, le=12),
    concepto: str | None = Query(None, pattern="^(ingreso|egreso)$"),
    moneda: str | None = Query(None, pattern="^(ars|usd)$"),
    finca: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[dict[str, Any]]:
    return await _fetch(
        db,
        "vw_presupuesto_vs_real",
        {"temporada": temporada, "mes": mes, "concepto": concepto, "moneda": moneda},
        "mes, concepto, tipo NULLS FIRST",
    )


@router.get("/produccion/parcelas", response_model=list[ProduccionParcelaKpi])
async def produccion_parcelas(
    temporada: int | None = Query(None),
    finca: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[dict[str, Any]]:
    return await _fetch(
        db,
        "vw_kpi_produccion_parcela",
        {"temporada": temporada},
        "temporada DESC, kg_ha DESC NULLS LAST",
    )


@router.get("/produccion/variedades", response_model=list[ProduccionVariedadKpi])
async def produccion_variedades(
    temporada: int | None = Query(None),
    finca: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[dict[str, Any]]:
    return await _fetch(
        db,
        "vw_kpi_produccion_variedad",
        {"temporada": temporada},
        "temporada DESC, kg_ha DESC NULLS LAST",
    )


@router.get("/compradores", response_model=list[CompradorKpi])
async def compradores(
    temporada: int = Query(...),
    finca: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[dict[str, Any]]:
    return await _fetch(
        db,
        "vw_kpi_comprador",
        {"temporada": temporada},
        "kg_entregados DESC",
    )


@router.get("/mano-obra/mensual", response_model=list[ManoObraMensualKpi])
async def mano_obra_mensual(
    temporada: int = Query(...),
    finca: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[dict[str, Any]]:
    return await _fetch(
        db,
        "vw_kpi_mo_mensual",
        {"temporada": temporada},
        "mes, clasificacion",
    )


@router.get("/mano-obra/parcelas-mes", response_model=list[ManoObraParcelaMesKpi])
async def mano_obra_parcelas_mes(
    temporada: int = Query(...),
    finca: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[dict[str, Any]]:
    """Per-parcela per-month labor cost — feeds the D4 heatmap."""
    return await _fetch(
        db,
        "vw_kpi_mo_parcela_mes",
        {"temporada": temporada},
        "parcela_nombre, mes",
    )


@router.get("/mano-obra/parcelas", response_model=list[ManoObraParcelaKpi])
async def mano_obra_parcelas(
    temporada: int | None = Query(None),
    finca: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[dict[str, Any]]:
    return await _fetch(
        db,
        "vw_kpi_mo_parcela",
        {"temporada": temporada},
        "temporada DESC, monto DESC",
    )
