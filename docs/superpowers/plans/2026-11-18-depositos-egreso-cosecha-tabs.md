# Depósitos en pestañas, egreso de insumos y Cosecha en pestañas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manual insumo egreso with free-text destino and idempotent movements (backend), plus tabbed Depósitos and Cosecha, and ingreso/egreso quick actions on Inicio (mobile).

**Architecture:** One Alembic migration adds enum value `egreso` and two nullable columns to `movimientos_stock`; `POST /insumos/{id}/movimientos` handles egreso and replays by `idempotency_key`. Mobile gets a shared `TabsBar`, a renamed movement modal (`MovimientoInsumoModal`, modes ingreso/egreso), tabs in Depósitos and Cosecha, and two quick actions on Inicio.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest (SQLite in memory); Expo SDK 54 (`npx tsc --noEmit` is the mobile gate, no test runner).

**Spec:** `docs/superpowers/specs/2026-11-18-mobile-depositos-egreso-cosecha-tabs-design.md` (also `2026-11-18-mobile-depositos-design.md`, already implemented)

## Global Constraints

- Backend: IDs UUID String(36); `await db.flush()` + `await db.refresh(obj)`, never commit in routers; `Decimal` for quantities; PEP 8, type hints, no bare `except`. Migrations already applied are never edited (head today: `a2a2a2a00001`).
- Egreso: `tipo = "egreso"` only for insumos with `tipo` in (`vario`, `riego`); fitosanitario → 422 «Los fitosanitarios salen por aplicación». `destino` required (non-blank after trim, max 200) for egreso → 422. Stock may go negative (consistent with `egreso_aplicacion`). Roles: `require_encargado_up` (existing dependency on the endpoint).
- `egreso_aplicacion` stays rejected (422), `ajuste` stays gerencial+.
- Idempotency: optional `idempotency_key` (String 64) on ingreso and egreso; same key replays the stored movement (HTTP 200, stock untouched); a different payload with the same key is not compared (the key owns the movement, same as alfalfa).
- `destino` is stored only for egreso; sent with ingreso/ajuste it is silently ignored (stored as null), never an error.
- Mobile: Spanish UI text, English code/comments; decimals from API are strings → `Number()` in `lib/`; quantities sent as strings; comma accepted and normalized to dot (`cantidadInsumoToString`); role gate `puedeAltaProduccion(role)`; no change to `mobile/eas.json` or native deps.
- Tabs: one panel visible at a time; the active tab survives pull-to-refresh and modal close; each tab keeps its own empty/error state.
- Do not publish, push, migrate production or run `eas update` as part of this plan (the release is a separate, confirmed step).

## Review Focus

- Replaying the same `idempotency_key` after an egreso never subtracts twice, and a replay by a different user is not an error.
- Egreso on a fitosanitario insumo, with blank/whitespace `destino`, or by a regador/obrero is refused with the right status (422/422/403).
- Egreso that leaves stock negative succeeds and the UI warns before confirming.
- Quantities `0`, `-1`, `1,5`, `1.555`, empty, `abc` in the egreso modal behave like the ingreso ones.
- Regador/obrero see no Depósitos entry and no insumo quick actions on Inicio.
- Cosecha: the despacho wizard, FAB, remito printing and long-press delete still work in the Uva tab; switching tabs does not lose the loaded remitos list.
- Alfalfa tab inside Cosecha and the standalone Alfalfa screen show the same data and both refresh after Alta/Entrega.

---

### Task 1: Backend — egreso, destino and idempotent movements

**Files:**
- Modify: `backend/app/models/insumo.py`, `backend/app/schemas/insumo.py`, `backend/app/api/insumos.py`
- Create: `backend/app/core/migrations/versions/<new_rev>_insumo_egreso_destino_idempotencia.py`
- Test: `backend/tests/test_insumo_egreso.py`

