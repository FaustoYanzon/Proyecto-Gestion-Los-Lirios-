"""Read-only pre-deploy gate for the migration that drops the single-product
shim columns of `ordenes_aplicacion` (insumo_id, dosis_por_ha, dias_carencia,
dias_reingreso, variedad, origen) and the `origenordenaplicacion` enum.

After the drop, the API reads products only from `ordenes_aplicacion_insumos`
(`lineas`). So every order must have at least one line, otherwise it would
render with no product at all. Exit code 0 = safe to migrate, 1 = fix first.

Also reports (informational, never blocks): orders whose shim product differs
from the first line, and the `origen` split, since `origen` is dropped for good.

Runs SELECTs only. Reuses the shared connection helper (_prod_db.py): reads
`.env.prod` and prints only the host name, never the URL or credentials.

Usage (from the repo root, venv python):
  backend/venv/Scripts/python.exe scripts/migracion/pregate_quitar_shims_orden.py           # PRODUCTION
  backend/venv/Scripts/python.exe scripts/migracion/pregate_quitar_shims_orden.py --local   # local dev DB
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
        total = await conn.fetchval("SELECT count(*) FROM ordenes_aplicacion")
        sin_lineas = await conn.fetch(
            "SELECT o.id, o.fecha_planificada, o.estado::text AS estado "
            "FROM ordenes_aplicacion o "
            "WHERE NOT EXISTS (SELECT 1 FROM ordenes_aplicacion_insumos l WHERE l.orden_id = o.id) "
            "ORDER BY o.fecha_planificada"
        )
        sin_parcelas = await conn.fetchval(
            "SELECT count(*) FROM ordenes_aplicacion o "
            "WHERE NOT EXISTS (SELECT 1 FROM ordenes_aplicacion_parcelas p WHERE p.orden_id = o.id)"
        )
        shim_distinto = await conn.fetchval(
            "SELECT count(*) FROM ordenes_aplicacion o "
            "JOIN ordenes_aplicacion_insumos l ON l.orden_id = o.id AND l.posicion = 0 "
            "WHERE l.insumo_id <> o.insumo_id OR l.dosis_por_ha <> o.dosis_por_ha"
        )
        # The migration drops this FK by name; a different name would abort it.
        fk_existe = await conn.fetchval(
            "SELECT count(*) FROM pg_constraint "
            "WHERE conname = 'ordenes_aplicacion_insumo_id_fkey' "
            "AND conrelid = 'ordenes_aplicacion'::regclass"
        )
        por_origen = await conn.fetch(
            "SELECT origen::text AS origen, count(*) AS n FROM ordenes_aplicacion GROUP BY origen ORDER BY origen"
        )
    finally:
        await conn.close()

    print(f"Órdenes totales: {total}")
    print("Por origen (se pierde al migrar): " + ", ".join(f"{r['origen']}={r['n']}" for r in por_origen))
    print(f"Órdenes sin parcelas (informativo): {sin_parcelas}")
    print(f"Órdenes cuyo shim difiere de la línea 0 (informativo): {shim_distinto}")
    bloquea = False
    if not fk_existe:
        print("BLOQUEA: no existe la FK 'ordenes_aplicacion_insumo_id_fkey' (la migración la dropea por nombre).")
        bloquea = True
    if sin_lineas:
        print(f"BLOQUEA: {len(sin_lineas)} orden(es) sin ninguna línea de producto:")
        for o in sin_lineas:
            print(f"  - {o['id']} · {o['fecha_planificada']} · {o['estado']}")
        bloquea = True
    if bloquea:
        return 1
    print("OK: todas las órdenes tienen al menos una línea y la FK existe. Se pueden quitar las columnas shim.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
