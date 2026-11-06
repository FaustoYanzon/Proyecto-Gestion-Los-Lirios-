"""Sets Parral 4 and Parral 5 surface to 2.0 ha (was 2.85 in the original load).

Dry run by default: prints current surface and the number of `registros_riego`
per parcel (read-only) so irrigation logged against the wrong parral (the map
labels were swapped) can be spotted. `--apply` writes the UPDATE, guarded by
the current value so it is idempotent. Parcel IDs are never touched.

Reuses _prod_db.py: prints only the host name, never the URL or credentials.

Usage (from the repo root, venv python):
  backend/venv/Scripts/python.exe scripts/migracion/corregir_parral_4_5.py                 # DRY RUN, production
  backend/venv/Scripts/python.exe scripts/migracion/corregir_parral_4_5.py --local         # DRY RUN, local DB
  backend/venv/Scripts/python.exe scripts/migracion/corregir_parral_4_5.py --apply         # writes (asks SI)
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prod_db import LOCAL_HOSTS, confirmar_apply, read_database_url  # noqa: E402

PARCELAS = ("Parral 4", "Parral 5")
HA_NUEVA = Decimal("2.0")


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
            "SELECT p.id, p.nombre, p.superficie_ha, "
            "(SELECT count(*) FROM registros_riego r WHERE r.parcela_id = p.id) AS riegos "
            "FROM parcelas p WHERE p.nombre = ANY($1::text[]) ORDER BY p.nombre",
            list(PARCELAS),
        )
        for r in filas:
            print(f"  {r['nombre']:<10} id={r['id']} superficie_ha={r['superficie_ha']} registros_riego={r['riegos']}")

        # Abort on anything but exactly one row per name: the UPDATE is by name.
        if sorted(r["nombre"] for r in filas) != sorted(PARCELAS):
            print(f"ABORT: se esperaba exactamente una fila por parcela {PARCELAS}; no se escribe nada.")
            return 1

        pendientes = [r for r in filas if r["superficie_ha"] != HA_NUEVA]
        if not pendientes:
            print(f"OK: ambas parcelas ya tienen superficie_ha={HA_NUEVA}. Nada que hacer.")
            return 0
        for r in pendientes:
            print(f"  cambiaría: {r['nombre']} {r['superficie_ha']} -> {HA_NUEVA}")

        if not args.apply:
            print("\nDRY RUN: nada escrito. Revisar los registros_riego por parcela y correr con --apply.")
            return 0

        confirmar_apply(host, local=args.local)
        async with conn.transaction():
            for r in pendientes:
                resultado = await conn.execute(
                    "UPDATE parcelas SET superficie_ha = $1, updated_at = now() WHERE id = $2",
                    HA_NUEVA, r["id"],
                )
                # Raising inside the transaction rolls everything back
                if resultado != "UPDATE 1":
                    raise RuntimeError(f"Filas afectadas inesperadas ({resultado}); rollback.")
        despues = await conn.fetch(
            "SELECT nombre, superficie_ha FROM parcelas WHERE nombre = ANY($1::text[]) ORDER BY nombre",
            list(PARCELAS),
        )
        for r in despues:
            print(f"Verificación: {r['nombre']} superficie_ha={r['superficie_ha']}")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
