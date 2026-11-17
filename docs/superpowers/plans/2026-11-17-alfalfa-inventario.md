# Alfalfa (fardos, rollos y semilla) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar de alta alfalfa por potrero, llevar su stock en el «Depósito Alfa» y sacarla a un comprador con documentos numerados y PDF, desde una pestaña nueva de Inventarios en la web.

**Architecture:** Dos tablas propias (`documentos_alfalfa` + `documento_alfalfa_lineas`); el stock se deriva (altas − salidas por producto), sin columna de saldo. Servicio `services/alfalfa.py` con las reglas, router `/alfalfa` con `require_encargado_estricto`, PDF con xhtml2pdf como el remito. Web: página nueva, cliente API y menú por rol.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2, xhtml2pdf + Jinja2, pytest (SQLite en memoria), Next.js (App Router, TS), axios.

**Spec:** `docs/superpowers/specs/2026-11-17-alfalfa-inventario-design.md`

## Global Constraints

- IDs UUID `String(36)`; cantidades y kg `Decimal` (`Numeric(14,2)`), nunca `float`; la API los serializa como string y el front usa `Number()`.
- Routers: `await db.flush()` + `await db.refresh(obj)`, **nunca commit** (commitea `get_db`); rutas estáticas antes de `/{id}`; sin `except` pelado.
- Migración nueva encima del head `c9b5b6bebbfd`, **aditiva**; no editar migraciones aplicadas. Nada se escribe en producción sin confirmación de Fausto.
- Fardo = 20 kg, rollo = 300 kg (parámetros `kg_fardo`, `kg_rollo`); semilla en kg. Depósito `"Depósito Alfa"`.
- Numeración `ALF-ALT-000001` / `ALF-SAL-000001`, automática, sin número manual.
- Roles: `require_encargado_estricto` (super_admin, gerencial, encargado); regador y obrero → 403.
- Fuera de alcance: anulación (paso 4), mobile (paso 5), consumo interno, precios, stock por potrero, FIFO.
- Probar en local (uvicorn + npm + click real) antes de commit de deploy. Sin deploy en este plan.

## Review Focus

- Salida exactamente igual al stock (saldo queda en 0): debe pasar; una unidad más → 409 sin crear nada.
- Alta con un potrero inactivo, o una parcela que no es `potrero` (p. ej. pasero), o inexistente: 422/404, nada creado.
- Cantidad fuera de `Numeric(14,2)` o con más de 2 decimales (semilla `0.001`, `1e15`): 422, nunca 500.
- Reintento con la misma `idempotency_key` y distinto contenido: devuelve el documento original, no crea otro.
- Encargado entrando por URL directa a Insumos/Producto Terminado: hoy sus endpoints son `require_encargado_up`, así que ya lo permiten; se audita y se informa (no se restringe en este plan).

---

### Task 1: Parámetros `kg_fardo` y `kg_rollo`

**Files:**
- Modify: `backend/app/services/alta_produccion.py` (`PARAMETROS_DEFAULT`, `Parametros`, `get_parametros`)
- Modify: `backend/app/schemas/alta_produccion.py` (`ParametrosResponse`, `ParametrosUpdate`)
- Modify: `backend/app/api/maestros_produccion.py` (`update_parametros_produccion`: persistir las dos claves nuevas como las existentes)
- Modify: `frontend/lib/api/altaProduccion.ts` (tipo + mapeo, default 20 y 300), `frontend/app/dashboard/documentacion/parametros/page.tsx` (`CAMPOS` + `aTexto`)
- Test: `backend/tests/test_alfalfa_parametros.py`

**Interfaces:**
- Produces: `Parametros.kg_fardo: Decimal`, `Parametros.kg_rollo: Decimal` (defaults `Decimal("20")`, `Decimal("300")`); `GET/PATCH /produccion/parametros` (el prefijo real es el de `maestros_produccion.router`) devuelven y aceptan ambos campos.

