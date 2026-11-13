"""maquinaria orden numero e icono de maquina

Revision ID: 07acdb0d401f
Revises: 60332c8268d5
Create Date: 2026-11-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '07acdb0d401f'
down_revision: Union[str, None] = '60332c8268d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SEQ = 'maquinaria_orden_numero_seq'

BACKFILL_SQL = """
UPDATE maquinaria_ordenes
SET numero = n.rn
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
    FROM maquinaria_ordenes
) n
WHERE maquinaria_ordenes.id = n.id
"""


def upgrade() -> None:
    op.add_column('maquinas', sa.Column('icono', sa.String(length=20), nullable=True))

    op.execute(f'CREATE SEQUENCE IF NOT EXISTS {_SEQ}')
    op.add_column('maquinaria_ordenes', sa.Column('numero', sa.Integer(), nullable=True))
    # Backfill in creation order (id as tie-breaker for a deterministic result).
    op.execute(BACKFILL_SQL)
    # Next nextval() must follow the backfilled rows (is_called=false when empty).
    op.execute(
        f"SELECT setval('{_SEQ}', COALESCE((SELECT MAX(numero) FROM maquinaria_ordenes), 1), "
        "(SELECT COUNT(*) > 0 FROM maquinaria_ordenes))"
    )
    op.alter_column('maquinaria_ordenes', 'numero', nullable=False,
                    server_default=sa.text(f"nextval('{_SEQ}')"))
    op.create_unique_constraint('uq_maquinaria_ordenes_numero', 'maquinaria_ordenes', ['numero'])


def downgrade() -> None:
    op.drop_constraint('uq_maquinaria_ordenes_numero', 'maquinaria_ordenes', type_='unique')
    op.drop_column('maquinaria_ordenes', 'numero')
    op.execute(f'DROP SEQUENCE IF EXISTS {_SEQ}')
    op.drop_column('maquinas', 'icono')
