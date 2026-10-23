"""orden aplicacion valvulas

Revision ID: b5210a4d05af
Revises: 9d3a6f1b2c85
Create Date: 2026-10-23 15:22:05.141384

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b5210a4d05af'
down_revision: Union[str, None] = '9d3a6f1b2c85'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ordenes_aplicacion_valvulas',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('orden_parcela_id', sa.String(length=36), nullable=False),
    sa.Column('valvula_id', sa.String(length=36), nullable=False),
    # El tipo estadoordenaplicacionparcela ya existe (ordenes_aplicacion_parcelas): no recrearlo.
    sa.Column('estado', postgresql.ENUM('pendiente', 'aplicada', name='estadoordenaplicacionparcela', create_type=False), server_default='pendiente', nullable=False),
    sa.Column('resultado', sa.Enum('completa', 'no_aplicada', name='resultadovalvula'), nullable=True),
    sa.Column('responsable_id', sa.String(length=36), nullable=True),
    sa.Column('responsable', sa.String(length=100), nullable=True),
    sa.Column('observaciones', sa.String(length=1000), nullable=True),
    sa.Column('registro_fitosanitario_id', sa.String(length=36), nullable=True),
    sa.Column('confirmada_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revisada_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revisada_por', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['orden_parcela_id'], ['ordenes_aplicacion_parcelas.id'], ),
    sa.ForeignKeyConstraint(['registro_fitosanitario_id'], ['registros_fitosanitarios.id'], ),
    sa.ForeignKeyConstraint(['responsable_id'], ['trabajadores.id'], ),
    sa.ForeignKeyConstraint(['revisada_por'], ['users.id'], ),
    sa.ForeignKeyConstraint(['valvula_id'], ['valvulas.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ordenes_aplicacion_valvulas_a_revisar', 'ordenes_aplicacion_valvulas', ['confirmada_at'], unique=False, postgresql_where=sa.text("estado = 'aplicada' AND revisada_at IS NULL"))
    op.create_index('ix_ordenes_aplicacion_valvulas_valvula', 'ordenes_aplicacion_valvulas', ['valvula_id'], unique=False)
    op.create_index('uq_ordenes_aplicacion_valvulas_parcela_valvula', 'ordenes_aplicacion_valvulas', ['orden_parcela_id', 'valvula_id'], unique=True)
    op.create_index('uq_ordenes_aplicacion_valvulas_registro', 'ordenes_aplicacion_valvulas', ['registro_fitosanitario_id'], unique=True, postgresql_where=sa.text('registro_fitosanitario_id IS NOT NULL'))
    op.add_column('registros_fitosanitarios', sa.Column('valvula_id', sa.String(length=36), nullable=True))
    op.create_foreign_key('fk_registros_fitosanitarios_valvula_id', 'registros_fitosanitarios', 'valvulas', ['valvula_id'], ['id'])
    op.add_column('valvulas', sa.Column('superficie_ha', sa.Numeric(precision=8, scale=4), nullable=True))


def downgrade() -> None:
    op.drop_column('valvulas', 'superficie_ha')
    op.drop_constraint('fk_registros_fitosanitarios_valvula_id', 'registros_fitosanitarios', type_='foreignkey')
    op.drop_column('registros_fitosanitarios', 'valvula_id')
    op.drop_index('uq_ordenes_aplicacion_valvulas_registro', table_name='ordenes_aplicacion_valvulas', postgresql_where=sa.text('registro_fitosanitario_id IS NOT NULL'))
    op.drop_index('uq_ordenes_aplicacion_valvulas_parcela_valvula', table_name='ordenes_aplicacion_valvulas')
    op.drop_index('ix_ordenes_aplicacion_valvulas_valvula', table_name='ordenes_aplicacion_valvulas')
    op.drop_index('ix_ordenes_aplicacion_valvulas_a_revisar', table_name='ordenes_aplicacion_valvulas', postgresql_where=sa.text("estado = 'aplicada' AND revisada_at IS NULL"))
    op.drop_table('ordenes_aplicacion_valvulas')
    sa.Enum(name='resultadovalvula').drop(op.get_bind(), checkfirst=True)
