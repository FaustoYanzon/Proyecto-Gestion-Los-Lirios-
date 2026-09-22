"""Genera PROJECT_MAP.md desde el estado real del repo (reemplaza al viejo
generate_map.ps1, que ya no existe -- el PROJECT_MAP.md anterior quedó
fechado 2026-06-01, describiendo 3 migraciones/4 modelos/7 routers cuando
hoy hay 42/17/24).

Introspecciona: modelos SQLAlchemy (backend/app/models/), routers FastAPI
(backend/app/api/, prefix real), migraciones de Alembic (conteo + head),
rutas de Next.js (frontend/app/**/page.tsx) y de Expo Router
(mobile/app/**/*.tsx). No lee la base de datos -- para el esquema real,
ver `generate_modelo_datos.py` / docs/sistema/Modelo de Datos.md.

No es un documento a mano: correr de nuevo después de agregar un modelo,
router, migración o pantalla nueva.

Uso:
  cd C:\\claude-projects\\los-lirios
  C:\\claude-projects\\.venv\\Scripts\\python.exe scripts\\generate_project_map.py
"""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "PROJECT_MAP.md"


def backend_models() -> dict[str, list[str]]:
    out = {}
    for f in sorted((ROOT / "backend/app/models").glob("*.py")):
        if f.name == "__init__.py":
            continue
        classes = re.findall(r"^class (\w+)\(Base\):", f.read_text(encoding="utf-8"), re.M)
        if classes:
            out[f.name] = classes
    return out


def backend_routers() -> list[tuple[str, str, str]]:
    out = []
    for f in sorted((ROOT / "backend/app/api").glob("*.py")):
        txt = f.read_text(encoding="utf-8")
        m = re.search(r'APIRouter\(\s*prefix="([^"]*)"(?:,\s*tags=\[([^\]]*)\])?', txt)
        if m:
            out.append((f.name, m.group(1) or "(sin prefix)", m.group(2) or ""))
    return out


def alembic_migrations() -> tuple[int, str]:
    versions_dir = ROOT / "backend/app/core/migrations/versions"
    revs, downs = {}, set()
    for f in versions_dir.glob("*.py"):
        txt = f.read_text(encoding="utf-8")
        m = re.search(r"^revision: str = '([a-f0-9]+)'", txt, re.M)
        d = re.search(r"^down_revision.*?=\s*'([a-f0-9]+)'", txt, re.M)
        if m:
            revs[m.group(1)] = f.name
        if d:
            downs.add(d.group(1))
    heads = set(revs) - downs
    head_desc = ", ".join(revs[h] for h in heads) if heads else "(sin head -- revisar)"
    return len(revs), head_desc


def frontend_routes() -> list[str]:
    out = []
    for f in sorted((ROOT / "frontend/app").rglob("page.tsx")):
        rel = f.relative_to(ROOT / "frontend/app").parent.as_posix()
        out.append("/" if rel == "." else "/" + rel)
    return out


def mobile_screens() -> list[str]:
    out = []
    for f in sorted((ROOT / "mobile/app").rglob("*.tsx")):
        if f.name in ("_layout.tsx",):
            continue
        out.append(f.relative_to(ROOT / "mobile/app").as_posix())
    return out


def api_client_modules() -> list[str]:
    d = ROOT / "frontend/lib/api"
    return sorted(f.name for f in d.glob("*.ts")) if d.exists() else []


def frontend_components() -> dict[str, list[str]]:
    out = {}
    d = ROOT / "frontend/components"
    if not d.exists():
        return out
    for sub in sorted(d.iterdir()):
        if sub.is_dir():
            out[sub.name] = sorted(f.name for f in sub.glob("*.tsx"))
    return out


def scripts_migracion() -> list[str]:
    d = ROOT / "scripts/migracion"
    return sorted(f.name for f in d.glob("*.py")) if d.exists() else []


