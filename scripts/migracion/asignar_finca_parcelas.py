"""Assigns every parcela without a finca to Media Agua.

Business fact (Fausto, 2026-11-12): all loaded parcelas belong to Media Agua;
Caucete is no longer a finca and Los Mimbres has no parcelas loaded yet. The
mobile finca selector filters strictly by `parcelas.finca`, so NULL rows must
be filled. Only rows with finca IS NULL are touched (idempotent; parcelas that
already carry a finca are never overwritten).

Dry run by default: lists the parcelas per finca (read-only) so the production
list can be compared with the local one. `--apply` writes inside a transaction.

Reuses _prod_db.py: prints only the host name, never the URL or credentials.

Usage (from the repo root, venv python):
  backend/venv/Scripts/python.exe scripts/migracion/asignar_finca_parcelas.py                 # DRY RUN, production
  backend/venv/Scripts/python.exe scripts/migracion/asignar_finca_parcelas.py --local         # DRY RUN, local DB
  backend/venv/Scripts/python.exe scripts/migracion/asignar_finca_parcelas.py --local --apply # writes local
  backend/venv/Scripts/python.exe scripts/migracion/asignar_finca_parcelas.py --apply         # writes prod (asks SI)
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prod_db import LOCAL_HOSTS, confirmar_apply, read_database_url  # noqa: E402

FINCA = "media_agua"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="use the local dev database")
    parser.add_argument("--apply", action="store_true", help="write the UPDATE (default: dry run)")
    args = parser.parse_args()

    url, source = read_database_url(skip_prod=args.local)
    host = urlparse(url).hostname
    if args.local and host not in LOCAL_HOSTS:
        print("ERROR: --local pero la base resuelta no está en localhost")
        return 1
    print(f"Fuente: {source} | host: {host} | {'APPLY' if args.apply else 'DRY RUN (solo lectura)'}")

    conn = await asyncpg.connect(url)
    try:
        filas = await conn.fetch(
            "SELECT nombre, tipo::text AS tipo, finca::text AS finca FROM parcelas ORDER BY finca NULLS FIRST, nombre"
        )
        por_finca: dict[str, list[str]] = {}
        for r in filas:
            por_finca.setdefault(r["finca"] or "(sin finca)", []).append(r["nombre"])
        for finca, nombres in por_finca.items():
            print(f"  {finca}: {len(nombres)} -> {', '.join(nombres)}")

        pendientes = len(por_finca.get("(sin finca)", []))
        if pendientes == 0:
            print("OK: todas las parcelas ya tienen finca. Nada que hacer.")
            return 0
        if not args.apply:
            print(f"\nDRY RUN: {pendientes} parcelas pasarían a {FINCA}. Nada escrito.")
            return 0

        confirmar_apply(host, local=args.local)
        async with conn.transaction():
            resultado = await conn.execute(
                "UPDATE parcelas SET finca = $1::finca, updated_at = now() WHERE finca IS NULL", FINCA
            )
            # Raising inside the transaction rolls everything back
            if resultado != f"UPDATE {pendientes}":
                raise RuntimeError(f"Filas afectadas inesperadas ({resultado}); rollback.")
        restantes = await conn.fetchval("SELECT count(*) FROM parcelas WHERE finca IS NULL")
        print(f"Verificación: {pendientes} parcelas asignadas a {FINCA}; sin finca restantes: {restantes}")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
