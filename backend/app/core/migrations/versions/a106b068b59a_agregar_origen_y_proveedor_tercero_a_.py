"""agregar origen y proveedor_tercero a registros_cosecha

Revision ID: a106b068b59a
Revises: 478138a22e4d
Create Date: 2026-09-19 12:42:49.406865

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a106b068b59a'
down_revision: Union[str, None] = '478138a22e4d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

origencosecha = postgresql.ENUM(
    'propio', 'tercero', name='origencosecha', create_type=False,
)


def upgrade() -> None:
    origencosecha.create(op.get_bind(), checkfirst=True)
    op.add_column('registros_cosecha', sa.Column('origen', origencosecha, server_default='propio', nullable=False))
    op.add_column('registros_cosecha', sa.Column('proveedor_tercero', sa.String(length=150), nullable=True))


def downgrade() -> None:
    op.drop_column('registros_cosecha', 'proveedor_tercero')
    op.drop_column('registros_cosecha', 'origen')
    op.execute("DROP TYPE IF EXISTS origencosecha")