**Interfaces:**
- Produces (Task 2 relies on these exact request/response fields):
  - `POST /insumos/{id}/movimientos` body `MovimientoStockCreate`: `tipo` (`ingreso|egreso|ajuste`), `cantidad` Decimal, `fecha`, `observacion?`, `destino?: str | None`, `idempotency_key?: str | None` (max 64).
  - Response `MovimientoStockResponse` adds `destino: str | None`, `idempotency_key: str | None`.
  - 201 on create, 200 on idempotent replay.
- Consumes: existing `_auth(client, create_user, role)` helper pattern and `create_insumo` fixture (see `backend/tests/test_insumo_stock.py`).

- [ ] **Step 1: Write failing tests** in `test_insumo_egreso.py` (names and assertions):
  - `test_egreso_resta_stock_y_guarda_destino`: vario with stock 100, egreso 30 destino «Tractor John Deere» → 201, `GET /insumos/{id}` stock 70, response `destino` equals input.
  - `test_egreso_stock_puede_quedar_negativo`: stock 10, egreso 25 → 201, stock -15.
  - `test_egreso_sin_destino_o_en_blanco_422`: omitted and `"   "` → 422, stock unchanged.
  - `test_egreso_de_fitosanitario_422`: insumo tipo fitosanitario → 422, detail contains «aplicación».
  - `test_egreso_regador_403`: role regador → 403.
  - `test_egreso_idempotente_no_resta_dos_veces`: two POSTs same `idempotency_key` → first 201, second 200 with the same `id`, stock reduced once.
  - `test_ingreso_idempotente_no_suma_dos_veces`: same for ingreso.
  - `test_ingreso_sin_clave_sigue_funcionando`: no key → 201, stock increased (regression).
  - `test_destino_se_ignora_en_ingreso`: ingreso with `destino` → stored `destino` is null.
