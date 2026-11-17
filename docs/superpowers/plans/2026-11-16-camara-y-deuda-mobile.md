# Cámara en mobile y deuda previa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar 3 deudas (finca pisada, cola offline sin reintento/descarte, Sheet de Ingresos) por OTA con el fingerprint actual, y después sumar cámara con build nativo.

**Architecture:** Fase 1 toca solo JS (mobile + web) sin tocar `app.json`/`eas.json`, para que el OTA llegue a los builds vigentes. Fase 2 agrega el plugin de `expo-image-picker` y un helper `elegirImagen()`; solo llega a builds nuevos porque el fingerprint cambia.

**Tech Stack:** Expo SDK 54, React Native, zustand, AsyncStorage, expo-image-picker ~17; Next.js (frontend).

**Spec:** `docs/superpowers/specs/2026-11-16-camara-y-deuda-mobile-design.md`

**Estado:** ejecutado el 2026-11-16 (PR #7 fase 1, PR #8 fase 2). Desvíos respecto del plan: el `Sheet` de Ingresos se reemplazó por el `Drawer` compartido en vez de agregarle un portal; `clearStoredFinca` no hizo falta; el `versionCode` de `app.json` se ignora (`appVersionSource: remote`). Ver la bitácora `2026-11-16-camara-y-deuda-mobile`.

## Global Constraints
- Mobile no tiene test runner (sin jest): la verificación es `npx tsc --noEmit` en `mobile/` + prueba manual. No se inventa infraestructura de tests.
- Fase 1: NO tocar `mobile/app.json` ni `mobile/eas.json` (fingerprint).
- Fase 2: NO tocar `eas.json`. Subir `android.versionCode` (hoy 5).
- Frontend: antes de leer código de Next leer `frontend/AGENTS.md`. Verificar con `npm run lint && npm run build`.
- OTA: `eas update --branch production --environment production`, verificar bundle según `mobile/AGENTS.md` (URL de Railway presente, sin `192.168.x.x`). Lo corre Fausto con `!` y rutas absolutas.
- Comentarios de código en inglés; textos de UI en español. Confirmar con Fausto antes de push/deploy.
- Rama de trabajo: `feat/camara-y-deuda-mobile`.

## Review Focus
- Dos usuarios en el mismo teléfono: el encargado B entra después de que el gerencial dejó otra finca guardada → debe ver la suya.
- Descartar/reintentar un item que se está procesando justo en `processQueue` → no debe duplicar ni resucitar un item ya eliminado.
- Reintentar un item `failed` cuando el item ya no existe (descartado en otra pantalla) → no-op sin error.
- Usuario niega el permiso de cámara o de galería → mensaje claro, sin crash, sin foto.
- Build viejo sin el módulo nativo → `elegirImagen` avisa en vez de cerrar la app.

---

## File Structure
- `mobile/store/fincaStore.ts` — restauración de finca solo para gerencial/super_admin.
- `mobile/lib/offlineQueue.ts` — `retryFailed`, `discard`, `getFailedItems`.
- `mobile/components/FailedQueueSheet.tsx` (nuevo) — lista de `failed` con acciones.
- `mobile/components/OfflineQueueBanner.tsx` — abre la hoja.
- `frontend/app/dashboard/finanzas/ingresos/page.tsx` — `Sheet` con portal.
- `mobile/lib/imagePicker.ts` — `elegirImagen`.
- `mobile/app.json` — plugin + versionCode.
- 4 usos del picker: `app/maquinaria/reportar.tsx`, `app/maquinaria/orden/[id].tsx`, `components/OrdenesPendientes.tsx` (2 lugares), `app/(tabs)/perfil.tsx`.

---

# FASE 1 — OTA (fingerprint actual)

### Task 1: Finca restaurada solo para gerencial/super_admin

**Files:**
- Modify: `mobile/store/fincaStore.ts`, `mobile/components/UserBadge.tsx:25`

**Interfaces:**
- Produces: `loadFinca(): Promise<void>` (misma firma; ahora no-op salvo rol gerencial/super_admin).
- Consumes: `useAuthStore.getState().user` (puede ser null).

- [ ] **Step 1:** En `loadFinca()` leer `useAuthStore.getState().user`; si es null o su rol no es `gerencial`/`super_admin`, retornar sin restaurar. Cuidar el import circular (`authStore` ya importa `fincaStore`): leer el store con `require` diferido dentro de la función o mover la restauración a `authStore.initAuth` — elegir lo que no genere ciclo.
- [ ] **Step 2:** En `UserBadge.tsx`, hacer que `loadFinca` se dispare cuando `user` esté disponible (dependencia `user?.id`), no solo al montar, para que gerencial siga recuperando su última elección.
- [ ] **Step 3:** Run `cd mobile && npx tsc --noEmit` → sin errores.
- [ ] **Step 4:** Prueba manual (Review Focus 1): login gerencial, elegir Los Mimbres, logout, login encargado de Media Agua → ve Media Agua; login gerencial de nuevo → conserva Los Mimbres.
- [ ] **Step 5:** Commit `fix(mobile): finca guardada solo se restaura para gerencial`.

### Task 2: Reintentar y descartar items `failed` de la cola offline

**Files:**
- Modify: `mobile/lib/offlineQueue.ts`, `mobile/components/OfflineQueueBanner.tsx`
- Create: `mobile/components/FailedQueueSheet.tsx`

**Interfaces:**
- Produces en `offlineQueue.ts`:
  - `getFailedItems(): Promise<OfflineQueueItem[]>`
  - `retryFailed(id: string): Promise<void>` — pone `status: 'pending'`, `retryCount: 0`, borra `lastError`; no-op si el id no existe.
  - `discard(id: string): Promise<void>` — alias claro de `removeFromQueue` para items `failed`; no-op si no existe.
- `FailedQueueSheet` props: `{ visible: boolean; onClose: () => void; onChanged: () => void }`.

- [ ] **Step 1:** Implementar las 3 funciones en `offlineQueue.ts` (lectura-modificación-escritura como las existentes; `retryFailed` solo actúa sobre items con `status === 'failed'`).
- [ ] **Step 2:** Crear `FailedQueueSheet.tsx`: modal con cada item (etiqueta legible según prefijo de `endpoint`: `/maquinaria/` → "Reporte de falla", tareas, riego, otro → "Registro"; fecha `createdAt` local; `lastError`), botones «Reintentar» (llama `retryFailed`, luego `processQueue()` de `offlineSync`, luego `onChanged()`) y «Descartar» (`Alert.alert` de confirmación; luego `discard` y `onChanged()`). Estilo: mismos `colors`/tokens que `OfflineQueueBanner`.
- [ ] **Step 3:** En `OfflineQueueBanner`, la fila de `failed` pasa a ser tocable y abre `FailedQueueSheet`; `onChanged` refresca contadores. Actualizar el comentario "Solo lectura".
- [ ] **Step 4:** Run `npx tsc --noEmit` → sin errores.
- [ ] **Step 5:** Prueba manual: forzar un `failed` (reporte de falla con payload inválido o `markFailed` temporal desde consola de debug), reintentar → vuelve a pendiente y se procesa; descartar → desaparece y el banner se actualiza; descartar un item ya inexistente no rompe.
- [ ] **Step 6:** Commit `feat(mobile): reintentar y descartar items fallidos de la cola offline`.

### Task 3: Sheet de Ingresos con portal

**Files:**
- Modify: `frontend/app/dashboard/finanzas/ingresos/page.tsx:30-60`

**Interfaces:** `Sheet` conserva props `{ open, onClose, title, children }`.

- [ ] **Step 1:** Leer `frontend/components/maquinaria/Drawer.tsx` y copiar el patrón de `createPortal(…, document.body)` (incluido el guard de montaje en cliente que use).
- [ ] **Step 2:** Envolver el contenido de `Sheet` en el portal; mantener Escape, bloqueo de scroll y `z-50`.
- [ ] **Step 3:** Run `cd frontend && npm run lint && npm run build` → ambos OK.
- [ ] **Step 4:** Prueba en local (skill `verificar-local`): abrir «Nuevo ingreso» y editar uno; el drawer cubre header/sidebar y cierra con Escape y click afuera.
- [ ] **Step 5:** Commit `fix(frontend): Sheet de ingresos con portal a body`.

### Task 4: Publicar fase 1

**Files:** ninguno.

- [ ] **Step 1:** Skill `revisar-antes-de-commit` sobre el diff de Tasks 1–3 (code-reviewer + qa-tester).
- [ ] **Step 2:** Fausto confirma → push de la rama, PR y merge a `main` (CI verde).
- [ ] **Step 3:** `! cd /c/claude-projects/los-lirios/mobile && npx expo-fingerprint`/`fingerprint:compare` (según scripts de `mobile/package.json`) → fingerprint coincide con builds vigentes.
- [ ] **Step 4:** Fausto corre el OTA `production` y verifica el bundle (ver Global Constraints). Fausto corre `npx vercel --prod` desde `frontend/` con ruta absoluta (el log debe decir "Deploying fausto-yanzon/frontend").

---

# FASE 2 — Cámara (build nativo)

### Task 5: Helper `elegirImagen` y reemplazo en los 4 usos

**Files:**
- Modify: `mobile/lib/imagePicker.ts`, `mobile/app/maquinaria/reportar.tsx:81`, `mobile/app/maquinaria/orden/[id].tsx:140`, `mobile/components/OrdenesPendientes.tsx:75,213`, `mobile/app/(tabs)/perfil.tsx:89`

**Interfaces:**
- Produces: `elegirImagen(opciones?: { aspect?: [number, number] }): Promise<string | null>`. Muestra `Alert.alert('Agregar foto', …)` con «Tomar foto», «Galería», «Cancelar»; devuelve el `uri` o `null`.
- Se mantiene `elegirImagenDeGaleria` como función interna (no exportada) y se agrega `tomarFoto` interna con `requestCameraPermissionsAsync` + `launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect, quality: 0.7 })`.

- [ ] **Step 1:** Implementar en `imagePicker.ts` manteniendo el `import()` diferido y el aviso «Fotos no disponibles» si falta el módulo. Permiso denegado → `Alert` «Permiso requerido» con texto específico de cámara o galería; sin foto.
- [ ] **Step 2:** Reemplazar las 5 llamadas por `elegirImagen(...)` (en `perfil.tsx` conservar `{ aspect: [1, 1] }`) y actualizar los imports.
- [ ] **Step 3:** Run `npx tsc --noEmit` → sin errores.
- [ ] **Step 4:** Commit `feat(mobile): elegir entre cámara y galería al adjuntar fotos`.

### Task 6: Plugin en `app.json` y versionCode

**Files:**
- Modify: `mobile/app.json`

- [ ] **Step 1:** Agregar a `plugins`: `["expo-image-picker", { "photosPermission": "Los Lirios SA necesita acceso a tus fotos para adjuntarlas a reportes y órdenes.", "cameraPermission": "Los Lirios SA usa la cámara para sacar fotos de fallas y aplicaciones." }]` (confirmar nombres de opciones en https://docs.expo.dev/versions/v54.0.0/sdk/imagepicker/; sin `microphonePermission`: no se graba video).
- [ ] **Step 2:** Subir `android.versionCode` de 5 a 6.
- [ ] **Step 3:** Run `npx expo config --type introspect` (o `npx expo prebuild --no-install` en directorio temporal) → el manifiesto incluye `android.permission.CAMERA` y el `Info.plist` `NSCameraUsageDescription`.
- [ ] **Step 4:** Commit `feat(mobile): plugin de expo-image-picker con permiso de cámara`.

### Task 7: Build, publicación y prueba en dispositivo

**Files:** ninguno. Todo lo corre Fausto con `!` y rutas absolutas; confirmar antes de cada paso (skill `deploy-lirios` + agente `release-manager`).

- [ ] **Step 1:** Review (`revisar-antes-de-commit`), push, PR, merge a `main` (CI verde).
- [ ] **Step 2:** Build Android `production` (AAB) → subir a prueba cerrada en Play Console; build iOS → TestFlight. Hacerlo antes del 2026-11-19.
- [ ] **Step 3:** Verificar en Play Console que el release no reinicia el conteo de 14 días de la prueba cerrada.
- [ ] **Step 4:** OTA `production` con el código de cámara (el nuevo fingerprint solo lo entrega al build nuevo); verificar bundle.
- [ ] **Step 5:** Prueba en dispositivo (Android e iOS): tomar foto y elegir de galería en reporte de falla, detalle de orden, órdenes de aplicación y avatar; negar permiso; reporte sin señal con foto. Esto cierra el punto 5 de Maquinaria (subida de fotos).
- [ ] **Step 6:** Skill/agente `docs-sync`: bitácora de la sesión, actualizar `Bugs Conocidos.md` (deuda cerrada) y regenerar `PROJECT_MAP.md`.

---

## Self-Review
- Cobertura del spec: Task 1 (finca), 2 (cola), 3 (Sheet), 4 (publicar fase 1), 5 (helper), 6 (plugin/versionCode), 7 (build/verificación/docs). Non-goals respetados (sin menores diferidos, sin tocar `eas.json`).
- Riesgo declarado: sin test runner en mobile, la prueba es manual + `tsc`; no se agrega jest en este alcance.
