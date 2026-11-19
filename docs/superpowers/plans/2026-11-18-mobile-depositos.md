# Mobile Depósitos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A «Depósitos» screen in the mobile app with five stock cards (Fitosanitarios, Insumos varios, Paseros, Bodega, Alfalfa) and an «+ Ingreso» modal for fitosanitarios and insumos varios.

**Architecture:** Mobile only, shipped by OTA. No backend change: every endpoint already exists. A pure client module (`lib/depositos.ts`) loads and shapes the data and posts ingresos; one screen renders the cards; one modal registers the ingreso; the modules drawer gets a new entry.

**Tech Stack:** Expo SDK 54, React Native, expo-router, axios client `lib/api.ts`. No mobile test runner exists: verification is `npx tsc --noEmit` (run in `mobile/`) plus the manual iPhone test.

**Spec:** `docs/superpowers/specs/2026-11-18-mobile-depositos-design.md`

## Global Constraints

- Spanish for UI text, English for code and comments (comments explain the why).
- Role gate: encargado, gerencial, super_admin only (`puedeAltaProduccion(role)` in `lib/altaProduccion.ts`). Regador/obrero must not see the drawer entry, and the drawer button keeps showing only the logo for them.
- Decimals from the API are strings: convert with `Number()` in the API layer. Quantities sent to the server are decimal strings.
- Ingreso endpoint: `POST /insumos/{id}/movimientos` with body `{ tipo: "ingreso", cantidad: <string>, fecha: "YYYY-MM-DD", observacion?: string }`. Quantity > 0, up to 2 decimals (column is Numeric(10,2)).
- Insumos: `GET /insumos/?is_active=true`; `tipo` values `fitosanitario` | `vario` | `riego`; `riego` is not shown. `unidad` is `kg` | `lt`.
- No offline queue; no idempotency key exists for movimientos. Double submit protection: `submittingRef` plus disabled button (same pattern as `components/AlfalfaModal.tsx`), and a confirmation step line before saving.
- Bodega card is computed from `getLotesPasa(undefined, true)` (lotes with saldo > 0): total `saldo_kg` and number of lotes. No new endpoint.
- Do not touch `mobile/eas.json` or native dependencies (OTA fingerprint).
- Each card that fails to load (403/network) shows «No disponible» and does not break the others.

## Review Focus

