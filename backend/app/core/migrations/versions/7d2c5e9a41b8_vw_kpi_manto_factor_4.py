"""vw_kpi_produccion_parcela: manto = 4x goteo

Recreates the view with the owner's 2026-11-05 rule: manto delivers 4x the drip
flow for new AND historical records. Litros = horas * 16000 * 4 * valves, where
valves is n_valvulas_manto when set, else the `valvula` CSV count (empty = 1).
Same columns and types as c3f1a8d27e54; only the litros expression changes.
c3f1a8d27e54 is left untouched.

Revision ID: 7d2c5e9a41b8
Revises: 91b7e7904993
Create Date: 2026-11-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '7d2c5e9a41b8'
down_revision: Union[str, None] = '91b7e7904993'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Copied (not imported): migrations must stay frozen even if other modules change.
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


_N_VALVULAS_CSV = (
    "GREATEST(COALESCE(array_length(string_to_array(NULLIF(valvula, ''), ','), 1), 1), 1)"
)
# Previous rule (c3f1a8d27e54): new manto 25% over n_valvulas_manto, historical 40% over CSV.
_LITROS_MANTO_ANTERIOR = (
    "duracion_horas * 16000 * CASE WHEN tipo = 'manto' "
    "THEN CASE WHEN n_valvulas_manto IS NULL THEN 0.4 ELSE 0.25 END ELSE 1 END "
    f"* COALESCE(n_valvulas_manto, {_N_VALVULAS_CSV})"
)
# Mirrors RegistroRiego.factor_caudal + contar_valvulas: manto is 4x for every record.
_LITROS_MANTO_X4 = (
    "duracion_horas * 16000 * CASE WHEN tipo = 'manto' THEN 4 ELSE 1 END "
    f"* COALESCE(n_valvulas_manto, {_N_VALVULAS_CSV})"
)


def upgrade() -> None:
    op.execute(_vista_produccion_parcela(_LITROS_MANTO_X4))


def downgrade() -> None:
    op.execute(_vista_produccion_parcela(_LITROS_MANTO_ANTERIOR))
