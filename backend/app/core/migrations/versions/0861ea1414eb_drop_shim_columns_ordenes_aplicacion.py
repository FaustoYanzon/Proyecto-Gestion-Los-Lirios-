"""drop shim columns ordenes_aplicacion

Revision ID: 0861ea1414eb
Revises: 822f93f13a0d
Create Date: 2026-11-05 12:59:21.628447

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0861ea1414eb'
down_revision: Union[str, None] = '822f93f13a0d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Lines (ordenes_aplicacion_insumos) and parcels are the source of truth now.
    op.drop_constraint(
        op.f('ordenes_aplicacion_insumo_id_fkey'), 'ordenes_aplicacion', type_='foreignkey'
    )
    for column in ('dias_reingreso', 'variedad', 'insumo_id', 'dias_carencia', 'dosis_por_ha', 'origen'):
        op.drop_column('ordenes_aplicacion', column)
    postgresql.ENUM(name='origenordenaplicacion').drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    origen_enum = postgresql.ENUM('plan', 'extra', name='origenordenaplicacion')
    origen_enum.create(bind, checkfirst=True)
    variedad_enum = postgresql.ENUM(
        'flame', 'red_globe', 'fiesta', 'bonarda', 'sultanina', 'syrah',
        'aspirant', 'alfalfa', 'otro', name='variedaduva', create_type=False,
    )
    # Re-created nullable so the backfill can run before NOT NULL is restored.
    op.add_column('ordenes_aplicacion', sa.Column(
        'origen', postgresql.ENUM('plan', 'extra', name='origenordenaplicacion', create_type=False), nullable=True))
    op.add_column('ordenes_aplicacion', sa.Column('dosis_por_ha', sa.Float(), nullable=True))
    op.add_column('ordenes_aplicacion', sa.Column('dias_carencia', sa.Integer(), nullable=True))
    op.add_column('ordenes_aplicacion', sa.Column('insumo_id', sa.String(length=36), nullable=True))
    op.add_column('ordenes_aplicacion', sa.Column('variedad', variedad_enum, nullable=True))
    op.add_column('ordenes_aplicacion', sa.Column('dias_reingreso', sa.Integer(), nullable=True))

    # Shim = first line (posicion 0); history cannot tell plan from extra.
    op.execute("""
        UPDATE ordenes_aplicacion o
        SET insumo_id = l.insumo_id,
            dosis_por_ha = l.dosis_por_ha,
            dias_carencia = l.dias_carencia,
            dias_reingreso = l.dias_reingreso
        FROM ordenes_aplicacion_insumos l
        WHERE l.orden_id = o.id AND l.posicion = 0
    """)
    # Variety of the largest parcel (unknown area = 0, ties by name), as the
    # old _variedad_principal did; 'otro' if no parcel carries a variety.
    op.execute("""
        UPDATE ordenes_aplicacion o
        SET variedad = COALESCE((
            SELECT p.variedad
            FROM ordenes_aplicacion_parcelas op
            JOIN parcelas p ON p.id = op.parcela_id
            WHERE op.orden_id = o.id AND p.variedad IS NOT NULL
            ORDER BY COALESCE(p.superficie_ha, 0) DESC, p.nombre DESC
            LIMIT 1
        ), 'otro')
    """)
    op.execute("UPDATE ordenes_aplicacion SET origen = 'extra'")

    # Fails loudly if an order without lines exists (insumo_id etc. stay NULL).
    for column in ('origen', 'dosis_por_ha', 'dias_carencia', 'insumo_id', 'variedad', 'dias_reingreso'):
        op.alter_column('ordenes_aplicacion', column, nullable=False)
    op.create_foreign_key(
        op.f('ordenes_aplicacion_insumo_id_fkey'), 'ordenes_aplicacion', 'insumos', ['insumo_id'], ['id']
    )