- Regador or obrero opens the app: no «Depósitos» entry and no crash in `ModulosButton`.
- One card request fails (e.g. alfalfa 500): the other four still render.
- Cantidad inputs: `0`, `-1`, `1,5` (comma), `1.555` (3 decimals), empty, `abc` are rejected with a clear message; `1.5` and `10` accepted.
- Double tap on Guardar sends one request.
- Ingreso for an insumo of the other type is impossible (the picker only lists the card's type).
- Empty lists (no insumos of a type, no lotes with saldo) show an empty state, not a blank card.

---

### Task 1: Data module `lib/depositos.ts`

**Files:**
- Create: `mobile/lib/fecha.ts`, `mobile/lib/depositos.ts`

**Interfaces:**
- Consumes: `api` from `lib/api.ts`; `getStockPasero`, `getLotesPasa`, `puedeAltaProduccion` from `lib/altaProduccion.ts`; `getStockAlfalfa` from `lib/alfalfa.ts`; `errorDetail` helper already used by `lib/alfalfa.ts` (import it from the same place).
- Produces (later tasks rely on these exact names):
  - `lib/fecha.ts`: `fechaValida(s: string): boolean` (moved verbatim from `AlfalfaModal.tsx`, rejects 2026-02-30) and `hoyISO(): string` (local date, `YYYY-MM-DD`).
  - `lib/depositos.ts`:
    - `type TipoInsumoDeposito = 'fitosanitario' | 'vario'`
    - `interface InsumoStock { id: string; nombre: string; unidad: 'kg' | 'lt'; tipo: string; stock_actual: number }`
    - `getInsumosStock(tipo: TipoInsumoDeposito): Promise<InsumoStock[]>` (filters `is_active`, `tipo`; sorted by `nombre`)
    - `registrarIngresoInsumo(insumoId: string, p: { cantidad: string; fecha: string; observacion?: string }): Promise<void>`
    - `cantidadInsumoValida(texto: string): boolean`
    - `interface ResumenBodega { kgSaldo: number; lotes: number }` and `getResumenBodega(): Promise<ResumenBodega>`
    - `interface ResumenPasero { kgTotal: number; porVariedad: { variedad: string; kg: number }[] }` and `getResumenPaseros(): Promise<ResumenPasero>` (sum `uva_disponible_kg` over `getStockPasero()`, grouped by variedad)

- [ ] **Step 1: Create `lib/fecha.ts`** with `fechaValida` (same logic and `FECHA_REGEX` as in `AlfalfaModal.tsx`) and `hoyISO`. Change `AlfalfaModal.tsx` to import `fechaValida` from it and delete its local copy; behavior must not change.
- [ ] **Step 2: Create `lib/depositos.ts`** with the signatures above. `cantidadInsumoValida`: `/^\d{1,8}(\.\d{1,2})?$/` and `Number(texto) > 0`. Comma is not accepted. `registrarIngresoInsumo` posts the body from Global Constraints and omits `observacion` when blank after `trim()`.
- [ ] **Step 3: Run** `cd mobile && npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 4: Commit**

```bash
git add mobile/lib/fecha.ts mobile/lib/depositos.ts mobile/components/AlfalfaModal.tsx
git commit -m "feat(mobile): depositos data module and shared date validator"
```

---

### Task 2: Screen and ingreso modal

**Files:**
- Create: `mobile/app/depositos/index.tsx`, `mobile/components/IngresoInsumoModal.tsx`
- Modify: `mobile/app/_layout.tsx` (register route `depositos/index`, header title «Depósitos», same header style as `alta-produccion/alfalfa`)

**Interfaces:**
- Consumes: everything produced by Task 1; `fmtKg` from `lib/altaProduccion.ts`; `PRODUCTO_LABELS`, `PRODUCTO_UNIDAD`, `getStockAlfalfa` from `lib/alfalfa.ts`; `EmptyState` from `components/ui/EmptyState`; patterns of `app/alta-produccion/alfalfa.tsx` and `components/AlfalfaModal.tsx` (modal shell, error banner, theme).
- Produces: the route `/depositos`; component `IngresoInsumoModal({ visible, tipo, insumos, onClose, onSaved })` where `tipo: TipoInsumoDeposito`, `insumos: InsumoStock[]` and `onSaved(): void` is called after a successful POST.

- [ ] **Step 1: Screen `app/depositos/index.tsx`.** Reload on focus (`useFocusEffect`) and pull-to-refresh. Load the five sources with `Promise.allSettled`, one state per card (`loading | error | data`). Cards in this order: Fitosanitarios, Insumos varios, Paseros, Bodega (bines de pasa), Alfalfa.
  - Fitosanitarios / Insumos varios: header with product count, a list of products (`nombre` + `stock_actual` + `unidad`, 2 decimals, es-AR format), the first 5 shown and a «Ver todos (N)» toggle that expands the rest in place. «+ Ingreso» button in the card header. Empty state when there are no insumos of that type.
  - Paseros: total kg (`fmtKg`) and one line per variedad.
  - Bodega: kg de pasa con saldo and number of lotes with saldo, labeled with the unit.
  - Alfalfa: one line per producto (`PRODUCTO_LABELS`), unidades or kg per `PRODUCTO_UNIDAD`.
  - A card in error shows «No disponible».
  - Redirect to the previous screen (or render nothing) if `!puedeAltaProduccion(role)`.
- [ ] **Step 2: Modal `IngresoInsumoModal`.** Fields: insumo (picker listing only `insumos`, required), cantidad (text, `decimal-pad`, `cantidadInsumoValida`), fecha (default `hoyISO()`, `fechaValida`), observaciones (multiline, placeholder «Proveedor y N° de remito»). Pressing the primary button runs validation, then shows a confirmation line «Se suman {cantidad} {unidad} a {stock actual} {unidad} de stock» with «Confirmar» and «Volver»; Confirmar calls `registrarIngresoInsumo` once (`submittingRef` guard, button disabled while sending). Server errors are shown inside the modal verbatim. On success: `onSaved()` then close; the screen refreshes the two insumo cards.
- [ ] **Step 3: Register the route in `_layout.tsx`.**
- [ ] **Step 4: Run** `cd mobile && npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5: Commit**

```bash
git add mobile/app/depositos/index.tsx mobile/components/IngresoInsumoModal.tsx mobile/app/_layout.tsx
git commit -m "feat(mobile): depositos screen with stock cards and insumo ingreso modal"
```

---

### Task 3: Drawer entry, permissions and docs

**Files:**
- Modify: `mobile/components/ModulosDrawer.tsx`
- Modify: `PROJECT_MAP.md` (regenerate), `docs/superpowers/specs/2026-11-18-mobile-depositos-design.md` (status and the bodega decision)
- Create: `docs/sistema/Bitácora/2026-11-18-mobile-depositos.md`

**Interfaces:**
- Consumes: route `/depositos` (Task 2); `puedeVerMaquinaria` from `lib/maquinaria.ts` and `puedeAltaProduccion` from `lib/altaProduccion.ts`.
- Produces: none.

- [ ] **Step 1: Permissions in `ModulosButton`.** Today it returns the plain logo unless `puedeVerMaquinaria(role)`. Change it to open the drawer when `puedeVerMaquinaria(role) || puedeAltaProduccion(role)` (both are the same role set today; use both so each entry has its own gate), and render each drawer item only when its own gate passes. Regador/obrero keep the plain logo.
- [ ] **Step 2: Drawer item «Depósitos»** below Maquinaria with the same row style, a warehouse-like icon taken from `lib/icons.ts` (pick an existing one; do not add a dependency), `router.push('/depositos')`, and no pending badge.
- [ ] **Step 3: Docs.** Run `python scripts/generate_project_map.py`. In the spec: set the status to «aprobado e implementado (sin desplegar)» and replace the bodega line with the real source (`GET /lotes-pasa/?con_saldo=true`, kg de saldo y cantidad de lotes; no backend nuevo). Write the Bitácora entry (what was built, decisions, pending web items: detalle por depósito, historial, columnas de proveedor/remito, idempotency key for movimientos).
- [ ] **Step 4: Run** `cd mobile && npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5: Commit**

```bash
git add mobile/components/ModulosDrawer.tsx PROJECT_MAP.md docs
git commit -m "feat(mobile): depositos entry in modules drawer; docs"
```
