# Plan fitosanitario mensual con avance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, one session) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir el plan fitosanitario como dosis/ha por variedad, mes y producto contra lo aplicado en el mes (rojo/verde/azul), sin rondas, y adaptar el formulario de órdenes, el banner y la pantalla de cumplimiento.

**Architecture:** Un servicio puro `plan_avance.py` calcula objetivo vs aplicado desde `planes_fitosanitarios` y `registros_fitosanitarios` (por fecha, sin vínculos). Tres endpoints lo exponen (`/avance`, `/contraste`, `/necesidad-stock`); se borra todo el código de rondas/vínculos. La web consume los endpoints; mobile no cambia.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pytest (SQLite en memoria); Next.js (TS, TanStack Query).

**Spec:** `docs/superpowers/specs/2026-10-28-plan-mensual-avance-design.md` (autoridad; ante conflicto gana el spec).

## Global Constraints

- Rama `feat/plan-mensual-avance` (ya creada, con el spec). Nada de push/deploy sin que Fausto lo confirme.
- Cantidades y dosis `Decimal` en servicios y respuestas; los campos float de las columnas viejas se convierten con `Decimal(str(x))`.
- `TOLERANCIA = Decimal("0.05")`; estados de parcela: `pendiente` (d=0), `bajo` (<95 %), `ok` (95–105 % inclusive), `exceso` (>105 %); agregado: `pendiente` → `bajo` → `exceso` → `ok`; `no_planificado` para producto sin objetivo.
- Temporada = mayo→abril: `temporada_de(fecha)` (`app/api/lotes_pasa.py`); meses en orden de campaña `(mes - 5) % 12`; mes `m` de la temporada `T` cae en el año `T` si `m >= 5`, si no `T + 1`.
- Rutas estáticas antes que parametrizadas; nunca commit en routers; PEP 8, type hints; comentarios en inglés explicando el porqué.
- Migraciones existentes no se editan. Mobile no se toca. Convención de commit: terminar con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Verificación por tarea: `cd backend && ./venv/Scripts/python.exe -m pytest <archivos>`; frontend `npx tsc --noEmit` desde `frontend/`.

## Review Focus

Entradas que el spec implica y ninguna tarea nueva cubriría sola (cada una tiene su test en la tarea indicada):

1. Válvula o parcela sin superficie, con registros: no divide por cero y el estado es coherente (T1).
2. Registro del 30/abr vs 1/may: cae en temporadas distintas (T1).
3. Producto aplicado sin fila de plan ese mes → fila `no_planificado`; `insumo_id` null → ignorado, sin error (T1).
4. Contraste con varias variedades y válvulas elegidas: pondera por el área elegida, no por la parcela entera (T2).
5. Duplicado de clave al cargar plan → 409 legible, no 500 (T3).

---

### Task 1: Servicio de avance y `GET /avance`

**Files:**
- Create: `backend/app/services/plan_avance.py`, `backend/tests/test_plan_avance.py`
- Modify: `backend/app/schemas/produccion.py` (schemas `AvanceParcela`, `AvanceItem`), `backend/app/api/plan_fitosanitario.py` (endpoint, antes de `/{plan_id}`)
- Reuse: `backend/tests/helpers_plan.py` (fixtures de parcela/válvula/plan/registro; ampliar si falta algo)

**Interfaces:**
- Produces (`plan_avance.py`):
  - `TOLERANCIA: Decimal`; `class EstadoAvance(str, Enum)`: `pendiente|bajo|ok|exceso|no_planificado`
  - `rango_mes(temporada: int, mes: int) -> tuple[date, date]` (inicio inclusive, fin exclusive)
  - `estado_parcela(dosis_aplicada: Decimal, dosis_plan: Decimal) -> EstadoAvance`
  - `async dosis_aplicada_por_parcela(db, temporada: int, mes: int, parcela_ids: Iterable[str]) -> dict[tuple[str, str], Decimal]` → `(parcela_id, insumo_id) -> d_p` (spec §3: Σ(w·dosis)/ha_p; peso por `Valvula.superficie_ha` vía `registro.valvula_id`, o parcela entera; sin superficie → promedio de dosis)
  - `@dataclass AvanceClave` con `variedad, mes, insumo_id, insumo_nombre, unidad, dosis_plan: Decimal | None, dosis_aplicada_promedio, porcentaje: Decimal | None, estado, ha_total, parcelas: list[AvanceParcela]`
  - `async calcular_avance(db, temporada: int, mes: int | None = None, variedad: VariedadUva | None = None) -> list[AvanceClave]` (orden: variedad, mes en campaña, insumo_nombre; no planificados al final de su variedad+mes)
- Endpoint: `GET /plan-fitosanitario/avance?temporada=&mes=&variedad=` → `list[AvanceItem]` (encargado+), cantidades `Decimal`.

