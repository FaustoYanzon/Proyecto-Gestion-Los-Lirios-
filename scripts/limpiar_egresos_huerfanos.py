"""One-time cleanup: delete egresos left orphaned by limpiar_duplicados.py.

That script deleted duplicate registros_trabajo rows via raw SQL DELETE,
which — unlike the real delete_trabajo endpoint (backend/app/api/produccion.py)
— does not also delete the linked Egreso (fuente='trabajo_diario',
referencia_id=<registro.id>, created by _build_egreso_for_trabajo). This left
14 egresos pointing at rows that no longer exist, inflating the Egresos total
in finanzas above the Mano de Obra total in produccion by the same amount.

Usage (from backend venv, which has asyncpg installed):
  cd C:\\claude-projects\\los-lirios
  python scripts\\limpiar_egresos_huerfanos.py             # DRY RUN (no writes)
  python scripts\\limpiar_egresos_huerfanos.py --commit    # actually delete

Behaviour:
  - Reads DATABASE_PUBLIC_URL from backend/.env (production Railway DB)
  - Deletes egresos WHERE fuente='trabajo_diario' AND referencia_id has no
    matching row in registros_trabajo
  - --commit always takes its own pg_dump backup into pg_backups/ first and
    refuses to continue if the dump fails or looks too small
"""

from __future__ import annotations

import argparse
import asyncio
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import asyncpg

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"

FIND_ORPHANS_SQL = """
    SELECT e.id, e.fecha, e.descripcion, e.monto, e.referencia_id
    FROM egresos e
    WHERE e.fuente = 'trabajo_diario'
      AND NOT EXISTS (SELECT 1 FROM registros_trabajo t WHERE t.id = e.referencia_id)
    ORDER BY e.fecha
"""


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def run_pg_dump_backup(database_public_url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_egresos_huerfanos.dump"
    result = subprocess.run(
        ["pg_dump", "-Fc", database_public_url, "-f", str(outfile)],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not outfile.exists() or outfile.stat().st_size < 10_000:
        print(result.stderr, file=sys.stderr)
        sys.exit("ERROR: pg_dump falló o el archivo quedó sospechosamente chico — no se borra nada.")
    print(f"\nBackup OK: {outfile} ({outfile.stat().st_size:,} bytes)")
    return outfile


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually delete (default: dry run)")
    args = parser.parse_args()

    database_public_url = read_env_var("DATABASE_PUBLIC_URL")
    conn = await asyncpg.connect(asyncpg_url(database_public_url))
    try:
        orphans = await conn.fetch(FIND_ORPHANS_SQL)
        total = sum(r["monto"] for r in orphans)
        print(f"Egresos huerfanos (fuente='trabajo_diario', sin registro_trabajo): {len(orphans)}")
        for r in orphans:
            print(f"  {r['fecha']}  ${r['monto']:>12,.2f}  {r['descripcion']}  (referencia_id={r['referencia_id']})")
        print(f"\nTotal: ${total:,.2f}")

        if not args.commit:
            print("\nDRY RUN — nada borrado. Ejecutá con --commit para borrar.")
            return

        run_pg_dump_backup(database_public_url)

        async with conn.transaction():
            ids = [r["id"] for r in orphans]
            await conn.execute("DELETE FROM egresos WHERE id = ANY($1::text[])", ids)

        print(f"\nBorrado: {len(orphans)} egresos huérfanos (${total:,.2f}).")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