def main() -> None:
    models = backend_models()
    routers = backend_routers()
    n_migrations, head = alembic_migrations()
    fe_routes = frontend_routes()
    mob_screens = mobile_screens()
    api_modules = api_client_modules()
    fe_components = frontend_components()
    migra_scripts = scripts_migracion()

    out = []
    out.append("# PROJECT MAP — Los Lirios Gestión Agrícola")
    out.append(f"> Auto-generado por `scripts/generate_project_map.py`. Correr de nuevo tras cualquier cambio "
                f"estructural (modelo/router/migración/pantalla nueva). **No editar a mano.**")
    out.append(f"> Última generación: {date.today().isoformat()}")
    out.append("")
    out.append("Para el esquema real de la base de datos (tablas/columnas/FKs/enums), ver "
                "`docs/sistema/Modelo de Datos.md` (`scripts/generate_modelo_datos.py`).")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## System Architecture")
    out.append("")
    out.append("```")
    out.append("repo/")
    out.append("├── backend/        FastAPI + PostgreSQL (Python 3.12)")
    out.append("├── frontend/       Next.js + React (TypeScript) — dashboard web")
    out.append("├── mobile/         Expo + React Native (TypeScript) — app de campo")
    out.append("├── scripts/        Scripts de mantenimiento, migración de datos, generadores de docs")
    out.append("└── docs/           Symlinks a la bóveda de Obsidian (C:\\Boveda Los Lirios)")
    out.append("```")
    out.append("")
    out.append("**Comunicación:** Frontend/Mobile → REST API (FastAPI) → PostgreSQL")
    out.append("**Auth:** JWT (python-jose) + bcrypt. Roles: `super_admin > gerencial > encargado > regador > obrero`")
    out.append("**Campaña:** mayo → abril (NO año calendario)")
    out.append("**Fincas:** `los_mimbres`, `media_agua`, `caucete`")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## Backend (`backend/`)")
    out.append("")
    out.append(f"**Modelos:** {len(models)} archivos, {sum(len(v) for v in models.values())} clases ORM")
    out.append("")
    out.append("| Archivo | Clases |")
    out.append("|---|---|")
    for f, classes in models.items():
        out.append(f"| `{f}` | {', '.join(classes)} |")
    out.append("")
    out.append(f"**Routers:** {len(routers)}")
    out.append("")
    out.append("| Archivo | Prefix | Tags |")
    out.append("|---|---|---|")
    for f, prefix, tags in routers:
        out.append(f"| `{f}` | `{prefix}` | {tags} |")
    out.append("")
    out.append(f"**Migraciones de Alembic:** {n_migrations} (head: `{head}`)")
    out.append("")
    out.append("**Reglas críticas:**")
    out.append("- Todos los IDs son UUID strings (`String(36)`), nunca int")
    out.append("- `await db.flush()` + `await db.refresh(obj)` tras escrituras — nunca commit en routers")
    out.append("- PATCH: `model_dump(exclude_unset=True)`")
    out.append("- Plata/cantidades: `Decimal`, nunca `float`")
    out.append("- Sub-rutas estáticas ANTES que parametrizadas (`/resumen/por-tipo` antes de `/{id}`)")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## Frontend (`frontend/`)")
    out.append("")
    out.append(f"**Rutas ({len(fe_routes)}):**")
    out.append("")
    for r in fe_routes:
        out.append(f"- `{r}`")
    out.append("")
    out.append(f"**Módulos de API client** (`frontend/lib/api/`, {len(api_modules)}): "
                + " · ".join(f"`{m}`" for m in api_modules))
    out.append("")
    out.append("**Componentes por carpeta:**")
    out.append("")
    for folder, files in fe_components.items():
        out.append(f"- `{folder}/`: " + " · ".join(files))
    out.append("")
    out.append("---")
    out.append("")
    out.append("## Mobile (`mobile/`)")
    out.append("")
    out.append(f"**Pantallas ({len(mob_screens)}):**")
    out.append("")
    for s in mob_screens:
        out.append(f"- `{s}`")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## Scripts de migración de datos (`scripts/migracion/`)")
    out.append("")
    out.append("Ver `scripts/migracion/README.md` para el detalle de cada migración corrida "
                "(cobertura, decisiones, verificación). Scripts actuales:")
    out.append("")
    for s in migra_scripts:
        out.append(f"- `{s}`")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## Conocimiento del proyecto (bóveda de Obsidian)")
    out.append("")
    out.append("Symlinkeada en `docs/` — leer el archivo relevante antes de trabajar en esa área:")
    out.append("")
    out.append("- `docs/sistema/` → `01 - Sistema`: Arquitectura, Modelo de Datos, Bugs Conocidos, Stack Técnico, Bitácora, Decisiones")
    out.append("- `docs/finanzas/` → `02 - Finanzas`: Cuentas por Pagar, Flujo de Caja, Presupuesto Anual")
    out.append("- `docs/produccion/` → `03 - Producción`: Parcelas y Fincas, Tareas Clasificadas, Campañas")
    out.append("- `docs/proyectos/` → `05 - Proyectos`: Dashboards, Sistema de Gestión Agrícola, otros proyectos")
    out.append("")
    out.append("---")
    out.append("")
    out.append("## DO NOT TOUCH")
    out.append("- `backend/.env`, `mobile/.env`")
    out.append("- `backend/app/core/migrations/versions/` (salvo para crear una migración nueva)")
    out.append("- Migraciones de Alembic ya commiteadas")
    out.append("")

    OUT_PATH.write_text("\n".join(out), encoding="utf-8")
    print(f"Escrito: {OUT_PATH}")
    print(f"{len(models)} archivos de modelos, {len(routers)} routers, {n_migrations} migraciones, "
          f"{len(fe_routes)} rutas frontend, {len(mob_screens)} pantallas mobile")


if __name__ == "__main__":
    main()
