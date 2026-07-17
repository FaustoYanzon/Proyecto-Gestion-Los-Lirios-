"""Detect and clean up duplicate rows created by the mobile double-tap
submit bug (fixed separately with a useRef guard in the wizards).

A rapid double-tap on "Confirmar" fired handleSubmit twice before the
button visually disabled (setLoading is React state, not synchronous),
producing two near-identical rows a few seconds apart. This script finds
such pairs by grouping rows on their natural business key and clustering
by created_at proximity, then (in --commit mode) keeps the oldest row of
each cluster and deletes the rest.

Usage (from backend venv, which has asyncpg installed):
  cd C:\\claude-projects\\los-lirios
  python scripts\\limpiar_duplicados.py             # DRY RUN (no writes)
  python scripts\\limpiar_duplicados.py --commit    # actually delete

Behaviour:
  - Reads DATABASE_PUBLIC_URL from backend/.env (production Railway DB —
    this cleans up rows created during the live pilot, not local dev data)
  - registros_trabajo: groups by (trabajador_nombre, tarea, parcela_id,
    fecha, cantidad, precio_unitario); within each group, rows are
    clustered by created_at using a DUP_WINDOW_SECONDS chain (a row joins
    the current cluster if it's within the window of the previous row)
  - registros_riego: groups by (cabezal, parcela_id, valvula, inicio, fin,
    responsable), same clustering
  - --commit always takes a pg_dump backup into pg_backups/ first and
    refuses to continue if the dump fails or looks too small
"""

from __future__ import annotations

import argparse
import asyncio
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import asyncpg

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"

DUP_WINDOW_SECONDS = 60

TRABAJO_KEY_COLS = ["trabajador_nombre", "tarea", "parcela_id", "fecha", "cantidad", "precio_unitario"]
RIEGO_KEY_COLS = ["cabezal", "parcela_id", "valvula", "inicio", "fin", "responsable"]


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    # asyncpg.connect wants plain postgresql:// (no SQLAlchemy driver tag)
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def cluster_by_time(rows: list[asyncpg.Record], window_seconds: int) -> list[list[asyncpg.Record]]:
    """rows must already be sorted by created_at. A row joins the current
    cluster if it's within window_seconds of the *previous* row — so a
    burst of 3+ near-simultaneous taps chains into one cluster even if the
    first and last are more than window_seconds apart."""
    clusters: list[list[asyncpg.Record]] = []
    for row in rows:
        if clusters and (row["created_at"] - clusters[-1][-1]["created_at"]).total_seconds() <= window_seconds:
            clusters[-1].append(row)
        else:
            clusters.append([row])
    return [c for c in clusters if len(c) > 1]


async def find_duplicate_groups(
    conn: asyncpg.Connection, table: str, key_cols: list[str],
) -> list[list[asyncpg.Record]]:
    cols = ", ".join(key_cols)
    rows = await conn.fetch(f"SELECT id, created_at, {cols} FROM {table} ORDER BY {cols}, created_at")

    groups: dict[tuple, list[asyncpg.Record]] = {}
    for row in rows:
        key = tuple(row[c] for c in key_cols)
        groups.setdefault(key, []).append(row)

    duplicate_clusters: list[list[asyncpg.Record]] = []
    for group_rows in groups.values():
        group_rows.sort(key=lambda r: r["created_at"])
        duplicate_clusters.extend(cluster_by_time(group_rows, DUP_WINDOW_SECONDS))
    return duplicate_clusters


def print_clusters(table: str, clusters: list[list[asyncpg.Record]]) -> None:
    print(f"\n{table}: {len(clusters)} grupo(s) de duplicados detectados")
    for i, cluster in enumerate(clusters, 1):
        print(f"  Grupo {i} ({len(cluster)} filas, se conserva la más antigua):")
        for row in cluster:
            print(f"    id={row['id']}  created_at={row['created_at'].isoformat()}")


def run_pg_dump_backup(database_public_url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_dedup.dump"
    result = subprocess.run(
        ["pg_dump", "-Fc", database_public_url, "-f", str(outfile)],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not outfile.exists() or outfile.stat().st_size < 10_000:
        print(result.stderr, file=sys.stderr)
        sys.exit("ERROR: pg_dump falló o el archivo quedó sospechosamente chico — no se borra nada.")
    print(f"\nBackup OK: {outfile} ({outfile.stat().st_size:,} bytes)")
    return outfile


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually delete (default: dry run)")
    args = parser.parse_args()

    database_public_url = read_env_var("DATABASE_PUBLIC_URL")
    conn = await asyncpg.connect(asyncpg_url(database_public_url))
    try:
        trabajo_clusters = await find_duplicate_groups(conn, "registros_trabajo", TRABAJO_KEY_COLS)
        riego_clusters = await find_duplicate_groups(conn, "registros_riego", RIEGO_KEY_COLS)

        print_clusters("registros_trabajo", trabajo_clusters)
        print_clusters("registros_riego", riego_clusters)

        n_trabajo = sum(len(c) - 1 for c in trabajo_clusters)
        n_riego = sum(len(c) - 1 for c in riego_clusters)
        print(f"\nTotal filas a borrar si se corre --commit: {n_trabajo} en registros_trabajo, "
              f"{n_riego} en registros_riego")

        if not args.commit:
            print("\nDRY RUN — nada borrado. Ejecutá con --commit para limpiar.")
            return

        run_pg_dump_backup(database_public_url)

        async with conn.transaction():
            for cluster in trabajo_clusters:
                to_delete = [r["id"] for r in cluster[1:]]  # cluster[0] = created_at más antiguo
                await conn.execute("DELETE FROM registros_trabajo WHERE id = ANY($1::text[])", to_delete)
            for cluster in riego_clusters:
                to_delete = [r["id"] for r in cluster[1:]]
                await conn.execute("DELETE FROM registros_riego WHERE id = ANY($1::text[])", to_delete)

        print(f"\nBorrado: {n_trabajo} filas de registros_trabajo, {n_riego} filas de registros_riego")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
