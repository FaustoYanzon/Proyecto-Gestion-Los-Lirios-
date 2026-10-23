"""foto orden valvula

Revision ID: 33a3c708b565
Revises: b5210a4d05af
Create Date: 2026-10-23 15:31:18.605838

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '33a3c708b565'
down_revision: Union[str, None] = 'b5210a4d05af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('fotos_registros_fitosanitarios', sa.Column('orden_valvula_id', sa.String(length=36), nullable=True))
    op.alter_column('fotos_registros_fitosanitarios', 'registro_fitosanitario_id',
               existing_type=sa.VARCHAR(length=36),
               nullable=True)
    op.create_index('ix_fotos_registros_fitosanitarios_orden_valvula', 'fotos_registros_fitosanitarios', ['orden_valvula_id'], unique=False)
    op.create_foreign_key('fk_fotos_registros_fitosanitarios_orden_valvula_id', 'fotos_registros_fitosanitarios', 'ordenes_aplicacion_valvulas', ['orden_valvula_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_fotos_registros_fitosanitarios_orden_valvula_id', 'fotos_registros_fitosanitarios', type_='foreignkey')
    op.drop_index('ix_fotos_registros_fitosanitarios_orden_valvula', table_name='fotos_registros_fitosanitarios')
    # Las fotos de valvulas no_aplicada no tienen registro: no caben en el esquema viejo.
    op.execute('DELETE FROM fotos_registros_fitosanitarios WHERE registro_fitosanitario_id IS NULL')
    op.alter_column('fotos_registros_fitosanitarios', 'registro_fitosanitario_id',
               existing_type=sa.VARCHAR(length=36),
               nullable=False)
    op.drop_column('fotos_registros_fitosanitarios', 'orden_valvula_id')
