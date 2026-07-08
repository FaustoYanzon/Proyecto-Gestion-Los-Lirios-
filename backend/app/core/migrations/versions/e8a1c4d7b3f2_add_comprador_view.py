"""add comprador kpi view

Cross of kg delivered (registros_cosecha.comprador) vs money collected
(ingresos.cliente), matched on UPPER(TRIM(name)). Both are free-text fields,
so the match is best-effort: rows that only appear on one side still show
(FULL OUTER JOIN) — a buyer with kg and no cobros is a collection alert.

Revision ID: e8a1c4d7b3f2
Revises: d4e7b2c9f1a5
Create Date: 2026-07-06

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e8a1c4d7b3f2'
down_revision: Union[str, None] = 'd4e7b2c9f1a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VIEW = """
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
    SELECT CASE WHEN EXTRACT(MONTH FROM fecha) >= 5
                THEN EXTRACT(YEAR FROM fecha)::int
                ELSE EXTRACT(YEAR FROM fecha)::int - 1 END AS temporada,
           UPPER(TRIM(cliente)) AS comprador,
           SUM(monto) FILTER (WHERE moneda = 'ars') AS monto_cobrado_ars,
           SUM(monto) FILTER (WHERE moneda = 'usd') AS monto_cobrado_usd
    FROM ingresos
    WHERE TRIM(cliente) <> ''
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


def upgrade() -> None:
    op.execute(_VIEW)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS vw_kpi_comprador")
