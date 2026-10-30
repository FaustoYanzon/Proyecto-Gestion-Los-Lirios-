"""Read-only pre-deploy gate for migration 822f93f13a0d (unique index
`ux_registros_riego_manto_en_curso`: one manto in progress per parcel).

The index cannot be created while a parcel already has two or more manto
records with `fin IS NULL`. This lists them; exit code 0 = safe to migrate,
1 = clean those rows first (close the stale ones from the web "Riego" screen).

Runs SELECTs only. Reuses the shared connection helper (_prod_db.py): reads
`.env.prod` and prints only the host name, never the URL or credentials.

Usage (from the repo root, venv python):
  backend/venv/Scripts/python.exe scripts/migracion/pregate_riego_manto_unico.py           # PRODUCTION
  backend/venv/Scripts/python.exe scripts/migracion/pregate_riego_manto_unico.py --local   # local dev DB
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prod_db import read_database_url  # noqa: E402


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
        duplicadas = await conn.fetch(
            "SELECT r.parcela_id, p.nombre, count(*) AS n, min(r.inicio) AS primero, max(r.inicio) AS ultimo "
            "FROM registros_riego r JOIN parcelas p ON p.id = r.parcela_id "
            "WHERE r.fin IS NULL AND r.tipo::text = 'manto' "
            "GROUP BY r.parcela_id, p.nombre HAVING count(*) > 1 ORDER BY n DESC"
        )
        en_curso = await conn.fetchval(
            "SELECT count(*) FROM registros_riego WHERE fin IS NULL AND tipo::text = 'manto'"
        )
    finally:
        await conn.close()

    print(f"Mantos en curso hoy: {en_curso}")
    if not duplicadas:
        print("OK: ninguna parcela tiene más de un manto en curso. El índice único se puede crear.")
        return 0
    print(f"BLOQUEA: {len(duplicadas)} parcela(s) con más de un manto en curso:")
    for d in duplicadas:
        print(f"    {d['nombre']:<24} {d['n']} en curso  (desde {d['primero']:%Y-%m-%d %H:%M} hasta {d['ultimo']:%Y-%m-%d %H:%M})")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
