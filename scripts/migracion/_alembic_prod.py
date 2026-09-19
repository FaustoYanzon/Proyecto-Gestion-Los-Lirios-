"""Runner interno: aplica alembic upgrade head contra producción sin exponer
la URL (la toma de .env.prod, la mete en el proceso via env var, nunca la
imprime). Uso: backend/venv/Scripts/python.exe scripts/migracion/_alembic_prod.py [current|head]
"""
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PROD_ENV_FILE = HERE / ".env.prod"


def _extract(text: str) -> str | None:
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("DATABASE_URL") or s.startswith("DATABASE_PUBLIC_URL"):
            if "=" in s:
                url = s.split("=", 1)[1].strip().strip('"').strip("'")
                # app.core.database usa create_async_engine -- necesita el
                # driver async explícito, a diferencia de los scripts que
                # conectan con asyncpg.connect() directo (esos sí quieren
                # el postgresql:// plano).
                if url.startswith("postgresql://"):
                    url = "postgresql+asyncpg://" + url[len("postgresql://"):]
                else:
                    url = re.sub(r"^postgresql\+\w+://", "postgresql+asyncpg://", url)
                return url
    return None


url = _extract(PROD_ENV_FILE.read_text(encoding="utf-8"))
if not url:
    sys.exit("ERROR: no DATABASE_URL en .env.prod")

os.environ["DATABASE_URL"] = url
os.chdir(ROOT / "backend")
sys.path.insert(0, str(ROOT / "backend"))

from alembic.config import Config
from alembic import command

cfg = Config(str(ROOT / "backend" / "alembic.ini"))
action = sys.argv[1] if len(sys.argv) > 1 else "current"
if action == "current":
    command.current(cfg, verbose=True)
elif action == "head":
    command.upgrade(cfg, "head")
    print("upgrade head OK (produccion)")
else:
    sys.exit(f"accion desconocida: {action}")
