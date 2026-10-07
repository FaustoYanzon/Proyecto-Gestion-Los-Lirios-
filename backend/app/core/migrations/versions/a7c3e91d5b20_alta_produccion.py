"""alta de produccion: productores, pasero, lotes de pasa, remitos

Revision ID: a7c3e91d5b20
Revises: e44e14c0a72b
Create Date: 2026-10-07 12:00:00.000000

"""
import unicodedata
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a7c3e91d5b20'
down_revision: Union[str, None] = 'e44e14c0a72b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Enums que ya existen en la base (los creó otra migración): no recrear.
VARIEDADES = ('flame', 'red_globe', 'fiesta', 'bonarda', 'sultanina', 'syrah', 'aspirant', 'alfalfa', 'otro')


def _variedad_enum() -> postgresql.ENUM:
    return postgresql.ENUM(*VARIEDADES, name='variedaduva', create_type=False)


def _origen_enum() -> postgresql.ENUM:
    return postgresql.ENUM('propio', 'tercero', name='origencosecha', create_type=False)


def _normalizar(nombre: str) -> str:
    """Misma normalización que app.core.normalizacion (sin tildes ni mayúsculas),
    copiada acá para que la migración no dependa del código de la app."""
    sin_tildes = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode("ascii")
    return " ".join(sin_tildes.strip().lower().split())


