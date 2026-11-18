# Anulación de remitos de pasa y documentos de alfalfa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que solo el super_admin pueda anular remitos `entrega_pasa`/`salida_fresco`/`salida_bodega` y documentos de alfalfa, devolviendo los saldos y dejando el documento visible como «ANULADO».

**Architecture:** Soft-delete por marca (`anulado_at/anulado_by/motivo_anulacion`) en `remitos` y `documentos_alfalfa`; los cálculos de stock excluyen anulados; en entrega de pasa se repone `lote.saldo_kg` y se libera el bin vía `remito_lineas.anulada` + índice único parcial. Servicio nuevo `app/services/anulacion.py`, un endpoint `POST .../anular` por módulo, marca en PDF y botón/modal en la web.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2, Next.js (App Router; leer `frontend/AGENTS.md`), TanStack Query, xhtml2pdf + Jinja2.

**Spec:** `docs/superpowers/specs/2026-11-17-anulacion-pasa-alfalfa-design.md` (aprobada por Fausto; vinculante).

## Global Constraints
- Solo `require_super_admin` (`app/api/deps.py`) en los dos endpoints nuevos; gerencial, encargado y regador → 403.
- Motivo obligatorio, 5–500 caracteres (422 si no). Anular algo ya anulado → 409.
- «Anulado» = `anulado_at IS NOT NULL`. Check: `anulado_at`, `anulado_by`, `motivo_anulacion` todos NULL o todos NOT NULL.
- Anulables: `entrega_pasa`, `salida_fresco`, `salida_bodega`, alfalfa `alta` y `salida`. **No** anulables: `traslado_pasero` (409), `salida_bodega` con `comprobante_bodega` (409), alfalfa `alta` cuyo retiro deje stock negativo en unidades o kg de algún producto (409 con producto y saldo).
- Un documento anulado nunca cuenta en saldos ni stock; sí cuenta para la numeración (`count+1` incluye anulados); se sigue viendo en listados y PDF.
- El chequeo de `api/produccion.py` (~2209) que impide borrar una cosecha con líneas de remito **sigue contando** anulados.
- Migración nueva, aditiva, encima de `a1fa1fa00001`; no editar migraciones aplicadas. Round trip `upgrade`/`downgrade -1`/`upgrade` en la Postgres LOCAL. Nada toca producción.
- Convenciones backend: UUID `String(36)`, `Decimal`, `flush`+`refresh` sin commit en routers, rutas estáticas antes de las parametrizadas, sin `except` pelado. Código/comentarios en inglés, textos de UI en español.
- Attribution de commits: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus
- Una consulta que sume `RemitoLinea` o líneas de alfalfa sin excluir anulados (saldo de cosecha, `remitos_por_cosecha`, búsqueda en `despacho_cosecha`, `_entregas_de`, `conciliacion-bodega`, `stock_alfalfa`): cada una lleva su test de regresión.
- Doble anulación concurrente del mismo documento: la segunda debe recibir 409 y el saldo no debe reponerse dos veces (bloqueo de fila antes de leer `anulado_at`).
- Anular un alta de alfalfa con salidas dependientes: 409 y nada cambia.
- Re-entrega de un bin cuyo remito fue anulado: debe poder entregarse otra vez, y un bin de un remito vigente sigue sin poder entregarse dos veces.
- `saldo_kg` del lote tras entrega + anulación = valor original exacto (Decimal, sin deriva).

---

### Task 1: Modelo y migración

**Files:**
- Modify: `backend/app/models/alta_produccion.py` (`Remito`, `RemitoLinea`), `backend/app/models/alfalfa.py` (`DocumentoAlfalfa`)
- Create: `backend/app/core/migrations/versions/<rev>_anulacion_documentos.py` (down_revision `a1fa1fa00001`)
- Test: `backend/tests/test_anulacion_modelo.py`

**Interfaces:**
- Produces: `Remito.anulado_at: datetime | None`, `Remito.anulado_by: str | None`, `Remito.motivo_anulacion: str | None`; las mismas tres en `DocumentoAlfalfa`; `RemitoLinea.anulada: bool` (default False, server_default false); índice único parcial `uq_remito_linea_bin` ahora con `bin_id IS NOT NULL AND NOT anulada` (postgres y sqlite). Check constraints `ck_remito_anulacion_completa` y `ck_documento_alfalfa_anulacion_completa`.

