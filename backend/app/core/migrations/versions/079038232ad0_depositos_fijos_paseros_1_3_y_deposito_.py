"""depositos fijos: paseros 1-3 y deposito bodega

Revision ID: 079038232ad0
Revises: 440f0e507ad5
Create Date: 2026-10-11 19:32:43.382782

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '079038232ad0'
down_revision: Union[str, None] = '440f0e507ad5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Depósitos definidos por la operación: los 3 paseros (donde se procesa/almacena
# la pasa) y el depósito-bodega (bines/bolsones de pasa). Ya no se administran
# desde la app. Solo inserta los que falten; no toca ni desactiva los existentes.
DEPOSITOS_FIJOS = ("Pasero 1", "Pasero 2", "Pasero 3", "Depósito bodega")


def upgrade() -> None:
    conn = op.get_bind()
    for nombre in DEPOSITOS_FIJOS:
        existe = conn.execute(
            sa.text("SELECT 1 FROM depositos WHERE lower(nombre) = lower(:nombre)"),
            {"nombre": nombre},
        ).first()
        if existe:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO depositos (id, nombre, is_active, created_at) "
                "VALUES (:id, :nombre, :activo, CURRENT_TIMESTAMP)"
            ),
            {"id": str(uuid.uuid4()), "nombre": nombre, "activo": True},
        )


def downgrade() -> None:
    # Migración de datos: no se borran depósitos que ya pueden tener lotes asignados.
    pass
