"""Auditoria de la nomenclatura real de valvulas/cuadrantes de riego.

Cruza 4 fuentes para preparar la tabla de equivalencia valvula-real <-> parcela/cabezal:
  1. Los Lirios 2026.kml           -> poligonos reales de cada Parral (fuente de verdad geometrica)
  2. layers/Valvulas.geojson       -> 57 valvulas reales (Nombre de Valvula, Cabezal)
  3. layers/Cuadrantes de Riego.geojson -> 57 cuadrantes (Nombre de Cuadrante, Valvula Correspondiente, Cabezal)
  4. Tablas hardcodeadas hoy vigentes (frontend/lib/api/riego.ts, mobile/lib/types.ts) + Parcela.cabezal_riego en DB

No escribe nada -- solo imprime un reporte para revisar antes de decidir la
tabla de equivalencia final (backend/app/models/produccion.py::Valvula, a crear
en la fase siguiente).

Usage (desde la venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  python scripts\\auditoria_valvulas_geojson.py
  python scripts\\auditoria_valvulas_geojson.py --no-db   # salta el cruce con Parcela.cabezal_riego
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "backend" / ".env"
KML_FILE = ROOT / "frontend" / "public" / "Los Lirios 2026.kml"
LAYERS_DIR = ROOT / "frontend" / "public" / "layers"
VALVULAS_GEOJSON = LAYERS_DIR / "Valvulas.geojson"
CUADRANTES_GEOJSON = LAYERS_DIR / "Cuadrantes de Riego.geojson"

KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}

# Snapshot de las tablas hardcodeadas hoy vigentes -- copiadas a mano para
# comparar, no se importan (son TS). Fuente: frontend/lib/api/riego.ts y
# mobile/lib/types.ts (idénticas entre sí salvo por este comentario).
VALVULAS_POR_PARCELA_HARDCODED: dict[str, int] = {
    "Parral Sult.": 4, "Parral 9": 2, "Parral 4": 2, "Parral 5": 2, "Parral 2": 2,
    "Parral 10": 3, "Parral 6": 4, "Parral 11": 4, "Parral 7": 4, "Parral 16": 2,
    "Parral 13": 3, "Parral 15": 2, "Parral 14": 3, "Parral 21": 4, "Parral 12": 3,
    "Parral 8": 3, "Parral SYR-RG": 3, "Parral Bond. Viejo": 2, "Parral Bond. Nuevo": 2,
}

# mobile/lib/types.ts::CABEZAL_VALVULAS -- "de planilla", cabezal -> parrales que alimenta.
CABEZAL_PARRALES_HARDCODED: dict[str, list[str]] = {
    "1": ["2", "4", "5", "9", "Sult."],
    "2": ["6", "7", "10", "11"],
    "3": ["12", "13", "14", "15", "16", "21"],
    "4": ["8", "BV", "BN", "SYR-RG"],
}

EPS_BBOX = 0.0002  # ~20m de margen para detectar candidatos "casi adentro" (casos límite)


def read_env_var(key: str) -> str | None:
    if not ENV_FILE.exists():
        return None
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


# ── Geometria ────────────────────────────────────────────────────────────────

def point_in_polygon(pt: tuple[float, float], poly: list[tuple[float, float]]) -> bool:
    """Ray casting estandar. pt y poly en (lon, lat)."""
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


def bbox(poly: list[tuple[float, float]], eps: float = 0.0) -> tuple[float, float, float, float]:
    lons = [p[0] for p in poly]
    lats = [p[1] for p in poly]
    return (min(lons) - eps, max(lons) + eps, min(lats) - eps, max(lats) + eps)


def bbox_contains(pt: tuple[float, float], poly: list[tuple[float, float]], eps: float) -> bool:
    x, y = pt
    minx, maxx, miny, maxy = bbox(poly, eps)
    return minx <= x <= maxx and miny <= y <= maxy


def polygon_centroid(poly: list[tuple[float, float]]) -> tuple[float, float]:
    lons = [p[0] for p in poly]
    lats = [p[1] for p in poly]
    return (sum(lons) / len(lons), sum(lats) / len(lats))


# ── Carga de datos ───────────────────────────────────────────────────────────

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
        pts = []
        for chunk in coords_el.text.split():
            lng_str, lat_str, *_ = chunk.split(",")
            pts.append((float(lng_str), float(lat_str)))
        parrales[name] = pts
    return parrales


def load_geojson_features(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["features"]


# ── Reporte ──────────────────────────────────────────────────────────────────

async def fetch_cabezal_riego_por_parcela(database_public_url: str) -> dict[str, str | None]:
    import asyncpg
    conn = await asyncpg.connect(asyncpg_url(database_public_url))
    try:
        rows = await conn.fetch("SELECT nombre, cabezal_riego FROM parcelas WHERE tipo = 'parral'")
        return {r["nombre"]: r["cabezal_riego"] for r in rows}
    finally:
        await conn.close()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-db", action="store_true", help="no cruzar contra Parcela.cabezal_riego (solo archivos)")
    args = ap.parse_args()

    parrales = load_kml_parrales()
    print(f"KML: {len(parrales)} poligonos de Parral cargados\n")

    valvulas = load_geojson_features(VALVULAS_GEOJSON)
    cuadrantes = load_geojson_features(CUADRANTES_GEOJSON)
    print(f"GeoJSON: {len(valvulas)} valvulas, {len(cuadrantes)} cuadrantes\n")

    cabezal_riego_db: dict[str, str | None] = {}
    if not args.no_db:
        db_url = read_env_var("DATABASE_PUBLIC_URL")
        if db_url:
            try:
                cabezal_riego_db = await fetch_cabezal_riego_por_parcela(db_url)
            except Exception as exc:  # noqa: BLE001 -- reporte best-effort, no bloquea el resto
                print(f"(no se pudo leer Parcela.cabezal_riego de la DB: {exc})\n")
        else:
            print("(DATABASE_PUBLIC_URL no encontrada en backend/.env -- se salta el cruce con la DB)\n")

    # ── Asignación espacial válvula -> parral ──────────────────────────────
    resultados = []  # dict por válvula
    for f in valvulas:
        props = f["properties"]
        nombre_valvula = props["Nombre de Valvula"]
        cabezal_geojson = props["Cabezal"]
        lon, lat = f["geometry"]["coordinates"]
        pt = (lon, lat)

        pip_matches = [nombre for nombre, poly in parrales.items() if point_in_polygon(pt, poly)]
        bbox_matches = [nombre for nombre, poly in parrales.items() if bbox_contains(pt, poly, EPS_BBOX)]

        confianza = "ALTA" if len(pip_matches) == 1 and set(bbox_matches) == set(pip_matches) else "BAJA"
        resultados.append({
            "fid": props["fid"],
            "nombre": nombre_valvula,
            "cabezal_geojson": cabezal_geojson,
            "lon": lon, "lat": lat,
            "pip_matches": pip_matches,
            "bbox_matches": bbox_matches,
            "confianza": confianza,
        })

    # Orden oeste->este dentro de cada parral (por longitud ascendente = menos negativo = más al este,
    # así que oeste->este es orden ascendente de longitud... OJO: acá lon es negativa, "más al oeste"
    # = más negativo = menor valor numérico, así que orden ascendente de lon YA es oeste->este).
    por_parral: dict[str, list[dict]] = {}
    for r in resultados:
        parral = r["pip_matches"][0] if len(r["pip_matches"]) == 1 else "AMBIGUO"
        por_parral.setdefault(parral, []).append(r)
    for parral, lst in por_parral.items():
        lst.sort(key=lambda r: r["lon"])
        for i, r in enumerate(lst, start=1):
            r["orden_oeste_este_calculado"] = i

    # ── Reporte por parral ──────────────────────────────────────────────────
    print("=" * 100)
    print("REPORTE POR PARRAL (spatial join vs. tabla hardcodeada vs. DB)")
    print("=" * 100)
    todos_los_parrales = sorted(set(list(por_parral.keys()) + list(parrales.keys())))
    for parral in todos_los_parrales:
        if parral == "AMBIGUO":
            continue
        valvs = por_parral.get(parral, [])
        nombre_corto = parral.replace("Parral ", "")
        esperado = VALVULAS_POR_PARCELA_HARDCODED.get(parral)
        cabezales_geojson = sorted(set(str(v["cabezal_geojson"]) for v in valvs))
        cabezal_db = cabezal_riego_db.get(parral, "?")
        flag = ""
        if esperado is not None and esperado != len(valvs):
            flag += f"  [!] cantidad no coincide (tabla hardcodeada dice {esperado}, GeoJSON tiene {len(valvs)})"
        if len(cabezales_geojson) > 1:
            flag += f"  [!] valvulas repartidas en mas de 1 cabezal: {cabezales_geojson}"
        if cabezal_db not in (None, "?") and cabezales_geojson and cabezal_db not in cabezales_geojson:
            flag += f"  [!] Parcela.cabezal_riego={cabezal_db!r} no coincide con cabezal(es) del GeoJSON {cabezales_geojson}"

        print(f"\n{parral} -- {len(valvs)} valvula(s) [DB cabezal_riego={cabezal_db}]{flag}")
        for v in sorted(valvs, key=lambda r: r["orden_oeste_este_calculado"]):
            conf = "" if v["confianza"] == "ALTA" else "  <-- BAJA CONFIANZA (revisar)"
            print(f"    orden {v['orden_oeste_este_calculado']}: \"{v['nombre']}\" (fid {v['fid']}, cabezal GeoJSON {v['cabezal_geojson']}){conf}")

    ambiguas = por_parral.get("AMBIGUO", [])
    if ambiguas:
        print("\n" + "=" * 100)
        print(f"VALVULAS AMBIGUAS -- {len(ambiguas)} (no cayeron en exactamente 1 poligono de parral)")
        print("=" * 100)
        for v in ambiguas:
            print(f"  \"{v['nombre']}\" (fid {v['fid']}, cabezal GeoJSON {v['cabezal_geojson']}) "
                  f"-- candidatos por bbox: {v['bbox_matches']} | point-in-polygon: {v['pip_matches']}")

    # ── Duplicados de nombre de válvula ──────────────────────────────────────
    nombres_valvula = [v["nombre"] for v in resultados]
    dup_valvula = sorted({n for n in nombres_valvula if nombres_valvula.count(n) > 1})
    print("\n" + "=" * 100)
    print("CALIDAD DE DATOS")
    print("=" * 100)
    if dup_valvula:
        print(f"Nombres de valvula duplicados en Valvulas.geojson: {dup_valvula}")
        for n in dup_valvula:
            fids = [v["fid"] for v in resultados if v["nombre"] == n]
            print(f"  \"{n}\": fids {fids}")
    else:
        print("Sin nombres de valvula duplicados.")

    # ── Cuadrantes: correspondencia con válvulas ─────────────────────────────
    valvula_names = {v["nombre"] for v in resultados}
    correspondencias = [c["properties"]["Valvula Correspondiente"] for c in cuadrantes]
    dup_correspondencia = sorted({n for n in correspondencias if correspondencias.count(n) > 1})
    huerfanas = sorted(set(correspondencias) - valvula_names)
    sin_cuadrante = sorted(valvula_names - set(correspondencias))

    print(f"\nCuadrantes cuya \"Valvula Correspondiente\" se repite (mas de 1 cuadrante -> misma valvula): {dup_correspondencia}")
    for n in dup_correspondencia:
        cs = [c["properties"]["Nombre de Cuadrante"] for c in cuadrantes if c["properties"]["Valvula Correspondiente"] == n]
        print(f"  valvula \"{n}\" referenciada por cuadrantes: {cs}")
    print(f"\n\"Valvula Correspondiente\" de cuadrante que no existe en Valvulas.geojson: {huerfanas}")
    print(f"Valvulas sin ningun cuadrante que las referencie: {sin_cuadrante}")

    # ── Resumen de cabezales (comparación con CABEZAL_PARRALES_HARDCODED) ───
    print("\n" + "=" * 100)
    print("CABEZALES: GeoJSON (agregado por parral) vs. mobile/lib/types.ts::CABEZAL_VALVULAS")
    print("=" * 100)
    for cabezal, parrales_esperados in CABEZAL_PARRALES_HARDCODED.items():
        parrales_geojson_de_este_cabezal = sorted({
            p.replace("Parral ", "") for p, valvs in por_parral.items()
            if p != "AMBIGUO" and any(str(v["cabezal_geojson"]) == cabezal for v in valvs)
        })
        esperados_norm = sorted(parrales_esperados)
        match = "OK" if parrales_geojson_de_este_cabezal == esperados_norm else "DIFIERE"
        print(f"Cabezal {cabezal}: esperado {esperados_norm} | GeoJSON real {parrales_geojson_de_este_cabezal}  [{match}]")

    print("\nFIN DEL REPORTE -- revisar los [!] y BAJA CONFIANZA antes de construir la tabla de equivalencia definitiva.")


if __name__ == "__main__":
    asyncio.run(main())
