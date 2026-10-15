"""entrega de pasa por bin: remito_lineas.bin_id (un bin sale una sola vez)

Revision ID: 9d3a6f1b2c85
Revises: 7c4e1a9d3b62
Create Date: 2026-10-15 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9d3a6f1b2c85'
down_revision: Union[str, None] = '7c4e1a9d3b62'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('remito_lineas') as batch:
        batch.add_column(sa.Column('bin_id', sa.String(length=36), nullable=True))
        batch.create_foreign_key('fk_remito_lineas_bin_id', 'bines_pasa', ['bin_id'], ['id'])
    op.create_index(
        'uq_remito_linea_bin', 'remito_lineas', ['bin_id'], unique=True,
        postgresql_where=sa.text('bin_id IS NOT NULL'),
        sqlite_where=sa.text('bin_id IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_remito_linea_bin', table_name='remito_lineas')
    with op.batch_alter_table('remito_lineas') as batch:
        batch.drop_constraint('fk_remito_lineas_bin_id', type_='foreignkey')
        batch.drop_column('bin_id')
