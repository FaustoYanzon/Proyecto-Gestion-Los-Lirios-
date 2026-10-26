"""Corrects Potrero 23 surface from 23 ha to 2.3 ha (typo in the original load).

Manto irrigation computes valves as ceil(superficie_ha), so this must be fixed
BEFORE enabling it. The UPDATE is guarded by `superficie_ha = 23` so it is
idempotent, and the script aborts unless exactly one row matches.

Usage:
  cd C:\\claude-projects\\los-lirios
  python scripts\\corregir_superficie_potrero_23.py                      # DRY RUN, local DB
  python scripts\\corregir_superficie_potrero_23.py --aplicar            # writes to local DB
  python scripts\\corregir_superficie_potrero_23.py --db prod            # DRY RUN, production
  python scripts\\corregir_superficie_potrero_23.py --db prod --aplicar  # production, with backup
"""

from __future__ import annotations

import argparse
import asyncio
import re
import subprocess
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"

PARCELA = "Potrero 23"
HA_ACTUAL = Decimal("23")
HA_NUEVA = Decimal("2.3")


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def run_pg_dump_backup(url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_potrero23.dump"
    result = subprocess.run(["pg_dump", "-Fc", url, "-f", str(outfile)], capture_output=True, text=True)
    # A tiny dump means pg_dump produced an empty/partial file: do not write without a real backup
    if result.returncode != 0 or not outfile.exists() or outfile.stat().st_size < 10_000:
        print(result.stderr, file=sys.stderr)
        sys.exit("ERROR: pg_dump fallo o el archivo quedo sospechosamente chico -- no se escribe nada.")
    print(f"\nBackup OK: {outfile} ({outfile.stat().st_size:,} bytes)")
    return outfile


async def main() -> None:
    import asyncpg

    ap = argparse.ArgumentParser()
    ap.add_argument("--db", choices=["local", "prod"], default="local")
    ap.add_argument("--aplicar", action="store_true", help="escribir (default: dry run)")
    args = ap.parse_args()

    # The URL is never printed.
    url = read_env_var("DATABASE_PUBLIC_URL" if args.db == "prod" else "DATABASE_URL")

    conn = await asyncpg.connect(asyncpg_url(url))
    try:
        print(f"DB: {args.db}\n")
        filas = await conn.fetch(
            "SELECT id, nombre, superficie_ha FROM parcelas WHERE nombre = $1", PARCELA
        )
        for r in filas:
            print(f"Actual: {r['nombre']} (id={r['id']}) superficie_ha={r['superficie_ha']}")

        coinciden = [r for r in filas if r["superficie_ha"] == HA_ACTUAL]
        if len(coinciden) != 1:
            sys.exit(
                f"ABORT: se esperaba exactamente 1 fila con nombre='{PARCELA}' y "
                f"superficie_ha={HA_ACTUAL}, hay {len(coinciden)}. No se escribe nada."
            )
        print(f"Cambiaria: superficie_ha {HA_ACTUAL} -> {HA_NUEVA}")

        if not args.aplicar:
            print("\nDRY RUN -- nada escrito. Ejecutar con --aplicar para escribir.")
            return

        if args.db == "prod":
            run_pg_dump_backup(url)

        async with conn.transaction():
            resultado = await conn.execute(
                "UPDATE parcelas SET superficie_ha = $1, updated_at = now() "
                "WHERE nombre = $2 AND superficie_ha = $3",
                HA_NUEVA, PARCELA, HA_ACTUAL,
            )
            # Raising inside the transaction rolls the UPDATE back
            if resultado != "UPDATE 1":
                raise RuntimeError(f"Filas afectadas inesperadas ({resultado}); rollback.")

        despues = await conn.fetch(
            "SELECT nombre, superficie_ha FROM parcelas WHERE nombre = $1", PARCELA
        )
        for r in despues:
            print(f"\nVerificacion: {r['nombre']} superficie_ha={r['superficie_ha']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
