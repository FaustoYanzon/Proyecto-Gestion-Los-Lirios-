"""add estado_variedad_campana table

Revision ID: 9cb9232862b4
Revises: 32154ec7b8f7
Create Date: 2026-07-21 09:52:21.851675

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '9cb9232862b4'
down_revision: Union[str, None] = '32154ec7b8f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# variedaduva ya existe (usado por parcelas.variedad) — create_type=False
# evita que SQLAlchemy intente re-crearlo.
variedaduva = postgresql.ENUM(
    'flame', 'red_globe', 'fiesta', 'bonarda', 'sultanina', 'syrah',
    'aspirant', 'alfalfa', 'otro',
    name='variedaduva', create_type=False,
)

# El único tipo genuinamente nuevo en esta revisión.
estadocampana = postgresql.ENUM(
    'brotacion', 'floracion', 'cuaje', 'cierre_racimo', 'envero', 'cosecha',
    'post_cosecha',
    name='estadocampana', create_type=False,
)


def upgrade() -> None:
    # Crea solo el tipo nuevo; checkfirst hace la migracion re-ejecutable.
    estadocampana.create(op.get_bind(), checkfirst=True)

    op.create_table('estados_variedad_campana',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('variedad', variedaduva, nullable=False),
    sa.Column('anio', sa.Integer(), nullable=False),
    sa.Column('estado_campana', estadocampana, nullable=False),
    sa.Column('fecha_confirmacion', sa.Date(), nullable=False),
    sa.Column('observaciones', sa.String(length=1000), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_estados_variedad_campana_variedad_anio', 'estados_variedad_campana', ['variedad', 'anio'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_estados_variedad_campana_variedad_anio', table_name='estados_variedad_campana')
    op.drop_table('estados_variedad_campana')
    estadocampana.drop(op.get_bind(), checkfirst=True)