- [ ] **Step 1: Write failing tests** in `test_anulacion_modelo.py`: (a) un `Remito` con `anulado_at` pero sin motivo/`anulado_by` viola el check; (b) lo mismo en `DocumentoAlfalfa`; (c) dos líneas con el mismo `bin_id` donde una tiene `anulada=True` se pueden insertar, dos con `anulada=False` → `IntegrityError`.
- [ ] **Step 2: Run** `./venv/Scripts/python.exe -m pytest tests/test_anulacion_modelo.py -v` → FAIL.
- [ ] **Step 3: Implement** columnas, checks e índice en los modelos; escribir la migración a mano (no autogenerate a ciegas): `add_column` ×7, `create_check_constraint` ×2, `drop_index uq_remito_linea_bin` + `create_index` con el nuevo `postgresql_where`; `downgrade` restaura el índice original y borra columnas/checks. Seguir el estilo de `a1fa1fa00001`.
- [ ] **Step 4: Run** el test del Step 2 → PASS, y `./venv/Scripts/python.exe -m pytest tests/test_alfalfa_modelo.py -q` (sin regresión).
- [ ] **Step 5: Probar la migración en la Postgres local**: `alembic upgrade head`, `downgrade -1`, `upgrade head`; pegar la salida en el reporte.
- [ ] **Step 6: Commit** `feat(backend): anulacion columns and bin-release index`.

---

### Task 2: Anulación de remitos de pasa (servicio, exclusiones, endpoint)

**Files:**
- Create: `backend/app/services/anulacion.py`
- Modify: `backend/app/api/remitos.py` (endpoint, listado, conciliación, `_remito_response`), `backend/app/schemas/alta_produccion.py` (`RemitoResponse`, schema `AnularRequest`), `backend/app/services/alta_produccion.py` (`saldos_cosecha`, `remitos_por_cosecha`), `backend/app/services/despacho_cosecha.py` (~línea 139), `backend/app/api/lotes_pasa.py` (`_entregas_de`)
- Test: `backend/tests/test_anulacion_remitos.py`

**Interfaces:**
- Consumes: columnas y `RemitoLinea.anulada` de Task 1.
- Produces:
  - `class AnularRequest(BaseModel)` en `schemas/alta_produccion.py`: `motivo: str` con `min_length=5, max_length=500` tras `strip()`.
  - `async def anular_remito(db: AsyncSession, remito_id: str, motivo: str, user_id: str) -> Remito` en `services/anulacion.py`; lanza `HTTPException` 404/409 según Global Constraints.
  - `POST /remitos/{remito_id}/anular` (`require_super_admin`, body `AnularRequest`, devuelve `RemitoResponse`), declarado entre las rutas parametrizadas del archivo.
  - `RemitoResponse` gana `anulado: bool`, `anulado_at: datetime | None`, `motivo_anulacion: str | None`.

- [ ] **Step 1: Write failing tests** (`test_anulacion_remitos.py`, fixtures de `conftest.py` y helpers de los tests de despacho/remitos existentes): entrega de 2 bines → anular → `lote.saldo_kg` vuelve al valor previo y ambos bines se entregan de nuevo en otro remito; entrega vigente sigue rechazando bin duplicado (409); FRE anulado devuelve el saldo de la cosecha (`saldos_cosecha`); BOD con `comprobante_bodega` → 409; TRA → 409; doble anulación → 409 y `saldo_kg` repuesto una sola vez; motivo de 4 caracteres → 422; roles gerencial/encargado/regador → 403; el número del remito anulado sigue existiendo y el siguiente remito de ese tipo no lo reutiliza; `conciliacion-bodega` y `_entregas_de` excluyen el anulado; `GET /remitos/` lo devuelve con `anulado=true`.
- [ ] **Step 2: Run** `./venv/Scripts/python.exe -m pytest tests/test_anulacion_remitos.py -v` → FAIL.
- [ ] **Step 3: Implement** `anular_remito`: `select(Remito).with_for_update()` por id (404 si falta), 409 si ya anulado, validar tipo/comprobante; para `entrega_pasa` bloquear los lotes en orden de id (`with_for_update`, igual que la creación en `api/remitos.py` ~línea 255) y sumar `linea.kg` a `lote.saldo_kg`; marcar todas las líneas `anulada=True`; setear `anulado_at` (UTC), `anulado_by`, `motivo_anulacion`; `flush` + `refresh`.
- [ ] **Step 4: Implement** exclusiones: filtro `Remito.anulado_at.is_(None)` en `saldos_cosecha`, `remitos_por_cosecha`, la consulta de `despacho_cosecha.py`, `_entregas_de` y `conciliacion-bodega`; `_remito_response` llena los tres campos nuevos. Después `grep -rn "RemitoLinea" backend/app` y revisar que no quede otra suma sin filtrar (anotar el resultado en el reporte; `produccion.py` ~2209 queda como está).
- [ ] **Step 5: Run** `./venv/Scripts/python.exe -m pytest tests/test_anulacion_remitos.py tests/test_despacho_cosecha.py -v` y luego la suite completa de remitos/lotes/alta de producción (`-k "remito or lote or despacho or alta_produccion"`) → PASS.
- [ ] **Step 6: Commit** `feat(backend): anular remitos de pasa`.

