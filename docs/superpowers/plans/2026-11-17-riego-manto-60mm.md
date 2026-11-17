# Riego a manto: 60 mm fijos — Implementation Plan

> **Estado: implementado y desplegado (2026-11-17).** PR #11, merge `25ab7f0`; migración `c9b5b6bebbfd` aplicada en producción antes del merge; web en Vercel; OTA desde `main`. Los checkboxes de abajo no se marcaron uno por uno: el estado real es esta nota y la lista de desviaciones al final. `Modelo de Datos.md` sigue pendiente de regenerar (Fausto).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada riego a manto entregue `mm_riego_manto` (60) mm sobre la parcela completa, sin importar el tiempo, congelado en el registro, con recálculo de los mantos históricos.

**Architecture:** Columna nueva `registros_riego.litros_manto` calculada al terminar (o al crear ya terminado) con superficie y parámetro vigentes; `RegistroRiego.litros_de` y la vista `vw_kpi_produccion_parcela` la leen. Parámetro editable en `parametros_produccion`. Migración con backfill. Web y mobile muestran «60 mm · N ha · X litros».

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + Postgres; pytest (SQLite en memoria); Next.js; Expo (OTA).

**Spec:** `docs/superpowers/specs/2026-11-17-riego-manto-60mm-design.md`

## Global Constraints
- Rama `feat/manto-60mm`. PEP 8, type hints, sin `except` pelado, Decimal para plata/cantidades salvo las columnas Float existentes de riego (`mm_aplicados`, `duracion_horas`); sin commit en routers.
- Tests: `cd backend && ./venv/Scripts/python.exe -m pytest <archivo> -q -p no:cacheprovider`. Los tests usan SQLite (`create_all`): la migración y la vista SQL se verifican a mano contra la Postgres **local**.
- Migraciones ya aplicadas no se editan. La migración copia sus helpers (no importa módulos de la app). `down_revision` = el `head` actual (`alembic heads`).
- **Producción:** nada se escribe sin confirmación explícita de Fausto en cada paso (script de solo lectura → `pg_dump` → migración con `scripts/migracion/_alembic_prod.py`). Nunca leer `.env`; el reporte de solo lectura va en archivo, no inline.
- Frontend: leer `frontend/AGENTS.md` antes de escribir Next. Mobile: docs de Expo SDK 54; no tocar `app.json`/`eas.json` (fingerprint: el OTA debe salir con el runtime actual). `npm run lint && npm run build` / `npx tsc --noEmit`.
- Textos de UI en español, código y comentarios en inglés. `n_valvulas_manto` y `FACTOR_MANTO` se conservan (compatibilidad).

## Review Focus
- Manto **en curso**: 0 litros y 0 mm en cumplimiento, panel del mapa, planilla y estado de campaña; recién cuenta al `terminar`.
- Superficie editada **después** de terminar un manto: el registro no cambia; cambiar el parámetro tampoco toca el historial.
- Manto sobre parcela **sin superficie** (histórico): 0 litros, sin división por cero ni 500; el backfill los deja en NULL.
- `PUT` de un manto terminado que **no** cambia la parcela (p. ej. corregir `responsable`): `litros_manto` intacto; si cambia la parcela, se recalcula con la superficie nueva.
- Goteo: litros y mm exactamente iguales que antes (regresión).
- Cliente viejo (mobile sin OTA) que manda `valvula`/factor al crear un manto: el servidor ignora y calcula solo.

---

### Task 1: Parámetro `mm_riego_manto` y fórmula de litros

**Files:**
- Modify: `backend/app/services/alta_produccion.py` (`PARAMETROS_DEFAULT`, `Parametros`, `get_parametros`), `backend/app/schemas/alta_produccion.py` (`ParametrosResponse`, `ParametrosUpdate`), `backend/app/api/maestros_produccion.py` (`/parametros` GET/PUT si arma la respuesta campo por campo), `backend/app/models/produccion.py` (`RegistroRiego`), `backend/app/core/cumplimiento_riego.py`
- Test: `backend/tests/test_riego_manto_60mm.py` (nuevo)

**Interfaces:**
- Produces:
  - `PARAMETROS_DEFAULT["mm_riego_manto"] = Decimal("60")`; `Parametros.mm_riego_manto: Decimal`; `ParametrosResponse.mm_riego_manto: Decimal`; `ParametrosUpdate.mm_riego_manto: ParametroDecimal | None`.
  - `RegistroRiego.litros_manto: Mapped[float | None]` (Float, nullable).
  - `RegistroRiego.litros_manto_de(mm: float, superficie_ha: float | None) -> float | None`: `mm * superficie_ha * 10_000`, `None` si la superficie es `None` o ≤ 0.
  - `RegistroRiego.litros_de(horas, tipo, valvula, n_valvulas_manto, litros_manto: float | None = None) -> float`: goteo sin cambios; manto → `litros_manto or 0.0` (0.0 también si `horas is None`).
  - `cumplimiento_riego.litros_de_registro(duracion_horas, tipo, valvula, n_valvulas_manto, litros_manto=None) -> float` (delegación).

