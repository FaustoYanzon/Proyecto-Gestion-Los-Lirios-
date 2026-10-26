"""vw_kpi_produccion_parcela: manto por superficie

Recrea la vista con la regla vigente del riego a manto: los registros nuevos
(n_valvulas_manto no NULL) usan el 25% sobre n_valvulas_manto; los manto
historicos (n_valvulas_manto NULL) conservan el 40% sobre las valvulas del CSV.
Mismas columnas y tipos que la version de e44e14c0a72b; solo cambian los litros.

Revision ID: c3f1a8d27e54
Revises: b92967a1486b
Create Date: 2026-10-26 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c3f1a8d27e54'
down_revision: Union[str, None] = 'b92967a1486b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Copied (not imported) from e44e14c0a72b: migrations must stay frozen even if
# that module changes, and alembic revision files are not importable packages.
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
# Previous rule (e44e14c0a72b): every manto at 40% over the CSV valve count.
_LITROS_MANTO_04 = (
    f"duracion_horas * 16000 * CASE WHEN tipo = 'manto' THEN 0.4 ELSE 1 END * {_N_VALVULAS_CSV}"
)
# Mirrors RegistroRiego.factor_caudal + contar_valvulas: new manto uses 25% over
# the frozen n_valvulas_manto; historical manto (NULL) keeps 40% over the CSV.
_LITROS_MANTO_SUPERFICIE = (
    "duracion_horas * 16000 * CASE WHEN tipo = 'manto' "
    "THEN CASE WHEN n_valvulas_manto IS NULL THEN 0.4 ELSE 0.25 END ELSE 1 END "
    f"* COALESCE(n_valvulas_manto, {_N_VALVULAS_CSV})"
)


def upgrade() -> None:
    op.execute(_vista_produccion_parcela(_LITROS_MANTO_SUPERFICIE))


def downgrade() -> None:
    op.execute(_vista_produccion_parcela(_LITROS_MANTO_04))
