"""riego manto 60mm

Each finished manto riego now delivers a fixed 60 mm over the whole parcela, whatever
its duration. The litres are frozen per record in registros_riego.litros_manto.

- Inserts the editable parameter mm_riego_manto = 60 (parametros_produccion).
- Adds registros_riego.litros_manto (Float, NULL).
- Backfills finished manto records whose parcela has a surface: litros_manto =
  60 * superficie_ha * 10000 and mm_aplicados = 60. Records on a parcela without
  surface stay NULL (0 litres); in-progress records stay NULL.
- Recreates vw_kpi_produccion_parcela: the manto branch reads litros_manto.
  Goteo is unchanged. Same columns and types as 7d2c5e9a41b8.

7d2c5e9a41b8 is left untouched; downgrade restores its expression.

Revision ID: c9b5b6bebbfd
Revises: 07acdb0d401f
Create Date: 2026-11-17 11:59:47.262915

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c9b5b6bebbfd'
down_revision: Union[str, None] = '07acdb0d401f'
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
# Previous rule (7d2c5e9a41b8): manto is 4x the drip flow for every record.
_LITROS_MANTO_X4 = (
    "duracion_horas * 16000 * CASE WHEN tipo = 'manto' THEN 4 ELSE 1 END "
    f"* COALESCE(n_valvulas_manto, {_N_VALVULAS_CSV})"
)
# New rule: manto reads the frozen litres (0 while in progress or without surface);
# goteo keeps horas * 16000 * valves.
_LITROS_MANTO_FIJO = (
    "CASE WHEN tipo = 'manto' THEN COALESCE(litros_manto, 0) "
    f"ELSE duracion_horas * 16000 * COALESCE(n_valvulas_manto, {_N_VALVULAS_CSV}) END"
)


def upgrade() -> None:
    # (1) Editable parameter; ON CONFLICT keeps a value already set by hand.
    op.execute(
        "INSERT INTO parametros_produccion (clave, valor, updated_at) "
        "VALUES ('mm_riego_manto', 60, now()) ON CONFLICT (clave) DO NOTHING"
    )
    # (2) Frozen litres per record.
    op.add_column("registros_riego", sa.Column("litros_manto", sa.Float(), nullable=True))
    # (3) Backfill finished manto records on a parcela with surface.
    op.execute(
        "UPDATE registros_riego r "
        "SET litros_manto = 60 * p.superficie_ha * 10000, mm_aplicados = 60 "
        "FROM parcelas p "
        "WHERE r.parcela_id = p.id AND r.tipo = 'manto' AND r.fin IS NOT NULL "
        "AND p.superficie_ha > 0"
    )
    # (4) KPI view reads the frozen litres.
    op.execute(_vista_produccion_parcela(_LITROS_MANTO_FIJO))


def downgrade() -> None:
    # The view must stop referencing litros_manto before the column is dropped.
    op.execute(_vista_produccion_parcela(_LITROS_MANTO_X4))
    # Old rule: mm = hours * 1.6 mm/h * 4 (manto factor).
    op.execute(
        "UPDATE registros_riego SET mm_aplicados = ROUND((duracion_horas * 1.6 * 4)::numeric, 2) "
        "WHERE tipo = 'manto' AND duracion_horas IS NOT NULL"
    )
    op.drop_column("registros_riego", "litros_manto")
    # mm_riego_manto stays in parametros_produccion (harmless, unused).