---

### Task 3: Anulación de documentos de alfalfa

**Files:**
- Modify: `backend/app/services/anulacion.py`, `backend/app/services/alfalfa.py` (`stock_alfalfa`), `backend/app/api/alfalfa.py`, `backend/app/schemas/alfalfa.py` (`DocumentoAlfalfaOut`)
- Test: `backend/tests/test_anulacion_alfalfa.py`

**Interfaces:**
- Consumes: Task 1 (columnas), `AnularRequest` de Task 2, `get_deposito_alfa(db, for_update=True)` y `stock_alfalfa(db)` de `services/alfalfa.py`.
- Produces:
  - `async def anular_documento_alfalfa(db: AsyncSession, documento_id: str, motivo: str, user_id: str) -> DocumentoAlfalfa`.
  - `POST /alfalfa/documentos/{documento_id}/anular` (`require_super_admin`, body `AnularRequest`, devuelve `DocumentoAlfalfaOut`).
  - `DocumentoAlfalfaOut` gana `anulado: bool`, `anulado_at: datetime | None`, `motivo_anulacion: str | None`.
  - `stock_alfalfa` excluye documentos con `anulado_at` no nulo.

- [ ] **Step 1: Write failing tests**: salida anulada devuelve unidades y kg al stock; alta sin salidas se anula y el stock baja; alta con salida dependiente (stock quedaría negativo en unidades o en kg) → 409 mencionando producto y saldo, sin cambios; doble anulación → 409; motivo corto → 422; roles gerencial/encargado → 403; `GET /alfalfa/documentos` lo devuelve con `anulado=true`; la numeración siguiente no reutiliza el número; un alta anulada ya no habilita salidas contra ese stock (crear salida posterior → 409 de stock insuficiente).
- [ ] **Step 2: Run** `./venv/Scripts/python.exe -m pytest tests/test_anulacion_alfalfa.py -v` → FAIL.
- [ ] **Step 3: Implement** `anular_documento_alfalfa`: bloquear el Depósito Alfa (`get_deposito_alfa(db, for_update=True)`) **antes** de leer el documento; 404/409; si es alta, calcular el stock sin ella (stock actual menos sus líneas) y rechazar con 409 si algún producto queda < 0 en unidades o kg; marcar campos; `flush` + `refresh`. Filtrar anulados en `stock_alfalfa`.
- [ ] **Step 4: Run** el test del Step 2 más `tests/test_alfalfa_servicio.py tests/test_alfalfa_api.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(backend): anular documentos de alfalfa`.

---

### Task 4: Marca «ANULADO» en los PDF

**Files:**
- Modify: `backend/app/core/pdf_remito.py`, `backend/app/templates/remito_entrega.html` (y los demás templates de remito que usa `generar_pdf_remito`), `backend/app/core/pdf_alfalfa.py`, `backend/app/templates/alfalfa_documento.html`, `backend/app/api/remitos.py` (`_pdf_response`), `backend/app/api/alfalfa.py` (PDF)
- Test: `backend/tests/test_anulacion_pdf.py`

**Interfaces:**
- Consumes: campos `anulado_at`, `motivo_anulacion` de las Tasks 2 y 3.
- Produces: `DatosRemitoPdf.anulado_el: date | None = None` y `.motivo_anulacion: str | None = None`; `DatosAlfalfaPdf.anulado_el: date | None = None` y `.motivo_anulacion: str | None = None`. Con `anulado_el` presente el PDF muestra un bloque «ANULADO el dd/mm/aaaa — motivo» bien visible arriba del contenido, y sigue en una sola hoja A4.

