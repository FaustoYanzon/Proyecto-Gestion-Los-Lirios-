# Sesión Riego / Fito / Campaña Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir Parral 4/5, el factor de riego a manto (×4), sincronizar ciclo de campaña web/mobile, simplificar selectores del mapa y Fito, y agregar la planilla Cumplimiento Riego.

**Architecture:** Cambios incrementales sobre FastAPI + Next.js + Expo existentes. El factor de manto vive en `RegistroRiego` (modelo) y se refleja en la vista `vw_kpi_produccion` y en previews de web/mobile. La planilla es un endpoint de agregación nuevo + una página nueva. Datos de prod se tocan solo por scripts con dry-run y confirmación.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic, pytest; Next.js (App Router, TS, react-query); Expo SDK 54.

**Spec:** `docs/superpowers/specs/2026-11-05-sesion-riego-fito-campana-design.md`

## Global Constraints

- IDs UUID `String(36)`; sin commit en routers (`await db.flush()` + `await db.refresh(obj)`).
- Rutas estáticas ANTES que parametrizadas.
- Plata/cantidades `Decimal`, API los serializa como string → `Number()` en front/mobile.
- Migraciones aplicadas no se editan: cambio = migración nueva. Tras cambio de esquema correr `generate_project_map.py` y `generate_modelo_datos.py`.
- Nunca leer `.env`; confirmar con Fausto antes de push, deploy, o SQL que escriba en prod.
- `eas.json` no se toca (entra en el fingerprint).
- Código/comentarios en inglés; UI en español.
- Antes de deployar: `verificar-local` con click real.

## Review Focus

- Riego manto con `n_valvulas_manto` NULL (histórico) y `valvula` vacío → 1 válvula, factor 4.
- Parcela sin riegos en el rango de la planilla → fila presente con celdas vacías.
- Riego "en curso" (`duracion_horas` NULL) en la planilla → no debe romper; se muestra como "en curso" sin mm.
- Riegos que cruzan de mes: se ubican por mes de `inicio`.
- Filtro Fito parcela con variedad distinta a la seleccionada → la lista de parcelas solo trae las de esa variedad; cambiar variedad limpia la parcela.

---

### Task 1: Parral 4 / Parral 5 (superficie y mapa)

**Files:**
- Modify: `backend/app/api/seed_parcelas.py:14-15` (superficie 2.85 → 2.0)
- Modify: `frontend/scripts/build-finca-map.mjs:20-21` (`ha: 2`) + nombres/geometría 4↔5; regenerar su salida
- Modify (si el swap lo requiere): `scripts/seed_valvulas.py` (mapa válvulas 41–48), `scripts/auditoria_valvulas_geojson.py`
- Create: `scripts/migracion/corregir_parral_4_5.py` (UPDATE superficie, dry-run por defecto, `--apply`)

**Interfaces:** Produces: parcelas "Parral 4"/"Parral 5" con `superficie_ha = 2.0`; IDs sin cambios.

- [ ] **Step 1:** En `build-finca-map.mjs`, intercambiar las etiquetas de los dos polígonos para que el del norte sea Parral 4 y el del sur Parral 5 (identificar por latitud del centroide), poner `ha: 2` en ambos; correr `node frontend/scripts/build-finca-map.mjs`.
- [ ] **Step 2:** Correr `python scripts/auditoria_valvulas_geojson.py`; si las válvulas 41–48 quedan en la parcela equivocada, corregir `seed_valvulas.py` (4 válvulas por parral, 1 ha c/u). Verificar: el audit no reporta discrepancias para Parral 4/5.
- [ ] **Step 3:** Actualizar `seed_parcelas.py` a `superficie_ha: 2.0` en ambos.
- [ ] **Step 4:** Escribir `corregir_parral_4_5.py` (usar `scripts/migracion/_prod_db.py` como los otros scripts): en dry-run imprime superficie actual y la cantidad de `registros_riego` por parcela (read-only) para detectar riegos cargados en el parral equivocado; con `--apply` hace el UPDATE. Mostrar la salida a Fausto.
- [ ] **Step 5:** Con confirmación de Fausto, correr contra prod con `--apply` (después de backup, ver Task 2 Step 8). Verificar: `/parcelas/mapa` devuelve 2.0 para ambos.
- [ ] **Step 6:** Commit `fix: parral 4/5 superficie 2 ha y mapa norte/sur`.

