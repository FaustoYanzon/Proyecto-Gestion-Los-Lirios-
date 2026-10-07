# Los Lirios — Sistema de Gestión Agrícola

Finca vitivinícola (Mendoza, AR). **En producción, piloto en curso.** Backend FastAPI, web Next.js, app Expo (Android + iOS).
Campaña = mayo → abril (NO año calendario). Fincas: `los_mimbres`, `media_agua`, `caucete`.
Mapa estructural completo → `PROJECT_MAP.md` (auto-generado). Leelo antes de explorar archivos.

## Stack
- `backend/` — Python 3.12, FastAPI, SQLAlchemy 2 async, PostgreSQL, Alembic, Pydantic v2, JWT (python-jose) + bcrypt
- `frontend/` — Next.js (App Router, TS). **Ver `frontend/AGENTS.md`: no es el Next que conocés, leer docs en `node_modules/next/dist/docs/`**
- `mobile/` — Expo SDK 54 + React Native. **Ver `mobile/AGENTS.md`** (reglas de `eas update`)
- `scripts/` — mantenimiento, migraciones de datos, generadores de docs · `docs/` — vault Obsidian (ver abajo)

## Dominio
- Parcelas: parral, potrero, pasero, cabezal · Roles: `super_admin > gerencial > encargado > regador > obrero`
- Monedas `ars`/`usd`: siempre separadas, nunca convertir automático
- Login por **`username`**, no email
- Módulos: producción (tareas/riego/fito/órdenes de aplicación/cosecha), finanzas (ingresos/egresos/cheques/flujo/ARCA CSV), inventarios (insumos/stock), trazabilidad (ficha + PDF + link público), clima, alertas/push, **WhatsApp bot** (egresos)

## Convenciones de código (backend)
- IDs UUID `String(36)`, nunca int
- `await db.flush()` + `await db.refresh(obj)` tras escribir; **nunca commit en routers** (commitea `get_db`)
- Rutas estáticas ANTES que parametrizadas (`/resumen/por-tipo` antes de `/{id}`)
- PATCH: `model_dump(exclude_unset=True)`
- Plata/cantidades `Decimal`, nunca `float` (la API los serializa como string → `Number()` en front/mobile)
- PEP 8, type hints, sin `except` pelado

## Comandos
```bash
# backend (cd backend)
./venv/Scripts/python.exe -m uvicorn app.main:app --reload
./venv/Scripts/python.exe -m pytest                 # SQLite en memoria, no toca DB real
./venv/Scripts/python.exe -m alembic upgrade head
# frontend (cd frontend):  npm run lint && npm run build   (build type-checkea)
# mobile (cd mobile):      npx tsc --noEmit
```
CI (`.github/workflows/ci.yml`): pytest + lint + build en cada push/PR a `main`. Debe quedar verde.

## Migraciones de BD
1. Editar modelo en `app/models/` → `alembic revision --autogenerate -m "desc"`
2. **Revisar** el archivo generado en `app/core/migrations/versions/` → `alembic upgrade head`
3. Correr los dos generadores de docs (abajo)
- Migraciones ya commiteadas/aplicadas: **no editarlas**; el cambio va en una migración nueva.
- Producción: `scripts/migracion/_alembic_prod.py` (confirmar con Fausto antes de tocar prod).

## Deploy (cada pieza distinta)
- **Backend → Railway**: auto-deploy al push a `main`. Logs: `npx @railway/cli logs`.
- **Web → Vercel**: **NO auto-despliega.** Deploy manual (`npx vercel --prod`) tras verificar.
- **Mobile → EAS**: OTA con `eas update ... --environment <env>` (runtime `1.0.0`, política fingerprint). **`eas.json` entra en el fingerprint**: tocarlo invalida el OTA y exige build nuevo. Builds nativos van a Play (Prueba cerrada/interna) y TestFlight.
- Ante "se cierra la app" en Android: mirar Play Console → Android vitals primero.
- **Antes de deployar: probar en local** (uvicorn + npm local, click real con Claude in Chrome), recién después commit/push/deploy.

## No tocar
- `backend/.env`, `mobile/.env` (secretos; bloqueados por `deny` en `.claude/settings.json`)
- `pg_backups/` (datos reales, gitignored)
- Nunca escribir contraseñas/tokens en comandos Bash ni en `settings*.json`; leerlos del entorno.

## Conocimiento (vault Obsidian `C:\Boveda Los Lirios`, vía `docs/`)
`core.symlinks=false`: git guarda el contenido como archivos normales; editar siempre por este repo.
- `docs/sistema/` → Arquitectura, **Modelo de Datos** (auto-generado), Bugs Conocidos, Stack Técnico, Decisiones/, Bitácora/
- `docs/finanzas/`, `docs/produccion/`, `docs/proyectos/` (Dashboards, Sistema de Gestión Agrícola)
Son fuente de verdad de decisiones ya tomadas: leer la relevante antes de trabajar y no contradecirla sin avisar.

## Regenerar docs estructurales (no editar a mano)
Tras agregar modelo, router, migración o pantalla:
- `python scripts/generate_project_map.py` → `PROJECT_MAP.md`
- `python scripts/generate_modelo_datos.py` → `docs/sistema/Modelo de Datos.md`

## Agentes (`.claude/agents/`) — delegar en vez de re-derivar convenciones
- `backend-fastapi` — rutas, modelos, schemas, lógica de negocio
- `db-migrations` — cargas históricas Excel/CSV → Postgres (leer `scripts/migracion/README.md`)
- `frontend-nextjs` — dashboard web
- `mobile-expo` — app Expo y builds EAS
- `finanzas-arca-whatsapp` — finanzas, import ARCA CSV, bot de WhatsApp
- `code-reviewer` — revisa el diff contra estas convenciones (solo lectura)
- `qa-tester` — corre pytest/lint/build/tsc y reporta (no edita)
- `release-manager` — deploy Railway/Vercel/EAS + verificación (confirma antes de publicar)
- `docs-sync` — regenera PROJECT_MAP/Modelo de Datos y escribe la bitácora

## Compactación
Conservar: objetivo actual, decisiones de arquitectura/esquema, archivos modificados. Descartar salida verbosa de herramientas.
