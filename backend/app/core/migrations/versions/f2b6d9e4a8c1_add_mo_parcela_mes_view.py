"""add labor cost per parcela per month view

Feeds the D4 heatmap (parcela x month). Same temporada convention as the
other KPI views.

Revision ID: f2b6d9e4a8c1
Revises: e8a1c4d7b3f2
Create Date: 2026-07-07

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f2b6d9e4a8c1'
down_revision: Union[str, None] = 'e8a1c4d7b3f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VIEW = """
CREATE OR REPLACE VIEW vw_kpi_mo_parcela_mes AS
SELECT
    CASE WHEN EXTRACT(MONTH FROM t.fecha) >= 5
         THEN EXTRACT(YEAR FROM t.fecha)::int
         ELSE EXTRACT(YEAR FROM t.fecha)::int - 1 END AS temporada,
    EXTRACT(MONTH FROM t.fecha)::int AS mes,
    t.parcela_id,
    p.nombre AS parcela_nombre,
    SUM(t.cantidad) FILTER (WHERE t.unidad_medida = 'dias') AS jornales,
    SUM(t.monto_total) AS monto
FROM registros_trabajo t
JOIN parcelas p ON p.id = t.parcela_id
GROUP BY 1, 2, 3, 4
"""


def upgrade() -> None:
    op.execute(_VIEW)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS vw_kpi_mo_parcela_mes")
