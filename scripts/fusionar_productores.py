"""Fusiona el productor duplicado HIDALGO en HIDALGO R (Raul) y borra HIDALGO.

Contexto: la carga inicial dejo dos filas en `productores` para la misma
persona. Los 3 "SANCHEZ" (MARCELO SANCHEZ, SANCHEZ, SANCHEZ F) se dejan como
estan por decision de Fausto (2026-10-15): no se tocan.

Mapeo armado a mano (no se detecta nada por similitud). Antes de escribir se
verifica que los ids sigan existiendo con el conteo de uso esperado; si algo
cambio, aborta sin escribir.

Usage (desde el venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  python scripts\\fusionar_productores.py                       # DRY RUN contra produccion
  python scripts\\fusionar_productores.py --commit              # aplica en produccion (hace pg_dump antes)
  python scripts\\fusionar_productores.py --url-key DATABASE_URL --dbname los_lirios_prod_copy --commit
      # contra una copia local de produccion (prueba; no hace falta backup)

Todo corre en una sola transaccion: si el DELETE final falla por una
referencia sin re-apuntar, se revierte todo.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

import asyncpg

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"

CANONICO = {"id": "9f17d557-09cd-4bfc-953c-50d67e2113d5", "nombre": "HIDALGO R"}
DUPLICADO = {"id": "bf5b6c1c-7932-4a90-8f1e-0051cefd225c", "nombre": "HIDALGO"}
# (tabla, columna) que referencian productores.id
REFERENCIAS = [("registros_cosecha", "productor_id"), ("ingresos_pasero", "productor_id")]
USO_ESPERADO_DUPLICADO = {"registros_cosecha": 2, "ingresos_pasero": 0}


def leer_conexion(url_key: str, dbname: str | None) -> dict:
    texto = ENV_FILE.read_text(encoding="utf-8")
    m = re.search(rf"^\s*{url_key}\s*=\s*(.+)$", texto, re.M)
    if not m:
        sys.exit(f"{url_key} no esta en backend/.env")
    url = m.group(1).strip().strip("\"'")
    p = re.match(r"postgresql(\+\w+)?://([^:]+):([^@]+)@([^:/]+)(:(\d+))?/([^?\s]+)", url)
    if not p:
        sys.exit(f"{url_key} con formato inesperado")
    return {
        "user": unquote(p[2]), "password": unquote(p[3]), "host": p[4],
        "port": int(p[6] or 5432), "database": dbname or p[7],
    }


def backup(conn: dict) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    destino = BACKUP_DIR / f"antes_fusionar_productores_{datetime.now():%Y%m%d_%H%M%S}.dump"
    env = dict(os.environ, PGPASSWORD=conn["password"], PGSSLMODE="prefer")
    r = subprocess.run(
        ["pg_dump", "-Fc", "-h", conn["host"], "-p", str(conn["port"]), "-U", conn["user"],
         "-d", conn["database"], "-f", str(destino)],
        env=env, capture_output=True, text=True,
    )
    if r.returncode != 0 or not destino.exists() or destino.stat().st_size < 10_000:
        destino.unlink(missing_ok=True)
        sys.exit(f"pg_dump fallo, no se escribe nada: {r.stderr.strip()}")
    print(f"Backup: {destino} ({destino.stat().st_size / 1e6:.2f} MB)")
    return destino


async def main(commit: bool, url_key: str, dbname: str | None, con_backup: bool) -> None:
    conn_cfg = leer_conexion(url_key, dbname)
    print(f"Base: {conn_cfg['host']}:{conn_cfg['port']}/{conn_cfg['database']}  ({'COMMIT' if commit else 'DRY RUN'})")
    conn = await asyncpg.connect(**conn_cfg, ssl="prefer")
    try:
        for fila, esperado in ((CANONICO, None), (DUPLICADO, None)):
            nombre = await conn.fetchval("SELECT nombre FROM productores WHERE id = $1", fila["id"])
            if nombre != fila["nombre"]:
                sys.exit(f"El id {fila['id']} deberia ser {fila['nombre']!r} y es {nombre!r}: aborto")
        uso = {}
        for tabla, col in REFERENCIAS:
            uso[tabla] = await conn.fetchval(f"SELECT count(*) FROM {tabla} WHERE {col} = $1", DUPLICADO["id"])
        if uso != USO_ESPERADO_DUPLICADO:
            sys.exit(f"Uso de {DUPLICADO['nombre']} cambio: esperado {USO_ESPERADO_DUPLICADO}, hay {uso}: aborto")
        print(f"{DUPLICADO['nombre']} -> {CANONICO['nombre']}: {uso}")

        if not commit:
            print("DRY RUN: no se escribio nada. Pasa --commit para aplicar.")
            return
        if con_backup:
            backup(conn_cfg)
        async with conn.transaction():
            for tabla, col in REFERENCIAS:
                n = await conn.execute(f"UPDATE {tabla} SET {col} = $1 WHERE {col} = $2", CANONICO["id"], DUPLICADO["id"])
                print(f"  {tabla}: {n}")
            print("  productores:", await conn.execute("DELETE FROM productores WHERE id = $1", DUPLICADO["id"]))
        restantes = await conn.fetchval("SELECT count(*) FROM productores")
        propias = await conn.fetchval(
            "SELECT count(*) FROM registros_cosecha WHERE productor_id = $1", CANONICO["id"])
        print(f"Listo. Productores: {restantes}. Cosechas de {CANONICO['nombre']}: {propias}")
    finally:
        await conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--url-key", default="DATABASE_PUBLIC_URL")
    ap.add_argument("--dbname", default=None)
    args = ap.parse_args()
    # Sobre produccion (clave publica) siempre se saca backup antes de escribir.
    asyncio.run(main(args.commit, args.url_key, args.dbname, con_backup=args.url_key == "DATABASE_PUBLIC_URL"))
