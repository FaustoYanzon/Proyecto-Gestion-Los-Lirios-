"""riego manto por superficie

Revision ID: b92967a1486b
Revises: 33a3c708b565
Create Date: 2026-10-26 17:41:42.291456

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b92967a1486b'
down_revision: Union[str, None] = '33a3c708b565'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('registros_riego', sa.Column('n_valvulas_manto', sa.Integer(), nullable=True))
    op.alter_column('registros_riego', 'cabezal',
               existing_type=sa.VARCHAR(length=20),
               nullable=True)
    op.alter_column('registros_riego', 'valvula',
               existing_type=sa.VARCHAR(length=20),
               nullable=True)


def downgrade() -> None:
    # New manto rows have NULL cabezal/valvula; backfill so NOT NULL can be restored.
    op.execute("UPDATE registros_riego SET cabezal = '-' WHERE cabezal IS NULL")
    op.execute("UPDATE registros_riego SET valvula = '-' WHERE valvula IS NULL")
    op.alter_column('registros_riego', 'valvula',
               existing_type=sa.VARCHAR(length=20),
               nullable=False)
    op.alter_column('registros_riego', 'cabezal',
               existing_type=sa.VARCHAR(length=20),
               nullable=False)
    op.drop_column('registros_riego', 'n_valvulas_manto')
