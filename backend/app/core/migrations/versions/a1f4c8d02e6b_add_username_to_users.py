"""add username to users

Revision ID: a1f4c8d02e6b
Revises: 6605bdca4963
Create Date: 2026-08-05 00:00:00.000000

Login moves from email to a separate `username` credential (email stays as
the real account identity). Existing rows are backfilled from the local part
of their email (lowercased) before the column is made NOT NULL + unique —
safe today because the 3 real users in production have distinct email
prefixes (administracion, camilotrabajofinca, ri3215015).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1f4c8d02e6b'
down_revision: Union[str, None] = '6605bdca4963'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('username', sa.String(length=50), nullable=True))
    op.execute("UPDATE users SET username = lower(split_part(email, '@', 1))")
    op.alter_column('users', 'username', nullable=False)
    op.create_unique_constraint('uq_users_username', 'users', ['username'])


def downgrade() -> None:
    op.drop_constraint('uq_users_username', 'users', type_='unique')
    op.drop_column('users', 'username')