- [ ] **Step 1: Tests (`test_plan_avance.py`)** — todos con nombre propio y valores del spec: `test_parcela_entera_ok`, `test_valvulas_parciales_da_bajo` (1,5 de 6 ha, 25 %), `test_banda_95_y_105_inclusive` (95 % y 105 % → ok; 94,9 → bajo; 105,1 → exceso), `test_retoque_suma_y_da_exceso`, `test_producto_ajeno_es_no_planificado_y_el_planificado_queda_pendiente`, `test_registro_a_mano_sin_vinculo_cuenta`, `test_dos_filas_mismo_producto_y_mes_suman_objetivo`, `test_limite_30_abril_1_mayo_cambia_de_temporada`, `test_parcela_sin_superficie_no_divide_por_cero`, `test_valvula_sin_superficie_pesa_cero`, `test_parcela_inactiva_y_otra_variedad_ignoradas`, `test_insumo_id_null_ignorado`, `test_prioridad_bajo_sobre_exceso_en_agregado`, y de API `test_avance_endpoint_filtra_mes_y_variedad`.
- [ ] **Step 2: Run** `pytest tests/test_plan_avance.py -v` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** `plan_avance.py` según las interfaces: una query de planes de la temporada (+insumo), una de parcelas activas de las variedades involucradas, una de registros del rango con join a `Valvula` por `registro.valvula_id`; agrupar en Python. Porcentaje `None` cuando no hay objetivo. Implementar schemas y endpoint (convertir `Decimal` sin pasar por float).
- [ ] **Step 4: Run** `pytest tests/test_plan_avance.py -v` → PASS.
- [ ] **Step 5: Commit** `feat(plan): servicio de avance mensual y GET /avance`.

---

### Task 2: `POST /contraste` y nueva `necesidad-stock`

**Files:**
- Create: `backend/app/services/plan_contraste.py`, `backend/tests/test_plan_contraste.py`
- Modify: `backend/app/services/plan_avance.py` (añadir `pendiente_por_insumo`), `backend/app/schemas/produccion.py` (`ContrasteRequest`, `ContrasteLinea`, `ContrasteResultado`), `backend/app/api/plan_fitosanitario.py` (endpoint `/contraste`; reescribir `necesidad_stock` sin `_calcular_cumplimiento`), `backend/tests/test_plan_fitosanitario.py` (ajustar tests de necesidad-stock)

**Interfaces:**
- Consumes: `dosis_aplicada_por_parcela`, `rango_mes`, `TOLERANCIA`, `temporada_de`.
- Produces:
  - `async calcular_contraste(db, fecha: date, parcelas: list[ParcelaElegida], lineas: list[LineaContraste]) -> list[ResultadoLinea]` — por línea y variedad: `estado` (`en_plan|excede|fuera_del_plan`), `dosis_plan`, `dosis_aplicada_promedio`, `dosis_proyectada_promedio`, `porcentaje_proyectado` (spec §4; `ha_sel` = suma de las válvulas elegidas o la parcela entera; `d_p' = d_p + dosis·ha_sel/ha_p`; ponderar por `ha_sel`).
  - `async pendiente_por_insumo(db, temporada: int, hoy: date) -> dict[str, Decimal]` — `Σ max(D·ha_p − d_p·ha_p, 0)` solo meses no cerrados (temporada actual: mes de `hoy` y siguientes en campaña; futura: todos; pasada: ninguno).
- Endpoint `POST /plan-fitosanitario/contraste` (encargado+, solo lectura) y `necesidad-stock` con la misma forma de respuesta de hoy (`NecesidadInsumoItem`).

- [ ] **Step 1: Tests** — `test_contraste_en_plan_con_proyeccion_100`, `test_contraste_excede_sobre_105`, `test_contraste_fuera_del_plan_para_producto_ajeno`, `test_contraste_pondera_por_valvulas_elegidas` (2 de 6 ha elegidas → proyección sobre esa área), `test_contraste_varias_variedades_devuelve_una_entrada_por_variedad`, `test_contraste_usa_mes_de_la_fecha`; `test_necesidad_excluye_meses_cerrados`, `test_necesidad_exceso_de_una_parcela_no_compensa_otra`, `test_necesidad_temporada_futura_cuenta_todo`, `test_necesidad_forma_de_respuesta_no_cambia`.
- [ ] **Step 2: Run** los dos archivos → FAIL.
- [ ] **Step 3: Implementar** servicios, schemas y endpoints. `hoy` se pasa desde el router con `date.today()`; la función lo recibe como parámetro para poder testear.
- [ ] **Step 4: Run** `pytest tests/test_plan_contraste.py tests/test_plan_fitosanitario.py tests/test_plan_avance.py -v` → PASS.
- [ ] **Step 5: Commit** `feat(plan): contraste de orden contra el plan y necesidad de stock mensual`.