- [ ] **Step 1: Tests (fallan).** `test_parametro_mm_riego_manto_default_60_y_editable` (GET `/maestros/parametros` o la ruta real devuelve `60`; PUT a `50` y GET devuelve `50`); `test_litros_manto_de_calcula_mm_por_superficie` (`litros_manto_de(60, 2.3) == 60*2.3*10_000`; `None` y `0` → `None`); `test_litros_de_manto_usa_litros_manto_e_ignora_horas` (mismas `litros_manto`, horas 1 y 24 → igual resultado; `horas=None` → `0.0`; `litros_manto=None` → `0.0`); `test_litros_de_goteo_no_cambia` (horas 10, valvula "1,2" → `10*16000*2`).
- [ ] **Step 2:** Run → FALLAN.
- [ ] **Step 3:** Implementar lo de Interfaces. `recalcular_mm`/`__init__`: para manto `mm_aplicados` = parámetro vigente solo cuando se pasa explícitamente (lo setea el endpoint en Task 2); el cálculo `horas × MM_POR_HORA × FACTOR` queda solo para goteo.
- [ ] **Step 4:** Run `test_riego_manto_60mm.py` → PASS (los tests viejos de manto se adaptan en Task 2).
- [ ] **Step 5:** Commit `feat(backend): parametro mm_riego_manto y litros de manto congelados por registro`.

### Task 2: Congelar litros al crear, terminar y editar; adaptar tests viejos

**Files:**
- Modify: `backend/app/api/produccion.py` (`create_riego`, `terminar_riego`, `update_riego`, `iniciar_riego`; los 3 llamadores de `litros_de_registro` ~l.312, ~l.1071, ~l.1857 agregan `RegistroRiego.litros_manto` al `select` y lo pasan), `backend/app/schemas/produccion.py` (exponer `litros_manto` solo si hace falta; no romper clientes)
- Modify tests: `backend/tests/test_riego_manto.py`, `test_cumplimiento_riego_volumetrico.py`, `test_riego_planilla*.py` (los que asumen ×4)
- Test: `backend/tests/test_riego_manto_60mm.py`

**Interfaces:**
- Produces: `_congelar_manto(db: AsyncSession, riego: RegistroRiego) -> None` en `produccion.py`: carga la parcela, lee `get_parametros(db).mm_riego_manto`, setea `riego.litros_manto = RegistroRiego.litros_manto_de(mm, parcela.superficie_ha)` y `riego.mm_aplicados = float(mm)`. Se llama solo para `tipo == manto` y `fin is not None`.
- Consumes: Task 1.

- [ ] **Step 1: Tests (fallan primero), contra la API.** `test_manto_terminado_vale_60mm_sin_importar_el_tiempo` (POST `/riego/` manto 2 h y otro 20 h sobre 3 ha → ambos `litros_aplicados == 60*3*10_000`, `mm_aplicados == 60`); `test_manto_en_curso_no_cuenta` (`/riego/iniciar` → `litros_aplicados == 0`, `mm_aplicados` nulo/0; `/riego/{id}/terminar` → 1 800 000); `test_cumplimiento_cuenta_1_56_riegos_por_manto` (un manto en parral de 1 ha → `riegos_equivalentes == 1.56` en `/estado-campana/cumplimiento-riego`); `test_superficie_editada_despues_no_cambia_el_manto_terminado`; `test_cambiar_el_parametro_no_toca_registros_viejos` (PUT parámetro a 50, el registro previo sigue en 60 mm, uno nuevo da 50); `test_put_sin_cambiar_parcela_conserva_litros` y `test_put_cambiando_parcela_recalcula`; `test_manto_sin_superficie_no_rompe` (registro histórico creado directo en DB con `litros_manto=None` → 0 litros en listado y cumplimiento, sin error); `test_cliente_viejo_con_valvula_se_ignora` (payload manto con `valvula="1,2"` → mismo resultado).
- [ ] **Step 2:** Run → FALLAN.
- [ ] **Step 3:** Implementar `_congelar_manto` y llamarlo en `create_riego` (si `fin`), `terminar_riego` (en lugar de `recalcular_mm` para manto), `update_riego` (si manto terminado y `parcela_id`/`tipo`/`fin` cambian a manto terminado). Pasar `litros_manto` en los 3 `select` y en la llamada a `litros_de_registro`.
- [ ] **Step 4:** Adaptar los tests viejos que asumían ×4 (valores esperados nuevos: 60 mm × superficie); no cambiar los de goteo.
- [ ] **Step 5:** Run `pytest tests/test_riego_manto_60mm.py tests/test_riego_manto.py tests/test_cumplimiento_riego_volumetrico.py tests/test_riego_planilla.py tests/test_riego_planilla_cumplimiento.py tests/test_superficie_valvulas.py tests/test_trazabilidad_enlaces.py -q` → PASS.
- [ ] **Step 6:** Commit `feat(backend): manto de 60 mm fijos congelado al terminar o crear`.

