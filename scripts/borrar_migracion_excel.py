"""One-time cleanup: remove the historical Excel-migration rows that Fausto
determined were loaded incorrectly (numbers didn't reconcile) — he'll
re-analyze and reload them later. Companion/undo of migrate_excels.py.

Scope (confirmed against production right before running):
  - registros_cosecha: full DELETE, gated on COUNT(*) == 591 (the exact
    row count migrate_excels.py loaded) — refuses to run on any other
    count, since that would mean real pilot data got mixed in.
  - egresos: DELETE WHERE fuente = 'migracion_excel' (expected 144 rows)
  - presupuestos: DELETE WHERE notas = 'migracion_excel' (expected 370 rows)
  - ingresos: deliberately NOT touched (out of scope per the 2026-07-14
    BD COBROS redesign — those historicals were already discarded there)

Usage (from backend venv, which has asyncpg installed):
  cd C:\\claude-projects\\los-lirios
  python scripts\\borrar_migracion_excel.py             # DRY RUN (counts only)
  python scripts\\borrar_migracion_excel.py --commit    # actually delete

Behaviour:
  - Reads DATABASE_PUBLIC_URL from backend/.env (production Railway DB)
  - Each table is deleted in its own transaction
  - Does NOT take its own pg_dump — this script assumes a fresh manual
    backup was already taken (see pg_backups/), per the safety protocol
    already followed for this cleanup
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

import asyncpg

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"

EXPECTED_COSECHA_COUNT = 591


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually delete (default: dry run)")
    args = parser.parse_args()

    conn = await asyncpg.connect(asyncpg_url(read_env_var("DATABASE_PUBLIC_URL")))
    try:
        n_cosecha = await conn.fetchval("SELECT COUNT(*) FROM registros_cosecha")
        n_egresos = await conn.fetchval("SELECT COUNT(*) FROM egresos WHERE fuente = 'migracion_excel'")
        n_presupuestos = await conn.fetchval("SELECT COUNT(*) FROM presupuestos WHERE notas = 'migracion_excel'")

        print(f"registros_cosecha: {n_cosecha} filas (esperado {EXPECTED_COSECHA_COUNT})")
        print(f"egresos WHERE fuente='migracion_excel': {n_egresos} filas (esperado 144)")
        print(f"presupuestos WHERE notas='migracion_excel': {n_presupuestos} filas (esperado 370)")

        if n_cosecha != EXPECTED_COSECHA_COUNT:
            sys.exit(
                f"\nERROR: registros_cosecha tiene {n_cosecha} filas, no {EXPECTED_COSECHA_COUNT} — "
                "puede haber datos reales del piloto mezclados. No se borra nada."
            )

        if not args.commit:
            print("\nDRY RUN — nada borrado. Ejecutá con --commit para borrar.")
            return

        async with conn.transaction():
            await conn.execute("DELETE FROM registros_cosecha")
        print(f"\nBorrado: {n_cosecha} filas de registros_cosecha")

        async with conn.transaction():
            await conn.execute("DELETE FROM egresos WHERE fuente = 'migracion_excel'")
        print(f"Borrado: {n_egresos} filas de egresos (fuente='migracion_excel')")

        async with conn.transaction():
            await conn.execute("DELETE FROM presupuestos WHERE notas = 'migracion_excel'")
        print(f"Borrado: {n_presupuestos} filas de presupuestos (notas='migracion_excel')")

        print("\ningresos: no tocado (fuera de alcance, ver docstring).")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
