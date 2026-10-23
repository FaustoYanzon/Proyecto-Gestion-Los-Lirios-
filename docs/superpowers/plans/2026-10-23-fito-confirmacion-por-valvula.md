# Fitosanitario: confirmación por válvula — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirmar órdenes de aplicación válvula por válvula (con responsable, resultado, observaciones y foto), avisar y revisar lo no aplicado/observado, y notificar por push las órdenes nuevas.

**Architecture:** Tabla hija `OrdenAplicacionValvula` bajo `OrdenAplicacionParcela`; cada confirmación crea un `RegistroFitosanitario` propio (con `valvula_id`) y descuenta stock con las ha de la válvula. La parcela/orden se cierran por agregación. Parcelas sin válvulas y órdenes viejas siguen usando el endpoint actual de confirmar parcela. Push reutiliza `PushToken` + Expo.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pytest (SQLite), Next.js (web), Expo SDK 54 (mobile).

**Spec:** `docs/superpowers/specs/2026-10-23-fito-confirmacion-por-valvula-design.md`

## Global Constraints

- IDs UUID `String(36)`; nunca commit en routers (commitea `get_db`); `await db.flush()` tras escribir.
- Cantidades con `Decimal`; la API las serializa como string → `Number()` en web/mobile.
- Resultado por válvula **solo** `completa` | `no_aplicada`. Sin "parcial": parcial = `completa` + observación, descuenta la superficie completa de la válvula.
- Orden de confirmación libre (sin forzar secuencia).
- Push de orden nueva: a **todos** los tokens. Alerta de revisión: solo a `encargado` y superiores.
- Migraciones ya aplicadas no se editan; migración nueva. Tras modelos/routers/pantallas: `python scripts/generate_project_map.py` y `python scripts/generate_modelo_datos.py`.
- Probar en local (uvicorn + npm + Chrome) antes de deployar; backend a Railway **antes** del OTA mobile. Mobile: `eas update --branch production --environment production`; Android ver `mobile/AGENTS.md`. Web: `npx vercel --prod` manual. Producción (script de superficie, deploys) se confirma con Fausto.
- Código backend en `backend/`; correr tests con `./venv/Scripts/python.exe -m pytest`.

## Review Focus

- Confirmar dos veces la misma válvula (doble toque / reintento de red) → 409, sin segundo descuento de stock.
- Válvula con `superficie_ha` NULL → 422 claro, sin registro ni descuento.
- `no_aplicada` sin observaciones → 422; `no_aplicada` no crea `RegistroFitosanitario` ni mueve stock.
- Operario de otra finca confirmando/viendo válvulas ajenas → 403 / filtradas en `/pendientes`.
- Falla de Expo (timeout, 5xx) al crear orden o alertar → la orden/confirmación igual se guarda (push nunca rompe la operación).
- Orden creada antes del cambio (sin filas de válvula) y parcela sin válvulas → siguen confirmándose por parcela entera.

---

### Task 1: Modelos y migración

**Files:**
- Modify: `backend/app/models/valvula.py` (agregar `superficie_ha`), `backend/app/models/produccion.py` (enum `ResultadoValvula`, `OrdenAplicacionValvula`, `RegistroFitosanitario.valvula_id`, relación `OrdenAplicacionParcela.valvulas`), `backend/app/models/__init__.py`, `backend/tests/conftest.py` (`create_valvula` acepta `superficie_ha`)
- Create: migración Alembic (skill `nueva-migracion`)
- Test: `backend/tests/test_orden_valvulas.py`

**Interfaces:**
- Produces: `Valvula.superficie_ha: Mapped[Decimal | None]` (Numeric(8,4)); `ResultadoValvula` enum (`completa`, `no_aplicada`); `OrdenAplicacionValvula` con campos del spec (`id, orden_parcela_id, valvula_id, estado: EstadoOrdenAplicacionParcela, resultado: ResultadoValvula | None, responsable_id, responsable, observaciones, registro_fitosanitario_id, confirmada_at, revisada_at, revisada_por`), único `(orden_parcela_id, valvula_id)`; `OrdenAplicacionParcela.valvulas` (cascade delete-orphan); `RegistroFitosanitario.valvula_id: str | None` FK `valvulas.id`.

