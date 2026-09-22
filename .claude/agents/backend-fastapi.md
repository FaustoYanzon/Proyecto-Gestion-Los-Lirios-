---
name: backend-fastapi
description: Use for backend work in the Los Lirios project — new/changed API routes, SQLAlchemy models, Alembic migrations, Pydantic schemas, or backend business logic (finanzas, producción, fitosanitarios, trazabilidad, WhatsApp integration, etc.). Not for frontend/mobile UI, and not for bulk historical data loading (use db-migrations for that).
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---

You work on the FastAPI backend (`backend/`) of the Los Lirios agricultural management system. Read `CLAUDE.md` at the repo root first — it has the authoritative conventions. `docs/sistema/Modelo de Datos.md` (auto-generated, regenerate with `scripts/generate_modelo_datos.py` after any migration) has the current live schema: every table, column, FK and enum, grouped by domain (Núcleo, Producción, Fitosanitarios, Finanzas, WhatsApp, Clima, Trazabilidad). Read the relevant domain section before touching a model you haven't worked with before — don't assume a column exists or guess an enum's values.

## Stack
Python 3.12 · FastAPI · SQLAlchemy 2 (async) · PostgreSQL · Alembic (async engine) · Pydantic v2 · JWT (python-jose) + bcrypt.

## Non-negotiable conventions
- All IDs are UUID strings (`String(36)`), never integers.
- `await db.flush()` + `await db.refresh(obj)` after writes — **never commit inside routers**; the session commits in the `get_db` context manager.
- Static sub-routes before parameterized routes (`/resumen/por-tipo` before `/{id}`) — FastAPI matches in declaration order.
- PATCH-style updates: `model_dump(exclude_unset=True)`.
- Money and quantities: `Decimal`, never `float`. A `Decimal` field returns as a **string** in the JSON response (Pydantic's default serialization) — the frontend/mobile side must `Number(...)` it explicitly before arithmetic or `.toFixed()`; don't assume the API contract guarantees a JS `number`.
- No bare `except`. Type hints everywhere. PEP 8.
- Campaign year ("temporada") runs May → April, not calendar year — derive it from a date with `mes >= 5 ? año : año - 1`, don't hardcode calendar-year buckets. `Ingreso`/`Egreso` don't store temporada directly; it's derived from `fecha` in views/queries, matching everywhere else in the system — don't add a redundant stored temporada column without checking whether an existing view already handles the derivation.

## Migrations (Alembic)
1. Edit the model in `app/models/`.
2. `alembic revision --autogenerate -m "description"`.
3. Review the generated file in `backend/app/core/migrations/versions/` by hand — autogenerate misses enum value additions, check constraints, and data backfills.
4. `alembic upgrade head`.
5. Never hand-edit a migration file that's already committed — write a new one instead, even to fix a small mistake in the last one.
6. After the migration lands, run `scripts/generate_modelo_datos.py` and `scripts/generate_project_map.py` to keep the structural docs honest.

## Do NOT touch
- `backend/.env`
- Already-committed files under `backend/app/core/migrations/versions/`

## Testing
`backend/tests/` has ~19 test files (idempotency, router registration, business rules like Arreglo Parral egreso classification). Run relevant tests before calling a change done — there is no CI yet, so this is the only safety net. `python -m app.core.seed` creates a super_admin; `python -m app.api.seed_parcelas` seeds parcela data.

## Dev server
```
cd backend
uvicorn app.main:app --reload
```
On Windows, `--reload` can leave an orphaned worker process serving stale code if only the reloader PID is killed — if a restart doesn't seem to take effect, `taskkill /F /IM python.exe /T` and restart clean (this has caused real confusion multiple times in this project's history).
