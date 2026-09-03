"""Backfill del campo finca en parcelas (agregado en la Fase 2 de
Trazabilidad -- ver plan de la feature).

Todas las parcelas ACTIVAS del sistema estan en Media Agua (confirmado con
Fausto, 2026-09). Este script les asigna finca='media_agua' a las que todavia
no tengan una finca asignada. Las parcelas inactivas quedan sin tocar --
nadie las va a ver en la ficha de trazabilidad, no vale la pena adivinar.

Usage (desde el venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  python scripts\\backfill_finca_parcelas.py             # DRY RUN (no escribe)
  python scripts\\backfill_finca_parcelas.py --commit    # aplica de verdad

Comportamiento:
  - Lee DATABASE_PUBLIC_URL de backend/.env (Postgres de produccion en Railway)
  - Solo toca parcelas is_active=true AND finca IS NULL.
  - --commit siempre saca su propio backup con pg_dump antes de escribir, y
    aborta sin escribir nada si el dump falla o queda sospechosamente chico.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import asyncpg

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"

FINCA_UNICA = "media_agua"


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
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_backfill_finca_parcelas.dump"
    result = subprocess.run(
        ["pg_dump", "-Fc", database_public_url, "-f", str(outfile)],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not outfile.exists() or outfile.stat().st_size < 10_000:
        print(result.stderr, file=sys.stderr)
        sys.exit("ERROR: pg_dump fallo o el archivo quedo sospechosamente chico -- no se escribe nada.")
    print(f"\nBackup OK: {outfile} ({outfile.stat().st_size:,} bytes)")
    return outfile


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    args = parser.parse_args()

    database_public_url = read_env_var("DATABASE_PUBLIC_URL")
    conn = await asyncpg.connect(asyncpg_url(database_public_url))
    try:
        candidatas = await conn.fetch(
            "SELECT id, nombre, tipo FROM parcelas WHERE is_active = true AND finca IS NULL ORDER BY nombre"
        )
        ya_asignadas = await conn.fetchval(
            "SELECT count(*) FROM parcelas WHERE is_active = true AND finca IS NOT NULL"
        )
        inactivas_sin_finca = await conn.fetchval(
            "SELECT count(*) FROM parcelas WHERE is_active = false AND finca IS NULL"
        )

        print(f"Parcelas activas ya con finca asignada (no se tocan): {ya_asignadas}")
        print(f"Parcelas inactivas sin finca (no se tocan): {inactivas_sin_finca}")
        print(f"Parcelas activas sin finca -> se les asigna '{FINCA_UNICA}': {len(candidatas)}")
        for p in candidatas:
            print(f"  - {p['nombre']} ({p['tipo']})")

        if not args.commit:
            print("\nDRY RUN -- nada escrito. Ejecuta con --commit para aplicar.")
            return

        if not candidatas:
            print("\nNada para hacer.")
            return

        run_pg_dump_backup(database_public_url)

        async with conn.transaction():
            result = await conn.execute(
                "UPDATE parcelas SET finca = $1 WHERE is_active = true AND finca IS NULL",
                FINCA_UNICA,
            )
        print(f"\n{result}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