- [ ] **Step 1: Write the failing tests** — `test_parametros_default_alfalfa`: `GET` parámetros → `kg_fardo == "20.0000"`-equivalente (`Decimal(...) == 20`) y `kg_rollo == 300`. `test_patch_kg_fardo`: `PATCH {"kg_fardo": "22"}` → `GET` devuelve 22 y `kg_rollo` sigue en 300. `test_patch_kg_fardo_cero_422`.
- [ ] **Step 2: Run** `cd backend && ./venv/Scripts/python.exe -m pytest tests/test_alfalfa_parametros.py -v` → FAIL (campos inexistentes).
- [ ] **Step 3: Implement** las dos claves siguiendo exactamente el rastro de `mm_riego_manto` (default, dataclass, response, update con `ParametroDecimal | None`, upsert en el PATCH) y los dos campos en la pantalla («Kg por fardo», «Kg por rollo», ayuda: «Los documentos ya cargados conservan su valor»).
- [ ] **Step 4: Run** el test file + `tests/test_alta_produccion.py` → PASS; `cd frontend && npm run lint` → sin errores.
- [ ] **Step 5: Commit** `feat: parametros kg_fardo y kg_rollo`.

---

### Task 2: Modelos, migración y Depósito Alfa

**Files:**
- Create: `backend/app/models/alfalfa.py`
- Modify: `backend/app/models/__init__.py` (registrar)
- Create: `backend/app/core/migrations/versions/<rev>_alfalfa_documentos.py` (`down_revision = "c9b5b6bebbfd"`, generada con `alembic revision --autogenerate` y revisada)
- Test: `backend/tests/test_alfalfa_modelo.py`

**Interfaces:**
- Produces: `TipoDocumentoAlfalfa(str, Enum)` = `alta|salida`; `ProductoAlfalfa(str, Enum)` = `fardo|rollo|semilla`; `DocumentoAlfalfa` y `DocumentoAlfalfaLinea` con los campos de la spec (`documentos_alfalfa`, `documento_alfalfa_lineas`); relación `DocumentoAlfalfa.lineas` (selectin, `order_by` producto); `UniqueConstraint(tipo, numero)`, `UniqueConstraint(documento_id, producto)`, check alta⇒`potrero_id` NOT NULL y `comprador_id` NULL / salida⇒inverso, índice único parcial sobre `idempotency_key` donde no es NULL (`postgresql_where` y `sqlite_where`).

- [ ] **Step 1: Write the failing tests** — insertar un alta válida con 2 líneas; un alta sin `potrero_id` → `IntegrityError`; una salida con `potrero_id` → `IntegrityError`; dos líneas del mismo producto en un documento → `IntegrityError`; `(tipo, numero)` repetido → `IntegrityError`.
- [ ] **Step 2: Run** `pytest tests/test_alfalfa_modelo.py -v` → FAIL (módulo inexistente).
- [ ] **Step 3: Implement** el modelo (FKs a `parcelas`, `compradores`, `depositos` con nombre de FK explícito si el autogenerate lo pide, como `fk_remitos_pasero_id_parcelas`). Migración: crear tablas + seed idempotente por nombre de «Depósito Alfa» (patrón de `079038232ad0`) + seed de `kg_fardo=20` y `kg_rollo=300` en `parametros_produccion` solo si faltan. `downgrade` borra tablas y enums, **no** el depósito ni los parámetros.
- [ ] **Step 4: Run** los tests → PASS. Contra la Postgres **local**: `alembic upgrade head`, `alembic downgrade -1`, `alembic upgrade head`, y repetir `upgrade` para confirmar que el seed es idempotente (una sola fila «Depósito Alfa»).
- [ ] **Step 5: Commit** `feat(backend): modelos y migracion de alfalfa`.

---

### Task 3: Servicio y schemas

**Files:**
- Create: `backend/app/services/alfalfa.py`, `backend/app/schemas/alfalfa.py`
- Test: `backend/tests/test_alfalfa_servicio.py`

