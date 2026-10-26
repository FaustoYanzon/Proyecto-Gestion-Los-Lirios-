# Deshacer válvula + cierre de pendientes de fito/mercado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que super_admin, gerencial y encargado deshagan la confirmación de una válvula (web y mobile), verificar el fingerprint iOS del OTA y probar el wizard mobile con el selector de mercado MI/EXPO.

**Architecture:** Un endpoint nuevo `POST /ordenes-aplicacion/{orden_id}/valvulas/{orden_valvula_id}/deshacer` que revierte stock, borra el `RegistroFitosanitario` y sus fotos, y devuelve la fila de válvula, la parcela y la orden a pendiente. La UI web y mobile solo agrega un botón con confirmación. No hay migración.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + pytest (SQLite), Next.js (App Router, TS), Expo SDK 54.

**Spec:** decisiones de Fausto del 2026-10-26 (este chat) + `docs/superpowers/specs/2026-10-23-fito-confirmacion-por-valvula-design.md`.

## Global Constraints

- Roles permitidos para deshacer: `require_encargado_estricto` (super_admin, gerencial, encargado). **No** `require_encargado_up` (incluye regador).
- El encargado solo deshace válvulas de su finca (`parcela.finca == current_user.finca`); super_admin y gerencial, de cualquiera (mismo criterio que `confirmar_valvula`).
- Router sin commit: `await db.flush()`; commitea `get_db`. Lock por orden con `_bloquear_orden` antes de tocar nada.
- Cantidades `Decimal`. IDs UUID `String(36)`. Sin `except` pelado.
- El stock se revierte con `_revertir_movimiento_stock` (`app/api/produccion.py:146`), no con lógica nueva.
- Mobile: no tocar `mobile/eas.json` ni dependencias nativas (invalida el fingerprint y el OTA).
- Probar en local antes de pushear (skill `verificar-local`). Push y deploy los corre Fausto con `!`.

## Review Focus

- Deshacer una válvula `no_aplicada` (sin registro fito ni stock): no debe fallar ni tocar stock; sí borra sus fotos.
- Deshacer la última válvula de una orden `completada`: la orden vuelve a `en_curso`, no a `pendiente`.
- Deshacer la única válvula aplicada de una orden: la orden vuelve a `pendiente`.
- Doble toque o dos usuarios a la vez: la segunda llamada recibe 409 y el stock se devuelve una sola vez.
- Válvula ya revisada (`revisada_at` seteada): al deshacer se limpia `revisada_at`/`revisada_por` y desaparece de "A revisar".
- Regador o obrero: 403. Encargado de otra finca: 403.

---

## Estado de los pendientes que no necesitan código

### Task 0: Fingerprint iOS (verificado, sin acción)

Resultado de `eas-cli build:list --platform ios` (2026-10-26):
- Builds iOS 5 y 6 → runtime `07054827…` = el runtime del OTA iOS publicado hoy (update group `5433ffd0-4465-47e9-b44e-57fca39f4494`). **Les llega.**
- Build iOS 4 → runtime `1.0.0`. **No recibe OTA**: los testers con ese build deben actualizar desde TestFlight.

- [ ] **Step 1:** Confirmar con Fausto qué build tienen instalado los testers iOS (TestFlight → Builds). Si alguno tiene el 4, pedirle que actualice.
- [ ] **Step 2:** Registrar en la bitácora de la sesión (una línea) que iOS 5/6 reciben el OTA y el 4 no.

---

## Tareas de código

### Task 1: Endpoint `deshacer` en el backend

**Files:**
- Modify: `backend/app/api/ordenes_aplicacion.py` (nuevo endpoint junto a `confirmar_valvula`, línea ~601; import de `_revertir_movimiento_stock` y `require_encargado_estricto`, ya importado)
- Modify: `backend/app/api/ordenes_aplicacion.py` (`_recalcular_estado_orden`, línea 564: hoy solo sube de estado)
- Test: `backend/tests/test_orden_valvulas.py` (agregar; mismos fixtures que los tests de `confirmar_valvula`)

