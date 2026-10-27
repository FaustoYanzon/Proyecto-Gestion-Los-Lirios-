"""ordenes multiproducto

Order lines (ordenes_aplicacion_insumos) and explicit links from each
RegistroFitosanitario to its plan row / order line / parcel row / valve row.

Backfill (in this order, after the DDL):
  1. every existing order gets one line (posicion 0) copied from its
     single-product columns; numero_aplicacion comes from its plan row.
  2. registros linked through the legacy 1-1 registro_fitosanitario_id
     columns get orden_parcela_id (valve records: the valve's parent row)
     and orden_valvula_id.
  3. those registros get orden_insumo_id (the order's only line) and
     plan_fitosanitario_id (the order's plan row, if it came from the plan).
Manual records without an order are left untouched (null links).

Revision ID: 71e969f8521f
Revises: c3f1a8d27e54
Create Date: 2026-10-27 12:38:20.610896

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '71e969f8521f'
down_revision: Union[str, None] = 'c3f1a8d27e54'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ordenes_aplicacion_insumos',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('orden_id', sa.String(length=36), nullable=False),
    sa.Column('insumo_id', sa.String(length=36), nullable=False),
    sa.Column('dosis_por_ha', sa.Float(), nullable=False),
    sa.Column('dias_carencia', sa.Integer(), nullable=False),
    sa.Column('dias_reingreso', sa.Integer(), nullable=False),
    sa.Column('numero_aplicacion', sa.Integer(), nullable=True),
    sa.Column('posicion', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['insumo_id'], ['insumos.id'], ),
    sa.ForeignKeyConstraint(['orden_id'], ['ordenes_aplicacion.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ordenes_aplicacion_insumos_insumo', 'ordenes_aplicacion_insumos', ['insumo_id'], unique=False)
    op.create_index('uq_ordenes_aplicacion_insumos_orden_insumo', 'ordenes_aplicacion_insumos', ['orden_id', 'insumo_id'], unique=True)
    op.add_column('registros_fitosanitarios', sa.Column('plan_fitosanitario_id', sa.String(length=36), nullable=True))
    op.add_column('registros_fitosanitarios', sa.Column('orden_insumo_id', sa.String(length=36), nullable=True))
    op.add_column('registros_fitosanitarios', sa.Column('orden_parcela_id', sa.String(length=36), nullable=True))
    op.add_column('registros_fitosanitarios', sa.Column('orden_valvula_id', sa.String(length=36), nullable=True))
    op.create_index('ix_registros_fitosanitarios_orden_insumo', 'registros_fitosanitarios', ['orden_insumo_id'], unique=False)
    op.create_index('ix_registros_fitosanitarios_orden_parcela', 'registros_fitosanitarios', ['orden_parcela_id'], unique=False)
    op.create_index('ix_registros_fitosanitarios_orden_valvula', 'registros_fitosanitarios', ['orden_valvula_id'], unique=False)
    op.create_index('ix_registros_fitosanitarios_plan', 'registros_fitosanitarios', ['plan_fitosanitario_id'], unique=False)
    # Explicit names (autogenerate left two as None) so downgrade can drop them.
    op.create_foreign_key('fk_registros_plan_fitosanitario', 'registros_fitosanitarios', 'planes_fitosanitarios', ['plan_fitosanitario_id'], ['id'])
    op.create_foreign_key('fk_registros_orden_valvula', 'registros_fitosanitarios', 'ordenes_aplicacion_valvulas', ['orden_valvula_id'], ['id'])
    op.create_foreign_key('fk_registros_orden_insumo', 'registros_fitosanitarios', 'ordenes_aplicacion_insumos', ['orden_insumo_id'], ['id'])
    op.create_foreign_key('fk_registros_orden_parcela', 'registros_fitosanitarios', 'ordenes_aplicacion_parcelas', ['orden_parcela_id'], ['id'])

    _backfill()


def _backfill() -> None:
    bind = op.get_bind()

    # 1. One line per existing order. UUIDs generated in Python: the DB has no
    #    uuid extension guaranteed, and ids are String(36) everywhere.
    ordenes = bind.execute(
        sa.text(
            """
            SELECT o.id, o.insumo_id, o.dosis_por_ha, o.dias_carencia,
                   o.dias_reingreso, o.created_at, p.numero_aplicacion
            FROM ordenes_aplicacion o
            LEFT JOIN planes_fitosanitarios p ON p.id = o.plan_fitosanitario_id
            """
        )
    ).mappings().all()
    if ordenes:
        bind.execute(
            sa.text(
                """
                INSERT INTO ordenes_aplicacion_insumos
                    (id, orden_id, insumo_id, dosis_por_ha, dias_carencia,
                     dias_reingreso, numero_aplicacion, posicion, created_at)
                VALUES
                    (:id, :orden_id, :insumo_id, :dosis_por_ha, :dias_carencia,
                     :dias_reingreso, :numero_aplicacion, 0, :created_at)
                """
            ),
            [
                {
                    "id": str(uuid.uuid4()),
                    "orden_id": o["id"],
                    "insumo_id": o["insumo_id"],
                    "dosis_por_ha": o["dosis_por_ha"],
                    "dias_carencia": o["dias_carencia"],
                    "dias_reingreso": o["dias_reingreso"],
                    "numero_aplicacion": o["numero_aplicacion"],
                    "created_at": o["created_at"],
                }
                for o in ordenes
            ],
        )

    # 2. Parcel/valve links from the legacy 1-1 columns. A valve record points
    #    at its valve row and at the valve's parent parcel row.
    bind.execute(
        sa.text(
            """
            UPDATE registros_fitosanitarios r
            SET orden_valvula_id = (
                    SELECT v.id FROM ordenes_aplicacion_valvulas v
                    WHERE v.registro_fitosanitario_id = r.id
                ),
                orden_parcela_id = COALESCE(
                    (SELECT op.id FROM ordenes_aplicacion_parcelas op
                     WHERE op.registro_fitosanitario_id = r.id),
                    (SELECT v.orden_parcela_id FROM ordenes_aplicacion_valvulas v
                     WHERE v.registro_fitosanitario_id = r.id)
                )
            WHERE EXISTS (
                    SELECT 1 FROM ordenes_aplicacion_parcelas op
                    WHERE op.registro_fitosanitario_id = r.id
                ) OR EXISTS (
                    SELECT 1 FROM ordenes_aplicacion_valvulas v
                    WHERE v.registro_fitosanitario_id = r.id
                )
            """
        )
    )

    # 3. Order line and plan row, through the parcel row set above.
    bind.execute(
        sa.text(
            """
            UPDATE registros_fitosanitarios r
            SET orden_insumo_id = (
                    SELECT l.id FROM ordenes_aplicacion_insumos l
                    JOIN ordenes_aplicacion_parcelas op ON op.orden_id = l.orden_id
                    WHERE op.id = r.orden_parcela_id AND l.posicion = 0
                ),
                plan_fitosanitario_id = (
                    SELECT o.plan_fitosanitario_id FROM ordenes_aplicacion o
                    JOIN ordenes_aplicacion_parcelas op ON op.orden_id = o.id
                    WHERE op.id = r.orden_parcela_id
                )
            WHERE r.orden_parcela_id IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    # Only lossless for single-line data: for an order with several lines,
    # dropping ordenes_aplicacion_insumos LOSES products 2..N, and their
    # registros (only the first line's one is on the legacy
    # registro_fitosanitario_id) are left unlinked from any order. Take a
    # backup and prefer a forward fix; see the Rollback section of
    # docs/sistema/Bitácora/2026-10-27-ordenes-multiproducto.md.
    op.drop_constraint('fk_registros_orden_parcela', 'registros_fitosanitarios', type_='foreignkey')
    op.drop_constraint('fk_registros_orden_insumo', 'registros_fitosanitarios', type_='foreignkey')
    op.drop_constraint('fk_registros_orden_valvula', 'registros_fitosanitarios', type_='foreignkey')
    op.drop_constraint('fk_registros_plan_fitosanitario', 'registros_fitosanitarios', type_='foreignkey')
    op.drop_index('ix_registros_fitosanitarios_plan', table_name='registros_fitosanitarios')
    op.drop_index('ix_registros_fitosanitarios_orden_valvula', table_name='registros_fitosanitarios')
    op.drop_index('ix_registros_fitosanitarios_orden_parcela', table_name='registros_fitosanitarios')
    op.drop_index('ix_registros_fitosanitarios_orden_insumo', table_name='registros_fitosanitarios')
    op.drop_column('registros_fitosanitarios', 'orden_valvula_id')
    op.drop_column('registros_fitosanitarios', 'orden_parcela_id')
    op.drop_column('registros_fitosanitarios', 'orden_insumo_id')
    op.drop_column('registros_fitosanitarios', 'plan_fitosanitario_id')
    op.drop_index('uq_ordenes_aplicacion_insumos_orden_insumo', table_name='ordenes_aplicacion_insumos')
    op.drop_index('ix_ordenes_aplicacion_insumos_insumo', table_name='ordenes_aplicacion_insumos')
    op.drop_table('ordenes_aplicacion_insumos')
