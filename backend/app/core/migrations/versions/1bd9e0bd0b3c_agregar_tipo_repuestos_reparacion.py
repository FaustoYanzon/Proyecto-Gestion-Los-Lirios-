"""agregar tipo repuestos reparacion

Revision ID: 1bd9e0bd0b3c
Revises: 2abdd34eebd2
Create Date: 2026-08-25 00:38:48.200727

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '1bd9e0bd0b3c'
down_revision: Union[str, None] = '2abdd34eebd2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Alembic autogenerate no detecta altas de miembros de enum nativo de
    # Postgres -- se escriben a mano, mismo patron que
    # c1d3f7a9e2b4_redesign_ingresos_bd_cobros.py.
    op.execute("ALTER TYPE tipoegreso ADD VALUE IF NOT EXISTS 'repuestos_reparacion'")
    op.execute("ALTER TYPE clasificacionegreso ADD VALUE IF NOT EXISTS 'herramientas'")
    op.execute("ALTER TYPE clasificacionegreso ADD VALUE IF NOT EXISTS 'indumentaria'")
    op.execute("ALTER TYPE clasificacionegreso ADD VALUE IF NOT EXISTS 'rep_repuestos_maquinaria'")
    op.execute("ALTER TYPE clasificacionegreso ADD VALUE IF NOT EXISTS 'rep_repuestos_riego'")
    op.execute("ALTER TYPE clasificacionegreso ADD VALUE IF NOT EXISTS 'rep_repuestos_parral'")
    op.execute("ALTER TYPE clasificacionegreso ADD VALUE IF NOT EXISTS 'rep_repuestos_otros'")


def downgrade() -> None:
    # Postgres no soporta DROP VALUE en un enum nativo -- no hay downgrade real.
    pass
