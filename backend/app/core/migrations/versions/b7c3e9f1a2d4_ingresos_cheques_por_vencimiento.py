"""Ingresos con cheque se imputan por vencimiento (f_pago) en las vistas KPI

Los cheques/echeques cobrados se devengan cuando vencen, no cuando se
reciben: vw_flujo_mensual_real (-> vw_presupuesto_vs_real) y
vw_kpi_comprador pasan a agrupar ingresos por la misma "fecha de
imputación" que Ingreso.fecha_imputacion en el modelo. Mismas columnas, así
que alcanza con CREATE OR REPLACE (vw_presupuesto_vs_real no se toca).

Revision ID: b7c3e9f1a2d4
Revises: a106b068b59a
Create Date: 2026-09-24
"""
from typing import Sequence, Union

from alembic import op

revision: str = "b7c3e9f1a2d4"
down_revision: Union[str, None] = "a106b068b59a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _vistas(fecha_ingreso: str) -> tuple[str, str]:
    temporada = (
        f"CASE WHEN EXTRACT(MONTH FROM {fecha_ingreso}) >= 5 "
        f"THEN EXTRACT(YEAR FROM {fecha_ingreso})::int "
        f"ELSE EXTRACT(YEAR FROM {fecha_ingreso})::int - 1 END"
    )
    flujo = f"""
CREATE OR REPLACE VIEW vw_flujo_mensual_real AS
SELECT
    CASE WHEN EXTRACT(MONTH FROM fecha) >= 5
         THEN EXTRACT(YEAR FROM fecha)::int
         ELSE EXTRACT(YEAR FROM fecha)::int - 1 END AS temporada,
    EXTRACT(MONTH FROM fecha)::int   AS mes,
    'egreso'                         AS concepto,
    tipo::text                       AS tipo,
    moneda::text                     AS moneda,
    SUM(monto)                       AS monto
FROM egresos
GROUP BY 1, 2, 4, 5
UNION ALL
SELECT
    {temporada},
    EXTRACT(MONTH FROM {fecha_ingreso})::int,
    'ingreso',
    NULL::text,
    moneda::text,
    SUM(monto)
FROM ingresos
GROUP BY 1, 2, 5
"""
    comprador = f"""
CREATE OR REPLACE VIEW vw_kpi_comprador AS
WITH kg AS (
    SELECT temporada,
           UPPER(TRIM(comprador)) AS comprador,
           SUM(kg_total)          AS kg_entregados
    FROM registros_cosecha
    WHERE comprador IS NOT NULL AND TRIM(comprador) <> ''
    GROUP BY 1, 2
),
cobros AS (
    SELECT {temporada} AS temporada,
           UPPER(TRIM(comprador)) AS comprador,
           SUM(monto) FILTER (WHERE moneda = 'ars') AS monto_cobrado_ars,
           SUM(monto) FILTER (WHERE moneda = 'usd') AS monto_cobrado_usd
    FROM ingresos
    WHERE TRIM(comprador) <> ''
    GROUP BY 1, 2
)
SELECT
    COALESCE(k.temporada, c.temporada)   AS temporada,
    COALESCE(k.comprador, c.comprador)   AS comprador,
    COALESCE(k.kg_entregados, 0)         AS kg_entregados,
    COALESCE(c.monto_cobrado_ars, 0)     AS monto_cobrado_ars,
    COALESCE(c.monto_cobrado_usd, 0)     AS monto_cobrado_usd
FROM kg k
FULL OUTER JOIN cobros c
  ON k.temporada = c.temporada AND k.comprador = c.comprador
"""
    return flujo, comprador


_FECHA_IMPUTACION = (
    "(CASE WHEN forma_pago::text IN ('cheque', 'echeque') AND f_pago IS NOT NULL "
    "THEN f_pago ELSE fecha END)"
)


def upgrade() -> None:
    for sql in _vistas(_FECHA_IMPUTACION):
        op.execute(sql)


def downgrade() -> None:
    for sql in _vistas("fecha"):
        op.execute(sql)
