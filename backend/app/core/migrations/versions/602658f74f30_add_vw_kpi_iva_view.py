"""add IVA compra/venta view over imported ARCA comprobantes

Aggregates comprobantes_arca_importados by calendar month (IVA is a
monthly tax obligation in Argentina, unlike the twice-a-month upload
cadence), netting out notas de credito. Includes pendiente/clasificado
rows -- IVA is a fact of the comprobante itself, independent of whether
it has been classified into an Egreso/Ingreso yet. Excludes descartado.

Revision ID: 602658f74f30
Revises: 5f262505db41
Create Date: 2026-08-12

"""
from typing import Sequence, Union

from alembic import op

revision: str = '602658f74f30'
down_revision: Union[str, None] = '5f262505db41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VIEW = """
CREATE OR REPLACE VIEW vw_kpi_iva AS
SELECT
    EXTRACT(YEAR FROM fecha_emision)::int AS anio,
    EXTRACT(MONTH FROM fecha_emision)::int AS mes,
    tipo_archivo,
    SUM(CASE WHEN es_nota_credito THEN -total_iva ELSE total_iva END) AS iva
FROM comprobantes_arca_importados
WHERE estado != 'descartado'
GROUP BY 1, 2, 3
"""


def upgrade() -> None:
    op.execute(_VIEW)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS vw_kpi_iva")