def upgrade() -> None:
    op.create_table('productores',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('nombre', sa.String(length=150), nullable=False),
    sa.Column('tipo', sa.Enum('propio', 'externo', name='tipoproductor'), nullable=False),
    sa.Column('cuit', sa.String(length=20), nullable=True),
    sa.Column('contacto', sa.String(length=200), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_productores_nombre'), 'productores', ['nombre'], unique=False)

    op.create_table('compradores',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('nombre', sa.String(length=150), nullable=False),
    sa.Column('cuit', sa.String(length=20), nullable=True),
    sa.Column('contacto', sa.String(length=200), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_compradores_nombre'), 'compradores', ['nombre'], unique=False)

    op.create_table('depositos',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('nombre', sa.String(length=100), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_depositos_nombre'), 'depositos', ['nombre'], unique=False)

    op.create_table('parametros_produccion',
    sa.Column('clave', sa.String(length=50), nullable=False),
    sa.Column('valor', sa.Numeric(precision=14, scale=4), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('clave')
    )

    op.create_table('ubicaciones_pasero',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('pasero_id', sa.String(length=36), nullable=False),
    sa.Column('hilera', sa.Integer(), nullable=False),
    sa.Column('parte', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['pasero_id'], ['parcelas.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('pasero_id', 'hilera', 'parte', name='uq_ubicacion_pasero')
    )
    op.create_index(op.f('ix_ubicaciones_pasero_pasero_id'), 'ubicaciones_pasero', ['pasero_id'], unique=False)

    op.create_table('ingresos_pasero',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('fecha', sa.Date(), nullable=False),
    sa.Column('pasero_id', sa.String(length=36), nullable=False),
    sa.Column('ubicacion_id', sa.String(length=36), nullable=True),
    sa.Column('cosecha_id', sa.String(length=36), nullable=True),
    sa.Column('variedad', _variedad_enum(), nullable=False),
    sa.Column('origen', _origen_enum(), nullable=False),
    sa.Column('productor_id', sa.String(length=36), nullable=True),
    sa.Column('carros', sa.Integer(), nullable=False),
    sa.Column('fichas', sa.Integer(), nullable=False),
    sa.Column('kg_teorico', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('kg_real', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('merma_kg', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('observaciones', sa.String(length=500), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['cosecha_id'], ['registros_cosecha.id'], ),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['pasero_id'], ['parcelas.id'], ),
    sa.ForeignKeyConstraint(['productor_id'], ['productores.id'], ),
    sa.ForeignKeyConstraint(['ubicacion_id'], ['ubicaciones_pasero.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ingresos_pasero_pasero_id'), 'ingresos_pasero', ['pasero_id'], unique=False)
    op.create_index(op.f('ix_ingresos_pasero_cosecha_id'), 'ingresos_pasero', ['cosecha_id'], unique=False)
    op.create_index(op.f('ix_ingresos_pasero_variedad'), 'ingresos_pasero', ['variedad'], unique=False)

    op.create_table('lotes_pasa',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('temporada', sa.Integer(), nullable=False),
    sa.Column('variedad', _variedad_enum(), nullable=False),
    sa.Column('calidad', sa.Integer(), nullable=False),
    sa.Column('numero', sa.Integer(), nullable=False),
    sa.Column('estado', sa.Enum('abierto', 'cerrado', name='estadolote'), nullable=False),
    sa.Column('deposito_id', sa.String(length=36), nullable=True),
    sa.Column('kg_total', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('saldo_kg', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('tope_bines', sa.Integer(), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['deposito_id'], ['depositos.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('temporada', 'variedad', 'calidad', 'numero', name='uq_lote_pasa')
    )
    op.create_index(op.f('ix_lotes_pasa_temporada'), 'lotes_pasa', ['temporada'], unique=False)
    op.create_index(op.f('ix_lotes_pasa_estado'), 'lotes_pasa', ['estado'], unique=False)
    op.create_index(
        'uq_lote_pasa_abierto', 'lotes_pasa', ['variedad', 'calidad'], unique=True,
        postgresql_where=sa.text("estado = 'abierto'"),
    )

    op.create_table('bines_pasa',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('lote_id', sa.String(length=36), nullable=False),
    sa.Column('pasero_id', sa.String(length=36), nullable=False),
    sa.Column('fecha', sa.Date(), nullable=False),
    sa.Column('kg_real', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('uva_consumida_kg', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['lote_id'], ['lotes_pasa.id'], ),
    sa.ForeignKeyConstraint(['pasero_id'], ['parcelas.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bines_pasa_lote_id'), 'bines_pasa', ['lote_id'], unique=False)

    op.create_table('remitos',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('tipo', sa.Enum('salida_fresco', 'salida_bodega', 'entrega_pasa', name='tiporemito'), nullable=False),
    sa.Column('numero', sa.String(length=50), nullable=False),
    sa.Column('fecha', sa.Date(), nullable=False),
    sa.Column('comprador_id', sa.String(length=36), nullable=False),
    sa.Column('kg_total', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('vehiculo_patente', sa.String(length=20), nullable=True),
    sa.Column('observaciones', sa.String(length=500), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['comprador_id'], ['compradores.id'], ),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tipo', 'numero', name='uq_remito_tipo_numero')
    )
    op.create_index(op.f('ix_remitos_tipo'), 'remitos', ['tipo'], unique=False)

    op.create_table('remito_lineas',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('remito_id', sa.String(length=36), nullable=False),
    sa.Column('lote_id', sa.String(length=36), nullable=True),
    sa.Column('cosecha_id', sa.String(length=36), nullable=True),
    sa.Column('kg', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.ForeignKeyConstraint(['cosecha_id'], ['registros_cosecha.id'], ),
    sa.ForeignKeyConstraint(['lote_id'], ['lotes_pasa.id'], ),
    sa.ForeignKeyConstraint(['remito_id'], ['remitos.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_remito_lineas_remito_id'), 'remito_lineas', ['remito_id'], unique=False)
    op.create_index(op.f('ix_remito_lineas_lote_id'), 'remito_lineas', ['lote_id'], unique=False)
    op.create_index(op.f('ix_remito_lineas_cosecha_id'), 'remito_lineas', ['cosecha_id'], unique=False)

    op.create_table('comprobantes_bodega',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('remito_id', sa.String(length=36), nullable=False),
    sa.Column('numero_suv', sa.String(length=50), nullable=False),
    sa.Column('kg_recibidos', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('fecha', sa.Date(), nullable=True),
    sa.Column('observaciones', sa.String(length=500), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['remito_id'], ['remitos.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('remito_id')
    )
    op.create_index(op.f('ix_comprobantes_bodega_numero_suv'), 'comprobantes_bodega', ['numero_suv'], unique=False)

    # registros_cosecha.productor_id (nullable: el histórico queda intacto).
    op.add_column('registros_cosecha', sa.Column('productor_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_registros_cosecha_productor_id'), 'registros_cosecha', ['productor_id'], unique=False)
    op.create_foreign_key(
        'fk_registros_cosecha_productor_id', 'registros_cosecha', 'productores', ['productor_id'], ['id']
    )

    _backfill_productores()


def _backfill_productores() -> None:
    """Unifica `proveedor_tercero` (texto libre) en filas de `productores`:
    un productor externo por cada nombre distinto de los registros con
    origen=tercero (comparado sin tildes, mayúsculas ni espacios de más) y enlaza los registros históricos. El texto original se
    conserva en `proveedor_tercero`."""
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, proveedor_tercero FROM registros_cosecha "
            "WHERE origen = 'tercero' AND proveedor_tercero IS NOT NULL AND TRIM(proveedor_tercero) <> ''"
        )
    ).fetchall()
    if not rows:
        return

    productor_por_clave: dict[str, str] = {}
    for row in rows:
        nombre = row.proveedor_tercero.strip()
        clave = _normalizar(nombre)
        if clave not in productor_por_clave:
            productor_id = str(uuid.uuid4())
            bind.execute(
                sa.text(
                    "INSERT INTO productores (id, nombre, tipo, is_active, created_at) "
                    "VALUES (:id, :nombre, 'externo', :activo, CURRENT_TIMESTAMP)"
                ),
                {"id": productor_id, "nombre": " ".join(nombre.split()), "activo": True},
            )
            productor_por_clave[clave] = productor_id
        bind.execute(
            sa.text("UPDATE registros_cosecha SET productor_id = :pid WHERE id = :id"),
            {"pid": productor_por_clave[clave], "id": row.id},
        )


def downgrade() -> None:
    op.drop_constraint('fk_registros_cosecha_productor_id', 'registros_cosecha', type_='foreignkey')
    op.drop_index(op.f('ix_registros_cosecha_productor_id'), table_name='registros_cosecha')
    op.drop_column('registros_cosecha', 'productor_id')

    op.drop_index(op.f('ix_comprobantes_bodega_numero_suv'), table_name='comprobantes_bodega')
    op.drop_table('comprobantes_bodega')
    op.drop_index(op.f('ix_remito_lineas_cosecha_id'), table_name='remito_lineas')
    op.drop_index(op.f('ix_remito_lineas_lote_id'), table_name='remito_lineas')
    op.drop_index(op.f('ix_remito_lineas_remito_id'), table_name='remito_lineas')
    op.drop_table('remito_lineas')
    op.drop_index(op.f('ix_remitos_tipo'), table_name='remitos')
    op.drop_table('remitos')
    op.drop_index(op.f('ix_bines_pasa_lote_id'), table_name='bines_pasa')
    op.drop_table('bines_pasa')
    op.drop_index('uq_lote_pasa_abierto', table_name='lotes_pasa', postgresql_where=sa.text("estado = 'abierto'"))
    op.drop_index(op.f('ix_lotes_pasa_estado'), table_name='lotes_pasa')
    op.drop_index(op.f('ix_lotes_pasa_temporada'), table_name='lotes_pasa')
    op.drop_table('lotes_pasa')
    op.drop_index(op.f('ix_ingresos_pasero_variedad'), table_name='ingresos_pasero')
    op.drop_index(op.f('ix_ingresos_pasero_cosecha_id'), table_name='ingresos_pasero')
    op.drop_index(op.f('ix_ingresos_pasero_pasero_id'), table_name='ingresos_pasero')
    op.drop_table('ingresos_pasero')
    op.drop_index(op.f('ix_ubicaciones_pasero_pasero_id'), table_name='ubicaciones_pasero')
    op.drop_table('ubicaciones_pasero')
    op.drop_table('parametros_produccion')
    op.drop_index(op.f('ix_depositos_nombre'), table_name='depositos')
    op.drop_table('depositos')
    op.drop_index(op.f('ix_compradores_nombre'), table_name='compradores')
    op.drop_table('compradores')
    op.drop_index(op.f('ix_productores_nombre'), table_name='productores')
    op.drop_table('productores')
    sa.Enum(name='tiporemito').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='estadolote').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='tipoproductor').drop(op.get_bind(), checkfirst=True)