---

### Task 3: Órdenes sin vínculo al plan, borrado de rondas, índice único

**Files:**
- Create: `backend/app/core/migrations/versions/<rev>_plan_indice_unico.py`
- Modify: `backend/app/api/ordenes_aplicacion.py` (quitar `resolver_plan_id`, `_lineas_conservando_ronda` y toda escritura de `plan_fitosanitario_id`/`numero_aplicacion` en cabecera, líneas y registros; aceptar e ignorar `lineas[].numero_aplicacion`; `/desde-plan` → alias de `POST /`), `backend/app/api/plan_fitosanitario.py` (borrar `/cumplimiento`, `/rondas-pendientes`, `_calcular_cumplimiento`, `_linea_pendiente`, guard 409 del DELETE; capturar `IntegrityError` en `POST /` y `PUT` → `HTTPException(409, "Ya existe una fila del plan para esa variedad, ronda y producto")`), `backend/app/schemas/produccion.py` (borrar schemas de ronda/cumplimiento sin uso), `scripts/migracion/pregate_ordenes_multiproducto.py`, `scripts/migracion/README.md`
- Delete: `backend/app/services/plan_cobertura.py`, `plan_vinculo.py`, `plan_backfill.py`, `scripts/migracion/backfill_plan_registros.py`, `backend/tests/test_plan_cobertura.py`, `test_plan_rondas_pendientes.py`, `test_backfill_plan_registros.py`, y los tests de `test_cumplimiento_fitosanitario.py` / órdenes que asertan el vínculo al plan o las rondas (reescribir los que prueben otra cosa)
- Test: `backend/tests/test_ordenes_multiproducto_compat.py`, `backend/tests/test_plan_fitosanitario.py`

**Interfaces:**
- Consumes: nada nuevo. Produces: índice único `ux_planes_fitosanitarios_clave` sobre `planes_fitosanitarios (temporada, variedad, numero_aplicacion, insumo_id)`; `down_revision` = head actual (`alembic heads`); downgrade `drop_index`. Las respuestas de órdenes siguen trayendo `numero_aplicacion` y `plan_fitosanitario_id` en `null`.

- [ ] **Step 1: Tests nuevos** — `test_post_orden_ignora_numero_aplicacion`, `test_orden_confirmada_no_escribe_vinculo_al_plan` (`registro.plan_fitosanitario_id is None`), `test_desde_plan_equivale_a_post`, `test_plan_duplicado_devuelve_409` (POST y PUT), `test_borrar_fila_de_plan_ya_no_da_409`, `test_endpoints_viejos_no_existen` (`/cumplimiento`, `/rondas-pendientes` → 404/405).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar** los cambios y la migración. Antes de borrar, `grep -rn "resolver_plan_id\|plan_cobertura\|plan_vinculo\|plan_backfill\|rondas_pendientes\|_lineas_conservando_ronda" backend scripts` debe quedar vacío (salvo migraciones ya aplicadas, que no se editan). En el `pregate`, quitar lo que dependía de lo borrado y dejar el chequeo de duplicados de la clave.
- [ ] **Step 4: Run** suite completa `pytest -q` → todo verde. `alembic upgrade head` contra una SQLite/Postgres local limpia y `alembic downgrade -1` + `upgrade head` sin error.
- [ ] **Step 5: Commit** `refactor(plan): órdenes sin vínculo al plan, fuera rondas, índice único de clave`.

---

### Task 4: Formulario de orden (web) — contraste en vivo y panel de pendientes

**Files:**
- Modify: `frontend/lib/api/planFitosanitario.ts` (tipos `AvanceItem`, `ContrasteResultado`; `getAvance`, `postContraste`; borrar `getRondasPendientes` y tipos de ronda), `frontend/lib/api/ordenesAplicacion.ts` (sin `numero_aplicacion`/ronda en `crearOrden`), `frontend/components/produccion/NuevaOrdenAplicacion.tsx`
- Delete: `frontend/components/produccion/RondaCard.tsx`

**Interfaces:**
- Consumes: `GET /avance`, `POST /contraste` (T1–T2); `normalizeBody` y el resto de `crearOrden` quedan como están.
- Produces: formulario sin selector Del plan/Fuera; sin precarga.

