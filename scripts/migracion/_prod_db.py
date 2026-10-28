"""Shared helpers for the prod-touching scripts in this folder: where the
database URL comes from, and the `SI` confirmation gate before any write.
Never prints the URL or credentials (only the hostname)."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ENV_FILE = ROOT / "backend" / ".env"
PROD_ENV_FILE = HERE / ".env.prod"  # optional, gitignored -- see README
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _extract_database_url(text: str) -> str | None:
    for line in text.splitlines():
        if line.strip().startswith("DATABASE_URL"):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            return re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    return None


def read_database_url(skip_prod: bool) -> tuple[str, str]:
    """(url, source label). Same order as the other scripts: .env.prod, env vars,
    backend/.env. `skip_prod` drops the .env.prod step (dry runs against local)."""
    if not skip_prod and PROD_ENV_FILE.exists():
        url = _extract_database_url(PROD_ENV_FILE.read_text(encoding="utf-8"))
        if url:
            return url, ".env.prod (producción)"
    env_url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if env_url:
        return re.sub(r"^postgresql\+\w+://", "postgresql://", env_url), "variable de entorno"
    url = _extract_database_url(ENV_FILE.read_text(encoding="utf-8"))
    if url:
        return url, f"{ENV_FILE} (local/staging)"
    raise RuntimeError(f"DATABASE_URL not found in {ENV_FILE}")


def confirmar_apply(host: str | None, *, local: bool, leer: Callable[[str], str] = input) -> None:
    """Gate before the first write. With --local the host was already checked to
    be localhost, so no prompt; otherwise show only the hostname (never the URL
    or credentials) and require the literal answer `SI`. Anything else, or no
    stdin, exits with code 1."""
    if local:
        return
    print(f"\n--apply contra el host: {host}")
    try:
        respuesta = leer("Escribí SI para escribir en esa base: ")
    except EOFError:
        respuesta = ""
    if respuesta.strip() != "SI":
        print("Abortado: no se escribió nada.")
        sys.exit(1)
