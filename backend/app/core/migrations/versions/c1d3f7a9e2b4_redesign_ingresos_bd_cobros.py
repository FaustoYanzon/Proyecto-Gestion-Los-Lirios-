"""redesign ingresos as a general cobros ledger (BD COBROS)

The old `ingresos` table modeled a single use case: uva-por-kilo sales
(cliente/producto/variedad/kg_totales/precio_por_kg). Fausto wants every
collection (uva de mesa, bodega, pasa, alquiler, ...) recorded here,
matching the farm's "BD COBROS" spreadsheet — destino/comprador/forma de
pago/banco/n_cheque/uso_cheque replace the kg-sale fields.

Per Fausto's explicit decision, the 259 rows already loaded under the old
schema are discarded (not migrated) — the table is dropped and recreated.

`uso_cheque` (formerly "PAGO CHEQU" in the spreadsheet) also backs the new
cheque-tracking screen: NULL/empty means the cheque is still available.

vw_kpi_comprador (e8a1c4d7b3f2) reads ingresos.cliente — updated here to
read the renamed ingresos.comprador instead.

Revision ID: c1d3f7a9e2b4
Revises: f2b6d9e4a8c1
Create Date: 2026-07-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c1d3f7a9e2b4'
down_revision: Union[str, None] = 'f2b6d9e4a8c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Enum types already created by previous migrations (shared with egresos).
finca = postgresql.ENUM('los_mimbres', 'media_agua', 'caucete', name='finca', create_type=False)
monedatipo = postgresql.ENUM('ars', 'usd', name='monedatipo', create_type=False)
origenpago = postgresql.ENUM('oficial', 'no_oficial', name='origenpago', create_type=False)
formapago = postgresql.ENUM(
    'efectivo', 'transferencia', 'cheque', 'echeque', 'credito',
    name='formapago', create_type=False,
)

# Genuinely new enum for this revision.
destinoingreso = postgresql.ENUM(
    'uva_mesa', 'bodega', 'pasa', 'alfalfa', 'cebolla', 'sandia', 'alquiler', 'otro',
    name='destinoingreso', create_type=False,
)

_VW_KPI_COMPRADOR = """
CREATE OR REPLACE VIEW vw_kpi_comprador AS
WITH kg AS (
    SELECT temporada,
           UPPER(TRIM(comprador)) AS comprador,
           SUM(kg_total)          AS kg_entregados
    FROM registros_cosecha
    WHERE comprador IS NOT NULL AND TRIM(comprador) <> ''
    GROUP BY 1, 2
),
cobros AS (
    SELECT CASE WHEN EXTRACT(MONTH FROM fecha) >= 5
                THEN EXTRACT(YEAR FROM fecha)::int
                ELSE EXTRACT(YEAR FROM fecha)::int - 1 END AS temporada,
           UPPER(TRIM(comprador)) AS comprador,
           SUM(monto) FILTER (WHERE moneda = 'ars') AS monto_cobrado_ars,
           SUM(monto) FILTER (WHERE moneda = 'usd') AS monto_cobrado_usd
    FROM ingresos
    WHERE TRIM(comprador) <> ''
    GROUP BY 1, 2
)
SELECT
    COALESCE(k.temporada, c.temporada)   AS temporada,
    COALESCE(k.comprador, c.comprador)   AS comprador,
    COALESCE(k.kg_entregados, 0)         AS kg_entregados,
    COALESCE(c.monto_cobrado_ars, 0)     AS monto_cobrado_ars,
    COALESCE(c.monto_cobrado_usd, 0)     AS monto_cobrado_usd
FROM kg k
FULL OUTER JOIN cobros c
  ON k.temporada = c.temporada AND k.comprador = c.comprador
"""

_VW_FLUJO_MENSUAL_REAL = """
SELECT
    CASE WHEN EXTRACT(MONTH FROM fecha) >= 5
         THEN EXTRACT(YEAR FROM fecha)::int
         ELSE EXTRACT(YEAR FROM fecha)::int - 1 END AS temporada,
    EXTRACT(MONTH FROM fecha)::int   AS mes,
    'egreso'                         AS concepto,
    tipo::text                       AS tipo,
    moneda::text                     AS moneda,
    SUM(monto)                       AS monto
