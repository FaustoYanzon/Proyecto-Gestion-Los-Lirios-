"""auth_5roles

Revision ID: 1b529f62d678
Revises: dd81fff4c510
Create Date: 2026-05-13 09:10:07.720738

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '1b529f62d678'
down_revision: Union[str, None] = 'dd81fff4c510'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE userrole RENAME TO userrole_old")
    op.execute("CREATE TYPE userrole AS ENUM ('super_admin','gerencial','encargado','regador','obrero')")
    op.execute("ALTER TABLE users ALTER COLUMN role TYPE userrole USING role::text::userrole")
    op.execute("DROP TYPE userrole_old")

def downgrade() -> None:
    op.execute("ALTER TYPE userrole RENAME TO userrole_old")
    op.execute("CREATE TYPE userrole AS ENUM ('admin','encargado','obrero')")
    op.execute("ALTER TABLE users ALTER COLUMN role TYPE userrole USING role::text::userrole")
    op.execute("DROP TYPE userrole_old")