### Task 3: Migración, backfill y vista de KPIs

**Files:**
- Create: `backend/app/core/migrations/versions/<rev>_riego_manto_60mm.py` (`alembic revision -m "riego manto 60mm"`; **no** `--autogenerate` para la vista)
- Test: verificación manual contra Postgres local + `test_router_registration.py` sigue verde

**Interfaces:**
- Produces: revisión nueva encima del `head` actual (`alembic heads` antes de crearla). `upgrade()`: (1) `INSERT … ON CONFLICT DO NOTHING` de `mm_riego_manto = 60` en `parametros_produccion`; (2) `op.add_column("registros_riego", sa.Column("litros_manto", sa.Float(), nullable=True))`; (3) backfill: `UPDATE registros_riego r SET litros_manto = 60 * p.superficie_ha * 10000, mm_aplicados = 60 FROM parcelas p WHERE r.parcela_id = p.id AND r.tipo = 'manto' AND r.fin IS NOT NULL AND p.superficie_ha > 0`; (4) `CREATE OR REPLACE VIEW vw_kpi_produccion_parcela` con la rama manto `CASE WHEN tipo = 'manto' THEN COALESCE(litros_manto, 0) ELSE duracion_horas * 16000 * n_valvulas END` (mismas columnas y tipos que `7d2c5e9a41b8`, copiando su helper). `downgrade()`: restaura la vista de `7d2c5e9a41b8`, recalcula `mm_aplicados` de manto como `duracion_horas * 1.6 * 4` y elimina la columna (el parámetro queda).

- [ ] **Step 1:** `alembic heads` → anotar el head; crear la revisión.
- [ ] **Step 2:** En la Postgres local (con un manto terminado, uno en curso y uno sin superficie cargados para la prueba): `alembic upgrade head` → `SELECT litros_manto, mm_aplicados` correctos; `SELECT * FROM vw_kpi_produccion_parcela` sin error; `alembic downgrade -1` y `upgrade head` de nuevo sin error.
- [ ] **Step 3:** Run `pytest tests/test_router_registration.py -q` → PASS.
- [ ] **Step 4:** Commit `feat(backend): migracion de riego manto 60 mm con backfill y vista de KPIs`.

### Task 4: Script de solo lectura para producción

**Files:**
- Create: `scripts/migracion/reporte_manto_60mm.py` (patrón de conexión y de «solo lectura» de los scripts existentes en `scripts/migracion/`; leer su README primero)

**Interfaces:**
- Produces: script de **solo lectura** que imprime, por parcela y temporada: cantidad de mantos terminados, litros actuales (regla ×4) vs. litros nuevos (60 mm × superficie × cantidad), y la lista de mantos terminados con parcela sin superficie. No escribe nada; aborta si no puede abrir la conexión en modo solo lectura.

- [ ] **Step 1:** Implementar el script en archivo; correrlo contra la Postgres **local** y verificar el formato.
- [ ] **Step 2:** Commit `chore(scripts): reporte de solo lectura del riego a manto 60 mm`. (La corrida en producción es del Task 8, con Fausto.)

### Task 5: Web — parámetro y formularios

**Files:**
- Modify: `frontend/app/dashboard/documentacion/parametros/page.tsx` y su formulario (campo «mm por riego a manto»), `frontend/lib/api/altaProduccion.ts` (tipo `Parametros`), `frontend/lib/api/riego.ts`, `frontend/components/produccion/RiegoForm.tsx`, `IniciarRiegoForm.tsx`, `TipoRiegoSelector.tsx` (`MantoResumen`), `RiegosEnCurso.tsx`, `RiegoTable.tsx`