**Interfaces:**
- Produces: `POST /ordenes-aplicacion/{orden_id}/valvulas/{orden_valvula_id}/deshacer` → 200 `OrdenAplicacionValvulaResponse` (la fila ya en `pendiente`); 404 si la orden o la fila no existen o no son de esa orden; 409 `"Esta válvula todavía no fue confirmada"` si ya está pendiente; 403 por rol/finca.
- Produces: `async def _recalcular_estado_orden(db, orden) -> None` pasa a bajar el estado también: `completada` si todas las parcelas aplicadas; `en_curso` si alguna parcela o válvula está aplicada; si no, `pendiente`.

- [ ] **Step 1: Escribir los tests que fallan** en `test_orden_valvulas.py`, con estos nombres y aserciones:
  - `test_deshacer_valvula_completa_devuelve_stock_y_borra_registro`: confirmar `completa`, deshacer → 200, `estado == "pendiente"`, `resultado is None`, `confirmada_at is None`; `insumo.stock_actual` igual al inicial; no existe el `RegistroFitosanitario` ni su `MovimientoStock`.
  - `test_deshacer_valvula_no_aplicada_no_toca_stock`: confirmar `no_aplicada` con observaciones, deshacer → 200; stock sin cambios; la foto de la válvula (si se subió) ya no existe.
  - `test_deshacer_ultima_valvula_baja_parcela_y_orden`: orden `completada` → tras deshacer, parcela `pendiente` y orden `en_curso`.
  - `test_deshacer_unica_valvula_deja_orden_pendiente`: orden con una sola válvula aplicada → orden `pendiente`.
  - `test_deshacer_valvula_pendiente_da_409`.
  - `test_deshacer_dos_veces_da_409_y_stock_se_devuelve_una_vez`.
  - `test_deshacer_limpia_revision`: válvula con `revisada_at` seteada → tras deshacer, `revisada_at is None` y `revisada_por is None`; no aparece en `GET /ordenes-aplicacion/a-revisar`.
  - `test_deshacer_roles`: regador y obrero → 403; encargado de la misma finca → 200; encargado de otra finca → 403; gerencial → 200.
- [ ] **Step 2: Correr y ver que fallan:** `cd backend && ./venv/Scripts/python.exe -m pytest tests/test_orden_valvulas.py -k deshacer -v` → FAIL (404/405: la ruta no existe).
- [ ] **Step 3: Implementar `deshacer_valvula(orden_id, orden_valvula_id, db, current_user=Depends(require_encargado_estricto)) -> OrdenAplicacionValvulaResponse`** en `ordenes_aplicacion.py`, con la misma carga y validaciones de 404 y finca que `confirmar_valvula`. Orden de operaciones: `_bloquear_orden` → cargar fila con `orden_parcela.parcela`, `registro_fitosanitario` y `fotos` → 409 si `estado == pendiente` → si hay registro: `_revertir_movimiento_stock(db, registro)`, borrar las fotos del registro y de la fila (`FotoRegistroFitosanitario`), poner `fila.registro_fitosanitario_id = None` y `flush` **antes** de `db.delete(registro)` (FK) → resetear `estado`, `resultado`, `responsable_id`, `responsable`, `observaciones`, `confirmada_at`, `revisada_at`, `revisada_por` → si `item.estado == aplicada`, pasarlo a `pendiente` → `_recalcular_estado_orden`. Registrar con `logger.info` quién deshizo qué (usuario, orden, válvula) porque la acción borra datos.
- [ ] **Step 4: Ajustar `_recalcular_estado_orden`** para bajar el estado (ver Interfaces). Los tests existentes de confirmar no deben cambiar.
- [ ] **Step 5: Correr toda la suite:** `./venv/Scripts/python.exe -m pytest` → todo en verde (hoy 274 + los nuevos).
- [ ] **Step 6: Commit:** `feat(backend): deshacer la confirmación de una válvula (encargado y gerencial)`.

