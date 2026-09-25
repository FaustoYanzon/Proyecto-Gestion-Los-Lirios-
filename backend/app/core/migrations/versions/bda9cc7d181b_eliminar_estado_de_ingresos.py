"""eliminar estado de ingresos

`estado` (facturado / no_registrado) y `origen` (oficial / no_oficial) eran
el mismo dato: en la migración de BD Cobros origen se derivó de estado
(FACT -> oficial, NR -> no_oficial). Queda solo `origen`, que es el que
comparten Egresos, los filtros y el import ARCA. Donde los dos no
coincidían (carga manual), gana `estado`, que es el dato original de la
planilla.

Revision ID: bda9cc7d181b
Revises: bbb383698209
Create Date: 2026-09-25 13:12:23.724467

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'bda9cc7d181b'
down_revision: Union[str, None] = 'bbb383698209'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE ingresos
        SET origen = CASE estado::text
                         WHEN 'facturado' THEN 'oficial'::origenpago
                         ELSE 'no_oficial'::origenpago
                     END
        WHERE estado IS NOT NULL
          AND origen::text <> CASE estado::text
                                  WHEN 'facturado' THEN 'oficial'
                                  ELSE 'no_oficial'
                              END
        """
    )
    op.drop_column('ingresos', 'estado')
    op.execute("DROP TYPE IF EXISTS estadoingreso")


def downgrade() -> None:
    estadoingreso = postgresql.ENUM('no_registrado', 'facturado', name='estadoingreso')
    estadoingreso.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'ingresos',
        sa.Column('estado', postgresql.ENUM(name='estadoingreso', create_type=False), nullable=True),
    )
    op.execute(
        "UPDATE ingresos SET estado = CASE origen::text WHEN 'oficial' THEN 'facturado'::estadoingreso "
        "ELSE 'no_registrado'::estadoingreso END"
    )
