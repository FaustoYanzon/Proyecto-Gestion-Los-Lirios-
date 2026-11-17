# Paseros en el mapa y fuera de riego/fito Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los paseros no entren a riego, fito, órdenes de aplicación ni plan fitosanitario, y que su panel del mapa muestre tareas, gasto y uva fresca (kg) con barra por variedad.

**Architecture:** Guardas 422 y filtros `tipo != pasero` en backend (defensa para clientes viejos); en web, una rama `tipo === 'pasero'` en `ParcelPanel` que reutiliza `GET /pasero/stock` y filtros en los selectores.

**Tech Stack:** FastAPI + SQLAlchemy async + pytest (SQLite en memoria); Next.js (App Router) + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-11-16-paseros-en-mapa-design.md`

## Global Constraints
- Rama: `feat/paseros-en-mapa`. Backend: PEP 8, type hints, sin `except` pelado, sin commit en routers. Tests: `cd backend && ./venv/Scripts/python.exe -m pytest <archivo> -q`.
- Frontend: antes de escribir código de Next, `frontend/AGENTS.md` (no es el Next conocido; docs en `node_modules/next/dist/docs/`). Verificar con `npm run lint && npm run build`.
- No tocar `GET /parcelas` ni los registros históricos. Paseros siguen en Tareas y Alta de producción.
- Textos de UI en español, código y comentarios en inglés. Confirmar con Fausto antes de push/deploy.

## Review Focus
- Pasero con riego/fito **históricos** en la base: el listado (`GET /riego/`, `GET /fitosanitarios/`) no debe romperse; solo se bloquean altas y ediciones nuevas.
- `PUT /fitosanitarios/{id}` que cambia `parcela_id` hacia un pasero → 422 (y sin tocar el stock ya revertido).
- Orden de aplicación por `variedad` sin `parcela_ids`, con un pasero que tiene variedad cargada → el pasero no entra.
- Panel del pasero con un rol sin acceso a `/pasero/stock` (403) → sin tarjeta y sin error visible.
- Pasero sin ingresos → «Sin uva ingresada»; kg totales 0 → sin barra ni división por cero.

---

### Task 1: Rechazar paseros en riego por goteo y fito

**Files:**
- Modify: `backend/app/api/produccion.py` (`_normalizar_riego` rama goteo ~l.836; `create_fitosanitario` ~l.1342; `update_fitosanitario` ~l.1394)
- Test: `backend/tests/test_paseros_fuera_de_riego_fito.py` (nuevo)

**Interfaces:**
- Produces: `_rechazar_pasero(parcela: Parcela | None, accion: str) -> None` en `produccion.py`; lanza `HTTPException(422, f"Los paseros no admiten {accion}.")` si `parcela.tipo == TipoParcela.pasero`.

- [ ] **Step 1: Tests (fallan primero).** Helpers locales `_auth(client, create_user)` (gerencial, como `test_insumo_stock.py`). Tests: `test_goteo_en_pasero_da_422` (POST `/produccion/riego/` con `cabezal="1"`, `valvula="1,2"`, parcela pasero → 422, detail contiene "pasero"); `test_iniciar_goteo_en_pasero_da_422` (POST `/produccion/riego/iniciar` tipo goteo); `test_fito_en_pasero_da_422` (payload de `_crear_fito` de `test_insumo_stock.py`); `test_fito_update_hacia_pasero_da_422_y_conserva_stock` (crear fito en parral, PUT `parcela_id` de un pasero → 422, `insumo.stock_actual` sin cambio); `test_listados_con_registro_historico_en_pasero_no_fallan` (insertar `RegistroFitosanitario` y `RegistroRiego` directo sobre un pasero, GET `/produccion/fitosanitarios/?parcela_id=` y `/produccion/riego/?parcela_id=` → 200 con 1 item).
- [ ] **Step 2:** Run `pytest tests/test_paseros_fuera_de_riego_fito.py -q` → los 4 primeros FALLAN (201/200 en vez de 422), el 5º pasa.
- [ ] **Step 3:** Implementar `_rechazar_pasero` y llamarla: en goteo de `_normalizar_riego` tras validar cabezal/válvula (cargar `await db.get(Parcela, data.get("parcela_id"))`; si es None no hacer nada, el 404/validación existente se mantiene); en `create_fitosanitario` justo después de obtener `parcela`; en `update_fitosanitario` **antes** de `revertir_movimiento_stock`, cuando `update_data` trae `parcela_id` (cargar la parcela nueva).
- [ ] **Step 4:** Run el archivo nuevo + `test_riego_manto.py test_insumo_stock.py test_produccion_idempotency.py -q` → todo PASS.
- [ ] **Step 5:** Commit `feat(backend): paseros no admiten riego por goteo ni fito`.

### Task 2: Excluir paseros de órdenes de aplicación y plan fitosanitario

**Files:**
- Modify: `backend/app/api/ordenes_aplicacion.py` (`_resolve_parcelas_orden` l.140-211), `backend/app/services/plan_avance.py` (`parcelas_stmt` ~l.233 y la carga por ids ~l.158), `backend/app/services/plan_contraste.py` (~l.68)
- Test: `backend/tests/test_paseros_fuera_de_riego_fito.py`

**Interfaces:**
- Consumes: `TipoParcela.pasero` de `app.models.parcela`.
- Produces: `_resolve_parcelas_orden` lanza 422 «Los paseros no admiten aplicaciones: <nombres>» con `parcela_ids` explícitos que incluyan un pasero, y los excluye en la ruta por `variedad`; `calcular_avance` y `calcular_contraste` ignoran paseros.

- [ ] **Step 1: Tests.** `test_orden_con_pasero_explicito_da_422` (helpers `crear_orden`/`linea` de `helpers_plan.py`; POST directo para leer el 422); `test_orden_por_variedad_no_incluye_pasero` (parral Flame + pasero con `variedad=flame`, `parcela_ids` omitido → `orden["parcelas"]` solo el parral); `test_plan_avance_ignora_pasero` (como `test_parcela_inactiva_y_otra_variedad_ignoradas`: pasero con variedad y un `RegistroFitosanitario` → no aparece en `calcular_avance`); `test_contraste_ignora_pasero` (`calcular_contraste` con el pasero elegido → no suma superficie).
- [ ] **Step 2:** Run → FALLAN.
- [ ] **Step 3:** Implementar los filtros (`Parcela.tipo != TipoParcela.pasero` en las tres consultas; 422 explícito solo en el camino `parcela_ids`).
- [ ] **Step 4:** Run `pytest tests/test_paseros_fuera_de_riego_fito.py tests/test_ordenes_aplicacion.py tests/test_plan_avance.py tests/test_plan_contraste.py tests/test_plan_fitosanitario.py -q` → PASS.
- [ ] **Step 5:** Commit `feat(backend): ordenes de aplicacion y plan fito ignoran paseros`.

### Task 3: Panel del pasero en el mapa

**Files:**
- Modify: `frontend/components/map/FincaMapInner.tsx` (`ParcelPanel` l.207-593, `getPolyStyle` l.115+)
- Create: `frontend/components/map/UvaPaseroCard.tsx`, `frontend/lib/api/paseroStock.ts` (si no existe un cliente para `GET /pasero/stock`; revisar `frontend/lib/api/altaProduccion.ts` y reutilizar)

**Interfaces:**
- Produces: `UvaPaseroCard({ paseroId }: { paseroId: string })`: consulta `GET /pasero/stock?pasero_id=` (queryKey `['pasero-stock', paseroId]`, `staleTime` 60 s, `retry: false`), suma `uva_disponible_kg` por `variedad`, muestra total en kg (`es-AR`), barra segmentada con `VAR_COLORS[variedad]` (fallback `#94a3b8`), leyenda «Variedad · N kg · P %». Estados: cargando (skeleton), 403/error → `null`, total ≤ 0 → «Sin uva ingresada».

