"""observaciones por bin de pasa

Revision ID: 7c4e1a9d3b62
Revises: 5b2f8c1d7a44
Create Date: 2026-10-13 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7c4e1a9d3b62'
down_revision: Union[str, None] = '5b2f8c1d7a44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bines_pasa', sa.Column('observaciones', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('bines_pasa', 'observaciones')
