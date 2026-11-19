"""insumo egreso: enum value, destino and idempotency key on movimientos_stock

Revision ID: b3e9a1d4c7f2
Revises: a2a2a2a00001
Create Date: 2026-11-18 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3e9a1d4c7f2'
down_revision: Union[str, None] = 'a2a2a2a00001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate does not detect new members of a native Postgres enum. ADD VALUE
    # runs outside the transaction block: the new value is not used in this migration.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tipomovimientostock ADD VALUE IF NOT EXISTS 'egreso'")

    op.add_column('movimientos_stock', sa.Column('destino', sa.String(length=200), nullable=True))
    op.add_column('movimientos_stock', sa.Column('idempotency_key', sa.String(length=64), nullable=True))
    op.create_index(
        'uq_movimientos_stock_idempotency_key',
        'movimientos_stock',
        ['idempotency_key'],
        unique=True,
        postgresql_where=sa.text('idempotency_key IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index(
        'uq_movimientos_stock_idempotency_key',
        table_name='movimientos_stock',
        postgresql_where=sa.text('idempotency_key IS NOT NULL'),
    )
    op.drop_column('movimientos_stock', 'idempotency_key')
    op.drop_column('movimientos_stock', 'destino')
    # Postgres cannot drop a member of a native enum: 'egreso' stays in tipomovimientostock.
