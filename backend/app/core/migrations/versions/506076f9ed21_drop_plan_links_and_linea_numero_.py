"""drop plan links and linea numero_aplicacion

Revision ID: 506076f9ed21
Revises: a4d7c19e3b52
Create Date: 2026-10-30 14:06:33.697635

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '506076f9ed21'
down_revision: Union[str, None] = 'a4d7c19e3b52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # DROP COLUMN also drops the FK and index that depend on the column, so the
    # constraint names (which differ between local and prod) do not matter.
    op.drop_column('registros_fitosanitarios', 'plan_fitosanitario_id')
    op.drop_column('ordenes_aplicacion_insumos', 'numero_aplicacion')
    op.drop_column('ordenes_aplicacion', 'plan_fitosanitario_id')


def downgrade() -> None:
    op.add_column('registros_fitosanitarios', sa.Column('plan_fitosanitario_id', sa.VARCHAR(length=36), autoincrement=False, nullable=True))
    op.create_foreign_key(op.f('fk_registros_plan_fitosanitario'), 'registros_fitosanitarios', 'planes_fitosanitarios', ['plan_fitosanitario_id'], ['id'])
    op.create_index(op.f('ix_registros_fitosanitarios_plan'), 'registros_fitosanitarios', ['plan_fitosanitario_id'], unique=False)
    op.add_column('ordenes_aplicacion_insumos', sa.Column('numero_aplicacion', sa.INTEGER(), autoincrement=False, nullable=True))
    op.add_column('ordenes_aplicacion', sa.Column('plan_fitosanitario_id', sa.VARCHAR(length=36), autoincrement=False, nullable=True))
    op.create_foreign_key(op.f('ordenes_aplicacion_plan_fitosanitario_id_fkey'), 'ordenes_aplicacion', 'planes_fitosanitarios', ['plan_fitosanitario_id'], ['id'])