FROM egresos
GROUP BY 1, 2, 4, 5
UNION ALL
SELECT
    CASE WHEN EXTRACT(MONTH FROM fecha) >= 5
         THEN EXTRACT(YEAR FROM fecha)::int
         ELSE EXTRACT(YEAR FROM fecha)::int - 1 END,
    EXTRACT(MONTH FROM fecha)::int,
    'ingreso',
    NULL::text,
    moneda::text,
    SUM(monto)
FROM ingresos
GROUP BY 1, 2, 5
"""

_VW_PRESUPUESTO_VS_REAL = """
WITH presup AS (
    SELECT temporada, mes, concepto::text AS concepto, tipo::text AS tipo,
           moneda::text AS moneda, SUM(monto) AS monto_presupuesto
    FROM presupuestos
    GROUP BY 1, 2, 3, 4, 5
)
SELECT
    COALESCE(p.temporada, r.temporada)      AS temporada,
    COALESCE(p.mes, r.mes)                  AS mes,
    COALESCE(p.concepto, r.concepto)        AS concepto,
    COALESCE(p.tipo, r.tipo)                AS tipo,
    COALESCE(p.moneda, r.moneda)            AS moneda,
    COALESCE(p.monto_presupuesto, 0)        AS monto_presupuesto,
    COALESCE(r.monto, 0)                    AS monto_real,
    COALESCE(r.monto, 0) - COALESCE(p.monto_presupuesto, 0) AS desvio,
    CASE WHEN COALESCE(p.monto_presupuesto, 0) <> 0
         THEN ROUND((COALESCE(r.monto, 0) - p.monto_presupuesto)
                    / p.monto_presupuesto * 100, 1)
    END                                     AS desvio_pct
FROM presup p
FULL OUTER JOIN vw_flujo_mensual_real r
  ON  p.temporada = r.temporada
  AND p.mes       = r.mes
  AND p.concepto  = r.concepto
  AND p.moneda    = r.moneda
  AND p.tipo IS NOT DISTINCT FROM r.tipo
"""

_VW_KPI_COMPRADOR_OLD = """
CREATE OR REPLACE VIEW vw_kpi_comprador AS
WITH kg AS (
    SELECT temporada,
           UPPER(TRIM(comprador)) AS comprador,
           SUM(kg_total)          AS kg_entregados
    FROM registros_cosecha
    WHERE comprador IS NOT NULL AND TRIM(comprador) <> ''
    GROUP BY 1, 2
),
cobros AS (
    SELECT CASE WHEN EXTRACT(MONTH FROM fecha) >= 5
                THEN EXTRACT(YEAR FROM fecha)::int
                ELSE EXTRACT(YEAR FROM fecha)::int - 1 END AS temporada,
           UPPER(TRIM(cliente)) AS comprador,
           SUM(monto) FILTER (WHERE moneda = 'ars') AS monto_cobrado_ars,
           SUM(monto) FILTER (WHERE moneda = 'usd') AS monto_cobrado_usd
    FROM ingresos
    WHERE TRIM(cliente) <> ''
    GROUP BY 1, 2
)
SELECT
    COALESCE(k.temporada, c.temporada)   AS temporada,
    COALESCE(k.comprador, c.comprador)   AS comprador,
    COALESCE(k.kg_entregados, 0)         AS kg_entregados,
    COALESCE(c.monto_cobrado_ars, 0)     AS monto_cobrado_ars,
    COALESCE(c.monto_cobrado_usd, 0)     AS monto_cobrado_usd
FROM kg k
FULL OUTER JOIN cobros c
  ON k.temporada = c.temporada AND k.comprador = c.comprador
