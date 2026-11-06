"""Fixes Parral 4 / Parral 5: surface to 2.0 ha (was 2.85) and crossed polygons.

Field truth: Parral 4 is the NORTH parral, Parral 5 the SOUTH one. The original
KML had the labels crossed, so `parcelas.coordenadas` (what mobile draws) may
hold Parral 4's polygon under Parral 5 and vice versa. In the same transaction
the stored polygons are swapped IF AND ONLY IF Parral 4's centroid latitude is
lower (more southern) than Parral 5's; NULL coordenadas are skipped with a
note. A second run finds them already correct and changes nothing.

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
import json
import sys
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prod_db import LOCAL_HOSTS, confirmar_apply, read_database_url  # noqa: E402

PARCELAS = ("Parral 4", "Parral 5")
HA_NUEVA = Decimal("2.0")


def centroid_lat(raw: object) -> float | None:
    """Mean latitude of a stored polygon ([[lat, lng], ...]); None if empty/NULL."""
    if raw is None:
        return None
    pts = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
    if not pts:
        return None
    # parcelas.coordenadas uses Leaflet order: [lat, lng]
    return sum(float(p[0]) for p in pts) / len(pts)


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
            "SELECT p.id, p.nombre, p.superficie_ha, p.coordenadas, "
            "(SELECT count(*) FROM registros_riego r WHERE r.parcela_id = p.id) AS riegos "
            "FROM parcelas p WHERE p.nombre = ANY($1::text[]) ORDER BY p.nombre",
            list(PARCELAS),
        )
        for r in filas:
            print(f"  {r['nombre']:<10} id={r['id']} superficie_ha={r['superficie_ha']} registros_riego={r['riegos']}")
            lat = centroid_lat(r["coordenadas"])
            print(f"             centroid_lat={'NULL (sin coordenadas)' if lat is None else f'{lat:.6f}'}")

        # Abort on anything but exactly one row per name: the UPDATE is by name.
        if sorted(r["nombre"] for r in filas) != sorted(PARCELAS):
            print(f"ABORT: se esperaba exactamente una fila por parcela {PARCELAS}; no se escribe nada.")
            return 1

        pendientes = [r for r in filas if r["superficie_ha"] != HA_NUEVA]
        for r in pendientes:
            print(f"  cambiaría: {r['nombre']} {r['superficie_ha']} -> {HA_NUEVA}")

        # Polygon swap only when Parral 4 is currently the more southern one
        por_nombre = {r["nombre"]: r for r in filas}
        p4, p5 = por_nombre["Parral 4"], por_nombre["Parral 5"]
        lat4, lat5 = centroid_lat(p4["coordenadas"]), centroid_lat(p5["coordenadas"])
        swap = False
        if lat4 is None or lat5 is None:
            print("  coordenadas: alguna es NULL, se omite el intercambio de polígonos.")
        elif lat4 < lat5:
            swap = True
            print(f"  cambiaría: intercambiar coordenadas Parral 4 <-> Parral 5 (lat {lat4:.6f} < {lat5:.6f})")
        else:
            print("  coordenadas: Parral 4 ya es el norte; sin cambios.")

        if not pendientes and not swap:
            print(f"OK: superficie_ha={HA_NUEVA} y polígonos correctos. Nada que hacer.")
            return 0

        if not args.apply:
            print("\nDRY RUN: nada escrito. Revisar los registros_riego por parcela y correr con --apply.")
            return 0

        confirmar_apply(host, local=args.local)
        async with conn.transaction():
            for r in pendientes:
                resultado = await conn.execute(
                    "UPDATE parcelas SET superficie_ha = $1, updated_at = now() WHERE id = $2",
                    float(HA_NUEVA), r["id"],
                )
                # Raising inside the transaction rolls everything back
                if resultado != "UPDATE 1":
                    raise RuntimeError(f"Filas afectadas inesperadas ({resultado}); rollback.")
            if swap:
                for fila, otra in ((p4, p5), (p5, p4)):
                    coords = otra["coordenadas"]
                    coords = coords if isinstance(coords, str) else json.dumps(coords)
                    resultado = await conn.execute(
                        "UPDATE parcelas SET coordenadas = $1::json, updated_at = now() WHERE id = $2",
                        coords, fila["id"],
                    )
                    if resultado != "UPDATE 1":
                        raise RuntimeError(f"Filas afectadas inesperadas ({resultado}); rollback.")
        despues = await conn.fetch(
            "SELECT nombre, superficie_ha, coordenadas FROM parcelas WHERE nombre = ANY($1::text[]) ORDER BY nombre",
            list(PARCELAS),
        )
        for r in despues:
            print(f"Verificación: {r['nombre']} superficie_ha={r['superficie_ha']} centroid_lat={centroid_lat(r['coordenadas'])}")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