---

### Task 2: Riego a manto ×4

**Files:**
- Modify: `backend/app/models/produccion.py:298-312` (constantes y `factor_caudal`)
- Modify: `backend/app/api/produccion.py:810-870` (rama legacy en normalización de manto), `:298-320` (litros)
- Modify: `frontend/lib/api/riego.ts`, `frontend/components/produccion/RiegoForm.tsx`, `frontend/components/produccion/TipoRiegoSelector.tsx`, `mobile/app/(tabs)/riego.tsx`, `mobile/lib/types.ts` (cualquier literal 0.25/0.4/25%/40% de manto: encontrar con `grep -rn "0\.25\|0\.4\b\|25%\|40%"` en esos paths)
- Create: `backend/app/core/migrations/versions/<rev>_vw_kpi_manto_factor_4.py` (recrea `vw_kpi_produccion`)
- Create: `scripts/migracion/recalcular_manto_x4.py`
- Test: `backend/tests/test_riego_manto.py`

**Interfaces:** Produces: `RegistroRiego.FACTOR_MANTO == 4.0`; `factor_caudal(tipo, n_valvulas_manto) -> float` devuelve 4.0 para manto (histórico o nuevo), 1.0 para goteo. `FACTOR_MANTO_LEGACY` eliminado.

- [ ] **Step 1: Tests que fallan** en `test_riego_manto.py` (actualizar los existentes que asumen 0.25/0.4): `test_factor_manto_es_4` (`factor_caudal("manto", None) == 4.0` y `("manto", 3) == 4.0`, goteo == 1.0); `test_mm_manto_8h` (8 h → `mm_aplicados == 51.2`); `test_litros_manto_2_valvulas_8h` (8 × 16000 × 4 × 2 == 1_024_000); `test_manto_historico_sin_valvula_cuenta_1`.
- [ ] **Step 2:** Correr `./venv/Scripts/python.exe -m pytest tests/test_riego_manto.py -v` → FAIL.
- [ ] **Step 3:** Implementar: `FACTOR_MANTO = 4.0`, borrar `FACTOR_MANTO_LEGACY`, simplificar `factor_caudal`; limpiar la rama legacy de `produccion.py:822-832` (el histórico ya no necesita factor aparte; conserva su `n_valvulas_manto` NULL → cuenta por CSV).
- [ ] **Step 4:** Correr pytest completo → PASS.
- [ ] **Step 5:** Nueva migración Alembic (`nueva-migracion`): recrear `vw_kpi_produccion` con litros de manto ×4; no editar `c3f1a8d27e54`. Revisar el SQL generado; `alembic upgrade head` local.
- [ ] **Step 6:** Actualizar previews/etiquetas de web y mobile al factor 4 (mm y litros estimados mostrados al cargar un riego). Verificar: `npm run lint && npm run build` (frontend) y `npx tsc --noEmit` (mobile) en verde.
- [ ] **Step 7:** `recalcular_manto_x4.py`: dry-run por defecto; para todo `registros_riego` con `tipo='manto'`: `mm_aplicados = round(duracion_horas*1.6*4, 2)` (omitir `duracion_horas` NULL); para manto con `n_valvulas_manto` no NULL, recalcular con `valvulas_manto_de(superficie_ha)` de la parcela. Imprimir conteo y 5 ejemplos antes/después. `--apply` escribe.
- [ ] **Step 8:** Pedir confirmación a Fausto; backup (`scripts/backup_postgres.ps1`); `_alembic_prod.py` upgrade; correr script `--apply` en prod (mismo paso que Task 1 Step 5, antes de recalcular manto). Verificar: totales de `/produccion/riego/` coinciden con ejemplos del dry-run.
- [ ] **Step 9:** `revisar-antes-de-commit`; commit `fix(riego): manto 4x goteo, recalculo mm y vista kpi`; push y deploy backend solo con OK de Fausto (**Deploy 1**).

