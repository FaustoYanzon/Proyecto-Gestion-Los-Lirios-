"""Read-only pre-deploy gates for the multi-product orders migration.

Runs SELECTs only (autocommit connection, no writes). Reuses the backfill
script's connection resolution, so it reads `.env.prod` the same way and prints
only the host name, never the URL or credentials.

Usage (from the repo root, venv python):
  backend\\venv\\Scripts\\python.exe scripts\\migracion\\pregate_ordenes_multiproducto.py          # PRODUCTION (read-only)
  backend\\venv\\Scripts\\python.exe scripts\\migracion\\pregate_ordenes_multiproducto.py --local  # local dev DB

Gates (see docs/sistema/Bitácora/2026-10-27-ordenes-multiproducto.md, step 0):
  (a) duplicate plan rows  -> must be 0 rows
  (b) valves without surface -> informational (they add 0 ha to coverage)
  (c) current schema revision and open orders -> informational
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backfill_plan_registros import read_database_url  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="use the local dev database")
    args = parser.parse_args()

    url, source = read_database_url(skip_prod=args.local)
    host = urlparse(url).hostname
    if args.local and host not in ("localhost", "127.0.0.1", "::1"):
        print("ERROR: --local pero la base resuelta no está en localhost")
        return 1
    print(f"Fuente: {source} | host: {host} | SOLO LECTURA")

    conn = await asyncpg.connect(url)
    try:
        revision = await conn.fetchval("SELECT version_num FROM alembic_version")
        print(f"\nRevisión alembic actual: {revision} (head previo esperado: c3f1a8d27e54)")

        dups = await conn.fetch(
            "SELECT temporada, variedad, numero_aplicacion, insumo_id, count(*) AS n "
            "FROM planes_fitosanitarios GROUP BY 1,2,3,4 HAVING count(*) > 1"
        )
        print(f"\n(a) Filas duplicadas del plan: {len(dups)}  {'OK' if not dups else 'LIMPIAR ANTES DE DEPLOYAR'}")
        for r in dups:
            print(f"    temporada={r['temporada']} variedad={r['variedad']} ronda={r['numero_aplicacion']} "
                  f"insumo={r['insumo_id'][:8]} x{r['n']}")

        sin_sup = await conn.fetchval(
            "SELECT count(*) FROM valvulas WHERE is_active AND superficie_ha IS NULL"
        )
        total = await conn.fetchval("SELECT count(*) FROM valvulas WHERE is_active")
        print(f"\n(b) Válvulas activas sin superficie: {sin_sup} de {total}")

        ordenes = await conn.fetch(
            "SELECT estado, origen, count(*) AS n FROM ordenes_aplicacion GROUP BY 1,2 ORDER BY 1,2"
        )
        print("\n(c) Órdenes por estado/origen:")
        for r in ordenes:
            print(f"    {r['estado']:<11} {r['origen']:<6} {r['n']}")
        con_registro = await conn.fetchval(
            "SELECT count(*) FROM ordenes_aplicacion_parcelas WHERE registro_fitosanitario_id IS NOT NULL"
        )
        con_registro_v = await conn.fetchval(
            "SELECT count(*) FROM ordenes_aplicacion_valvulas WHERE registro_fitosanitario_id IS NOT NULL"
        )
        print(f"    parcelas con registro (legacy): {con_registro} | válvulas con registro (legacy): {con_registro_v}")
        planes = await conn.fetchval("SELECT count(*) FROM planes_fitosanitarios")
        print(f"    filas del plan cargadas: {planes}")
    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
