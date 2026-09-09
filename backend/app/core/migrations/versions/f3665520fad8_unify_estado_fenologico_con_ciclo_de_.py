"""unify estado fenologico con ciclo de campana (paso 1: agregar valores)

Fausto pidió que Fenología y Ciclo de Campaña usen exactamente los mismos 7
estados que ya pinta el mapa (app.core.ciclo_campana.EstadoCampana):
brotacion, floracion, cuaje, cierre_racimo, envero, cosecha, post_cosecha —
en vez del set viejo de EstadoFenologico (que tenía madurez/latencia en vez
de cierre_racimo/post_cosecha). Postgres no permite usar un valor de enum
recién agregado en la misma transacción en que se agrega, así que esto se
divide en dos migraciones: esta agrega los valores nuevos, la siguiente
migra las filas existentes y los deja de usar.

Revision ID: f3665520fad8
Revises: 42a9bcab6a1a
Create Date: 2026-09-08 21:13:01.525039

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f3665520fad8'
down_revision: Union[str, None] = '42a9bcab6a1a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE estadofenologico ADD VALUE IF NOT EXISTS 'cierre_racimo'")
    op.execute("ALTER TYPE estadofenologico ADD VALUE IF NOT EXISTS 'post_cosecha'")


def downgrade() -> None:
    # Postgres no soporta sacar valores de un enum sin recrear el tipo entero
    # (y recrearlo exigiría primero migrar cualquier fila que ya los use).
    # No hace falta un downgrade real para este proyecto.
    pass