- [ ] **Step 1:** En `ParcelPanel`, `const esPasero = parcela?.tipo === 'pasero'`. Pasar `enabled: !!parcela?.id && !esPasero` a las queries `panel-riego` y `panel-fito`.
- [ ] **Step 2:** Ocultar si `esPasero`: grid Cabezal (dejar solo Superficie), Cosecha, Ciclo de Campaña, Fenología, Agua, Aplicaciones fito. Mantener Costo laboral y Últimas tareas. Insertar `<UvaPaseroCard paseroId={parcela.id} />` después de la superficie.
- [ ] **Step 3:** Acciones rápidas: si `esPasero`, solo `{ key: 'tarea', label: '+ Tarea' }`.
- [ ] **Step 4:** `getPolyStyle`: en modos `cumplimiento` y `fito`, `f.type === 'pasero'` → estilo neutro (gris `#d1d5db`, sin tooltip de cumplimiento).
- [ ] **Step 5:** Run `cd frontend && npm run lint && npm run build` → sin errores nuevos.
- [ ] **Step 6:** Commit `feat(frontend): panel del pasero con uva fresca por variedad`.

### Task 4: Selectores web sin paseros

**Files:**
- Modify: `frontend/app/dashboard/produccion/riego/page.tsx` (`parralesConRiego` ~l.121), `frontend/components/produccion/NuevaOrdenAplicacion.tsx` (`grupos` ~l.481-499), `frontend/app/dashboard/produccion/plan-fitosanitario/page.tsx` (`variedadesDisponibles` ~l.294)

- [ ] **Step 1:** Agregar `p.tipo !== 'pasero'` a los tres filtros.
- [ ] **Step 2:** Run `npm run lint && npm run build` → OK.
- [ ] **Step 3:** Commit `fix(frontend): paseros fuera de los selectores de riego y fito`.

### Task 5: Verificar, revisar y publicar

- [ ] **Step 1:** `cd backend && ./venv/Scripts/python.exe -m pytest -q` → todo verde.
- [ ] **Step 2:** Click real en local (skill `verificar-local`, Playwright; Fausto hace el login): pasero con ingresos de dos variedades (cargar vía API local), panel, modos del mapa y que no aparezca en los selectores.
- [ ] **Step 3:** Skill `revisar-antes-de-commit`; corregir hallazgos.
- [ ] **Step 4:** Con confirmación de Fausto: push, PR, merge tras CI verde; Railway despliega solo; `npx vercel --prod` desde `frontend/` lo corre Fausto con `!`.

---

## Self-Review
- Spec: guardas backend (T1-T2), panel (T3), selectores (T4), verificación (T5). Mobile queda fuera por spec.
- Review Focus: cada línea tiene test (T1 listados históricos y PUT; T2 por variedad) o verificación manual (T3 403/vacío).
