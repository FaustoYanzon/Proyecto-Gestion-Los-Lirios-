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
- **expo-updates** — actualizaciones OTA (desde 2026-07-12, ver [[2026-07-12-ota-y-ux-cargar-tarea]]). Canales por build profile: `development`/`preview`/`production`. `runtimeVersion` policy `appVersion`.
- **react-native-web** — solo para poder correr `expo start --web` como preview de desarrollo/testing; el target real sigue siendo Android/iOS nativo.

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
| `a4244d685964_add_performance_indexes.py` | Índices de performance + entidad `Trabajador` |
| `b7e2c1a4f9d3_add_token_version_to_users.py` | `token_version` en `users` (invalidación de sesión) |
| `ac50bb4dc8a9_add_presupuestos_and_metas_produccion.py` | Presupuestos y metas de producción (dashboards D1-D4) |
| `d4e7b2c9f1a5_add_kpi_views.py` | Vistas SQL para KPIs de dashboards |
| `e8a1c4d7b3f2_add_comprador_view.py` | Vista de comprador |
| `f2b6d9e4a8c1_add_mo_parcela_mes_view.py` | Vista mano de obra por parcela/mes |
| `c1d3f7a9e2b4_redesign_ingresos_bd_cobros.py` | Ingresos: de venta-de-uva-por-kilo a libro de cobros "BD COBROS" (dropea y recrea la tabla, 259 filas viejas descartadas por decisión explícita); actualiza `vw_kpi_comprador` |
| `f8a6e10ed72e_estado_ingreso_enum.py` | `ingresos.estado` de texto libre a enum (`no_registrado`/`facturado`) — **head actual** |

Cadena lineal, un solo head confirmado (`alembic heads`), sin conflictos.

> ⚠️ No editar archivos de migración ya commiteados.
> ✅ El venv de desarrollo corre Python 3.14.3, pero `backend/runtime.txt` fija `python-3.12` para el deploy real (Railway). Validado 2026-07-10 contra Python 3.12.10 (`venv312`), 11/11 tests passing — ya no es un riesgo abierto.

## Deploy (producción desde 2026-07-10/11)

| Servicio | Plataforma | URL |
|---|---|---|
| Backend | Railway | `proyecto-gestion-los-lirios-production.up.railway.app` |
| Frontend | Vercel | `frontend-six-jade-79.vercel.app` |
| Mobile | EAS (build `preview`, distribución interna) | ver [[2026-07-11-deploy-piloto-completado]] |

Detalle completo (URLs, problemas resueltos, commits): [[2026-07-11-deploy-piloto-completado]].

## Ver también

- [[Arquitectura]]
- [[Checklist Deploy de Prueba (Semana Piloto)]]
- [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]
- [[2026-07-11-deploy-piloto-completado]]
- [[2026-07-12-ota-y-ux-cargar-tarea]]
