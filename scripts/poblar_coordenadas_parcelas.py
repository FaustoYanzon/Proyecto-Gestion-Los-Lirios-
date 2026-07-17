"""Backfill parcelas.coordenadas from the canonical KML.

The `coordenadas` JSON column on `parcelas` was wired end-to-end (backend
schema, mobile type) but never actually populated — every row has it set to
JSON null in production. This script fills it in from
`frontend/public/Los Lirios 2026.kml`, which is the up-to-date geometry
source the web map already reads live at runtime (see frontend/lib/kml.ts).
The mobile map, by contrast, drew polygons from a stale hand-copied snapshot
(mobile/lib/kmlData.ts) — this backfill is what lets mobile switch to
drawing from the API instead.

Usage (from backend venv, which has asyncpg installed):
  cd C:\\claude-projects\\los-lirios
  python scripts\\poblar_coordenadas_parcelas.py             # DRY RUN (no writes)
  python scripts\\poblar_coordenadas_parcelas.py --commit    # actually write

Behaviour:
  - Reads DATABASE_PUBLIC_URL from backend/.env (production Railway DB)
  - Parses Polygon placemarks under the Cabezales/Parrales/Paseros/Potreros
    folders (skips the Finca outline, pipelines, and unnamed markers --
    those aren't `parcelas` rows, they're separate map layers)
  - Matches placemarks to parcelas by nombre (case-insensitive); UPDATEs
    coordenadas for matches
  - INSERTs a new parcela row for any KML polygon with no matching DB row
    (today: only "Pasero 3", following the same field pattern as the
    existing Pasero 1/Pasero 2 seed rows in backend/app/api/seed_parcelas.py)
  - --commit always takes its own pg_dump backup into pg_backups/ first and
    refuses to continue if the dump fails or looks too small
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import asyncpg

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"
KML_FILE = ROOT / "frontend" / "public" / "Los Lirios 2026.kml"

KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}
TYPE_PREFIXES = ("parral", "potrero", "pasero", "cabezal")


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def infer_tipo(name: str) -> str | None:
    n = name.strip().lower()
    for prefix in TYPE_PREFIXES:
        if n.startswith(prefix):
            return prefix
    return None


def parse_coords(text: str) -> list[list[float]]:
    """KML gives 'lng,lat[,alt] lng,lat[,alt] ...' -> [[lat, lng], ...] (Leaflet order)."""
    points = []
    for chunk in text.split():
        lng_str, lat_str, *_ = chunk.split(",")
        points.append([float(lat_str), float(lng_str)])
    return points


def load_kml_placemarks() -> list[dict]:
    root = ET.parse(KML_FILE).getroot()
    placemarks = []
    for pm in root.findall(".//kml:Placemark", KML_NS):
        name_el = pm.find("kml:name", KML_NS)
        name = (name_el.text or "").strip() if name_el is not None else ""
        if not name or name == "Marcador sin título":
            continue
        tipo = infer_tipo(name)
        if tipo is None:
            continue  # Finca outline / pipelines / anything else -- not a parcela row
        coords_el = pm.find("kml:Polygon/kml:outerBoundaryIs/kml:LinearRing/kml:coordinates", KML_NS)
        if coords_el is None or not coords_el.text:
            continue
        placemarks.append({"nombre": name, "tipo": tipo, "coordenadas": parse_coords(coords_el.text)})
    return placemarks


def run_pg_dump_backup(database_public_url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_coordenadas.dump"
    result = subprocess.run(
        ["pg_dump", "-Fc", database_public_url, "-f", str(outfile)],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not outfile.exists() or outfile.stat().st_size < 10_000:
        print(result.stderr, file=sys.stderr)
        sys.exit("ERROR: pg_dump falló o el archivo quedó sospechosamente chico — no se escribe nada.")
    print(f"\nBackup OK: {outfile} ({outfile.stat().st_size:,} bytes)")
    return outfile


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    args = parser.parse_args()

    placemarks = load_kml_placemarks()
    print(f"KML: {len(placemarks)} placemarks de tipo parral/potrero/pasero/cabezal")

    database_public_url = read_env_var("DATABASE_PUBLIC_URL")
    conn = await asyncpg.connect(asyncpg_url(database_public_url))
    try:
        db_rows = await conn.fetch("SELECT id, nombre FROM parcelas")
        db_by_name = {row["nombre"].strip().lower(): row["id"] for row in db_rows}
        kml_names = {p["nombre"].strip().lower() for p in placemarks}

        matched = [p for p in placemarks if p["nombre"].strip().lower() in db_by_name]
        unmatched_kml = [p for p in placemarks if p["nombre"].strip().lower() not in db_by_name]
        unmatched_db = [row["nombre"] for row in db_rows if row["nombre"].strip().lower() not in kml_names]

        print(f"\nCoincidencias (KML <-> parcelas): {len(matched)}")
        for p in matched:
            print(f"  {p['nombre']}: {len(p['coordenadas'])} puntos")

        print(f"\nPlacemarks del KML SIN fila en parcelas (se insertan en --commit): {len(unmatched_kml)}")
        for p in unmatched_kml:
            print(f"  {p['nombre']} ({p['tipo']}): {len(p['coordenadas'])} puntos")

        print(f"\nFilas de parcelas SIN placemark en el KML (quedan sin tocar): {len(unmatched_db)}")
        for nombre in unmatched_db:
            print(f"  {nombre}")

        if not args.commit:
            print("\nDRY RUN — nada escrito. Ejecutá con --commit para aplicar.")
            return

        run_pg_dump_backup(database_public_url)

        async with conn.transaction():
            for p in matched:
                await conn.execute(
                    "UPDATE parcelas SET coordenadas = $1::json WHERE id = $2",
                    json.dumps(p["coordenadas"]), db_by_name[p["nombre"].strip().lower()],
                )
            now = datetime.now(timezone.utc)
            for p in unmatched_kml:
                await conn.execute(
                    """INSERT INTO parcelas
                       (id, nombre, tipo, variedad, superficie_ha, cabezal_riego, coordenadas, is_active, created_at, updated_at)
                       VALUES ($1, $2, $3, NULL, NULL, NULL, $4::json, true, $5, $5)""",
                    str(uuid.uuid4()), p["nombre"], p["tipo"], json.dumps(p["coordenadas"]), now,
                )

        print(f"\nActualizado: {len(matched)} filas. Insertado: {len(unmatched_kml)} filas nuevas.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
