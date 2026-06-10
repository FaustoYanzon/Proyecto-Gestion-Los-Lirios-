# PROJECT MAP — Los Lirios Gestión Agrícola
> Auto-generated snapshot. Run `generate_map.ps1` to update.
> Last updated: 2026-06-01

---

## System Architecture

```
repo/
├── backend/        FastAPI + PostgreSQL (Python 3.12)
├── frontend/       Next.js 16 + React 19 (TypeScript)
└── mobile/         Expo 54 + React Native 0.81 (TypeScript)
```

**Communication:** Frontend/Mobile → REST API (FastAPI) → PostgreSQL  
**Auth:** JWT (python-jose) + bcrypt. Roles: `super_admin > gerencial > encargado > regador > obrero`  
**Campaign year:** May → April (NOT calendar year)  
**Fincas:** `los_mimbres`, `media_agua`, `caucete`

---

## Backend (`backend/`)

**Stack:** FastAPI · SQLAlchemy 2 (async) · PostgreSQL · Alembic · Pydantic v2 · JWT

### Entry point
```
backend/app/main.py          # FastAPI app, router registration, CORS
backend/app/core/config.py   # Settings (reads .env)
backend/app/core/database.py # Async engine + get_db session
backend/app/core/security.py # JWT encode/decode, password hashing
backend/app/core/seed.py     # Creates super_admin user
```

### API Routes (`backend/app/api/`)
| File | Prefix | Description |
|------|--------|-------------|
| `auth.py` | `/auth` | Login, token refresh |
| `users.py` | `/users` | CRUD usuarios, roles |
| `parcelas.py` | `/parcelas` | CRUD parcelas + stats |
| `finanzas.py` | `/finanzas` | Ingresos, egresos, flujo de caja |
| `produccion.py` | `/produccion` | Tareas, riego, fitosanitarios, campaña |
| `deps.py` | — | `get_db`, `get_current_user`, `require_*` guards |
| `seed_parcelas.py` | `/seed` | One-time parcela seed |

**Rule:** Static sub-routes BEFORE parameterized (`/resumen/por-tipo` before `/{id}`)

### Models (`backend/app/models/`)
| File | Key Tables/Enums |
|------|-----------------|
| `user.py` | `User` (id UUID, email, role, finca) |
| `parcela.py` | `Parcela` (id, nombre, tipo, finca, variedad_uva, superficie) |
| `finanzas.py` | `Ingreso`, `Egreso` · Enums: `Finca`, `MonedaTipo(ars/usd)`, `TipoEgreso`, `ClasificacionEgreso`, `ProductoIngreso(uva_fresca/pasa/mosto/otro)`, `FormaPago`, `OrigenPago` |
| `produccion.py` | `Tarea`, `Riego`, `Fitosanitario`, `EstadoCampana` · Dict: `CLASIFICACION_POR_TAREA` |

**Parcela tipos:** `parral` (vineyard), `potrero` (field), `pasero` (drying), `cabezal` (irrigation head)

**Tarea clasificaciones** (auto-derived from dict):
- `verano`: Cosecha, Tractor Cosecha, Pasero, Levantar Pasa, Control Cosecha, Amontonar Pasa
- `invierno`: Poda, Atada, Tejido
- `primavera`: Verde, Brote, Raleo, Polainas, Descole
- `otono`: Murones
- `general`: Jornal Comun, Tractor Comun, Riego, Mochila, Limpieza Acequia, etc.

### Schemas (`backend/app/schemas/`)
Pydantic v2 — mirrors models: `user.py`, `parcela.py`, `finanzas.py`, `produccion.py`

### Coding conventions (critical)
- All IDs: `UUID` strings (`String(36)`), never int
- After writes: `await db.flush()` + `await db.refresh(obj)` — never commit inside routers
- PATCH updates: `model_dump(exclude_unset=True)`
- Money/quantities: `Decimal`, never `float`
- No bare `except`. Type hints everywhere.

### Migrations (`backend/app/core/migrations/versions/`)
| File | Description |
|------|-------------|
| `dd81fff4c510_initial_schema.py` | Schema inicial |
| `1b529f62d678_auth_5roles.py` | Auth + 5 roles |
| `1cac1b6d2e3d_add_referencia_id_to_egresos.py` | referencia_id en egresos |

**Never hand-edit committed migration files.**

