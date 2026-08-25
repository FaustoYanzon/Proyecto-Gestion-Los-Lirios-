"""reclasificar repuestos y reparaciones a tipo nuevo

Revision ID: 413793cedac4
Revises: 1bd9e0bd0b3c
Create Date: 2026-08-25 00:39:07.725768

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '413793cedac4'
down_revision: Union[str, None] = '1bd9e0bd0b3c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Repuestos Vehiculos/Infraestructura vivian bajo Insumos Varios --
    # pasan al tipo nuevo Repuestos y Reparacion. La clasificacion (columna
    # `clasificacion`) no cambia, solo el tipo que las agrupa.
    op.execute(
        """
        UPDATE egresos SET tipo = 'repuestos_reparacion'
        WHERE tipo = 'insumos_varios'
          AND clasificacion IN ('rep_repuestos_vehiculos', 'rep_repuestos_infraestructura')
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE egresos SET tipo = 'insumos_varios'
        WHERE tipo = 'repuestos_reparacion'
          AND clasificacion IN ('rep_repuestos_vehiculos', 'rep_repuestos_infraestructura')
        """
    )
