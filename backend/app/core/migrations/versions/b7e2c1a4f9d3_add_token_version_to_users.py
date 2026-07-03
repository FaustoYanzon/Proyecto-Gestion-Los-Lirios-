"""add_token_version_to_users

Revision ID: b7e2c1a4f9d3
Revises: a4244d685964
Create Date: 2026-07-03 10:00:00.000000

Adds users.token_version to support session invalidation. Existing rows get a
server_default of 1 so no backfill is required; every issued JWT will carry this
value as the "tv" claim.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7e2c1a4f9d3'
down_revision: Union[str, None] = 'a4244d685964'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'token_version',
            sa.Integer(),
            nullable=False,
            server_default='1',
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'token_version')
