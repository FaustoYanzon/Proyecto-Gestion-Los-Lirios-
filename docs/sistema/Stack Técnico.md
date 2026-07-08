---
tags: [sistema, stack]
---

# Stack Técnico

## Backend

- **Python 3.12** + **FastAPI**
- **SQLAlchemy 2** (async) con `asyncpg`
- **PostgreSQL** — base de datos principal
- **Alembic** — migraciones (async engine)
- **Pydantic v2** — schemas y validación (settings con `extra="ignore"`, `ALLOWED_ORIGINS` vía `Annotated[list[str], NoDecode]`)
- **PyJWT** — JWT (reemplaza a `python-jose`, migrado 2026-07 por hardening de seguridad)
- **bcrypt** — hash de contraseñas
- **slowapi** — rate limiting (`LOGIN_RATE_LIMIT` por IP + throttle propio por username, ver [[Arquitectura]])

## Testing

- **pytest** + **pytest-asyncio** — suite de regresión (`backend/tests/`, 11 tests sobre auth)
- **aiosqlite** — engine SQLite in-memory para tests (motor async "sqlite-safe" en `core/database.py`)
- Instalación: `pip install -r requirements.txt -r requirements-dev.txt` · Run: `pytest`

## Frontend

- **Next.js 16.2.6** con App Router
- **React 19**
- **TypeScript**
- **TanStack Query v5** — data fetching y cache
- **Zustand v5** — estado global
- **Axios** — HTTP client
- **Zod v4** — validación en cliente
- **React Hook Form v7**
- **Recharts v3** — gráficos
- **Leaflet** — mapas
- **Lucide React** — iconos
- **Tailwind v4**

## Mobile

- **Expo 54**
- **React Native 0.81**
- **TypeScript**

## Herramientas de desarrollo

- `uvicorn` con `--reload` para desarrollo
- Alembic para migraciones
- Dev server frontend: `localhost:5173`
- Dev server backend: `localhost:8000`

## Migraciones existentes

| Archivo | Descripción |
|---|---|
| `dd81fff4c510_initial_schema.py` | Schema inicial |
| `1b529f62d678_auth_5roles.py` | Auth + 5 roles |
| `1cac1b6d2e3d_add_referencia_id_to_egresos.py` | referencia_id en egresos |
| `15b70dabafed_add_registros_cosecha.py` | Registros de cosecha |
| `a3f8c2d1e9b7_push_tokens.py` | Tokens push (notificaciones) |
| `a4244d685964_add_performance_indexes.py` | Índices de performance |
| `b7e2c1a4f9d3_add_token_version_to_users.py` | `token_version` en `users` (invalidación de sesión) |

> ⚠️ No editar archivos de migración ya commiteados.

## Ver también

- [[Arquitectura]]