- [ ] **Step 2: Run** `cd backend && ./venv/Scripts/python.exe -m pytest tests/test_insumo_egreso.py -q`. Expected: FAIL (tests error/422 for unknown `egreso`).
- [ ] **Step 3: Implement.** Model: add `TipoMovimientoStock.egreso = "egreso"`, `destino: Mapped[str | None] = mapped_column(String(200))`, `idempotency_key: Mapped[str | None] = mapped_column(String(64))` and a partial unique index `uq_movimientos_stock_idempotency_key` (`postgresql_where` and `sqlite_where` on `idempotency_key IS NOT NULL`, same style as `DocumentoAlfalfa`). Schema: fields above; validator trims `destino` and converts blank to `None`. Endpoint: before computing stock, if `idempotency_key` is given look up an existing movement with that key and return it with status 200 (inject `response: Response` and set `response.status_code`); for `egreso` apply the rules in Global Constraints; sign: `+` for ingreso/ajuste, `-` for egreso; persist `destino` only when `tipo == egreso`.
- [ ] **Step 4: Migration** via `alembic revision -m "insumo egreso destino idempotencia"` (hand-written, `down_revision = 'a2a2a2a00001'`): enum value with `op.get_context().autocommit_block()` + `ALTER TYPE tipomovimientostock ADD VALUE IF NOT EXISTS 'egreso'` (verify the real type name with `\dT` equivalent in the model: `SAEnum(TipoMovimientoStock)` → `tipomovimientostock`), `add_column` for both columns, `create_index` for the partial unique index. `downgrade()` drops the index and columns and leaves the enum value (Postgres cannot drop it) with a comment saying so.
- [ ] **Step 5: Run** the new tests then the full suite: `./venv/Scripts/python.exe -m pytest -q`. Expected: all new tests PASS; the only failure allowed is the known `tests/test_riego_manto_60mm.py::test_cumplimiento_cuenta_1_56_riegos_por_manto`.
- [ ] **Step 6: Apply the migration to the LOCAL database** (`DATABASE_URL` host must be `localhost`, check first): `./venv/Scripts/python.exe -m alembic upgrade head`, then restart nothing (uvicorn runs with `--reload`, the Alembic change is independent).
- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat(backend): insumo egreso with destino and idempotent stock movements"
```

---

### Task 2: Mobile data layer, movement modal and TabsBar

**Files:**
- Modify: `mobile/lib/depositos.ts`
- Rename + modify: `mobile/components/IngresoInsumoModal.tsx` → `mobile/components/MovimientoInsumoModal.tsx` (use `git mv`)
- Create: `mobile/components/TabsBar.tsx`

**Interfaces:**
- Consumes: Task 1 fields; `newIdempotencyKey()` from `lib/idempotency.ts`.
- Produces:
  - `registrarMovimientoInsumo(insumoId: string, p: { tipo: 'ingreso' | 'egreso'; cantidad: string; fecha: string; observacion?: string; destino?: string; idempotencyKey: string }): Promise<void>` (replaces `registrarIngresoInsumo`; keep no alias).
  - `getInsumosPorTipos(tipos: TipoInsumoDeposito[]): Promise<InsumoStock[]>` (loads each type, concatenates, sorted by nombre).
  - `MovimientoInsumoModal({ modo: 'ingreso' | 'egreso'; insumos: InsumoStock[]; onClose: () => void; onSaved: () => void | Promise<void> })`. Egreso adds required field «¿Dónde se usó?» (placeholder «Tractor, máquina o parcela», max 200) and the confirmation line «Se restan X {unidad} de Y; quedan Z» with an extra warning line «El stock va a quedar en negativo» when Z < 0. Idempotency key: one per modal open, regenerated only if the sent payload JSON changed (same pattern as `components/AlfalfaModal.tsx`, `sentPayloadRef`). The previous «No sabemos si se guardó…» error text stays for no-response errors.
  - `TabsBar<T extends string>({ tabs: { key: T; label: string }[]; active: T; onChange: (k: T) => void })`: horizontally scrollable row of pills, active pill filled `colors.burdeos[600]` with white text, min height 44, `accessibilityRole="tab"` and `accessibilityState={{ selected }}`.

- [ ] **Step 1: Update `lib/depositos.ts`** with the two functions above (body shape per spec: `destino` sent only for egreso; `idempotency_key` always sent).
- [ ] **Step 2: `git mv` the modal**, rename the component and props, add the egreso behavior, update the title («Ingreso de insumo» / «Egreso de insumo»). Fix imports in `app/depositos/index.tsx` only as far as needed to compile (Task 3 rewrites it).
- [ ] **Step 3: Create `TabsBar.tsx`.**
- [ ] **Step 4: Run** `cd mobile && npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5: Commit**

```bash
git add mobile
git commit -m "feat(mobile): movement modal with egreso and idempotency, shared TabsBar"
```

---

### Task 3: Depósitos in tabs

**Files:**
- Modify: `mobile/app/depositos/index.tsx`

**Interfaces:**
- Consumes: `TabsBar`, `MovimientoInsumoModal` (Task 2), existing card components in the file.
- Produces: none.