---

### Task 3: Ciclo de campaña sincronizado (mobile → estado por variedad)

**Files:**
- Modify: `mobile/app/estado-campana.tsx:56,159` (endpoints), `mobile/app/(tabs)/campana.tsx`, `mobile/app/(tabs)/index.tsx:346`, `mobile/app/(tabs)/mapa.tsx:818` (refetch al volver al foco), `mobile/lib/types.ts`

**Interfaces:** Consumes: `GET /produccion/estado-campana/actual` y `POST /produccion/estado-campana/` (ver `EstadoVariedadCampanaCreate` en `backend/app/schemas/produccion.py` para el payload exacto: variedad, anio, estado_campana, fecha_confirmacion, observaciones).

- [ ] **Step 1:** Leer `frontend/lib/api/produccion.ts:366-430` y la mutación de `frontend/app/dashboard/documentacion/campana/page.tsx` (~l.260-280) y copiar su contrato exacto a mobile.
- [ ] **Step 2:** Reemplazar en `estado-campana.tsx` la lectura (`/campana/estado-actual/`) por `/produccion/estado-campana/actual` y el POST (`/produccion/campana/`) por `/produccion/estado-campana/` con el payload por variedad.
- [ ] **Step 3:** En `index.tsx` y `mapa.tsx` recargar `fenologia/estado-actual` cuando la pantalla recupera foco (`useFocusEffect`), para ver el cambio sin reiniciar.
- [ ] **Step 4:** Verificar con click real: cambiar estado de una variedad en mobile (emulador/Expo web) → `GET /produccion/fenologia/estado-actual` y la página web Documentación → Ciclo de campaña muestran el mismo estado; y a la inversa. `npx tsc --noEmit` en verde.
- [ ] **Step 5:** Commit `fix(mobile): ciclo de campana usa el estado por variedad compartido con la web`. OTA en **Deploy 2**.

---

### Task 4: Mapa — quitar selector "Riego"

**Files:**
- Modify: `frontend/components/map/FincaMapInner.tsx:18,168,964,1003,1029` (modo `'riego'` del tipo `ColorMode`, selector, leyenda, render)
- Modify: `frontend/components/map/FincaMap.tsx` (limpiar query de riego aplicado si queda sin uso)
- Modify: `mobile/app/(tabs)/mapa.tsx` (modo riego y fetch `/produccion/riego/` ~l.876 si queda sin uso)

- [ ] **Step 1:** Borrar `'riego'` de `ColorMode` y las ramas asociadas; dejar solo el modo de cumplimiento, con etiqueta "Cumplimiento riego". Verificar: `npm run lint && npm run build` y `npx tsc --noEmit`.
- [ ] **Step 2:** Click real en web local: el selector no ofrece "Riego" y Cumplimiento riego colorea. Commit `refactor(mapa): solo cumplimiento riego`.

---

### Task 5: Fito — Plan como vista y Cumplimiento Fito con filtro de parcela

**Files:**
- Modify: `backend/app/api/plan_fitosanitario.py:68-` (`avance_plan_fitosanitario`: nuevo `parcela_id: str | None = Query(None)`)
- Modify: `frontend/lib/api/planFitosanitario.ts:109` (`getAvance` acepta `variedad?` y `parcelaId?`)
- Modify: `frontend/app/dashboard/produccion/cumplimiento-fitosanitario/page.tsx` (título "Cumplimiento Fito", selects variedad → parcela)
- Modify: `frontend/app/dashboard/produccion/plan-fitosanitario/page.tsx` (vista de solo lectura estilo metas; botón "Editar plan" que abre el CRUD actual)
- Modify: `frontend/lib/navigation.ts:112-115` (label "Cumplimiento Fito"; Plan Fitosanitario se mantiene)
- Test: `backend/tests/test_plan_avance.py`