### Task 2: UI web — botón "Deshacer"

**Files:**
- Modify: `frontend/lib/api/ordenesAplicacion.ts` (junto a `revisarValvula`, línea 146)
- Modify: `frontend/app/dashboard/produccion/ordenes-aplicacion/page.tsx` (el detalle por válvula en la vista `aplicadas`; `puedeRevisar` en la línea ~700 ya calcula los mismos tres roles)

**Interfaces:**
- Consumes: el endpoint de la Task 1.
- Produces: `export async function deshacerValvula(ordenId: string, ordenValvulaId: string): Promise<void>` en `ordenesAplicacion.ts`.

- [ ] **Step 1:** Agregar `deshacerValvula` (POST a `/ordenes-aplicacion/${ordenId}/valvulas/${ordenValvulaId}/deshacer`).
- [ ] **Step 2:** Mostrar "Deshacer" en cada válvula aplicada, solo si `puedeRevisar` (super_admin, gerencial, encargado). Usar el modal de confirmación propio de la app, **no** `window.confirm` (bloquea la automatización del browser). El texto dice que se devuelve el stock y se borra el registro fitosanitario. Al confirmar: llamar, invalidar las queries de órdenes y `a-revisar`, mostrar error del backend si hay 409.
- [ ] **Step 3: Verificar** `cd frontend && npm run lint && npm run build` → sin errores.
- [ ] **Step 4: Commit:** `feat(web): botón para deshacer una válvula confirmada`.

### Task 3: UI mobile — botón "Deshacer"

**Files:**
- Modify: `mobile/lib/api.ts` (junto a `confirmarValvulaOrden`, línea 190)
- Modify: `mobile/components/OrdenesPendientes.tsx` (o la pantalla donde hoy se ven las válvulas ya confirmadas de una parcela; ver Step 1)

**Interfaces:**
- Consumes: el endpoint de la Task 1.
- Produces: `export async function deshacerValvulaOrden(ordenId: string, ordenValvulaId: string): Promise<void>`.

- [ ] **Step 1:** Confirmar dónde mobile muestra válvulas ya confirmadas. Si `OrdenesPendientes` solo lista pendientes, el botón va en el detalle de la parcela (donde se ven los estados por válvula); si ahí no se muestran las confirmadas, **parar y avisar a Fausto**: agregar esa vista es alcance nuevo.
- [ ] **Step 2:** Agregar `deshacerValvulaOrden` y el botón, visible solo si el rol del usuario es super_admin, gerencial o encargado (leer el rol del mismo store que usa el resto de la app). Confirmación con `Alert.alert` de dos botones (Cancelar / Deshacer); al terminar, recargar la orden.
- [ ] **Step 3: Verificar** `cd mobile && npx tsc --noEmit` → sin errores.
- [ ] **Step 4: Commit:** `feat(mobile): deshacer una válvula confirmada (encargado y gerencial)`.

### Task 4: Probar en local con click real

Usar la skill `verificar-local` (uvicorn + npm local + Claude in Chrome). La Postgres local no está sincronizada con prod: no es dato real.

- [ ] **Step 1:** Levantar backend local, `npm run dev` en `frontend/`.
- [ ] **Step 2:** Crear una orden chica, confirmar 2 válvulas (una `completa`, una `no_aplicada` con observación), anotar el stock del insumo.
- [ ] **Step 3:** Deshacer la `completa` en la web como gerencial → el stock vuelve al valor anotado, la válvula queda pendiente, la orden queda `en_curso`.
- [ ] **Step 4:** Deshacer la otra → la orden vuelve a `pendiente`.
- [ ] **Step 5:** Entrar como regador (o con un usuario sin permiso): el botón no aparece y el endpoint responde 403.

