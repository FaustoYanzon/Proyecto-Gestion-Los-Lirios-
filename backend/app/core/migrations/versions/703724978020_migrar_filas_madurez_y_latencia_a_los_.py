"""migrar filas madurez y latencia a los estados unificados

Segundo paso de la unificación (ver f3665520fad8): 'madurez' no tiene
equivalente propio en el calendario único del mapa (Envero se extiende hasta
Cosecha, cubriendo la maduración) — pasa a 'envero'. 'latencia' cubría tanto
Reposo invernal como Lloro como Post-Cosecha en el motor viejo — pasa a
'post_cosecha', que en el calendario único ya cubre exactamente esa ventana
(mayo hasta la próxima brotación). Solo toca `ciclos_campana`
(CicloCampana.estado_fenologico) — `estados_variedad_campana` usa el enum
EstadoCampana, que ya tenía estos valores desde que existe.

Revision ID: 703724978020
Revises: f3665520fad8
Create Date: 2026-09-08 21:14:44.795737

"""
from typing import Sequence, Union

from alembic import op


revision: str = '703724978020'
down_revision: Union[str, None] = 'f3665520fad8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE ciclos_campana SET estado_fenologico = 'envero' WHERE estado_fenologico = 'madurez'")
    op.execute("UPDATE ciclos_campana SET estado_fenologico = 'post_cosecha' WHERE estado_fenologico = 'latencia'")


def downgrade() -> None:
    # No se puede distinguir qué filas 'envero'/'post_cosecha' eran
    # originalmente 'madurez'/'latencia' vs. genuinamente esos estados nuevos
    # — downgrade de datos no es reversible con certeza, se deja como no-op.
    pass