"""


def upgrade() -> None:
    # 'echeque' joins the shared forma_pago enum (also used by egresos).
    # Must not be used in this same transaction after being added — it isn't.
    op.execute("ALTER TYPE formapago ADD VALUE IF NOT EXISTS 'echeque'")

    destinoingreso.create(op.get_bind(), checkfirst=True)

    # These views read from `ingresos` (directly or transitively) and block
    # the DROP TABLE below. Drop in dependency order, recreate after.
    op.execute("DROP VIEW IF EXISTS vw_presupuesto_vs_real")
    op.execute("DROP VIEW IF EXISTS vw_flujo_mensual_real")
    op.execute("DROP VIEW IF EXISTS vw_kpi_comprador")

    op.drop_table('ingresos')

    op.execute("DROP TYPE IF EXISTS productoingreso")

    op.create_table(
        'ingresos',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('fecha', sa.Date(), nullable=False),
        sa.Column('destino', destinoingreso, nullable=False),
        sa.Column('comprador', sa.String(length=200), nullable=False),
        sa.Column('forma_pago', formapago, nullable=False),
        sa.Column('estado', sa.String(length=50), nullable=True),
        sa.Column('cuenta_destino', sa.String(length=100), nullable=True),
        sa.Column('banco', sa.String(length=100), nullable=True),
        sa.Column('n_cheque', sa.String(length=50), nullable=True),
        sa.Column('f_pago', sa.Date(), nullable=True),
        sa.Column('uso_cheque', sa.String(length=200), nullable=True),
        sa.Column('monto', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('moneda', monedatipo, nullable=False),
        sa.Column('tipo_cambio', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('origen', origenpago, nullable=False),
        sa.Column('finca', finca, nullable=False),
        sa.Column('descripcion', sa.String(length=500), nullable=True),
        sa.Column('created_by', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ingresos_fecha', 'ingresos', ['fecha'], unique=False)
    op.create_index('ix_ingresos_finca_fecha', 'ingresos', ['finca', 'fecha'], unique=False)
    op.create_index('ix_ingresos_moneda_fecha', 'ingresos', ['moneda', 'fecha'], unique=False)
    op.create_index('ix_ingresos_forma_pago', 'ingresos', ['forma_pago'], unique=False)

    # Recreate the views dropped above. vw_flujo_mensual_real must exist
    # before vw_presupuesto_vs_real (which selects from it).
    op.execute(f"CREATE VIEW vw_flujo_mensual_real AS {_VW_FLUJO_MENSUAL_REAL}")
    op.execute(f"CREATE VIEW vw_presupuesto_vs_real AS {_VW_PRESUPUESTO_VS_REAL}")
    # Re-point the KPI view at the renamed column.
    op.execute(_VW_KPI_COMPRADOR)


def downgrade() -> None:
    # Best-effort downgrade: restores the old shape empty (data already lost
    # going forward, same as upgrade — this migration is not round-trippable).
    op.execute("DROP VIEW IF EXISTS vw_presupuesto_vs_real")
    op.execute("DROP VIEW IF EXISTS vw_flujo_mensual_real")
    op.execute("DROP VIEW IF EXISTS vw_kpi_comprador")

    op.drop_table('ingresos')

    productoingreso = postgresql.ENUM(
        'uva_fresca', 'pasa', 'mosto', 'otro', name='productoingreso', create_type=False,
    )
    productoingreso.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'ingresos',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('fecha', sa.Date(), nullable=False),
        sa.Column('cliente', sa.String(length=200), nullable=False),
        sa.Column('producto', productoingreso, nullable=False),
        sa.Column('variedad', postgresql.ENUM(
            'flame', 'red_globe', 'fiesta', 'bonarda', 'sultanina', 'syrah',
            'aspirant', 'alfalfa', 'otro', name='variedaduva', create_type=False,
        ), nullable=True),
        sa.Column('kg_totales', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('precio_por_kg', sa.Numeric(precision=10, scale=4), nullable=True),
        sa.Column('monto', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('moneda', monedatipo, nullable=False),
        sa.Column('tipo_cambio', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('origen', origenpago, nullable=False),
        sa.Column('finca', finca, nullable=False),
        sa.Column('forma_pago', formapago, nullable=False),
        sa.Column('descripcion', sa.String(length=500), nullable=True),
        sa.Column('created_by', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ingresos_fecha', 'ingresos', ['fecha'], unique=False)
    op.create_index('ix_ingresos_finca_fecha', 'ingresos', ['finca', 'fecha'], unique=False)
    op.create_index('ix_ingresos_moneda_fecha', 'ingresos', ['moneda', 'fecha'], unique=False)

    op.execute(f"CREATE VIEW vw_flujo_mensual_real AS {_VW_FLUJO_MENSUAL_REAL}")
    op.execute(f"CREATE VIEW vw_presupuesto_vs_real AS {_VW_PRESUPUESTO_VS_REAL}")
    op.execute(_VW_KPI_COMPRADOR_OLD)
    op.execute("DROP TYPE IF EXISTS destinoingreso")