- [ ] **Step 1: Test** `test_orden_valvula_unica_por_parcela_de_orden`: insertar dos `OrdenAplicacionValvula` con el mismo `(orden_parcela_id, valvula_id)` → `IntegrityError`.
- [ ] **Step 2:** Correr el test; debe fallar (`ImportError`).
- [ ] **Step 3:** Implementar modelos con índices `ix_..._orden_parcela`, `ix_..._revision` (parcial: `resultado IS NOT NULL AND revisada_at IS NULL`, mismo estilo `postgresql_where` que el resto) y unique de registro. Revisar que la relación `RegistroFitosanitario.orden_parcela` (historial) siga funcionando y agregar `orden_valvula` análoga.
- [ ] **Step 4:** `alembic revision --autogenerate -m "orden aplicacion valvulas"`, revisar el archivo (nada de drops inesperados), `alembic upgrade head` en local. Correr test → PASS.
- [ ] **Step 5:** Commit `feat(backend): modelos de confirmación por válvula`.

### Task 2: Script de superficie por válvula

**Files:**
- Create: `scripts/cargar_superficie_valvulas.py`
- Test: `backend/tests/test_superficie_valvulas.py` (función pura de área)

**Interfaces:**
- Produces: `area_ha(coords: list[list[float]]) -> Decimal` (polígono lon/lat WGS84 → ha, proyección equirectangular local; error < 0.5 % a esta escala).

- [ ] **Step 1: Test** `test_area_ha_cuadrado_100m`: un cuadrado de ~100 m × 100 m en lat -33.0 da `1.0 ± 0.01` ha.
- [ ] **Step 2:** Falla; **Step 3:** implementar `area_ha` (shoelace sobre metros) y el `main`: lee `frontend/public/layers/Cuadrantes de Riego.geojson`, empareja `Valvula Correspondiente` con `Valvula.nombre`, por defecto **dry-run**: imprime tabla por parcela con suma de válvulas vs `Parcela.superficie_ha` y diferencia %, y lista válvulas sin cuadrante / cuadrantes sin válvula. `--aplicar` escribe `Valvula.superficie_ha` (mismo estilo que `scripts/seed_valvulas.py`).
- [ ] **Step 4:** Test PASS; correr dry-run contra DB local y revisar la tabla con Fausto. Si hay parcelas con diferencia > 5 %, decidir con Fausto antes de `--aplicar` en producción.
- [ ] **Step 5:** Commit.

### Task 3: Filas de válvula al crear/editar órdenes

**Files:**
- Modify: `backend/app/api/ordenes_aplicacion.py` (`crear_orden_desde_plan`, `crear_orden_extra`, `actualizar_orden_extra`, `_ORDEN_LOAD_OPTS`, `_to_response`), `backend/app/schemas/produccion.py`
- Test: `backend/tests/test_orden_valvulas.py`

**Interfaces:**
- Produces: `async def _crear_filas_valvula(db, item: OrdenAplicacionParcela, valvula_ids: list[str] | None) -> None` (todas las `Valvula` activas de `item.parcela_id`; si `valvula_ids` se pasa, solo esas); `OrdenAplicacionValvulaResponse(id, valvula_id, valvula_nombre, superficie_ha: Decimal | None, estado, resultado, responsable, observaciones, confirmada_at)`; `OrdenAplicacionParcelaResponse.valvulas: list[OrdenAplicacionValvulaResponse] = []`; `OrdenAplicacionCreateExtra.valvula_ids: list[str] | None = None` (para el repaso; valida que pertenezcan a las parcelas elegidas).

- [ ] **Step 1: Tests:** (a) orden desde plan para Parral 2 con válvulas 21/22/23 → respuesta trae 3 `valvulas` en estado `pendiente`, ordenadas por `Valvula.orden`; (b) parcela sin válvulas → `valvulas == []`; (c) extra con `valvula_ids=[v21]` → solo esa fila; (d) `valvula_ids` de otra parcela → 422; (e) editar extra regenera filas coherentes con las parcelas nuevas.
- [ ] **Step 2:** Fallan; **Step 3:** implementar (cargar `valvulas` con `selectinload` en `_ORDEN_LOAD_OPTS`); **Step 4:** PASS + suite completa; **Step 5:** commit.

### Task 4: Confirmar válvula + foto + cierre por agregación

**Files:**
- Modify: `backend/app/api/ordenes_aplicacion.py`, `backend/app/schemas/produccion.py`
- Test: `backend/tests/test_orden_valvulas.py`

