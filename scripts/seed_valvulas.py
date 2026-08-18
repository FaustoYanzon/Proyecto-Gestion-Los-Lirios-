"""Popula la tabla `valvulas` desde Valvulas.geojson (fuente de verdad).

Reemplaza las listas hardcodeadas y duplicadas VALVULAS_POR_PARCELA/
CABEZAL_VALVULAS (frontend/lib/api/riego.ts, mobile/lib/types.ts) por el
catalogo real, cruzado espacialmente contra los poligonos de Parral del KML
(ver scripts/auditoria_valvulas_geojson.py para el reporte completo).

La asignacion parcela<-valvula es automatica por point-in-polygon salvo 3
excepciones confirmadas por Fausto el 2026-08-18 (los puntos del GeoJSON
quedaron digitalizados corridos, o la valvula riega un potrero sin parral):
  - "41","42" -> Parral 4  (el punto cae del lado de Parral 5, error de digitalizacion)
  - "31","32" -> Potrero 3 (riegan un potrero sin cuadrante/parral asociado)

Usage (desde la venv del backend):
  cd C:\\claude-projects\\los-lirios
  python scripts\\seed_valvulas.py             # DRY RUN (no escribe)
  python scripts\\seed_valvulas.py --commit    # aplica, con backup previo
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
from datetime import datetime
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"
KML_FILE = ROOT / "frontend" / "public" / "Los Lirios 2026.kml"
VALVULAS_GEOJSON = ROOT / "frontend" / "public" / "layers" / "Valvulas.geojson"

KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}

# Excepciones confirmadas manualmente (ver docstring) -- nombre de valvula -> nombre de parcela real.
OVERRIDES_PARCELA: dict[str, str] = {
    "41": "Parral 4",
    "42": "Parral 4",
    "31": "Potrero 3",
    "32": "Potrero 3",
}


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def point_in_polygon(pt: tuple[float, float], poly: list[tuple[float, float]]) -> bool:
    x, y = pt
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def load_kml_parrales() -> dict[str, list[tuple[float, float]]]:
    root = ET.parse(KML_FILE).getroot()
    parrales: dict[str, list[tuple[float, float]]] = {}
    for pm in root.findall(".//kml:Placemark", KML_NS):
        name_el = pm.find("kml:name", KML_NS)
        name = (name_el.text or "").strip() if name_el is not None else ""
        if not name.lower().startswith("parral"):
            continue
        coords_el = pm.find("kml:Polygon/kml:outerBoundaryIs/kml:LinearRing/kml:coordinates", KML_NS)
        if coords_el is None or not coords_el.text:
            continue
        pts = [
            (float(chunk.split(",")[0]), float(chunk.split(",")[1]))
            for chunk in coords_el.text.split()
        ]
        parrales[name] = pts
    return parrales


def build_valvulas(parrales: dict[str, list[tuple[float, float]]]) -> list[dict]:
    data = json.loads(VALVULAS_GEOJSON.read_text(encoding="utf-8"))
    valvulas = []
    for f in data["features"]:
        props = f["properties"]
        nombre = props["Nombre de Valvula"]
        lon, lat = f["geometry"]["coordinates"]

        if nombre in OVERRIDES_PARCELA:
            parcela_nombre = OVERRIDES_PARCELA[nombre]
        else:
            matches = [pname for pname, poly in parrales.items() if point_in_polygon((lon, lat), poly)]
            if len(matches) != 1:
                sys.exit(
                    f"ERROR: valvula \"{nombre}\" (fid {props['fid']}) no cayo en exactamente 1 "
                    f"poligono de parral ({matches}) y no tiene override manual. Correr "
                    f"scripts/auditoria_valvulas_geojson.py y agregar una excepcion en OVERRIDES_PARCELA."
                )
            parcela_nombre = matches[0]

        valvulas.append({
            "nombre": nombre,
            "parcela_nombre": parcela_nombre,
            "cabezal": props["Cabezal"],
            "lat": lat,
            "lon": lon,
        })

    # Orden oeste->este (longitud ascendente) dentro de cada parcela real.
    por_parcela: dict[str, list[dict]] = {}
    for v in valvulas:
        por_parcela.setdefault(v["parcela_nombre"], []).append(v)
    for lst in por_parcela.values():
        lst.sort(key=lambda v: v["lon"])
        for i, v in enumerate(lst, start=1):
            v["orden"] = i

    return valvulas


def run_pg_dump_backup(database_public_url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_seed_valvulas.dump"
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="aplicar (default: dry run)")
    args = ap.parse_args()

    parrales = load_kml_parrales()
    valvulas = build_valvulas(parrales)
    print(f"{len(valvulas)} valvulas a insertar, agrupadas en {len(set(v['parcela_nombre'] for v in valvulas))} parcelas.\n")
    for v in sorted(valvulas, key=lambda v: (v["parcela_nombre"], v["orden"])):
        print(f"  {v['parcela_nombre']:22s} orden {v['orden']}: \"{v['nombre']}\" cabezal {v['cabezal']}")

    database_public_url = read_env_var("DATABASE_PUBLIC_URL")
    conn = await asyncpg.connect(asyncpg_url(database_public_url))
    try:
        existentes = await conn.fetchval("SELECT count(*) FROM valvulas")
        if existentes:
            sys.exit(f"ERROR: la tabla valvulas ya tiene {existentes} filas -- este script es solo para el seed inicial.")

        parcela_rows = await conn.fetch("SELECT id, nombre FROM parcelas")
        parcela_id_by_nombre = {r["nombre"]: r["id"] for r in parcela_rows}

        faltantes = sorted({v["parcela_nombre"] for v in valvulas} - set(parcela_id_by_nombre))
        if faltantes:
            sys.exit(f"ERROR: parcelas no encontradas en la DB: {faltantes}")

        if not args.commit:
            print("\nDRY RUN -- nada escrito. Ejecutar con --commit para aplicar.")
            return

        run_pg_dump_backup(database_public_url)

        async with conn.transaction():
            for v in valvulas:
                await conn.execute(
                    """INSERT INTO valvulas
                       (id, nombre, parcela_id, cabezal, orden, lat, lon, is_active, created_at, updated_at)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, true, now(), now())""",
                    str(uuid.uuid4()), v["nombre"], parcela_id_by_nombre[v["parcela_nombre"]],
                    v["cabezal"], v["orden"], v["lat"], v["lon"],
                )
        print(f"\nInsertadas {len(valvulas)} valvulas.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
