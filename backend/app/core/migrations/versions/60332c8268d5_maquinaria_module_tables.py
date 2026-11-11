"""maquinaria module tables

Revision ID: 60332c8268d5
Revises: 7d2c5e9a41b8
Create Date: 2026-11-11 18:23:29.867632

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '60332c8268d5'
down_revision: Union[str, None] = '7d2c5e9a41b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Enum types owned by this migration. `finca` already exists (shared with
# egresos/ingresos/users) and `userrole` is intentionally untouched.
_NEW_ENUMS = (
    postgresql.ENUM('tractor', 'cosechadora', 'enfardadora', 'implemento', name='tipomaquina'),
    postgresql.ENUM('sigue_trabajando', 'parada', name='gravedadfalla'),
    postgresql.ENUM(
        'reportada', 'diagnosticada', 'presupuesto_pendiente', 'presupuesto_aprobado',
        'enviada_taller', 'en_reparacion', 'lista_retirar', 'pendiente_validacion',
        'cerrada', 'cancelada', name='estadoordenmaquinaria',
    ),
    postgresql.ENUM('pendiente', 'aprobado', 'rechazado', name='estadopresupuestomaquinaria'),
)


def upgrade() -> None:
    bind = op.get_bind()
    for enum_type in _NEW_ENUMS:
        enum_type.create(bind, checkfirst=True)
    op.create_table('maquinas',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('tipo', postgresql.ENUM('tractor', 'cosechadora', 'enfardadora', 'implemento', name='tipomaquina', create_type=False), nullable=False),
    sa.Column('marca', sa.String(length=100), nullable=False),
    sa.Column('modelo', sa.String(length=100), nullable=False),
    sa.Column('anio', sa.Integer(), nullable=True),
    sa.Column('patente_serie', sa.String(length=100), nullable=True),
    sa.Column('horas_motor', sa.Numeric(precision=10, scale=1), nullable=True),
    sa.Column('finca', postgresql.ENUM('los_mimbres', 'media_agua', 'caucete', name='finca', create_type=False), nullable=False),
    sa.Column('tractor_id', sa.String(length=36), nullable=True),
    sa.Column('foto_url', sa.String(length=500), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tractor_id'], ['maquinas.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_maquinas_finca', 'maquinas', ['finca'], unique=False)
    op.create_table('maquinaria_ordenes',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('maquina_id', sa.String(length=36), nullable=False),
    sa.Column('finca', postgresql.ENUM('los_mimbres', 'media_agua', 'caucete', name='finca', create_type=False), nullable=False),
    sa.Column('reportada_por', sa.String(length=36), nullable=False),
    sa.Column('descripcion', sa.Text(), nullable=False),
    sa.Column('gravedad', postgresql.ENUM('sigue_trabajando', 'parada', name='gravedadfalla', create_type=False), nullable=False),
    sa.Column('estado', postgresql.ENUM('reportada', 'diagnosticada', 'presupuesto_pendiente', 'presupuesto_aprobado', 'enviada_taller', 'en_reparacion', 'lista_retirar', 'pendiente_validacion', 'cerrada', 'cancelada', name='estadoordenmaquinaria', create_type=False), nullable=False),
    sa.Column('taller', sa.String(length=200), nullable=True),
    sa.Column('fecha_estimada_entrega', sa.Date(), nullable=True),
    sa.Column('idempotency_key', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['maquina_id'], ['maquinas.id'], ),
    sa.ForeignKeyConstraint(['reportada_por'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key')
    )
    op.create_index('ix_maquinaria_ordenes_finca_estado', 'maquinaria_ordenes', ['finca', 'estado'], unique=False)
    op.create_index('ix_maquinaria_ordenes_maquina', 'maquinaria_ordenes', ['maquina_id'], unique=False)
    op.create_table('maquinaria_orden_eventos',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('orden_id', sa.String(length=36), nullable=False),
    sa.Column('estado_desde', postgresql.ENUM('reportada', 'diagnosticada', 'presupuesto_pendiente', 'presupuesto_aprobado', 'enviada_taller', 'en_reparacion', 'lista_retirar', 'pendiente_validacion', 'cerrada', 'cancelada', name='estadoordenmaquinaria', create_type=False), nullable=True),
    sa.Column('estado_hasta', postgresql.ENUM('reportada', 'diagnosticada', 'presupuesto_pendiente', 'presupuesto_aprobado', 'enviada_taller', 'en_reparacion', 'lista_retirar', 'pendiente_validacion', 'cerrada', 'cancelada', name='estadoordenmaquinaria', create_type=False), nullable=False),
    sa.Column('usuario_id', sa.String(length=36), nullable=False),
    sa.Column('nota', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['orden_id'], ['maquinaria_ordenes.id'], ),
    sa.ForeignKeyConstraint(['usuario_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_maquinaria_orden_eventos_orden', 'maquinaria_orden_eventos', ['orden_id', 'created_at'], unique=False)
    op.create_table('maquinaria_orden_fotos',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('orden_id', sa.String(length=36), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('subida_por', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['orden_id'], ['maquinaria_ordenes.id'], ),
    sa.ForeignKeyConstraint(['subida_por'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_maquinaria_orden_fotos_orden', 'maquinaria_orden_fotos', ['orden_id'], unique=False)
    op.create_table('maquinaria_pagos',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('orden_id', sa.String(length=36), nullable=False),
    sa.Column('monto_real', sa.Numeric(precision=15, scale=2), nullable=False),
    sa.Column('factura_url', sa.String(length=500), nullable=True),
    sa.Column('fecha', sa.Date(), nullable=False),
    sa.Column('registrado_por', sa.String(length=36), nullable=False),
    sa.Column('egreso_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['egreso_id'], ['egresos.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['orden_id'], ['maquinaria_ordenes.id'], ),
    sa.ForeignKeyConstraint(['registrado_por'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('orden_id')
    )
    op.create_table('maquinaria_presupuestos',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('orden_id', sa.String(length=36), nullable=False),
    sa.Column('taller', sa.String(length=200), nullable=False),
    sa.Column('monto', sa.Numeric(precision=15, scale=2), nullable=False),
    sa.Column('detalle', sa.Text(), nullable=True),
    sa.Column('adjunto_url', sa.String(length=500), nullable=True),
    sa.Column('estado', postgresql.ENUM('pendiente', 'aprobado', 'rechazado', name='estadopresupuestomaquinaria', create_type=False), nullable=False),
    sa.Column('motivo_rechazo', sa.Text(), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('resuelto_por', sa.String(length=36), nullable=True),
    sa.Column('resuelto_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['orden_id'], ['maquinaria_ordenes.id'], ),
    sa.ForeignKeyConstraint(['resuelto_por'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_maquinaria_presupuestos_orden', 'maquinaria_presupuestos', ['orden_id'], unique=False)
    op.create_index(
        'uq_maquinaria_presupuesto_pendiente', 'maquinaria_presupuestos', ['orden_id'],
        unique=True, postgresql_where=sa.text("estado = 'pendiente'"),
    )


def downgrade() -> None:
    op.drop_index(
        'uq_maquinaria_presupuesto_pendiente', table_name='maquinaria_presupuestos',
        postgresql_where=sa.text("estado = 'pendiente'"),
    )
    op.drop_index('ix_maquinaria_presupuestos_orden', table_name='maquinaria_presupuestos')
    op.drop_table('maquinaria_presupuestos')
    op.drop_table('maquinaria_pagos')
    op.drop_index('ix_maquinaria_orden_fotos_orden', table_name='maquinaria_orden_fotos')
    op.drop_table('maquinaria_orden_fotos')
    op.drop_index('ix_maquinaria_orden_eventos_orden', table_name='maquinaria_orden_eventos')
    op.drop_table('maquinaria_orden_eventos')
    op.drop_index('ix_maquinaria_ordenes_maquina', table_name='maquinaria_ordenes')
    op.drop_index('ix_maquinaria_ordenes_finca_estado', table_name='maquinaria_ordenes')
    op.drop_table('maquinaria_ordenes')
    op.drop_index('ix_maquinas_finca', table_name='maquinas')
    op.drop_table('maquinas')
    bind = op.get_bind()
    for enum_type in reversed(_NEW_ENUMS):
        enum_type.drop(bind, checkfirst=True)