- [ ] **Step 1: Add `tab` state** (`'fito' | 'varios' | 'paseros' | 'bodega' | 'alfalfa'`, default `'fito'`) and render `TabsBar` fixed above the `ScrollView` with labels «Fitosanitarios», «Insumos», «Paseros», «Bodega», «Alfalfa». Render only the active card.
- [ ] **Step 2: Buttons.** Fitosanitarios card: «+ Ingreso» only. Insumos varios card: «+ Ingreso» and «− Egreso» (secondary style). Both open `MovimientoInsumoModal` with a snapshot of the card's insumos taken at open time (state `{ modo, insumos }`), as today.
- [ ] **Step 3: In the Alfalfa tab** add a button «Abrir Alfalfa» that pushes `/alta-produccion/alfalfa`.
- [ ] **Step 4: Run** `cd mobile && npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5: Commit**

```bash
git add mobile
git commit -m "feat(mobile): depositos tabs and egreso button"
```

---

### Task 4: Inicio quick actions

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `MovimientoInsumoModal`, `getInsumosPorTipos` (Task 2), `puedeAltaProduccion` (`lib/altaProduccion.ts`), `ActionButton` already in the file.
- Produces: none.

- [ ] **Step 1: Second row of two `compact` `ActionButton`s** under the existing actions grid, only when `puedeAltaProduccion(user?.role)`: «Ingreso de insumos» (icon key `agregar`) and «Egreso de insumos» (icon key `quitar`).
- [ ] **Step 2: On press**, load the list (`['fitosanitario','vario']` for ingreso, `['vario']` for egreso), show a small loading state on the button, and open `MovimientoInsumoModal`; a load error shows a brief inline message «No se pudieron cargar los insumos».
- [ ] **Step 3: Run** `cd mobile && npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 4: Commit**

```bash
git add mobile
git commit -m "feat(mobile): insumo ingreso/egreso quick actions on Inicio"
```

---

### Task 5: Cosecha in tabs (Uva | Pasa | Alfalfa)

**Files:**
- Create: `mobile/components/AlfalfaPanel.tsx`
- Modify: `mobile/app/alta-produccion/alfalfa.tsx`, `mobile/app/(tabs)/cosecha.tsx`

**Interfaces:**
- Consumes: `TabsBar` (Task 2).
- Produces: `AlfalfaPanel()` — the current body of `app/alta-produccion/alfalfa.tsx` (stock, Alta/Entrega buttons, last documents, `AlfalfaModal`, own loading/refresh), without the access-denied guard.

- [ ] **Step 1: Extract `AlfalfaPanel`** from `alfalfa.tsx` (move code and its styles, no behavior change); `alfalfa.tsx` keeps the role guard and renders `<AlfalfaPanel />`.
- [ ] **Step 2: In `cosecha.tsx`** add `tab` state (`'uva' | 'pasa' | 'alfalfa'`, default `'uva'`) and render `TabsBar` below the title. **Uva:** keeps the remitos `FlatList`, summary strip, FAB and wizard modal untouched, plus the «Ingresos al pasero» access. **Pasa:** «Levantar pasa» (primary), «Lotes de pasa», «Entregar pasa a un comprador» (existing `router.push` targets). **Alfalfa:** `<AlfalfaPanel />` (only if `puedeAltaProduccion(role)`, otherwise the tab is not shown). The FAB and the remitos list are visible only on Uva.
- [ ] **Step 3: Remove the old «Alfalfa» access button** from the header (it is now a tab).
- [ ] **Step 4: Run** `cd mobile && npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5: Commit**

```bash
git add mobile
git commit -m "feat(mobile): cosecha tabs uva/pasa/alfalfa with shared alfalfa panel"
```

---

### Task 6: Docs

**Files:**
- Modify: `PROJECT_MAP.md`, `docs/sistema/Modelo de Datos.md` (both generated), `docs/superpowers/specs/2026-11-18-mobile-depositos-egreso-cosecha-tabs-design.md` (status), `docs/sistema/Bitácora/2026-11-18-mobile-depositos.md` (append section)
- Create: `docs/sistema/Decisiones/2026-11-18-egreso-insumos-destino-libre.md`

- [ ] **Step 1: Run** `python scripts/generate_project_map.py` and `python scripts/generate_modelo_datos.py`.
- [ ] **Step 2: Write the decision doc** (free-text `destino` now, classification by máquina/parcela later; negative stock allowed; idempotency key on movements; fitosanitarios out of manual egreso) and append the Bitácora section; set the spec status to «aprobado e implementado (sin desplegar)». List the release order (backup → push → verify migration → OTA).
- [ ] **Step 3: Commit**

```bash
git add PROJECT_MAP.md docs
git commit -m "docs: insumo egreso, depositos/cosecha tabs"
```