**Interfaces:**
- Consumes: `_calcular_cantidad_total`, `_aplicar_movimiento_stock`, `_resolve_responsable_nombre` de `app/api/produccion.py`; `_crear_filas_valvula` (Task 3).
- Produces: `ConfirmarValvulaRequest(resultado: ResultadoValvula, responsable_id: str | None = None, observaciones: str | None = None)`; `POST /ordenes-aplicacion/{orden_id}/valvulas/{orden_valvula_id}/confirmar -> OrdenAplicacionValvulaResponse`; `POST /ordenes-aplicacion/valvulas/{orden_valvula_id}/fotos` (mismo patrón que `subir_foto_aplicacion`, exige registro existente). Declarar rutas estáticas antes de las parametrizadas.

- [ ] **Step 1: Tests:** (a) `completa` crea `RegistroFitosanitario` con `valvula_id`, `cantidad_total == dosis × superficie_ha` y baja `Insumo.stock_actual` exacto; (b) confirmar 21 y 22 deja parcela `pendiente` y orden `en_curso`; al confirmar 23 parcela `aplicada` y orden `completada`; (c) orden libre (23 antes que 21); (d) 2ª confirmación → 409 y stock sin cambio; (e) `superficie_ha` NULL → 422; (f) `no_aplicada` sin observaciones → 422; con observaciones: sin registro, sin cambio de stock, la parcela igual se cierra al resolver todas; (g) responsable por defecto = `current_user.trabajador_id`; `responsable_id` explícito inválido → 404; (h) usuario de otra finca → 403; (i) endpoint viejo de confirmar parcela sigue andando en parcela sin válvulas; con válvulas → 409 "confirmar por válvula".
- [ ] **Step 2:** Fallan; **Step 3:** implementar reutilizando la lógica de `confirmar_aplicacion`; factorizar el cálculo de estado de orden en `_recalcular_estados(orden)`. **Step 4:** PASS + suite; **Step 5:** commit.

### Task 5: Revisión ("A revisar") y orden de repaso

**Files:**
- Modify: `backend/app/api/ordenes_aplicacion.py`, `backend/app/schemas/produccion.py`
- Test: `backend/tests/test_orden_valvulas.py`

**Interfaces:**
- Produces: `GET /ordenes-aplicacion/a-revisar -> list[ValvulaARevisarResponse]` (válvulas con `resultado == no_aplicada` **o** `completa` con observaciones no vacías, `revisada_at IS NULL`; campos: orden, parcela, válvula, responsable, observaciones, fotos, fecha), requiere `require_encargado_up`; `POST /ordenes-aplicacion/valvulas/{orden_valvula_id}/revisar` (marca `revisada_at/por`, idempotente). Predicado compartido: `def requiere_revision(v: OrdenAplicacionValvula) -> bool` (usado también por Task 6).

- [ ] **Step 1: Tests:** completa sin obs → no aparece; completa con obs → aparece; no_aplicada → aparece; tras `/revisar` desaparece; operario → 403; crear orden extra con `valvula_ids` del repaso y luego `/revisar` desde el cliente funciona.
- [ ] **Step 2–5:** fallan → implementar → PASS → commit.

### Task 6: Push (orden nueva y alerta de revisión)

**Files:**
- Modify: `backend/app/core/push.py`, `backend/app/api/ordenes_aplicacion.py`
- Test: `backend/tests/test_push_ordenes.py`

**Interfaces:**
- Produces (en `push.py`, `send_expo_push(messages) -> int` se mantiene intacta para `birthdays`/`cheques_aviso`): `async def notificar_tokens(titulo: str, cuerpo: str, user_ids: list[str] | None = None, data: dict | None = None) -> None` — abre su propia sesión (`AsyncSessionLocal`), arma mensajes en lotes de 100, lee los tickets de la respuesta y borra los `PushToken` con `DeviceNotRegistered`; captura y loguea toda excepción (nunca propaga).
- Se dispara con `BackgroundTasks.add_task(notificar_tokens, ...)` desde `crear_orden_desde_plan` y `crear_orden_extra` ("Nueva orden: {parcelas} – {insumo}", `user_ids=None`), y desde la confirmación de válvula cuando `requiere_revision` (`user_ids` = usuarios con rol ≥ encargado).

