"""Carga `valvulas.superficie_ha` desde los poligonos de "Cuadrantes de Riego.geojson".

Cada cuadrante trae `Valvula Correspondiente` (= `valvulas.nombre`). La superficie
es la base del calculo de producto/stock al confirmar una orden de aplicacion por
valvula. Antes de escribir, imprime por parcela la suma de sus valvulas contra
`parcelas.superficie_ha` para detectar cuadrantes mal dibujados.

Usage (desde la venv del backend):
  cd C:\\claude-projects\\los-lirios
  python scripts\\cargar_superficie_valvulas.py                      # DRY RUN contra la DB local
  python scripts\\cargar_superficie_valvulas.py --aplicar            # escribe en la DB local
  python scripts\\cargar_superficie_valvulas.py --db prod            # DRY RUN contra produccion
  python scripts\\cargar_superficie_valvulas.py --db prod --aplicar  # produccion, con backup previo
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
import subprocess
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"
CUADRANTES_GEOJSON = ROOT / "frontend" / "public" / "layers" / "Cuadrantes de Riego.geojson"

M_POR_GRADO_LAT = 111_320.0
TOLERANCIA_PARCELA_PCT = 5.0


def area_ha(anillo: list[list[float]]) -> Decimal:
    """Area en hectareas de un anillo [lon, lat] WGS84 (formula del agrimensor
    sobre una proyeccion equirectangular local; error < 0.5 % a escala de finca)."""
    lat0 = sum(p[1] for p in anillo) / len(anillo)
    m_por_grado_lon = M_POR_GRADO_LAT * math.cos(math.radians(lat0))
    pts = [(p[0] * m_por_grado_lon, p[1] * M_POR_GRADO_LAT) for p in anillo]
    doble_area = sum(
        x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1])
    )
    return (Decimal(str(abs(doble_area) / 2.0)) / Decimal(10_000)).quantize(Decimal("0.0001"))


# Valvulas sin cuadrante en el GeoJSON, con la superficie que confirmo Fausto (2026-10-23):
# 31 y 32 riegan Potrero 3 (2,20 ha declaradas) y se reparten 1,10 ha cada una.
EXCEPCIONES_HA: dict[str, Decimal] = {
    "31": Decimal("1.1000"),
    "32": Decimal("1.1000"),
}


def superficies_por_valvula() -> dict[str, Decimal]:
    """nombre de valvula -> ha: los cuadrantes del GeoJSON mas las EXCEPCIONES_HA.
    Una excepcion nunca reemplaza a un cuadrante real."""
    return {**EXCEPCIONES_HA, **superficies_de_cuadrantes()}


def superficies_de_cuadrantes() -> dict[str, Decimal]:
    """nombre de valvula -> ha (suma si una valvula tuviera mas de un cuadrante)."""
    data = json.loads(CUADRANTES_GEOJSON.read_text(encoding="utf-8"))
    resultado: dict[str, Decimal] = {}
    for feat in data["features"]:
        nombre = str(feat["properties"]["Valvula Correspondiente"])
        geom = feat["geometry"]
        poligonos = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for rings in poligonos:
            resultado[nombre] = resultado.get(nombre, Decimal(0)) + area_ha(rings[0])
    return resultado


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def run_pg_dump_backup(url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_superficie_valvulas.dump"
    result = subprocess.run(["pg_dump", "-Fc", url, "-f", str(outfile)], capture_output=True, text=True)
    if result.returncode != 0 or not outfile.exists() or outfile.stat().st_size < 10_000:
        print(result.stderr, file=sys.stderr)
        sys.exit("ERROR: pg_dump fallo o el archivo quedo sospechosamente chico -- no se escribe nada.")
    print(f"\nBackup OK: {outfile} ({outfile.stat().st_size:,} bytes)")
    return outfile


async def main() -> None:
    import asyncpg

    ap = argparse.ArgumentParser()
    ap.add_argument("--db", choices=["local", "prod"], default="local")
    ap.add_argument("--aplicar", action="store_true", help="escribir (default: dry run)")
    args = ap.parse_args()

    url = read_env_var("DATABASE_PUBLIC_URL" if args.db == "prod" else "DATABASE_URL")
    superficies = superficies_por_valvula()

    conn = await asyncpg.connect(asyncpg_url(url))
    try:
        filas = await conn.fetch(
            """SELECT v.nombre AS valvula, p.nombre AS parcela, p.superficie_ha AS parcela_ha
               FROM valvulas v JOIN parcelas p ON p.id = v.parcela_id
               WHERE v.is_active ORDER BY p.nombre, v.orden"""
        )
        nombres_db = {r["valvula"] for r in filas}
        print(f"DB: {args.db} · {len(filas)} valvulas activas · {len(superficies)} cuadrantes\n")

        sin_cuadrante = sorted(nombres_db - set(superficies))
        sin_valvula = sorted(set(superficies) - nombres_db)
        if sin_cuadrante:
            print(f"!! Valvulas SIN cuadrante (quedaran con superficie NULL): {sin_cuadrante}")
        if sin_valvula:
            print(f"!! Cuadrantes SIN valvula en la DB (se ignoran): {sin_valvula}")

        por_parcela: dict[str, dict] = {}
        for r in filas:
            d = por_parcela.setdefault(r["parcela"], {"ha": r["parcela_ha"], "suma": Decimal(0), "n": 0})
            if r["valvula"] in superficies:
                d["suma"] += superficies[r["valvula"]]
                d["n"] += 1

        print(f"\n{'Parcela':22s} {'valv':>4s} {'suma ha':>9s} {'parcela ha':>11s} {'dif %':>7s}")
        hay_desvio = False
        for parcela, d in sorted(por_parcela.items()):
            if d["ha"]:
                dif = (float(d["suma"]) - float(d["ha"])) / float(d["ha"]) * 100
                marca = "  <-- REVISAR" if abs(dif) > TOLERANCIA_PARCELA_PCT else ""
                hay_desvio |= bool(marca)
                print(f"{parcela:22s} {d['n']:4d} {d['suma']:9.4f} {float(d['ha']):11.4f} {dif:+7.1f}{marca}")
            else:
                print(f"{parcela:22s} {d['n']:4d} {d['suma']:9.4f} {'(sin ha)':>11s}")
        if hay_desvio:
            print(f"\nHay parcelas con desvio > {TOLERANCIA_PARCELA_PCT:.0f} %: revisar con Fausto antes de aplicar.")

        if not args.aplicar:
            print("\nDRY RUN -- nada escrito. Ejecutar con --aplicar para escribir.")
            return

        if args.db == "prod":
            run_pg_dump_backup(url)

        async with conn.transaction():
            for nombre in nombres_db & set(superficies):
                await conn.execute(
                    "UPDATE valvulas SET superficie_ha = $1, updated_at = now() WHERE nombre = $2",
                    superficies[nombre], nombre,
                )
        print(f"\nActualizadas {len(nombres_db & set(superficies))} valvulas.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
