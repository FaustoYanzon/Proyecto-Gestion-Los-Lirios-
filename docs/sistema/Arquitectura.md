---
tags: [sistema, arquitectura]
---

# Arquitectura del Sistema

## Stack

| Capa | Tecnología |
|---|---|
| Backend | FastAPI · SQLAlchemy 2 (async) · PostgreSQL · Alembic · Pydantic v2 |
| Frontend | Next.js 16 · React 19 · TypeScript · TanStack Query v5 · Zustand v5 · Recharts v3 |
| Mobile | Expo 54 · React Native 0.81 · TypeScript |
| Auth | JWT (PyJWT) · bcrypt · slowapi (rate limiting) |

## Estructura del repo

```
repo/
├── backend/
│   └── app/
│       ├── api/        # Route handlers
│       ├── core/       # config, database, security, migrations
│       ├── models/     # SQLAlchemy ORM
│       └── schemas/    # Pydantic v2
├── frontend/
└── mobile/
```

## API Routes

| Archivo | Prefix | Descripción |
|---|---|---|
| `auth.py` | `/auth` | Login, token refresh |
| `users.py` | `/users` | CRUD usuarios, roles |
| `parcelas.py` | `/parcelas` | CRUD parcelas + stats |
| `finanzas.py` | `/finanzas` | Ingresos, egresos, flujo de caja |
| `produccion.py` | `/produccion` | Tareas, riego, fitosanitarios, campaña |

## Roles (jerarquía descendente)

`super_admin` → `gerencial` → `encargado` → `regador` → `obrero`

## Fincas

- `los_mimbres`
- `media_agua`
- `caucete`

## Año de campaña

**Mayo → Abril** (no año calendario). Tener en cuenta para todos los filtros y reportes.

## Convenciones críticas

- IDs: UUID strings (`String(36)`), nunca int
- Después de writes: `await db.flush()` + `await db.refresh(obj)` — nunca commit dentro de routers
- PATCH: `model_dump(exclude_unset=True)`
- Dinero/cantidades: `Decimal`, nunca `float`
- Rutas estáticas ANTES de parametrizadas (`/resumen/por-tipo` antes de `/{id}`)

## Seguridad (hardening 2026-07)

- **Secretos:** `backend/.env` y `mobile/.env` fuera de git (`.gitignore`); `SECRET_KEY`, password de Postgres y password del super_admin rotados. Nada de credenciales hardcodeadas en `seed.py` — falla fuerte si `SUPER_ADMIN_PASSWORD` no está seteada.
- **CORS por entorno:** `ALLOWED_ORIGINS` desde `.env`. En producción, `ENVIRONMENT=production` rechaza el arranque si `SECRET_KEY` es débil o si `ALLOWED_ORIGINS` contiene `"*"`.
- **`/docs` y `/redoc`:** deshabilitados automáticamente en producción (override manual con `DOCS_ENABLED`).
- **Rate limiting doble en login:**
  - Por IP (`slowapi`, `LOGIN_RATE_LIMIT`, default `10/minute`).
  - Por username (`app/core/login_throttle.py`, in-memory, sliding window: `LOGIN_MAX_FAILURES` / `LOGIN_FAILURE_WINDOW_SECONDS`, default 10/300s). Cubre password spraying distribuido entre IPs que el límite por IP no detecta. Solo cuenta fallos; login exitoso resetea el contador. No persiste entre workers — si se escala a multi-worker/multi-host hay que respaldarlo con Redis.
- **Invalidación de sesión:** columna `User.token_version` (migración `b7e2c1a4f9d3`). El JWT lleva el claim `tv`; cambiar la contraseña incrementa `token_version` e invalida todos los tokens emitidos antes, sin necesitar blacklist.
- **Suite de regresión:** `backend/tests/` (pytest + pytest-asyncio + aiosqlite), cubre login, rate limit y session invalidation.
- **Decisión pendiente:** los commits viejos en GitHub siguen conteniendo los `.env` con los secretos ya rotados (no se purgó la historia — ver [[Purga de historia git - decisión de no purgar]]).

## Comandos de desarrollo

```bash
cd backend
uvicorn app.main:app --reload          # dev :8000
alembic upgrade head                   # migraciones
python -m app.core.seed                # crear super_admin
python -m app.api.seed_parcelas        # seed parcelas
```

## Ver también

- [[Bugs Conocidos]]
- [[Stack Técnico]]
- [[Sistema de Gestión Agrícola]]
- [[Purga de historia git - decisión de no purgar]]
