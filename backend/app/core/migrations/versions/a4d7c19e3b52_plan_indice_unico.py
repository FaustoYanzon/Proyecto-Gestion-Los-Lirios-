"""plan fitosanitario: unique key per variety, round and product

Progress against the plan is now measured by month and product, summing every
plan row of the same (temporada, variedad, mes, insumo). A duplicated row of
the same round would silently double the monthly target, so the data-entry key
(temporada, variedad, numero_aplicacion, insumo_id) becomes unique. Production
was cleaned of duplicates on 2026-10-27 (scripts/migracion/limpiar_duplicados_plan.py);
run scripts/migracion/pregate_ordenes_multiproducto.py before deploying: with
duplicates left this migration fails and the release does not start.

Revision ID: a4d7c19e3b52
Revises: 71e969f8521f
Create Date: 2026-10-28 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4d7c19e3b52"
down_revision: Union[str, Sequence[str], None] = "71e969f8521f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX = "ux_planes_fitosanitarios_clave"


def upgrade() -> None:
    op.create_index(
        INDEX,
        "planes_fitosanitarios",
        ["temporada", "variedad", "numero_aplicacion", "insumo_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(INDEX, table_name="planes_fitosanitarios")
