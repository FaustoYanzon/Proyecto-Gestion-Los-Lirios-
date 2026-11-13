"""pg_dump (custom format) of the production database into C:\\claude-projects\\pg_backups.

Read-only against production. The URL comes from .env.prod via _prod_db.py and
is passed to pg_dump through the PGDATABASE-free `--dbname` argument inside the
process only; it is never printed (only the host name).

Usage (from the repo root, venv python):
  backend/venv/Scripts/python.exe scripts/migracion/backup_prod.py
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prod_db import ROOT, read_database_url  # noqa: E402

BACKUP_DIR = ROOT.parent / "pg_backups"
MIN_BYTES = 100_000  # a real dump is far larger; smaller means pg_dump failed silently


def main() -> int:
    url, source = read_database_url(skip_prod=False)
    host = urlparse(url).hostname
    print(f"Fuente: {source} | host: {host}")
    BACKUP_DIR.mkdir(exist_ok=True)
    outfile = BACKUP_DIR / f"loslirios_prod_{datetime.now():%Y%m%d_%H%M%S}.dump"
    result = subprocess.run(["pg_dump", "-Fc", url, "-f", str(outfile)], capture_output=True, text=True)
    if result.returncode != 0:
        # stderr may echo connection details: show only the last line, scrubbed of the URL
        ultimo = (result.stderr.strip().splitlines() or ["(sin salida)"])[-1].replace(url, "<url>")
        print(f"ERROR: pg_dump falló: {ultimo}")
        outfile.unlink(missing_ok=True)
        return 1
    size = outfile.stat().st_size
    if size < MIN_BYTES:
        print(f"ERROR: el dump pesa {size} bytes, sospechosamente chico.")
        return 1
    print(f"OK: {outfile} ({size / 1_048_576:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
