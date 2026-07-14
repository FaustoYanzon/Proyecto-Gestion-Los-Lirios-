"""convert ingresos.estado from free text to a closed enum

Fausto confirmed the only two real values seen in the source spreadsheet:
NR = "no registrado" (en negro) and FACT = "facturado". Locks the column
down the same way destino/forma_pago already are.

Revision ID: f8a6e10ed72e
Revises: c1d3f7a9e2b4
Create Date: 2026-07-14

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'f8a6e10ed72e'
down_revision: Union[str, None] = 'c1d3f7a9e2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

estadoingreso = postgresql.ENUM(
    'no_registrado', 'facturado', name='estadoingreso', create_type=False,
)


def upgrade() -> None:
    estadoingreso.create(op.get_bind(), checkfirst=True)
    # Defensive mapping: any legacy free-text value that isn't a recognized
    # alias falls back to NULL instead of failing the migration. Production
    # has 0 rows in `ingresos` right now, so this is a no-op there.
    op.execute("""
        ALTER TABLE ingresos ALTER COLUMN estado TYPE estadoingreso USING (
            CASE UPPER(TRIM(estado))
                WHEN 'NR' THEN 'no_registrado'
                WHEN 'FACT' THEN 'facturado'
                WHEN 'NO_REGISTRADO' THEN 'no_registrado'
                WHEN 'FACTURADO' THEN 'facturado'
                ELSE NULL
            END
        )::estadoingreso
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE ingresos ALTER COLUMN estado TYPE VARCHAR(50) USING estado::text")
    op.execute("DROP TYPE IF EXISTS estadoingreso")
