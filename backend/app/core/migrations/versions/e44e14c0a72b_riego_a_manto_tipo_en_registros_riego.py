"""riego a manto: tipo en registros_riego

Cada riego se marca goteo o manto (reusa el enum `tiporiego` de parcelas).
En manto las valvulas indican hasta que parte del parral llega el agua y el
caudal se estima en el 40% del de goteo (RegistroRiego.FACTOR_MANTO), tanto
para litros como para mm. Todo el historial queda como goteo.

Tambien recrea vw_kpi_produccion_parcela para aplicar ese factor a los litros.

Revision ID: e44e14c0a72b
Revises: bda9cc7d181b
Create Date: 2026-10-05 16:12:46.644253

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e44e14c0a72b'
down_revision: Union[str, None] = 'bda9cc7d181b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TEMPORADA = (
    "CASE WHEN EXTRACT(MONTH FROM {col}) >= 5 "
    "THEN EXTRACT(YEAR FROM {col})::int "
    "ELSE EXTRACT(YEAR FROM {col})::int - 1 END"
)


def _vista_produccion_parcela(litros_expr: str) -> str:
    return f"""
        CREATE OR REPLACE VIEW vw_kpi_produccion_parcela AS
        WITH cosecha AS (
            SELECT temporada, parcela_id, SUM(kg_total) AS kg_total
            FROM registros_cosecha
            WHERE parcela_id IS NOT NULL
            GROUP BY 1, 2
        ),
        riego AS (
            SELECT
                {_TEMPORADA.format(col='fecha')} AS temporada,
                parcela_id,
                SUM({litros_expr}) AS litros
            FROM registros_riego
            GROUP BY 1, 2
        )
        SELECT
            c.temporada,
            p.id              AS parcela_id,
            p.nombre          AS parcela_nombre,
            p.variedad::text  AS variedad,
            p.superficie_ha,
            c.kg_total,
            CASE WHEN p.superficie_ha > 0
                 THEN ROUND((c.kg_total / p.superficie_ha)::numeric, 1)
            END               AS kg_ha,
            m.kg_plan,
            CASE WHEN m.kg_plan > 0
                 THEN ROUND(((c.kg_total - m.kg_plan) / m.kg_plan * 100)::numeric, 1)
            END               AS desvio_plan_pct,
            r.litros          AS litros_riego_estimados,
            CASE WHEN c.kg_total > 0 AND r.litros IS NOT NULL
                 THEN ROUND((r.litros / c.kg_total)::numeric, 1)
            END               AS litros_por_kg
        FROM cosecha c
        JOIN parcelas p ON p.id = c.parcela_id
        LEFT JOIN metas_produccion m
               ON m.parcela_id = c.parcela_id AND m.temporada = c.temporada
        LEFT JOIN riego r
               ON r.parcela_id = c.parcela_id AND r.temporada = c.temporada
    """


_N_VALVULAS = (
    "GREATEST(COALESCE(array_length(string_to_array(NULLIF(valvula, ''), ','), 1), 1), 1)"
)
_LITROS_ANTES = f"duracion_horas * 16000 * {_N_VALVULAS}"
_LITROS_CON_TIPO = (
    f"duracion_horas * 16000 * CASE WHEN tipo = 'manto' THEN 0.4 ELSE 1 END * {_N_VALVULAS}"
)


def upgrade() -> None:
    tipo_riego = postgresql.ENUM("goteo", "manto", name="tiporiego", create_type=False)
    op.add_column(
        "registros_riego",
        sa.Column("tipo", tipo_riego, server_default="goteo", nullable=False),
    )
    op.execute(_vista_produccion_parcela(_LITROS_CON_TIPO))


def downgrade() -> None:
    op.execute(_vista_produccion_parcela(_LITROS_ANTES))
    op.drop_column("registros_riego", "tipo")
