"""tarja de bines y depósito único de la pasa

Revision ID: 5b2f8c1d7a44
Revises: 079038232ad0
Create Date: 2026-10-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5b2f8c1d7a44'
down_revision: Union[str, None] = '079038232ad0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEPOSITO_UNICO = "Depósito bodega"


def _tarja(temporada: int, variedad: str, calidad: int, numero: int, nro_bin: int) -> str:
    # Mismo formato que app.services.alta_produccion.tarja_bin.
    var = str(variedad).lower().replace("_", "")[:3].upper()
    return f"{temporada}-{var}-C{calidad}-N{numero:02d}-B{nro_bin:02d}"


def upgrade() -> None:
    conn = op.get_bind()

    # 1) Tarja: columna nullable, backfill por lote en orden de levantada, y recién
    # después NOT NULL + único por lote.
    op.add_column('bines_pasa', sa.Column('tarja', sa.String(length=40), nullable=True))
    filas = conn.execute(sa.text(
        "SELECT b.id AS bin_id, b.lote_id AS lote_id, l.temporada AS temporada, "
        "l.variedad::text AS variedad, l.calidad AS calidad, l.numero AS numero "
        "FROM bines_pasa b JOIN lotes_pasa l ON l.id = b.lote_id "
        "ORDER BY b.lote_id, b.created_at, b.id"
    )).mappings().all()
    contador: dict[str, int] = {}
    for f in filas:
        contador[f["lote_id"]] = contador.get(f["lote_id"], 0) + 1
        conn.execute(
            sa.text("UPDATE bines_pasa SET tarja = :tarja WHERE id = :id"),
            {
                "tarja": _tarja(f["temporada"], f["variedad"], f["calidad"], f["numero"], contador[f["lote_id"]]),
                "id": f["bin_id"],
            },
        )
    op.alter_column('bines_pasa', 'tarja', existing_type=sa.String(length=40), nullable=False)
    op.create_unique_constraint('uq_bin_pasa_tarja', 'bines_pasa', ['lote_id', 'tarja'])

    # 2) Depósito único: los lotes que quedaron sin depósito pasan al depósito fijo
    # (si existe; la migración 079038232ad0 lo crea).
    dep = conn.execute(
        sa.text("SELECT id FROM depositos WHERE lower(nombre) = lower(:n)"), {"n": DEPOSITO_UNICO}
    ).first()
    if dep:
        conn.execute(
            sa.text("UPDATE lotes_pasa SET deposito_id = :d WHERE deposito_id IS NULL"), {"d": dep[0]}
        )


def downgrade() -> None:
    # Los depósitos asignados a lotes se conservan (no hay forma de saber cuáles
    # estaban vacíos antes).
    op.drop_constraint('uq_bin_pasa_tarja', 'bines_pasa', type_='unique')
    op.drop_column('bines_pasa', 'tarja')
