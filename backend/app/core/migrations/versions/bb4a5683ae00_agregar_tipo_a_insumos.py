"""agregar tipo a insumos

Revision ID: bb4a5683ae00
Revises: 703724978020
Create Date: 2026-09-13 12:58:06.661808

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'bb4a5683ae00'
down_revision: Union[str, None] = '703724978020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tipo nuevo -- hay que crearlo explícitamente antes del ADD COLUMN
# (a diferencia de create_table, add_column no crea el enum solo).
tipoinsumo = postgresql.ENUM('fitosanitario', 'vario', 'riego', name='tipoinsumo')


def upgrade() -> None:
    tipoinsumo.create(op.get_bind(), checkfirst=True)
    # Todos los insumos existentes eran fitosanitarios antes de esta migración.
    op.add_column('insumos', sa.Column('tipo', tipoinsumo, server_default='fitosanitario', nullable=False))


def downgrade() -> None:
    op.drop_column('insumos', 'tipo')
    tipoinsumo.drop(op.get_bind(), checkfirst=True)
