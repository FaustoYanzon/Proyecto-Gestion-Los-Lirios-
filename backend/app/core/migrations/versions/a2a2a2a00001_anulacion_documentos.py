"""annulment columns for remitos and alfalfa documents, bin-release index

Revision ID: a2a2a2a00001
Revises: a1fa1fa00001
Create Date: 2026-11-17 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a2a2a2a00001'
down_revision: Union[str, None] = 'a1fa1fa00001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CK_ANULACION = (
    "(anulado_at IS NULL AND anulado_by IS NULL AND motivo_anulacion IS NULL) "
    "OR (anulado_at IS NOT NULL AND anulado_by IS NOT NULL AND motivo_anulacion IS NOT NULL)"
)

# (table, FK name, check name)
TABLES = (
    ('remitos', 'fk_remitos_anulado_by_users', 'ck_remito_anulacion_completa'),
    (
        'documentos_alfalfa',
        'fk_documentos_alfalfa_anulado_by_users',
        'ck_documento_alfalfa_anulacion_completa',
    ),
)


def upgrade() -> None:
    for table, fk_name, ck_name in TABLES:
        op.add_column(table, sa.Column('anulado_at', sa.DateTime(timezone=True), nullable=True))
        op.add_column(table, sa.Column('anulado_by', sa.String(length=36), nullable=True))
        op.add_column(table, sa.Column('motivo_anulacion', sa.String(length=500), nullable=True))
        op.create_foreign_key(fk_name, table, 'users', ['anulado_by'], ['id'])
        op.create_check_constraint(ck_name, table, CK_ANULACION)

    op.add_column(
        'remito_lineas',
        sa.Column('anulada', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    # Recreate the unique bin index so lines of annulled remitos free their bin.
    op.drop_index(
        'uq_remito_linea_bin', table_name='remito_lineas',
        postgresql_where=sa.text('bin_id IS NOT NULL'),
        sqlite_where=sa.text('bin_id IS NOT NULL'),
    )
    op.create_index(
        'uq_remito_linea_bin', 'remito_lineas', ['bin_id'], unique=True,
        postgresql_where=sa.text('bin_id IS NOT NULL AND anulada = false'),
        sqlite_where=sa.text('bin_id IS NOT NULL AND anulada = false'),
    )


def downgrade() -> None:
    # Restoring the strict index fails if a bin was re-delivered after an
    # annulment (annulled + active line share the bin); that is intentional,
    # the data would otherwise be silently inconsistent.
    op.drop_index(
        'uq_remito_linea_bin', table_name='remito_lineas',
        postgresql_where=sa.text('bin_id IS NOT NULL AND anulada = false'),
        sqlite_where=sa.text('bin_id IS NOT NULL AND anulada = false'),
    )
    op.create_index(
        'uq_remito_linea_bin', 'remito_lineas', ['bin_id'], unique=True,
        postgresql_where=sa.text('bin_id IS NOT NULL'),
        sqlite_where=sa.text('bin_id IS NOT NULL'),
    )
    op.drop_column('remito_lineas', 'anulada')

    for table, fk_name, ck_name in reversed(TABLES):
        op.drop_constraint(ck_name, table, type_='check')
        op.drop_constraint(fk_name, table, type_='foreignkey')
        op.drop_column(table, 'motivo_anulacion')
        op.drop_column(table, 'anulado_by')
        op.drop_column(table, 'anulado_at')