**Interfaces:**
- Produces: `calcMantoResumen(mm: number, superficieHa: number): { mm: number; litros: number }` en `riego.ts` (`litros = mm * ha * 10_000`); `MantoResumen` muestra «60 mm · 2,3 ha · 1.380.000 L» (mm desde el parámetro; fallback 60 si el rol no puede leerlo). `RiegosEnCurso` no muestra litros/mm de un manto en curso. Se quita el cálculo «válvulas × factor» del manto nuevo (el goteo y el manto histórico siguen igual).

- [ ] **Step 1:** Agregar el campo al formulario de parámetros (`mm_riego_manto`, mismo estilo que `tara_carro`).
- [ ] **Step 2:** Implementar `calcMantoResumen` y usarlo en los tres formularios y el resumen.
- [ ] **Step 3:** Run `cd frontend && npm run lint && npm run build` → sin errores nuevos.
- [ ] **Step 4:** Commit `feat(frontend): manto de 60 mm en formularios y parametro editable`.

### Task 6: Mobile — resumen y etiquetas (OTA)

**Files:**
- Modify: `mobile/lib/types.ts` (`calcRiegoTotales` y helpers del manto), `mobile/app/(tabs)/riego.tsx` (resumen del manto ~l.897-954, lista en curso ~l.1231, etiquetas ~l.1169-1275)

**Interfaces:**
- Produces: `calcMantoResumen(mm, superficieHa)` espejo del web; el resumen del manto muestra «60 mm · N ha · X L»; la lista de riegos en curso no calcula litros del manto (solo horas transcurridas). Valor de mm: 60 por defecto (se toma del parámetro si el rol puede leerlo; si no, 60).

- [ ] **Step 1:** Implementar los cambios sin tocar `app.json`/`eas.json`.
- [ ] **Step 2:** Run `cd mobile && npx tsc --noEmit` → sin errores.
- [ ] **Step 3:** Commit `feat(mobile): resumen del manto de 60 mm`.

### Task 7: Verificación y revisión

- [ ] **Step 1:** `cd backend && ./venv/Scripts/python.exe -m pytest -q -p no:cacheprovider` → suite completa verde.
- [ ] **Step 2:** Click real en local (skill `verificar-local`, Playwright; Fausto hace el login): crear un manto, terminarlo, ver 60 mm en el panel del mapa, la planilla y el cumplimiento (1,56 riegos); editar el parámetro en Documentación → Parámetros.
- [ ] **Step 3:** Skill `revisar-antes-de-commit`; corregir hallazgos.

### Task 8: Producción (con Fausto, cada paso confirmado)

- [ ] **Step 1:** Push de la rama, PR, CI verde (**confirmar con Fausto antes del push**).
- [ ] **Step 2:** Correr `scripts/migracion/reporte_manto_60mm.py` contra producción en solo lectura; mostrar a Fausto el antes/después por parcela y los mantos sin superficie.
- [ ] **Step 3:** `pg_dump` de producción con Fausto (usa `scripts/backup_prod.py`; si hay `ECONNRESET`, cambiar de red). Un dump de 0 bytes = fallido.
- [ ] **Step 4:** Merge del PR **después** de aplicar la migración en producción con `scripts/migracion/_alembic_prod.py` (**confirmación explícita**); luego Railway despliega el backend. Orden: migración → merge/Railway → web (`npx vercel --prod` desde `frontend/`, lo corre Fausto) → OTA mobile (`fingerprint:compare`, `eas update --branch production --environment production`, verificar bundle) → `python scripts/generate_modelo_datos.py` (lee producción, después de migrar) → bitácora con `docs-sync`.

---

## Self-Review
- Spec: parámetro (T1,T5), congelado (T1,T2), migración/vista/backfill (T3), reporte previo (T4), web (T5), mobile (T6), verificación (T7), producción (T8). `n_valvulas_manto` no se toca.
- Review Focus: en curso (T2), superficie/parámetro posteriores (T2), sin superficie (T2,T3), PUT (T2), goteo (T1), cliente viejo (T2).

## Estado final y desviaciones

**Estado:** implementado y desplegado el 2026-11-17 (PR #11, merge `25ab7f0`). Tareas 1 a 8 ejecutadas.

**Desviaciones respecto de este plan:**

- **Task 6 (mobile):** 60 mm fijos (`MM_RIEGO_MANTO_DEFAULT`), no la lectura del parámetro que pedía el plan. Pendiente.
- **Task 2 (PUT):** además de congelar al cambiar parcela, se agregaron las guardas de riego terminado (422) y de mm no sobrescribible.
- **Task 3 (vista):** la rama manto usa `COALESCE(litros_manto, 0)` sin filtrar `duracion_horas`. Follow-up de review pendiente.
- **Task 8 (orden):** migración antes del merge, con backup. El paso de `Modelo de Datos.md` quedó pendiente de Fausto.