- [ ] **Step 1: Write failing tests**: para un remito anulado y un documento de alfalfa anulado, `GET .../pdf` responde 200 `application/pdf` no vacío; el texto «ANULADO» aparece en el HTML renderizado por el template (renderizar con Jinja2 el template con el contexto, patrón de los tests existentes de PDF) y no aparece en uno vigente.
- [ ] **Step 2: Run** `./venv/Scripts/python.exe -m pytest tests/test_anulacion_pdf.py -v` → FAIL.
- [ ] **Step 3: Implement** los campos nuevos de los dataclasses, el bloque en cada template (autoescape sigue activo; el motivo es texto libre) y el paso de los datos desde `_pdf_response` y el endpoint de alfalfa. Evitar tablas de columnas fijas con texto libre (xhtml2pdf): usar una fila de ancho completo.
- [ ] **Step 4: Run** el test del Step 2 más `tests/test_alfalfa_pdf.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(backend): ANULADO mark in remito and alfalfa PDFs`.

---

### Task 5: Web — botón y modal «Anular»

**Files:**
- Modify: `frontend/lib/api/altaProduccion.ts` (tipo de remito y `anularRemito`), `frontend/lib/api/alfalfa.ts` (tipo `DocumentoAlfalfa` y `anularDocumentoAlfalfa`), `frontend/app/dashboard/alta-produccion/remitos/page.tsx`, `frontend/app/dashboard/inventarios/alfalfa/page.tsx`
- Create: `frontend/components/AnularDocumentoModal.tsx` (compartido)

**Interfaces:**
- Consumes: respuestas con `anulado`, `anulado_at`, `motivo_anulacion`; `POST /remitos/{id}/anular` y `POST /alfalfa/documentos/{id}/anular` con body `{motivo: string}`.
- Produces: `AnularDocumentoModal` con props `{ titulo: string; numero: string; onConfirm: (motivo: string) => Promise<void>; onClose: () => void }`: pide el motivo (mín. 5 caracteres, contador), botón de confirmar deshabilitado mientras sea inválido o esté enviando, y muestra el `detail` del 409/422 del backend en el propio modal sin cerrarlo.

- [ ] **Step 1: Leer `frontend/AGENTS.md`** y los modales de alfalfa (`components/alfalfa/*`) para seguir su estilo y el patrón de manejo de errores axios.
- [ ] **Step 2: Implement** tipos y funciones de API (Decimal → `Number()` donde ya corresponda; los campos nuevos son boolean/string/null).
- [ ] **Step 3: Implement** el modal y su uso en las dos páginas: botón «Anular» visible **solo** si el usuario es super_admin (usar el mismo mecanismo de rol que ya usa el resto del dashboard) y el documento no está anulado; tras anular, invalidar las queries de listado y de stock/saldos (alfalfa: stock y documentos; remitos: listado y lo que la página ya refresca). Remitos de tipo `traslado_pasero` no muestran el botón.
- [ ] **Step 4: Implement** la presentación de anulados: fila atenuada, etiqueta «Anulado» con el motivo accesible (tooltip o texto secundario), sin botón de anular.
- [ ] **Step 5: Run** `cd frontend && npm run lint && npm run build` → 0 errores (las ~25 advertencias previas son conocidas).
- [ ] **Step 6: Commit** `feat(frontend): anular remitos y documentos de alfalfa (super_admin)`.

---

### Task 6: Documentación y cierre

**Files:**
- Create: `docs/sistema/Decisiones/2026-11-17-anulacion-pasa-alfalfa.md` (decisión que reemplaza parcialmente «sin anulación» de `2026-10-07-alta-de-produccion-fase-1.md` y `2026-10-13-levantada-de-pasa.md`: qué se anula, qué no y por qué), `docs/sistema/Bitácora/2026-11-17-anulacion-pasa-alfalfa.md`
- Modify: `PROJECT_MAP.md` (regenerar con `python scripts/generate_project_map.py`), `docs/sistema/Bugs Conocidos.md` solo si quedaron riesgos

- [ ] **Step 1: Write** la decisión y la bitácora (usar como formato la entrada `docs/sistema/Bitácora/2026-11-17-alfalfa-inventario.md`).
- [ ] **Step 2: Run** `python scripts/generate_project_map.py`. **No** correr `generate_modelo_datos.py` (lee producción vía `.env.prod`); dejarlo anotado como pendiente post-migración en prod.
- [ ] **Step 3: Run** la suite completa `cd backend && ./venv/Scripts/python.exe -m pytest -q` → todo verde; anotar el conteo.
- [ ] **Step 4: Commit** `docs: anulacion de pasa y alfalfa`.