### Task 5: Probar el wizard mobile con el selector de mercado (MI/EXPO)

El selector vive en `mobile/app/(tabs)/cosecha.tsx` (líneas ~278–356, resumen en ~599, envío en ~748). Hoy solo se verificó que compila.

**No probar contra prod:** no hay anulación de remitos, así que un despacho de prueba en prod queda para siempre. Se prueba contra el backend local.

- [ ] **Step 1:** Backend local arriba (`uvicorn`) con datos de prueba: un comprador, un productor/parcela con cosecha y un usuario encargado.
- [ ] **Step 2:** Correr Expo en web contra el backend local, pasando la URL por variable de entorno en el comando (sin tocar `.env`): `cd mobile && EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start --web`. Abrir con Claude in Chrome. (Alternativa si algo no anda en web: Expo Go en el celular con `EXPO_PUBLIC_API_URL=http://<IP-de-la-PC>:8000`, misma red wifi.)
- [ ] **Step 3:** Casos a recorrer en Cosecha → Despacho:
  1. "Para: Uva en fresco" sin elegir mercado → el botón Siguiente queda deshabilitado.
  2. Elegir "Exportación" → el paso de confirmar muestra "Mercado: Exportación" → enviar → en la base local el remito es FRE y la cosecha tiene `destino = 'EXPO'`.
  3. Repetir con "Mercado interno" → destino `MI`.
  4. Cambiar "Para" a Bodega o Pasero → el selector de mercado desaparece y se limpia el valor.
  5. Reenviar el mismo despacho dos veces → idempotente (mismo remito, sin duplicar).
- [ ] **Step 4:** Anotar el resultado en la bitácora. Si algún caso falla, abrir el fix como tarea aparte antes de seguir.
- [ ] **Step 5 (opcional, después del deploy):** en el celular real con el OTA aplicado, solo mirar que el selector aparezca y se pueda elegir **sin enviar**, o enviar contra el comprador "ZZ-PRUEBA Bodega" una vez creado en prod (hoy sigue pendiente crearlo).

### Task 6: Revisión, deploy y cierre

- [ ] **Step 1:** Skill `revisar-antes-de-commit` (code-reviewer + qa-tester en paralelo sobre el diff). Corregir lo que salga.
- [ ] **Step 2:** `docs-sync`: regenerar `PROJECT_MAP.md` (no hay modelo ni migración nuevos, así que `Modelo de Datos.md` no cambia) y escribir la bitácora de la sesión.
- [ ] **Step 3:** Fausto corre `! git push origin main` (Railway despliega el backend). Verificar `Application startup complete` en `railway logs` y CI en verde.
- [ ] **Step 4:** Fausto corre `! cd /c/claude-projects/los-lirios/frontend && npx vercel --prod`.
- [ ] **Step 5:** Con Railway en SUCCESS, comparar fingerprint (`eas-cli fingerprint:compare --build-id b698e814-ef2c-4a0f-9dd3-344bcd074e69`) y publicar OTA: `! cd /c/claude-projects/los-lirios/mobile && npx eas update --branch production --environment production -m "Deshacer válvula" --non-interactive`. Si el fingerprint cambió, **no publicar**.
- [ ] **Step 6:** Prueba real en prod del deshacer con una orden chica de Parral 2 confirmada y deshecha por un gerencial (verificar stock del insumo antes y después).
- [ ] **Step 7:** Actualizar `memory/project_fito_por_valvula.md` (sacar "deshacer" y "iOS fingerprint" de pendientes).

## Orden y paralelismo

Task 1 primero (define el contrato). Tasks 2 y 3 en paralelo con `frontend-nextjs` y `mobile-expo` una vez que el endpoint esté mergeado en local. Task 5 es independiente y puede correr en paralelo desde el inicio. Tasks 4 y 6 al final.
