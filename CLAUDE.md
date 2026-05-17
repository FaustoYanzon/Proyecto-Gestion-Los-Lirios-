# Los Lirios — Agricultural Management System

## Project overview
FastAPI backend for managing a vineyard/farm operation (finca).
Handles parcelas, produccion (trabajo/riego/fitosanitarios/campana), finanzas (ingresos/egresos) and user auth.
Campaign year runs May → April (not January → December).

## Stack
- Python 3.12 / FastAPI / SQLAlchemy 2 (async) / PostgreSQL
- Alembic for migrations (async engine)
- Pydantic v2 schemas
- JWT auth (python-jose) + bcrypt passwords
- Frontend: React/Vite on localhost:5173 (not yet in repo)

## Project structure
```
backend/
  app/
    api/          # Route handlers: auth, users, parcelas, finanzas, produccion
    core/         # config, database, security, migrations/, seed.py
    models/       # SQLAlchemy ORM: user, parcela, finanzas, produccion
    schemas/      # Pydantic schemas: user, parcela, finanzas, produccion
  alembic.ini
  .env            # DO NOT READ OR MODIFY
```

## Key domain concepts
- **Parcela types**: parral (vineyard), potrero (field), pasero (drying), cabezal (irrigation head)
- **Fincas**: los_mimbres, media_agua, caucete
- **Roles** (descending): super_admin → gerencial → encargado → regador → obrero
- **Monedas**: ars (ARS), usd (USD) — always track separately, never auto-convert
- **Tareas clasificacion**: verano, invierno, primavera, otono, general — auto-derived from CLASIFICACION_POR_TAREA dict in produccion.py

## Coding conventions
- All IDs are UUID strings (String(36)), never integers
- Use `await db.flush()` + `await db.refresh(obj)` after writes — never commit inside routers (session commits in get_db context manager)
- Static sub-routes must be defined BEFORE parameterized routes (e.g. `/resumen/por-tipo` before `/{id}`)
- Dependency injection: get_db, get_current_user, require_* from app.api.deps
- Always use `model_dump(exclude_unset=True)` for PATCH-style updates
- Decimal for all monetary/quantity fields — never float for money
- PEP 8, type hints everywhere, no bare `except`

## Running the project
```bash
cd backend
uvicorn app.main:app --reload          # dev server
alembic upgrade head                   # run migrations
python -m app.core.seed                # create super admin
python -m app.api.seed_parcelas        # seed parcela data
```

## Do NOT touch
- backend/.env
- backend/app/core/migrations/versions/  (unless explicitly asked to create a migration)
- Alembic migration files already committed

## When making DB changes
1. Edit the model in app/models/
2. Run: `alembic revision --autogenerate -m "description"`
3. Review generated file in migrations/versions/
4. Run: `alembic upgrade head`
Never hand-edit committed migration files.

## Compact instructions
When compacting: preserve current task goal, any decisions made about architecture or DB schema, and filenames modified. Drop verbose tool output and intermediate reasoning.