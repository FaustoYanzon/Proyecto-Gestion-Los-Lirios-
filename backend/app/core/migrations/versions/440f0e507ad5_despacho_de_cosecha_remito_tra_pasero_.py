"""despacho de cosecha: remito TRA, pasero_id, comprador_id

Revision ID: 440f0e507ad5
Revises: a7c3e91d5b20
Create Date: 2026-10-10 18:30:08.099489

- tiporemito gana 'traslado_pasero' (ALTER TYPE ... ADD VALUE: autogenerate no
  lo detecta y en Postgres no puede ejecutarse dentro de la transacción donde
  se usa el valor nuevo, por eso va en un autocommit_block).
- remitos.comprador_id pasa a nullable; remitos.pasero_id (FK parcelas).
- CHECK ck_remito_destinatario_segun_tipo: TRA lleva pasero, el resto comprador.
- registros_cosecha.comprador_id (FK compradores).
- ingresos_pasero.carro_incompleto (Boolean not null default false).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '440f0e507ad5'
down_revision: Union[str, None] = 'a7c3e91d5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CK_NAME = 'ck_remito_destinatario_segun_tipo'
CK_SQL = (
    "(tipo = 'traslado_pasero' AND pasero_id IS NOT NULL AND comprador_id IS NULL) "
    "OR (tipo <> 'traslado_pasero' AND comprador_id IS NOT NULL AND pasero_id IS NULL)"
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        # Fuera de la transacción: el valor nuevo tiene que quedar commiteado
        # antes de que lo use el CHECK de más abajo.
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE tiporemito ADD VALUE IF NOT EXISTS 'traslado_pasero'")

    op.add_column('registros_cosecha', sa.Column('comprador_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_registros_cosecha_comprador_id'), 'registros_cosecha', ['comprador_id'], unique=False)
    op.create_foreign_key(
        'fk_registros_cosecha_comprador_id_compradores',
        'registros_cosecha', 'compradores', ['comprador_id'], ['id'],
    )

    op.add_column('remitos', sa.Column('pasero_id', sa.String(length=36), nullable=True))
    op.alter_column('remitos', 'comprador_id', existing_type=sa.VARCHAR(length=36), nullable=True)
    op.create_index(op.f('ix_remitos_pasero_id'), 'remitos', ['pasero_id'], unique=False)
    op.create_foreign_key('fk_remitos_pasero_id_parcelas', 'remitos', 'parcelas', ['pasero_id'], ['id'])
    # Los remitos existentes (FRE/BOD/PAS) tienen comprador y no pasero: cumplen el CHECK.
    op.create_check_constraint(CK_NAME, 'remitos', CK_SQL)

    # Carro incompleto: fichas estimadas por peso, sin merma calculable.
    op.add_column(
        'ingresos_pasero',
        sa.Column('carro_incompleto', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )


def downgrade() -> None:
    bind = op.get_bind()
    traslados = bind.execute(sa.text("SELECT count(*) FROM remitos WHERE tipo::text = 'traslado_pasero'")).scalar() \
        if bind.dialect.name == 'postgresql' else 0
    if traslados:
        raise RuntimeError(
            f"No se puede revertir: hay {traslados} remito(s) TRA (traslado a pasero). "
            "Borralos o migralos a mano antes de hacer downgrade."
        )

    op.drop_column('ingresos_pasero', 'carro_incompleto')
    op.drop_constraint(CK_NAME, 'remitos', type_='check')
    op.drop_constraint('fk_remitos_pasero_id_parcelas', 'remitos', type_='foreignkey')
    op.drop_index(op.f('ix_remitos_pasero_id'), table_name='remitos')
    op.alter_column('remitos', 'comprador_id', existing_type=sa.VARCHAR(length=36), nullable=False)
    op.drop_column('remitos', 'pasero_id')

    op.drop_constraint('fk_registros_cosecha_comprador_id_compradores', 'registros_cosecha', type_='foreignkey')
    op.drop_index(op.f('ix_registros_cosecha_comprador_id'), table_name='registros_cosecha')
    op.drop_column('registros_cosecha', 'comprador_id')

    if bind.dialect.name == 'postgresql':
        # Postgres no permite quitar un valor de un enum: se recrea el tipo.
        op.execute("ALTER TYPE tiporemito RENAME TO tiporemito_old")
        op.execute("CREATE TYPE tiporemito AS ENUM ('salida_fresco', 'salida_bodega', 'entrega_pasa')")
        op.execute("ALTER TABLE remitos ALTER COLUMN tipo TYPE tiporemito USING tipo::text::tiporemito")
        op.execute("DROP TYPE tiporemito_old")