**Interfaces:**
- Consumes: `get_parametros` (Task 1), modelos (Task 2), `Comprador`, `Deposito`, `Parcela`/`TipoParcela.potrero`.
- Produces (todas `async`, sin commit):
  - `DEPOSITO_ALFA = "Depósito Alfa"`; `get_deposito_alfa(db, for_update: bool = False) -> Deposito` (por nombre, lo crea si falta).
  - `siguiente_numero(db, tipo: TipoDocumentoAlfalfa) -> str` (copia de `siguiente_numero_remito`: advisory lock en Postgres, `count+1`, bucle hasta número libre; prefijos `ALF-ALT` / `ALF-SAL`).
  - `stock_alfalfa(db) -> list[StockProducto]`; `@dataclass StockProducto(producto: ProductoAlfalfa, unidades: Decimal, kg: Decimal)`, siempre los tres productos (en 0 si no hay movimientos); para semilla `unidades == kg`.
  - `crear_documento(db, data: DocumentoAlfalfaCreate, user_id: str) -> tuple[DocumentoAlfalfa, bool]` (el bool es `creado`; `False` en reintento idempotente).
- Schemas: `LineaAlfalfaIn(producto, cantidad: Decimal)` con `Field(gt=0, max_digits=14, decimal_places=2)`; `DocumentoAlfalfaCreate(tipo, fecha, potrero_id | None, comprador_id | None, vehiculo_patente | None, observaciones | None (max 500), idempotency_key | None (max 36), lineas: list[LineaAlfalfaIn] (min 1))` con validadores: producto sin repetir, fardo/rollo entero; `LineaAlfalfaOut`, `DocumentoAlfalfaOut` (con `kg_total`), `StockProductoOut`.

- [ ] **Step 1: Write the failing tests** (fixtures de `conftest.py`; potrero y comprador creados a mano):
  - `test_alta_tres_lineas_congela_kg`: 10 fardos + 2 rollos + 50 semilla → kg 200 / 600 / 50, `kg_total == 850`, número `ALF-ALT-000001`; luego `PATCH` de `kg_fardo=25` y el documento viejo sigue con 200 kg.
  - `test_stock_altas_menos_salidas`: tras altas y una salida de 4 fardos, `stock_alfalfa` da fardos 6 u / 120 kg.
  - `test_salida_igual_al_stock_pasa` y `test_salida_mayor_al_stock_409`: el 409 menciona el producto y el saldo y `count(documentos_alfalfa)` no cambia.
  - `test_fardo_fraccionario_422`, `test_producto_repetido_422`, `test_semilla_tres_decimales_422`, `test_cantidad_fuera_de_rango_422`.
  - `test_alta_sin_potrero_422`, `test_salida_sin_comprador_422`, `test_potrero_inactivo_422`, `test_parcela_no_potrero_422` (pasero), `test_comprador_inexistente_404`.
  - `test_numeracion_correlativa_por_tipo`: dos altas → 000001/000002; una salida → `ALF-SAL-000001`.
  - `test_idempotency_key_reintento_devuelve_original`: mismo key con distinto contenido → mismo `id`, `creado is False`, un solo documento.