### Dev commands
```bash
cd backend
uvicorn app.main:app --reload          # dev server :8000
alembic upgrade head                   # run migrations
python -m app.core.seed                # create super_admin
python -m app.api.seed_parcelas        # seed parcelas
```

---

## Frontend (`frontend/`)

**Stack:** Next.js 16.2.6 · React 19 · TypeScript · TanStack Query v5 · Zustand v5 · Axios · Zod v4 · React Hook Form v7 · Recharts v3 · Leaflet · Lucide React

**Important:** This Next.js version may have breaking changes. Read `node_modules/next/dist/docs/` before writing code.

### App Router structure (`frontend/app/`)
```
app/
├── page.tsx                           # Root redirect
├── layout.tsx                         # Root layout
├── login/page.tsx                     # Login
└── dashboard/
    ├── layout.tsx                     # Dashboard shell (sidebar, nav)
    ├── page.tsx                       # Dashboard home
    ├── mapa/page.tsx                  # Finca map (Leaflet + KML)
    ├── finanzas/
    │   ├── dashboard/page.tsx         # Finanzas overview + charts
    │   ├── ingresos/page.tsx          # Ingresos table + form
    │   ├── egresos/page.tsx           # Egresos table + form
    │   └── flujo/page.tsx             # Flujo de caja
    ├── produccion/
    │   ├── dashboard/page.tsx         # Producción overview
    │   ├── tareas/page.tsx            # Registro de tareas
    │   ├── riego/page.tsx             # Registro de riego
    │   ├── fitosanitarios/page.tsx    # Fitosanitarios
    │   └── mano-de-obra/page.tsx      # Mano de obra
    └── admin/
        ├── parcelas/page.tsx          # CRUD parcelas
        └── usuarios/page.tsx          # CRUD usuarios
```

### Key files
| File | Purpose |
|------|---------|
| `lib/api.ts` | Axios instance, interceptors, base config |
| `lib/auth.ts` | Auth helpers, token management |
| `lib/kml.ts` | KML parser for finca map |
| `store/authStore.ts` | Zustand auth store |
| `components/providers.tsx` | TanStack Query + auth provider |

### API client modules (`frontend/lib/api/`)
`egresos.ts` · `ingresos.ts` · `flujo.ts` · `parcelas.ts` · `produccion.ts` · `fitosanitarios.ts` · `riego.ts` · `usuarios.ts`

### Components (`frontend/components/`)
```
finanzas/   EgresoForm, EgresosTable, IngresoForm, IngresosTable
produccion/ FitosanitarioForm, FitosanitariosTable, RiegoForm, RiegoTable, TareaForm, TareasTable
map/        FincaMap, FincaMapInner
```

### Assets
- `public/los-lirios.kml` — KML file with parcela polygons for the map

---

## Mobile (`mobile/`)

**Stack:** Expo 54.0.33 · React Native 0.81.5 · TypeScript · Expo Router

**Important:** Read exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing code.

### Structure
```
mobile/
├── App.tsx
├── app/
│   ├── _layout.tsx              # Root layout (auth guard)
│   ├── (auth)/
│   │   └── login.tsx            # Login screen
│   ├── (tabs)/
│   │   ├── _layout.tsx          # Tab bar
│   │   ├── index.tsx            # Home / resumen
│   │   ├── mapa.tsx             # Mapa de parcelas
│   │   ├── riego.tsx            # Riego
│   │   ├── tareas.tsx           # Tareas
│   │   └── perfil.tsx           # Perfil usuario
│   └── estado-campana.tsx       # Estado de campaña
├── lib/
│   ├── api.ts                   # Axios client
│   ├── auth.ts                  # Auth helpers
│   ├── kmlData.ts               # KML data for map
│   └── types.ts                 # Shared TypeScript types
└── store/authStore.ts           # Auth state
```

---

## DO NOT TOUCH
- `backend/.env`
- `mobile/.env`
- `backend/app/core/migrations/versions/` (unless creating new migration)
- Alembic migration files already committed

---

## Files Outside repo/ (Claude workspace)
| File | Purpose |
|------|---------|
| `CLAUDE.md` | Working memory + instructions for Claude |
| `memory/` | Domain context files (about, los-lirios-context, rules, voice) |
| `plan-dashboards-claude-code.md` | Plan for dashboard feature |
| `plan-dashboards-v2.md` | Updated dashboard plan |
| `prompt-cosecha-claude-code.md` | Prompt template for cosecha workflow |
| `generate_map.ps1` | Script to regenerate this file |
