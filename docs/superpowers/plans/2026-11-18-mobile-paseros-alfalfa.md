# Mobile: paseros en el mapa y alfalfa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el encargado/ingeniero cargue alfalfa (alta y entrega) y abra su PDF desde el celular, y que el pasero tenga en el mapa mobile su propio panel y quede fuera de riego y fito.

**Architecture:** Un endpoint nuevo de backend (enlace firmado del PDF de alfalfa, espejo del de remitos) y, en `mobile/`, un módulo `lib/alfalfa.ts`, una pantalla con modal de carga (patrón de `EntregaModal`), un acceso en la pestaña Cosecha y una rama `pasero` en el panel del mapa. Solo con conexión. Publicación por OTA.

**Tech Stack:** FastAPI + PyJWT + pytest (SQLite); Expo SDK 54 / React Native / TypeScript (`npx tsc --noEmit`); Axios `api` de `mobile/lib/api`.

**Spec:** `docs/superpowers/specs/2026-11-18-mobile-paseros-alfalfa-design.md`

## Global Constraints

- Mobile: leer `mobile/AGENTS.md` y los docs de Expo SDK 54 antes de escribir código; no tocar `mobile/eas.json` ni dependencias nativas (invalida el fingerprint y exige build nuevo). Sin paquetes nuevos que no sean JS puro.
- Backend: IDs UUID `String(36)`; sin commit en routers; rutas estáticas antes de las parametrizadas; sin `except` pelado.
- Cantidades como string decimal hacia la API; `Number()` al leer. Fardo y rollo en unidades enteras; semilla en kg (hasta 2 decimales).
- Roles que ven Alfalfa: los de `puedeAltaProduccion` (encargado, gerencial, super_admin). Anular NO va en el celular.
- Texto del paso de revisión, literal: «Revisá bien el documento antes de guardar: una vez guardado, solo un super admin puede anularlo.»
- La entrega de pasa, lotes, levantada e ingresos al pasero mobile **no se tocan**.
- Textos de UI en español; código y comentarios en inglés.
- Nada se despliega ni se publica por OTA sin confirmación de Fausto.

## Review Focus

- Doble toque en «Guardar» o reintento tras timeout: el mismo intento reutiliza el mismo `idempotency_key` y no duplica el documento; un intento nuevo genera otro.
- Entrega con stock insuficiente (409) o cantidad inválida (422): el error del backend se ve dentro del modal y el modal no se cierra ni pierde lo cargado.
- Fardo/rollo con decimales («1,5») o cantidad 0: se rechazan en el formulario antes de enviar; semilla acepta coma decimal.
- Token del PDF: un token de remito no abre PDF de alfalfa (ni al revés) y un token de acceso tampoco; vencido da 401.
- Panel del pasero sin ingresos, sin stock visible por rol (regador) o con la API caída: el panel abre sin error y sin la tarjeta de uva.

---

### Task 1: Backend — enlace firmado del PDF de alfalfa

**Files:**
- Modify: `backend/app/core/security.py` (junto a `create_remito_pdf_token`, ~línea 60-95)
- Modify: `backend/app/api/alfalfa.py`
- Modify: `backend/app/schemas/alfalfa.py`
- Test: `backend/tests/test_alfalfa_pdf_link.py` (nuevo)

**Interfaces:**
- Produces: `ALFALFA_PDF_SCOPE = "alfalfa_pdf"`, `ALFALFA_PDF_TOKEN_TTL_SECONDS = 300`, `create_alfalfa_pdf_token(documento_id: str, ttl_seconds: int = ...) -> str`, `decode_alfalfa_pdf_token(token: str) -> str | None`; `POST /alfalfa/documentos/{documento_id}/pdf-link` → `{path, url, expires_in}` (`AlfalfaPdfLinkResponse`); `GET /alfalfa/descarga/{token}` sin Authorization → PDF o 401.