- [ ] **Step 1: API client** — agregar `getAvance(temporada, mes?, variedad?)` y `postContraste(body)`; quitar lo de rondas.
- [ ] **Step 2: Formulario** — quitar selector, tarjetas y estado de "modo"; el formulario arranca vacío (fecha = `fecha_planificada`). Etiqueta por línea con `useQuery` debounced (~400 ms) sobre `postContraste` (estados **En plan** / **Excede** / **Fuera del plan** con los textos del spec §5; color + texto, nunca solo color). Insignia del conjunto: Fuera del plan / Mixta / Del plan (todas proyectan ≥ 95 %) / Parcial. Nunca bloquea el guardado.
- [ ] **Step 3: Panel «Pendiente del plan»** — `getAvance(temporada, mes, variedad)` por variedad elegida; ítems con estado `pendiente|bajo` y botón «agregar» que suma la línea con `dosis_plan − dosis_aplicada_promedio` (editable, no negativa); sección «Pendiente de <mes anterior>» con el mes previo en campaña si hay rojos. Estados de carga/vacío/error visibles.
- [ ] **Step 4: Verificar** `cd frontend && npx tsc --noEmit && npm run lint` → sin errores; `grep -rn "RondaCard\|getRondasPendientes" frontend/` vacío.
- [ ] **Step 5: Commit** `feat(web): formulario de orden con contraste del plan y panel de pendientes`.

---

### Task 5: Banner, matriz de cumplimiento y limpieza de la UI

**Files:**
- Modify: `frontend/app/dashboard/produccion/ordenes-aplicacion/page.tsx` (banner), `frontend/app/dashboard/produccion/cumplimiento-fitosanitario/page.tsx` (matriz), `frontend/components/produccion/AplicacionesRealizadas.tsx`, `ARevisarPanel.tsx`, `frontend/components/map/FincaMap.tsx`, `frontend/lib/api/produccion.ts` (sacar referencias a rondas/`numero_aplicacion`/`plan_fitosanitario_id` en la UI)
- Test: `tsc`, `lint`, `build`

- [ ] **Step 1: Banner** — en órdenes, `getAvance(temporadaActual, mesActual)`; si hay ítems `pendiente|bajo`, mostrar «<Mes>: faltan N productos en M variedades» con enlace a cumplimiento; sin rojos no se muestra; el fallo de la consulta no rompe la página.
- [ ] **Step 2: Matriz** — reescribir la página: filtros temporada y variedad; filas variedad × producto, columnas meses en campaña; celda con % + texto/ícono + color (rojo `bajo|pendiente`, verde `ok`, azul `exceso`/`no_planificado`); clic abre detalle por parcela (`parcelas[]`); filas `no_planificado` al pie de su variedad; estado vacío cuando no hay plan.
- [ ] **Step 3: Limpieza** — quitar de las pantallas listadas todo texto/dato de "ronda" o `numero_aplicacion` (el dato puede seguir en los tipos como `null`).
- [ ] **Step 4: Verificar** `npx tsc --noEmit && npm run lint && npm run build` → verde.
- [ ] **Step 5: Commit** `feat(web): banner de faltantes y matriz de cumplimiento mensual`.

---

### Task 6: Verificación local, docs y cierre

**Files:**
- Modify: `docs/sistema/Bitácora/2026-10-28-plan-mensual-avance.md` (nuevo), `docs/sistema/Decisiones/2026-10-28-plan-mensual-avance.md` (nuevo), `docs/sistema/Arquitectura.md` (actualizar el bullet de multiproducto), `docs/sistema/Bugs Conocidos.md` (si aplica); regenerar `PROJECT_MAP.md` y `Modelo de Datos.md`; actualizar la memoria `project_ordenes_multiproducto.md`

- [ ] **Step 1: Suite completa** `cd backend && ./venv/Scripts/python.exe -m pytest -q` verde; `cd frontend && npm run lint && npm run build`; `cd mobile && npx tsc --noEmit`.
- [ ] **Step 2: Click real local** (skill `verificar-local`, login manual de Fausto en Chrome; usar `read_page`/`javascript_tool` en lugar de capturas siempre que alcance): orden del plan completa → confirmar → verde; válvula parcial → rojo; sobre-dosis → azul; producto ajeno → «Mixta» + fila no planificada; botón «agregar» del panel; banner; matriz y detalle por parcela. Reportar qué se probó y qué no.
- [ ] **Step 3: Docs** — Bitácora (con checklist de deploy del spec §8), Decisión, Arquitectura; regenerar los dos generadores (`generate_project_map.py`; `generate_modelo_datos.py` lo corre Fausto con `!` porque lee `.env.prod`).
- [ ] **Step 4: Commit** `docs: bitácora y decisión del plan mensual con avance`.
- [ ] **Step 5: Revisión final** — un solo `code-reviewer` (modelo mid) sobre `git diff main...HEAD`; corregir hallazgos importantes en una pasada.
- [ ] **Step 6: Deploy (solo con OK explícito de Fausto)** — `pregate` en prod (`!`, solo lectura) → merge a `main` + push (Railway migra) → `npx vercel --prod` enseguida → verificar `/avance` en prod. Sin OTA.