- [ ] **Step 1: Tests** (monkeypatch del cliente HTTP; helper `_ids_encargado_up(db)` testeable aparte): crear orden invoca `notificar_tokens` una vez con `user_ids=None`; 250 tokens → 3 lotes (100/100/50); ticket `DeviceNotRegistered` borra ese token; excepción de red no propaga y la orden se crea 201; confirmar válvula con obs invoca con solo usuarios encargado+; sin obs no invoca.
- [ ] **Step 2–5:** fallan → implementar → PASS → commit. Nota: tokens por usuario son 1; documentarlo en docstring.

### Task 7: Mobile — acordeón por válvula y modal

**Files:**
- Modify: `mobile/lib/types.ts` (`OrdenAplicacionValvulaItem`, `ResultadoValvula`, `valvulas` en `OrdenAplicacionParcelaItem`), `mobile/lib/api.ts` (`confirmarValvulaOrden(ordenId, ordenValvulaId, {resultado, responsable_id?, observaciones?})`, `subirFotoValvula(ordenValvulaId, uri)`), `mobile/components/OrdenesPendientes.tsx`
- Reutilizar: `mobile/components/TrabajadorPicker.tsx`

**Interfaces:**
- Consumes: respuesta `valvulas` de `/ordenes-aplicacion/pendientes` y endpoints de Task 4.

- [ ] **Step 1:** Tipos y funciones de API (fotos con el mismo `FormData` que `subirFotoAplicacion`).
- [ ] **Step 2:** `OrdenCard`: chip de parcela con `valvulas.length > 0` se expande/contrae mostrando chips de válvula (`pendiente` toca → modal; `aplicada` tachada con tilde; `no_aplicada` en color de alerta). Parcela sin válvulas conserva el chip actual y el modal viejo.
- [ ] **Step 3:** `ConfirmarValvulaModal`: resumen (parral, válvula, producto, dosis, ha), `TrabajadorPicker` precargado con el trabajador del usuario, selector Completa/No aplicada, observaciones (obligatorias si No aplicada, con validación en cliente), foto opcional. Mantener `submittingRef` anti doble toque.
- [ ] **Step 4:** `cd mobile && npx tsc --noEmit` sin errores (ver gotchas de `--stack-size` en memoria del proyecto).
- [ ] **Step 5:** Probar en local (Expo web + backend local): crear orden en Parral 2, confirmar 21, 22, 23 y ver el parral tildarse; probar no_aplicada sin observaciones. Commit.

### Task 8: Web — historial por válvula y panel "A revisar"

**Files:**
- Modify: `frontend/lib/api/ordenesAplicacion.ts`, `frontend/app/dashboard/produccion/ordenes-aplicacion/page.tsx`, `frontend/components/produccion/AplicacionesRealizadas.tsx`
- Create: `frontend/components/produccion/ARevisarPanel.tsx`

- [ ] **Step 1:** Tipos/fetchers para `valvulas`, `GET /a-revisar`, `POST /revisar`.
- [ ] **Step 2:** `AplicacionesRealizadas`: cada parcela expandible con sus válvulas (responsable, resultado, observaciones, foto).
- [ ] **Step 3:** `ARevisarPanel` como pestaña "A revisar" con contador; botón "Crear orden de repaso" abre el formulario de orden extra precargado (variedad, parcela, `valvula_ids`, insumo/dosis de la orden origen) y al crearla llama a `/revisar`; botón "Marcar revisada" sin repaso.
- [ ] **Step 4:** `cd frontend && npm run lint && npm run build` verdes; probar en local con Chrome. Commit.

### Task 9: Docs y despliegue por fases

- [ ] **Step 1:** Regenerar `PROJECT_MAP.md` y `docs/sistema/Modelo de Datos.md`; escribir bitácora (skill/agente `docs-sync`).
- [ ] **Step 2 (Fase 1+2, backend):** CI verde → con confirmación de Fausto: `alembic upgrade` en prod (`scripts/migracion/_alembic_prod.py`), correr `cargar_superficie_valvulas.py --aplicar` en prod, push a `main` (Railway). Verificar con la skill `verificar-local` y logs de Railway.
- [ ] **Step 3 (Fase 3, mobile):** `eas update` con la skill `deploy-lirios`; verificar bundle (grep URL de producción, sin IP LAN). Recordar: el OTA aplica en el 2º arranque; builds 5/6 no reciben OTA (ver memoria de builds).
- [ ] **Step 4 (Fase 4, web):** `cd /c/claude-projects/los-lirios/frontend && npx vercel --prod`.
- [ ] **Step 5:** Prueba real en producción con una orden chica y un operario; actualizar memoria del proyecto.