- [ ] **Step 1: Test** `test_avance_filtra_por_parcela`: con 2 parcelas de la misma variedad con aplicaciones distintas, `GET /plan-fitosanitario/avance?temporada=T&parcela_id=<A>` cuenta solo las de A. Correr → FAIL.
- [ ] **Step 2:** Implementar el filtro `parcela_id` en el cálculo de aplicado (la variedad ya existe). Pytest completo → PASS.
- [ ] **Step 3:** Frontend: en Cumplimiento Fito, select Variedad; select Parral/Potrero cargado con las parcelas de esa variedad (opción "Todas"); cambiar variedad resetea la parcela. Renombrar título y nav.
- [ ] **Step 4:** Plan Fitosanitario: tabla de solo lectura (leer `produccion/metas/page.tsx` y copiar su patrón), con "Editar plan" hacia el formulario/CRUD existente (sin perder alta/edición/necesidad de stock).
- [ ] **Step 5:** `npm run lint && npm run build`; click real. Commit `feat(fito): cumplimiento fito con filtro de parcela; plan en modo vista`.

---

### Task 6: Cumplimiento Riego (planilla en Seguimiento)

**Files:**
- Modify: `backend/app/api/produccion.py` (endpoint nuevo **antes** de `/riego/{id}`), `backend/app/schemas/produccion.py` (`PlanillaRiegoCelda`, `PlanillaRiegoFila`, `PlanillaRiegoResponse`)
- Create: `backend/tests/test_riego_planilla.py`
- Modify: `frontend/lib/api/riego.ts` (`getPlanillaRiego`), `frontend/lib/navigation.ts` (grupo "Seguimiento")
- Create: `frontend/app/dashboard/produccion/cumplimiento-riego/page.tsx`

**Interfaces:**
- Produces: `GET /produccion/riego/planilla?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tipo=goteo|manto|ambos&parcela_id=` →
  `{ meses: ["2026-08", ...], filas: [{ parcela_id, parcela_nombre, celdas: { "2026-08": [{ fecha_inicio: date, horas: Decimal|null, mm: Decimal|null, tipo, en_curso: bool }] } }] }`. Filas = todos los parrales y potreros (incluye SY/BN/BV si existen como parcela), ordenadas como la planilla de papel; cada riego se ubica en el mes de `inicio`.

- [ ] **Step 1: Tests** (`test_riego_planilla.py`): `test_planilla_agrupa_por_mes_de_inicio`; `test_planilla_filtra_tipo_manto`; `test_planilla_parcela_sin_riegos_tiene_fila_vacia`; `test_planilla_riego_en_curso_sin_mm` (horas/mm None, `en_curso` True); `test_planilla_mm_manto_usa_factor_4` (8 h manto → `"51.20"`). Correr → FAIL.
- [ ] **Step 2:** Implementar endpoint y schemas (Decimal; mm desde `mm_aplicados`). Pytest completo → PASS.
- [ ] **Step 3:** `getPlanillaRiego` en `riego.ts` y entrada nav "Cumplimiento Riego" en grupo Seguimiento.
- [ ] **Step 4:** Página: tabla con parcelas en filas, meses en columnas, filas alternadas verde/celeste como la foto (`C:\claude-projects\Fotos Los Lirios\Planilla riego.jpeg`); celda con "dd/mm · Xh · Y mm" apilado, tipo marcado (goteo); filtros: tipo (goteo/manto/ambos), rango de fechas (default: campaña actual, mayo→abril), parcela (opción "Todas"). `Number()` sobre los Decimal.
- [ ] **Step 5:** `npm run lint && npm run build`; click real con Claude in Chrome contra datos locales. Commit `feat(riego): planilla cumplimiento riego`.

---

### Task 7: Cierre y Deploy 2

- [ ] **Step 1:** `revisar-antes-de-commit` (code-reviewer + qa-tester) sobre el diff acumulado de Tasks 3–6; corregir hallazgos.
- [ ] **Step 2:** `docs-sync`: regenerar `PROJECT_MAP.md` y `Modelo de Datos.md`, bitácora de la sesión.
- [ ] **Step 3:** Con OK de Fausto: push, `npx vercel --prod` (web), `eas update` OTA mobile (skill `deploy-lirios`, agente `release-manager`). Verificar en prod: ciclo sincronizado, planilla, Fito.