- [ ] **Step 1: Write the failing tests** en `test_alfalfa_pdf_link.py` (patrón de los tests de remitos pdf-link; buscarlos con grep `pdf-link` en `backend/tests`): crear un alta vía `POST /alfalfa/documentos` como super_admin y pedir `pdf-link`; `test_pdf_link_abre_el_pdf_sin_authorization` (GET a `path` sin headers → 200, `content-type: application/pdf`, empieza con `%PDF`); `test_token_de_remito_no_abre_alfalfa` (token de `create_remito_pdf_token` en `/alfalfa/descarga/` → 401); `test_token_de_acceso_no_abre_alfalfa` (bearer de login → 401); `test_token_vencido_da_401` (`create_alfalfa_pdf_token(id, ttl_seconds=-1)`); `test_pdf_link_de_documento_anulado_sigue_abriendo`; `test_pdf_link_exige_encargado_o_superior` (regador → 403); `test_pdf_link_documento_inexistente_404`.
- [ ] **Step 2: Run** `./venv/Scripts/python.exe -m pytest tests/test_alfalfa_pdf_link.py -q` — Expected: FAIL (funciones y rutas no existen).
- [ ] **Step 3: Implement** los dos helpers en `security.py` copiando la estructura de los de remitos con `aud`/`typ`/`scope` = `"alfalfa_pdf"` y claim `did`; `decode_alfalfa_pdf_token` rechaza cualquier token cuyo `aud`/`typ` no sea ese (el decode con `audience` ya lo hace). En `api/alfalfa.py`: extraer la generación del PDF de `get_documento_pdf` a un helper `_pdf_response(db, documento_id) -> Response` reutilizado por la ruta autenticada y por `GET /alfalfa/descarga/{token}` (declararla **antes** de `/documentos/{documento_id}`); `POST /documentos/{documento_id}/pdf-link` con `require_encargado_estricto` que verifica que el documento exista (404) y arma `path=f"/alfalfa/descarga/{token}"`, `url` con `request.base_url`, `expires_in`. `AlfalfaPdfLinkResponse(path: str, url: str, expires_in: int)` en el schema.
- [ ] **Step 4: Run** el archivo de tests nuevo y `tests/test_alfalfa_*.py tests/test_anulacion_pdf.py` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): signed PDF link for alfalfa documents`.

---

### Task 2: Mobile — módulo `lib/alfalfa.ts`

**Files:**
- Create: `mobile/lib/alfalfa.ts`
- Modify (solo si hace falta exportar): `mobile/lib/altaProduccion.ts`

**Interfaces:**
- Consumes: `api` (axios), `errorDetail`, `getCompradores` y `Comprador` de `lib/altaProduccion.ts`; `Parcela` de `lib/types.ts`; la forma de `GET /alfalfa/stock`, `GET /alfalfa/documentos`, `POST /alfalfa/documentos` (ver `backend/app/schemas/alfalfa.py` y `frontend/lib/api/alfalfa.ts` para los campos).
- Produces:
  - `type ProductoAlfalfa = 'fardo' | 'rollo' | 'semilla'`, `PRODUCTO_LABELS`, `PRODUCTO_UNIDAD` (unidades / kg).
  - `interface StockAlfalfa { producto; unidades_o_kg: number; kg: number }` (nombres reales según el schema `StockProductoOut`), `interface DocumentoAlfalfa` (incluye `anulado`, `numero`, `tipo`, `fecha`, `lineas`).
  - `getStockAlfalfa(): Promise<StockAlfalfa[]>`, `getDocumentosAlfalfa(limit = 20): Promise<DocumentoAlfalfa[]>`, `getPotreros(): Promise<Parcela[]>` (activos, tipo potrero, orden natural por nombre, vía `/parcelas/mapa`).
  - `createDocumentoAlfalfa(payload: DocumentoAlfalfaCreate): Promise<DocumentoAlfalfa>`.
  - `abrirDocumentoAlfalfaPdf(documentoId: string): Promise<void>` → `POST /alfalfa/documentos/{id}/pdf-link` y `Linking.openURL(url)` (igual que `abrirRemitoPdf`).
  - `cantidadAlfalfaValida(producto: ProductoAlfalfa, texto: string): boolean`: fardo/rollo solo enteros > 0; semilla > 0 con hasta 2 decimales y coma o punto.

- [ ] **Step 1: Implement** el módulo con los nombres de arriba, decimales como string (`kgToString`), `Number()` al leer.
- [ ] **Step 2: Run** `npx tsc --noEmit` desde `mobile/` — Expected: sin errores.
- [ ] **Step 3: Commit** `feat(mobile): alfalfa api client`.

---

### Task 3: Mobile — pantalla Alfalfa, modal de carga y acceso

**Files:**
- Create: `mobile/app/alta-produccion/alfalfa.tsx`
- Create: `mobile/components/AlfalfaModal.tsx`
- Modify: `mobile/app/_layout.tsx` (registrar `alta-produccion/alfalfa` con el mismo header que `alta-produccion/entrega`, título «Alfalfa»)
- Modify: `mobile/app/(tabs)/cosecha.tsx` (acceso «Alfalfa», visible solo si `puedeAltaProduccion(role)`, junto a los accesos de Alta de producción, mismo estilo que «Entregar pasa a un comprador»)

**Interfaces:**
- Consumes: Task 2 completo; `EntregaModal.tsx` como patrón de modal/estilos; `useAuthStore`, `colors`, `ICONS`.
- Produces: `AlfalfaModal({ tipo: 'alta' | 'salida', potreros, compradores, onClose, onSaved(doc) })`.

- [ ] **Step 1: Implement la pantalla** (`alfalfa.tsx`): gate por `puedeAltaProduccion`; tarjetas de stock por producto (unidades o kg + kg), botones «Alta» y «Entrega», lista de los últimos 20 documentos (número, tipo, fecha, anulado marcado, toque abre el PDF), pull-to-refresh, estados de carga y error con reintento.
- [ ] **Step 2: Implement `AlfalfaModal`**: alta → potrero; entrega → comprador + patente opcional; fecha (hoy por defecto, formato de `hoyISO`); una fila de cantidad por producto (al menos una con valor; validar con `cantidadAlfalfaValida` antes de avanzar); observaciones opcional. Dos pasos: formulario → revisión (resumen + el texto literal de Global Constraints) → «Guardar». El `idempotency_key` se genera al abrir el modal y se mantiene para los reintentos del mismo intento (usar el mecanismo de UUID que ya use la app; grep `idempotency_key` / `randomUUID` en `mobile/`); se deshabilita el botón mientras guarda. Errores de la API con `errorDetail`, dentro del modal sin cerrarlo. Al guardar: `onSaved(doc)`, la pantalla refresca stock y documentos y ofrece «Abrir PDF» (`abrirDocumentoAlfalfaPdf`).
- [ ] **Step 3: Run** `npx tsc --noEmit` — Expected: sin errores.
- [ ] **Step 4: Commit** `feat(mobile): alfalfa screen with alta and entrega`.

---

### Task 4: Mobile — panel del pasero en el mapa y selectores sin pasero

**Files:**
- Modify: `mobile/app/(tabs)/mapa.tsx` (`ParcelPanelView` ~555, `handleParcelSelect` ~930, `fetchPanelExtras` ~880, y el JS del WebView ~289/353 para los modos `cumplimiento` y `fenologia`)
- Modify: `mobile/app/(tabs)/riego.tsx` (~415, ~506, y el selector de parcelas para riego goteo)
- Modify: `mobile/app/fito.tsx` y `mobile/app/(tabs)/fitosanitario.tsx` (selectores de parcela), y cualquier otro selector de órdenes de aplicación mobile (grep `tipo === 'parral'` / `/parcelas/mapa` en `mobile/`)
- Modify: `mobile/lib/types.ts` solo si `ParcelPanel` necesita un campo para el stock

**Interfaces:**
- Consumes: `getStockPasero(pasero_id)` y `puedeAltaProduccion` (en `lib/altaProduccion.ts`); `VARIEDAD_LABELS`, colores por variedad ya usados en el mapa.
- Produces: en el panel de un `tipo === 'pasero'`: superficie, últimas tareas, tarjeta «Uva fresca» (total kg + barra segmentada por variedad con kg en la leyenda; vacío «Sin uva ingresada»), solo acción «+ Tarea»; sin ciclo de campaña, fenología, riego, fito ni cabezal.

- [ ] **Step 1: Implement** la rama `pasero` en `ParcelPanelView`/`handleParcelSelect`: no consultar riego ni fito para paseros (`fetchPanelExtras` solo trae tareas); la tarjeta de uva se pide únicamente si `puedeAltaProduccion(role)` (`/pasero/stock` exige encargado+); si la consulta falla o el rol no alcanza, el panel abre sin la tarjeta y sin error visible.
- [ ] **Step 2: Implement** pasero neutro (gris) en los modos de color `cumplimiento` y `fenologia` del WebView (hoy lo pintan como parral sin datos).
- [ ] **Step 3: Implement** la exclusión de `pasero` en los selectores de riego, fito y órdenes de aplicación mobile (el backend ya devuelve 422); no tocar tareas ni Alta de producción, que sí usan paseros.
- [ ] **Step 4: Run** `npx tsc --noEmit` — Expected: sin errores.
- [ ] **Step 5: Commit** `feat(mobile): pasero panel in map and out of riego/fito selectors`.

---

### Task 5: Verificación local y documentación

**Files:**
- Create: `docs/sistema/Bitácora/2026-11-18-mobile-paseros-alfalfa.md`
- Create: `docs/sistema/Decisiones/2026-11-18-mobile-alfalfa-solo-con-conexion.md` (decisión de Fausto: opción A, offline después si hace falta; entrega de pasa sin cambios)
- Modify: `PROJECT_MAP.md` (regenerar con `python scripts/generate_project_map.py`)

- [ ] **Step 1: Run** `./venv/Scripts/python.exe -m pytest -q` en `backend/` (esperado: todo verde salvo el conocido `test_cumplimiento_cuenta_1_56_riegos_por_manto`) y `npx tsc --noEmit` en `mobile/`.
- [ ] **Step 2: Probar contra backend local** (uvicorn + Expo web/emulador según `verificar-local`; `EXPO_PUBLIC_API_URL` apuntando al local, nunca a producción): alta y entrega de alfalfa; entrega con stock insuficiente muestra el 409 en el modal; doble toque en Guardar crea un solo documento; PDF abre; panel de un pasero con ingresos de dos variedades; pasero ausente en riego y fito; usuario regador no ve el acceso. Registrar el resultado en la bitácora (qué se probó y qué no).
- [ ] **Step 3: Regenerar** `PROJECT_MAP.md` y escribir la bitácora y la decisión.
- [ ] **Step 4: Commit** `docs: mobile paseros y alfalfa`.

**Fuera del plan (requiere confirmación de Fausto, en este orden):** push a `main` (Railway despliega el endpoint nuevo), verificar el endpoint en producción, y recién después `EXPO_PUBLIC_API_URL=<url prod> npx eas update --branch production --environment production -m "..."` con verificación del bundle (URL de producción presente, sin `192.168.*`).
