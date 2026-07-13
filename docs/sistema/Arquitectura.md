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

## Mobile — wizards de carga

Los 4 formularios multi-paso (`tareas.tsx`, `fito.tsx`/`fitosanitario.tsx`, `riego.tsx`, `campana.tsx`) **no usan** el componente genérico `mobile/components/Wizard.tsx` documentado en `docs/DESIGN_SYSTEM.md` § 8 — cada uno reimplementa su propio `StepIndicator` y estilos a mano. `Wizard.tsx` es código sin uso (confirmado por grep, 2026-07-12). Al pedir cambios de UX en un wizard, hay que tocar el archivo del screen correspondiente, no el componente genérico. Detalle del último cambio: [[2026-07-12-ota-y-ux-cargar-tarea]].

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

- **Secretos:** `backend/.env` y `mobile/.env` fuera de git (`.gitignore`); `SECRET_KEY`, password de Postgres y password del super_admin rotados. Nada de credenciales hardcodeadas en `seed.py` — falla fuerte si `SUPER_ADMIN_PASSWORD` no está seteada. `backend/.env.example` documenta todas las variables; **no existe `.env.example` para frontend ni mobile** (gap menor de documentación).
- **CORS por entorno:** `ALLOWED_ORIGINS` desde `.env`/variables de Railway. En producción, `ENVIRONMENT=production` rechaza el arranque si `SECRET_KEY` es débil (`config.py:106-113`) o si `ALLOWED_ORIGINS` contiene `"*"` (`config.py:115-119`). Default en código (sin `.env`): `localhost:3000`/`localhost:5173`. ✅ Verificado en producción (2026-07-10): `ALLOWED_ORIGINS` apunta al dominio real de Vercel, `SECRET_KEY` de 64 bytes urlsafe generado nuevo para el deploy.
- **`/docs` y `/redoc`:** deshabilitados automáticamente en producción (`config.py:85-93`, aplicado en `main.py:19-21`; override manual con `DOCS_ENABLED`). ✅ Confirmado en producción: `/docs` devuelve 404.
- **Rate limiting doble en login:**
  - Por IP (`slowapi`, enganchado en `auth.py:20` sobre `/auth/login`, `LOGIN_RATE_LIMIT` default `10/minute`).
  - Por username (`app/core/login_throttle.py`, invocado en `auth.py:28,40`, in-memory, sliding window: `LOGIN_MAX_FAILURES` / `LOGIN_FAILURE_WINDOW_SECONDS`, default 10/300s). Cubre password spraying distribuido entre IPs que el límite por IP no detecta. Solo cuenta fallos; login exitoso resetea el contador. **No persiste entre workers** — documentado explícitamente en el código (`limiter.py:7-9`, `login_throttle.py:12`); hoy corre con 1 worker (`railway.json` no fija `--workers`), así que está bien, pero si se escala a multi-worker/multi-host hay que respaldarlo con Redis.
- **Invalidación de sesión:** columna `User.token_version` (migración `b7e2c1a4f9d3`). El JWT lleva el claim `tv` (seteado en `auth.py:59`, verificado en `deps.py:37`); cambiar la contraseña incrementa `token_version` e invalida todos los tokens emitidos antes, sin necesitar blacklist. Cubierto por test propio.
- **Autorización server-side:** rutas sensibles protegidas con guards por rol (`require_gerencial_up` en todo `finanzas.py`, `require_super_admin` en todo `users.py`). El frontend NO replica estos chequeos a nivel de página (solo esconde botones), pero el backend sí bloquea el acceso — confirmado por lectura directa de código.
- **Suite de regresión:** `backend/tests/` (pytest + pytest-asyncio + aiosqlite), 11/11 passing. Cubre login, rate limit y session invalidation. ✅ Validada contra Python 3.12.10 (venv `venv312`, 2026-07-10), coincide con `runtime.txt`.
- **Manejo de errores/logging:** health check mínimo en `main.py:72-74` (`GET /` → `{"status":"ok"}`). No hay logging estructurado ni exception handler genérico — solo se registra el de `RateLimitExceeded`. Los 500 no dejan rastro propio más allá de lo que capture la plataforma de hosting.
- **Decisión pendiente:** los commits viejos en GitHub siguen conteniendo los `.env` con los secretos ya rotados (no se purgó la historia — ver [[Purga de historia git - decisión de no purgar]]).

## Deploy

**✅ En producción desde 2026-07-10/11** (piloto de prueba). Detalle completo de la ejecución y de los 7 problemas no anticipados que aparecieron: [[2026-07-11-deploy-piloto-completado]].

- **Backend:** Railway (`backend/railway.json`, Nixpacks, `startCommand: alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`) + `backend/runtime.txt` (`python-3.12`, validado con 11/11 tests). URL: `https://proyecto-gestion-los-lirios-production.up.railway.app`. `DATABASE_URL` requiere el driver `+asyncpg` explícito (`postgresql+asyncpg://...`) — el que Railway autogenera para el plugin de Postgres es sync y rompe `alembic upgrade head`. Root Directory fijado a `backend` (monorepo). Sin Dockerfile ni docker-compose (no hace falta con Nixpacks).
- Scripts locales encontrados (no aptos para prod tal cual): `start.bat` (dev, con `--reload`), `start-silent.ps1` (hosting local vía Task Scheduler de Windows).
- **Frontend:** Vercel, sin `vercel.json` (no hace falta para Next.js). URL: `https://frontend-six-jade-79.vercel.app`. `NEXT_PUBLIC_API_URL` (`lib/api.ts:3`, default `http://localhost:8000`) fijada como variable de entorno de producción en Vercel. CORS confirmado (`ALLOWED_ORIGINS` en Railway apunta a este dominio).
- **Mobile:** `EXPO_PUBLIC_API_URL` (`mobile/lib/api.ts`) fijada al dominio de Railway vía el campo `env` del profile `preview` en `eas.json` (las variables de shell local NO viajan a los builds en la nube de EAS). Desde 2026-07-12, la app tiene **EAS Update (OTA)** configurado — ver [[2026-07-12-ota-y-ux-cargar-tarea]] — así que cambios de puro JS/UI ya no requieren un nuevo build. Último build con reinstalación manual (el que activó el canal OTA): `https://expo.dev/accounts/faustoyanzon2411/projects/los-lirios/builds/66e747d7-e810-4f1c-a8cb-b5347c424e7b`.
- **Backup:** manual pre-piloto en `pg_backups/loslirios_railway_20260710_pilot.dump` (carpeta gitignoreada). Sin rutina automática todavía — pendiente, ver [[Sistema de Gestión Agrícola]].
- Ver checklist original (ahora resuelto): [[Checklist Deploy de Prueba (Semana Piloto)]]

## Comandos de desarrollo

```bash
cd backend
uvicorn app.main:app --reload          # dev :8000
alembic upgrade head                   # migraciones
python -m app.core.seed                # crear super_admin
python -m app.api.seed_parcelas        # seed parcelas
```

## Ver también

- [[2026-07-11-deploy-piloto-completado]]
- [[Bugs Conocidos]]
- [[Stack Técnico]]
- [[Sistema de Gestión Agrícola]]
- [[Purga de historia git - decisión de no purgar]]
