"""Read-only report of orphan media in Cloudinary.

An orphan is an asset under one of the app's deletable prefixes
(fotos_parcela/, fotos_ordenes_aplicacion/, informes_analisis/) that no DB row
references. Before feat/cloudinary-borrado (2026-10-31) deleting a row left its
file behind; this script measures that backlog. It NEVER deletes anything:
only SELECTs on the DB and GETs on the Cloudinary Admin API.

Also reports (informational) DB URLs whose asset no longer exists in Cloudinary.
Assets younger than --min-age-hours are listed apart: an upload can be in flight
(file uploaded, row not committed yet) and must not be judged an orphan.

Credentials are read here, never printed: DB URL via _prod_db.py, Cloudinary
CLOUDINARY_* from the environment or backend/.env. Only host and cloud name are
shown (the cloud name is already public in every media URL).

Usage (repo root, venv python):
  backend/venv/Scripts/python.exe scripts/migracion/reporte_huerfanos_cloudinary.py
  backend/venv/Scripts/python.exe scripts/migracion/reporte_huerfanos_cloudinary.py --local
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import asyncpg
import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
BACKEND = HERE.parent.parent / "backend"
sys.path.insert(0, str(BACKEND))
# `app.core.config` loads `.env` relative to the cwd; importing from the repo root
# would fail on the required settings. Reusing parse_media_url keeps the report
# in lockstep with what the real deletion considers "ours".
os.chdir(BACKEND)
from _prod_db import ENV_FILE, read_database_url  # noqa: E402
from app.core.cloudinary_client import parse_media_url  # noqa: E402

PREFIXES = ("fotos_parcela/", "fotos_ordenes_aplicacion/", "informes_analisis/")
RESOURCE_TYPES = ("image", "raw", "video")
URL_QUERIES = (
    ("fotos_parcela.url", "SELECT url FROM fotos_parcela WHERE url IS NOT NULL"),
    ("fotos_registros_fitosanitarios.url",
     "SELECT url FROM fotos_registros_fitosanitarios WHERE url IS NOT NULL"),
    ("analisis_calidad.informe_url",
     "SELECT informe_url FROM analisis_calidad WHERE informe_url IS NOT NULL"),
)


def read_cloudinary_config() -> tuple[str, str, str]:
    values = {k: os.environ.get(k) for k in
              ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET")}
    if not all(values.values()) and ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            key, sep, val = line.partition("=")
            key = key.strip()
            if sep and key in values and not values[key]:
                values[key] = val.strip().strip('"').strip("'")
    if not all(values.values()):
        raise SystemExit("ERROR: faltan CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET (entorno o backend/.env)")
    return values["CLOUDINARY_CLOUD_NAME"], values["CLOUDINARY_API_KEY"], values["CLOUDINARY_API_SECRET"]


async def list_assets(client: httpx.AsyncClient, cloud: str, auth: tuple[str, str]) -> list[dict]:
    """Every asset under PREFIXES, all resource types, following next_cursor."""
    assets: list[dict] = []
    for rtype in RESOURCE_TYPES:
        for prefix in PREFIXES:
            cursor = None
            while True:
                params = {"prefix": prefix, "max_results": 500}
                if cursor:
                    params["next_cursor"] = cursor
                resp = await client.get(
                    f"https://api.cloudinary.com/v1_1/{cloud}/resources/{rtype}/upload",
                    params=params, auth=auth,
                )
                if resp.status_code != 200:
                    raise SystemExit(f"ERROR: Cloudinary {rtype}/{prefix} -> HTTP {resp.status_code}")
                body = resp.json()
                for r in body.get("resources", []):
                    r["_rtype"] = rtype
                    assets.append(r)
                cursor = body.get("next_cursor")
                if not cursor:
                    break
    return assets


def human(n: int) -> str:
    return f"{n / 1024 / 1024:.2f} MB"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="use the local dev database")
    parser.add_argument("--min-age-hours", type=int, default=24)
    args = parser.parse_args()

    url, source = read_database_url(skip_prod=args.local)
    host = urlparse(url).hostname
    if args.local and host not in ("localhost", "127.0.0.1", "::1"):
        print("ERROR: --local pero la base resuelta no está en localhost")
        return 1
    cloud, api_key, api_secret = read_cloudinary_config()
    print(f"DB: {source} | host: {host} | Cloudinary cloud: {cloud} | SOLO LECTURA")

    referenced: dict[str, str] = {}  # public_id -> where it is referenced
    foreign = 0
    conn = await asyncpg.connect(url)
    try:
        for label, query in URL_QUERIES:
            rows = await conn.fetch(query)
            for r in rows:
                parsed = parse_media_url(r[0])
                if parsed is None or parsed[0] != cloud:
                    foreign += 1
                    continue
                referenced[parsed[2]] = label
            print(f"  {label}: {len(rows)} filas")
    finally:
        await conn.close()
    if foreign:
        print(f"  (URLs de otra cuenta/carpeta, ignoradas: {foreign})")

    async with httpx.AsyncClient(timeout=60) as client:
        assets = await list_assets(client, cloud, (api_key, api_secret))

    cutoff = datetime.now(timezone.utc) - timedelta(hours=args.min_age_hours)
    by_id = {a["public_id"]: a for a in assets}
    orphans, recent = [], []
    for a in assets:
        if a["public_id"] in referenced:
            continue
        created = datetime.fromisoformat(a["created_at"].replace("Z", "+00:00"))
        (recent if created > cutoff else orphans).append(a)
    missing = sorted(pid for pid in referenced if pid not in by_id)

    print(f"\nAssets en Cloudinary bajo los prefijos: {len(assets)} ({human(sum(a.get('bytes', 0) for a in assets))})")
    print(f"Referenciados por la base: {len(referenced)}")
    print(f"HUÉRFANOS (sin fila, más viejos que {args.min_age_hours}h): {len(orphans)} "
          f"({human(sum(a.get('bytes', 0) for a in orphans))})")
    for prefix in PREFIXES:
        sub = [a for a in orphans if a["public_id"].startswith(prefix)]
        print(f"  {prefix:<28} {len(sub):>4} ({human(sum(a.get('bytes', 0) for a in sub))})")
    for a in sorted(orphans, key=lambda x: x["created_at"])[:50]:
        print(f"    - {a['_rtype']:<5} {a['public_id']} · {a['created_at'][:10]} · {a.get('bytes', 0)} B")
    if len(orphans) > 50:
        print(f"    ... y {len(orphans) - 50} más")
    if recent:
        print(f"Sin fila pero recientes (posible subida en curso, no cuentan): {len(recent)}")
    print(f"Filas cuyo archivo ya no está en Cloudinary (informativo): {len(missing)}")
    for pid in missing[:20]:
        print(f"    - {pid} ({referenced[pid]})")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