- [ ] **Step 2: Run** `pytest tests/test_alfalfa_servicio.py -v` → FAIL.
- [ ] **Step 3: Implement** según las firmas. Reglas: alta valida potrero activo de tipo `potrero` (404 si no existe, 422 si inactivo o de otro tipo); salida valida comprador activo, toma `get_deposito_alfa(for_update=True)` para serializar y compara cada línea contra `stock_alfalfa`; los kg se congelan con `get_parametros` (fardo × `kg_fardo`, rollo × `kg_rollo`, semilla = cantidad); el reintento busca por `idempotency_key` antes de numerar.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(backend): servicio de alfalfa con stock derivado`.

---

### Task 4: API `/alfalfa`

**Files:**
- Create: `backend/app/api/alfalfa.py`
- Modify: `backend/app/main.py` (import + `app.include_router(alfalfa.router)`)
- Test: `backend/tests/test_alfalfa_api.py`

**Interfaces:**
- Consumes: Task 3. La ruta `GET /alfalfa/documentos/{id}/pdf` no se crea acá: la agrega completa la Task 5.
- Produces: `GET /alfalfa/stock -> list[StockProductoOut]`; `GET /alfalfa/documentos` (filtros `tipo`, `fecha_desde`, `fecha_hasta`, `potrero_id`, `comprador_id`, `skip`, `limit` ≤ 200, orden fecha desc, `created_at` desc); `POST /alfalfa/documentos -> DocumentoAlfalfaOut` (201 si es nuevo, 200 en reintento idempotente); `GET /alfalfa/documentos/{id}` (404 si no existe). Todas con `require_encargado_estricto`; estáticas (`/stock`, `/documentos`) antes de `/documentos/{id}`.

- [ ] **Step 1: Write the failing tests** — flujo HTTP alta → stock → salida → listado con filtro `tipo=salida`; `POST` de reintento devuelve 200 y mismo `id`; `GET /documentos/{uuid-inexistente}` → 404; matriz de roles: encargado, gerencial y super_admin → 2xx, regador y obrero → 403 en las 4 rutas, sin token → 401; decimales llegan como string.
- [ ] **Step 2: Run** `pytest tests/test_alfalfa_api.py -v` → FAIL.
- [ ] **Step 3: Implement** el router delegando todo en el servicio; el commit lo hace `get_db`.
- [ ] **Step 4: Run** el test file + `pytest` completo → PASS.
- [ ] **Step 5: Commit** `feat(backend): endpoints de alfalfa`.

---

### Task 5: PDF numerado

**Files:**
- Create: `backend/app/core/pdf_alfalfa.py`, `backend/app/templates/alfalfa_documento.html`
- Modify: `backend/app/api/alfalfa.py` (ruta `GET /documentos/{id}/pdf`)
- Test: `backend/tests/test_alfalfa_pdf.py`

**Interfaces:**
- Produces: `@dataclass DatosAlfalfaPdf(titulo: str, numero: str, fecha: date, contraparte_label: str, contraparte_nombre: str, vehiculo_patente: str | None, observaciones: str | None, lineas: list[tuple[str, Decimal, Decimal]], kg_total: Decimal)` y `generar_pdf_alfalfa(d: DatosAlfalfaPdf) -> bytes`. Título «Alta de alfalfa» / «Entrega de alfalfa»; `contraparte_label` «Potrero» / «Comprador»; tabla producto · cantidad · kg y total. Respuesta inline, `application/pdf`, `Cache-Control: no-store`, filename `alfalfa-<numero>.pdf`. Estilo, empresa y helpers de formato es-AR copiados de `pdf_remito.py` / `remito_entrega.html` (reusar `_fmt_fecha` y `_fmt_kg` importándolos, no duplicarlos).

- [ ] **Step 1: Write the failing tests** — alta y salida: `GET .../pdf` → 200, `content-type` `application/pdf`, cuerpo empieza con `%PDF`, header `no-store`; id inexistente → 404; regador → 403.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** generador, plantilla y ruta (la ruta resuelve potrero/comprador y arma `DatosAlfalfaPdf`).
- [ ] **Step 4: Run** → PASS; abrir un PDF generado y revisar a ojo que entre en una hoja.
- [ ] **Step 5: Commit** `feat(backend): pdf de documentos de alfalfa`.

---

### Task 6: Cliente web y página Alfalfa

**Files:**
- Create: `frontend/lib/api/alfalfa.ts`, `frontend/app/dashboard/inventarios/alfalfa/page.tsx`, `frontend/components/alfalfa/AltaAlfalfaModal.tsx`, `frontend/components/alfalfa/SalidaAlfalfaModal.tsx`
- Modify: `frontend/lib/api/altaProduccion.ts` solo si hace falta exportar `abrirPdf` (hoy es función local; exportarla en vez de duplicarla).

**Interfaces:**
- Consumes: endpoints de la Task 4; listados de potreros y compradores que ya usa la web (`lib/api/parcelas`, `altaProduccion`).
- Produces (`lib/api/alfalfa.ts`): tipos `StockAlfalfa {producto; unidades: number; kg: number}`, `DocumentoAlfalfa`, funciones `getStockAlfalfa()`, `listarDocumentosAlfalfa(filtros)`, `crearDocumentoAlfalfa(payload)`, `abrirPdfAlfalfa(id, numero)`; cada Decimal pasa por `Number()` al leer. `crearDocumentoAlfalfa` genera un `idempotency_key` con `crypto.randomUUID()` por intento de guardado (se reutiliza si el usuario reintenta tras un error de red).

- [ ] **Step 1: Implement** el cliente y la página: tres tarjetas de stock (fardos y rollos en unidades y kg, semilla en kg), botones **+ Alta** y **+ Salida**, tabla de documentos con filtros tipo/fechas y botón PDF. Textos y estilos como el resto de Inventarios (`producto-terminado/page.tsx` de referencia).
- [ ] **Step 2: Implement** `AltaAlfalfaModal` (potrero obligatorio, fecha, líneas por producto, observaciones) y `SalidaAlfalfaModal` (comprador, fecha, patente, líneas; muestra el saldo disponible por producto y deshabilita guardar si lo supera). Ambos piden **confirmación explícita antes de guardar** (resumen del documento), porque no hay anulación hasta el paso 4; si el backend responde 409/422 se muestra `detail` sin cerrar el modal.
- [ ] **Step 3: Run** `cd frontend && npm run lint && npm run build` → sin errores (el build type-checkea).
- [ ] **Step 4: Commit** `feat(frontend): pagina de inventario de alfalfa`.

---

### Task 7: Menú por rol e índice de Inventarios

**Files:**
- Modify: `frontend/lib/navigation.ts` (`SubNavItem.allowedRoles?: Role[]`; ítem Alfalfa; `ALL_NAV` Inventarios: `href: '/dashboard/inventarios'`, `allowedRoles` + `'encargado'`)
- Modify: `frontend/app/dashboard/layout.tsx` (filtrar los ítems del sub-menú por `allowedRoles`, igual que `navItems`)
- Modify: `frontend/components/CommandPalette.tsx` (aplicar el mismo filtro en `SUB_NAV_ITEMS`; hoy no filtra por rol)
- Create: `frontend/app/dashboard/inventarios/page.tsx` (redirige: `encargado` → `/dashboard/inventarios/alfalfa`, resto → `/dashboard/inventarios/insumos`)

**Interfaces:**
- Produces: Insumos y Producto Terminado con `allowedRoles: ['super_admin','gerencial']`; Alfalfa para `['super_admin','gerencial','encargado']`. El `matchFn` de Inventarios no cambia.

- [ ] **Step 1: Implement** los cuatro cambios; el redirect espera a que el store cargue el usuario (`isLoading`) para no mandar a todos a Insumos por rol indefinido.
- [ ] **Step 2: Audit (solo lectura, no se cambia código):** `grep` de los endpoints que consumen `insumos/page.tsx` y `producto-terminado/page.tsx` y reportar su guard (`insumos.py` y `lotes_pasa.py` hoy usan `require_encargado_up`, que incluye encargado y regador). Dejar el hallazgo escrito en la bitácora y en el resumen final para que Fausto decida si se restringe.
- [ ] **Step 3: Run** `npm run lint && npm run build` → sin errores.
- [ ] **Step 4: Commit** `feat(frontend): menu de inventarios por rol y acceso del encargado a alfalfa`.

---

### Task 8: Verificación local y documentación

**Files:**
- Modify (regenerados, no a mano): `PROJECT_MAP.md`, `docs/sistema/Modelo de Datos.md`; bitácora en `docs/sistema/Bitácora/2026-11-17-alfalfa-inventario.md` (vía agente `docs-sync`)

- [ ] **Step 1: Suite completa** `cd backend && ./venv/Scripts/python.exe -m pytest` → verde; `cd frontend && npm run lint && npm run build` → verde. Delegar en el agente `qa-tester`.
- [ ] **Step 2: Click real en local** (skill `verificar-local`, uvicorn + `npm run dev` + Playwright/Chrome): como gerencial, alta con tres líneas en un potrero con fecha pasada, salida a un comprador, salida mayor al saldo (error visible), PDF de ambos; como encargado, el menú muestra solo Alfalfa dentro de Inventarios y `/dashboard/inventarios` aterriza en Alfalfa; como gerencial, el aterrizaje sigue en Insumos.
- [ ] **Step 3: Revisión** con la skill `revisar-antes-de-commit` (code-reviewer + qa-tester) y corregir hallazgos.
- [ ] **Step 4: Regenerar docs** (`python scripts/generate_project_map.py`, `python scripts/generate_modelo_datos.py`) y escribir la bitácora con el hallazgo de la auditoría de la Task 7.
- [ ] **Step 5: Commit** `docs: alfalfa en mapa del proyecto, modelo de datos y bitacora`. **No se hace push ni deploy**: se pide confirmación a Fausto (backend por merge a `main`, web con `npx vercel --prod`).
