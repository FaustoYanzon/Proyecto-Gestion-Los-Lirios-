# Riego a manto por parcela Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El registro de riego empieza eligiendo goteo o manto; el manto se carga sobre un parral o potrero completo (sin cabezal, válvulas ni fertirriego) y calcula litros por superficie.

**Architecture:** `registros_riego` gana `n_valvulas_manto` (nullable) y `cabezal`/`valvula` pasan a nullable. La regla de caudal vive en `RegistroRiego` (una sola fuente): manto con `n_valvulas_manto` → factor 0.25 y `n` guardado; manto sin él (histórico) → 0.4 y `n` del CSV; goteo → 1.0. Los endpoints validan y calculan `n_valvulas_manto = ceil(superficie_ha)`. Web y mobile agregan el paso inicial y consumen `factor_aplicado` de la respuesta.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic (PostgreSQL; tests en SQLite), Next.js 16 (leer `frontend/AGENTS.md`), Expo SDK 54 (leer `mobile/AGENTS.md`).

**Spec:** `docs/superpowers/specs/2026-10-26-riego-manto-design.md`

## Global Constraints

- Cada válvula = 1 ha, 16 000 L/h, 1.6 mm/h. Manto nuevo: factor `0.25`; manto histórico: `0.4` (no se recalcula ningún registro viejo).
- `n_valvulas_manto = max(1, ceil(round(superficie_ha, 4)))`. Ejemplos: 3.0→3, 2.3→3, 2.85→3, 1.0→1, 0.4→1.
- Manto solo para parcelas `parral` o `potrero` con `superficie_ha` cargada (>0); si no, 422.
- Manto: sin fertirriego (422), `cabezal`/`valvula` se guardan en `NULL` y se ignoran si el cliente los manda.
- Un solo riego a manto en curso (`fin IS NULL`) por parcela: 409.
- Goteo no cambia: `cabezal` y `valvula` obligatorios (422 si faltan).
- Convenciones del repo: IDs UUID `String(36)`, routers sin commit (`flush`+`refresh`), PATCH/PUT con `exclude_unset`, no editar migraciones aplicadas, `float` ya es el tipo de las columnas de riego (no cambiarlo).
- Mobile: no tocar `app.json`/`eas.json`/`package.json` (fingerprint, OTA). Textos de UI en español, código y comentarios en inglés.
- No pushear ni desplegar: lo hace Fausto con `!`.

## Review Focus

Entradas que el spec implica y las tareas cubren con tests:

1. Parcela con superficie 0.4 ha → 1 válvula (Task 1, Task 2); sin superficie o 0 → 422 (Task 2).
2. Cliente viejo manda manto con `cabezal`/`valvula` → se ignoran, se calcula con la regla nueva (Task 2).
3. Registro manto histórico editado por `PUT` (solo `inicio`/`fin`) conserva factor 0.4 y su CSV (Task 1, Task 2).
4. Segundo manto en curso en la misma parcela → 409; reintento con la misma `idempotency_key` devuelve el mismo registro sin 409 (Task 2).
5. `PUT` manto→goteo sin `cabezal`/`valvula` → 422; goteo→manto fija `n_valvulas_manto` (Task 2).

---

### Task 1: Modelo, migración y regla de caudal

**Files:**
- Modify: `backend/app/models/produccion.py` (clase `RegistroRiego`, ~líneas 212-323)
- Create: `backend/app/core/migrations/versions/<rev>_riego_manto_por_superficie.py` (vía `alembic revision --autogenerate`, revisar a mano)
- Modify: `backend/app/api/produccion.py` (eficiencia hídrica, ~líneas 313-331)
- Test: `backend/tests/test_riego_manto.py` (nuevo bloque de tests de modelo al final; no tocar aún los existentes)

**Interfaces:**
- Produces (en `RegistroRiego`):
  - columnas: `cabezal: Mapped[str | None]`, `valvula: Mapped[str | None]` (`nullable=True`), `n_valvulas_manto: Mapped[int | None]` (`Integer`, nullable).
  - `FACTOR_MANTO_LEGACY: float = 0.4`, `FACTOR_MANTO: float = 0.25` (reemplaza el 0.4 actual; el histórico usa `FACTOR_MANTO_LEGACY`).
  - `@classmethod factor_caudal(cls, tipo: TipoRiego | str | None, n_valvulas_manto: int | None = None) -> float`.
  - `@staticmethod valvulas_manto_de(superficie_ha: float) -> int` (regla `max(1, ceil(round(x, 4)))`).
  - `@staticmethod contar_valvulas(valvula: str | None, n_valvulas_manto: int | None) -> int` (si `n_valvulas_manto` no es nulo lo devuelve; si no, cuenta el CSV; mínimo 1).
  - propiedades `n_valvulas -> int` (usa `contar_valvulas`), `factor_aplicado -> float`, `litros_aplicados -> float`.
  - `__init__` y `recalcular_mm()` usan `factor_caudal(tipo, n_valvulas_manto)`.
- Consumes: nada de otras tareas.

- [ ] **Step 1: Tests de modelo (fallan).** Agregar a `test_riego_manto.py`, construyendo `RegistroRiego(...)` directo (sin DB), con `inicio=2026-10-05T08:00Z`, `fin=…T18:00Z` (10 h):
  - `test_manto_nuevo_usa_factor_025_y_n_guardado`: `tipo=manto, n_valvulas_manto=3, cabezal=None, valvula=None` → `litros_aplicados == 120_000.0`, `mm_aplicados == 4.0`, `n_valvulas == 3`, `factor_aplicado == 0.25`.
  - `test_manto_historico_conserva_factor_04`: `tipo=manto, valvula="1,2", n_valvulas_manto=None` → `litros_aplicados == 128_000.0`, `mm_aplicados == 6.4`, `n_valvulas == 2`, `factor_aplicado == 0.4`.
  - `test_goteo_no_cambia`: `tipo=goteo, valvula="1,2"` → `litros_aplicados == 320_000.0`, `mm_aplicados == 16.0`, `factor_aplicado == 1.0`.
  - `test_valvulas_manto_de`: parametrizado `3.0→3, 2.3→3, 2.85→3, 1.0→1, 0.4→1, 3.0000000000000004→3`.
- [ ] **Step 2:** Correr `./venv/Scripts/python.exe -m pytest tests/test_riego_manto.py -q` y ver los 4 fallar.
- [ ] **Step 3: Implementar** lo de Interfaces en `models/produccion.py`; el comentario de `tipo` actualizado (manto: caudal por superficie, histórico 0.4). Quitar `CASE WHEN … 0.4` solo si aparece en código vivo (la migración vieja `e44e14c0a72b` NO se toca).
- [ ] **Step 4: Migración.** `alembic revision --autogenerate -m "riego manto por superficie"`; revisar que solo haga `alter_column cabezal/valvula nullable=True` y `add_column n_valvulas_manto Integer nullable`, con un `downgrade` que primero rellena `cabezal` y `valvula` NULL con `'-'` (`op.execute("UPDATE registros_riego SET cabezal = '-' WHERE cabezal IS NULL")`, ídem `valvula`), luego vuelve ambas a `nullable=False` y por último hace `drop_column('n_valvulas_manto')`. Aplicar en la DB local: `alembic upgrade head`.
- [ ] **Step 5: Eficiencia hídrica.** En `produccion.py` (bloque de `litros_rows`) seleccionar también `RegistroRiego.n_valvulas_manto` y calcular con `RegistroRiego.factor_caudal(row.tipo, row.n_valvulas_manto)` y `RegistroRiego.contar_valvulas(row.valvula, row.n_valvulas_manto)` en vez del split inline.
- [ ] **Step 6:** Correr `pytest tests/test_riego_manto.py tests/ -q -k "riego or eficiencia or trazabilidad"` → todo en verde (los tests viejos de manto siguen pasando: el endpoint todavía no escribe `n_valvulas_manto`).
- [ ] **Step 7: Commit** `feat(backend): modelo de riego a manto por superficie (columna, migración y regla de caudal)`.

---

### Task 2: Schemas y endpoints de riego

**Files:**
- Modify: `backend/app/schemas/produccion.py` (bloque Registro Riego, ~líneas 126-205)
- Modify: `backend/app/api/produccion.py` (endpoints `iniciar_riego`, `create_riego`, `update_riego`, ~líneas 817-910)
- Test: `backend/tests/test_riego_manto.py` (reescribir los 4 tests de manto viejos y agregar los nuevos)

**Interfaces:**
- Consumes (Task 1): `RegistroRiego.valvulas_manto_de`, `.factor_caudal`, columnas `cabezal`/`valvula` nullable, `n_valvulas_manto`.
- Produces (contrato para web y mobile):
  - Request manto: `{parcela_id, tipo: "manto", responsable, responsable_id?, idempotency_key?}` en `POST /produccion/riego/iniciar`; más `{fecha, inicio, fin}` en `POST /produccion/riego/`. Sin `cabezal`/`valvula`/`fertilizante_*`.
  - `RegistroRiegoBase`/`RegistroRiegoIniciar`/`RegistroRiegoUpdate`/`RegistroRiegoEnCursoResponse`: `cabezal: str | None = None`, `valvula: str | None = None`.
  - `RegistroRiegoResponse` y `RegistroRiegoEnCursoResponse` agregan `factor_aplicado: float`; el cliente calcula litros y mm en curso con `n_valvulas` y `factor_aplicado`.
  - Helper `async def _normalizar_riego(db: AsyncSession, data: dict, riego: RegistroRiego | None = None) -> dict` (privado en `produccion.py`): aplica las reglas de abajo sobre el dict ya mergeado y devuelve el dict a persistir.

Reglas de `_normalizar_riego` (en este orden):
1. `tipo == goteo`: `cabezal` y `valvula` no vacíos, si no 422 `"El riego por goteo necesita cabezal y válvulas."`; `n_valvulas_manto = None`.
2. `tipo == manto`: 422 si hay `fertilizante_nombre` o `fertilizante_dosis_lt_ha` (`"El riego a manto no lleva fertirriego."`); la parcela debe existir, ser `parral`/`potrero` y tener `superficie_ha > 0` (422 `"El riego a manto necesita un parral o potrero con superficie cargada."`); `cabezal = None`, `valvula = None`, `n_valvulas_manto = valvulas_manto_de(superficie_ha)`.
3. Solo para `PUT`: si el registro es manto histórico (`n_valvulas_manto IS NULL`) y no cambian `tipo` ni `parcela_id`, no se toca nada (conserva regla vieja). Si cambia `tipo` o `parcela_id`, se aplican 1 y 2 sobre el estado resultante.

Además en `iniciar_riego`: si `tipo == manto` y ya existe un `RegistroRiego` con la misma `parcela_id`, `tipo = manto` y `fin IS NULL` → 409 `"Ya hay un riego a manto en curso en esta parcela."`. El chequeo va **después** del bloque de `idempotency_key` (un reintento devuelve el mismo registro).

- [ ] **Step 1: Tests (fallan).** En `test_riego_manto.py`, helper `_payload(parcela_id, **extra)` sin `cabezal`/`valvula` por defecto para manto; fixtures `create_parcela(superficie_ha=2.3)`. Escribir (10 h, 08:00→18:00):
  - `test_riego_sin_tipo_es_goteo`: igual que hoy (con `cabezal="1", valvula="1,2"`): `litros_aplicados == 320_000`, `mm == 16.0`.
  - `test_manto_calcula_por_superficie`: parcela 2.3 ha, `POST /produccion/riego/` manto sin cabezal/válvula → 201, `n_valvulas == 3`, `litros_aplicados == 120_000`, `mm_aplicados == 4.0`, `cabezal is None`, `valvula is None`, `factor_aplicado == 0.25`.
  - `test_manto_parcela_menor_a_una_ha`: superficie 0.4 → `n_valvulas == 1`, `litros == 40_000`.
  - `test_manto_ignora_cabezal_y_valvula_de_cliente_viejo`: payload manto con `cabezal="1", valvula="1,2"` → 201, `cabezal is None`, `n_valvulas == 3`, `litros == 120_000`.
  - `test_manto_rechaza_fertirriego` (422), `test_manto_sin_superficie_422` (superficie `None` y `0`), `test_manto_en_cabezal_o_pasero_422` (`tipo=TipoParcela.cabezal`).
  - `test_goteo_sin_cabezal_o_valvula_422` (en `POST /riego/` e `iniciar`).
  - `test_iniciar_y_terminar_manto`: iniciar manto (parcela 2.3 ha) → 201 con `n_valvulas == 3`, `factor_aplicado == 0.25`; terminar con `fin = inicio + 5 h` → `mm_aplicados == 2.0`, `litros_aplicados == 60_000`.
  - `test_segundo_manto_en_curso_misma_parcela_409`; `test_reintento_idempotente_de_iniciar_manto_no_da_409` (misma `idempotency_key` dos veces → mismo `id`, 201 ambas); `test_manto_en_curso_en_otra_parcela_ok`.
  - `test_put_manto_historico_conserva_factor_04`: crear registro histórico insertando directo `RegistroRiego(tipo=manto, valvula="1,2", n_valvulas_manto=None, …)` con la sesión de test; `PUT {"fin": …+1 h}` como gerencial → `litros_aplicados` sigue usando 0.4 y 2 válvulas (`== 12 * 16_000 * 0.4 * 2` para 12 h).
  - `test_put_goteo_a_manto_fija_n_valvulas` (reemplaza `test_cambiar_tipo_recalcula_mm`): goteo→manto con parcela 2.3 → `n_valvulas == 3`, `mm_aplicados == 4.0`, `cabezal is None`; `test_put_manto_a_goteo_sin_cabezal_422`; `test_put_manto_a_goteo_con_cabezal_y_valvula_ok` (limpia `n_valvulas_manto`, `factor_aplicado == 1.0`).
- [ ] **Step 2:** Correr el archivo y verificar que fallan por lo esperado.
- [ ] **Step 3: Schemas.** Aplicar los cambios de Interfaces. Agregar `factor_aplicado` a ambas respuestas (se lee de la propiedad del modelo). Mantener `tipo: TipoRiego = TipoRiego.goteo`.
- [ ] **Step 4: Endpoints.** Implementar `_normalizar_riego` y usarlo en `iniciar_riego` y `create_riego` (después de resolver `responsable_id`) y en `update_riego` (mergear `update_data` sobre los valores actuales, normalizar, setear los campos resultantes incluidos `n_valvulas_manto`; luego el recálculo de `duracion_horas`/`mm` existente). 422/409 con `HTTPException`.
- [ ] **Step 5:** Correr `./venv/Scripts/python.exe -m pytest -q` completo → verde.
- [ ] **Step 6: Commit** `feat(backend): riego a manto por superficie en los endpoints de riego`.

---

### Task 3: Carta de trazabilidad, PDF y listados con cabezal/válvula vacíos

**Files:**
- Modify: `backend/app/core/pdf_carta.py` (~línea 157)
- Modify: `backend/app/templates/carta_trazabilidad.html` (~líneas 225-226)
- Modify: `backend/app/api/trazabilidad.py` y `backend/app/schemas/trazabilidad.py` solo si algún campo de riego declara `cabezal`/`valvula` como `str` obligatorio (buscar con grep `cabezal`).
- Test: `backend/tests/test_trazabilidad*.py` (el archivo existente que cubre la carta; agregar un caso)

**Interfaces:**
- Consumes (Task 1/2): `RegistroRiego.cabezal/valvula` pueden ser `None`; `n_valvulas`.
- Produces: en la carta/PDF, para un riego manto nuevo: `cabezal` = `"—"`, `valvula` = `"Manto · N válv."`. Para manto histórico y goteo, sin cambios.

- [ ] **Step 1: Test (falla).** Un riego manto nuevo (`n_valvulas_manto=3`, cabezal/válvula `None`) en una parcela con historial → generar la carta (HTML o PDF según lo que ya cubre el test) sin error y con `"Manto · 3 válv."` presente en el HTML; goteo existente sigue mostrando su cabezal y válvulas.
- [ ] **Step 2:** Verlo fallar (hoy rompe con `None` o muestra `None`).
- [ ] **Step 3:** Implementar en `pdf_carta.py` (`"cabezal": r.cabezal or "—"`, `"valvula": r.valvula or f"Manto · {r.n_valvulas} válv."`) y ajustar el template si usa `r.cabezal` directo.
- [ ] **Step 4:** `pytest -q` completo en verde.
- [ ] **Step 5: Commit** `fix(backend): la carta de trazabilidad muestra riegos a manto sin cabezal`.

---

### Task 4: Corregir Potrero 23 (2.3 ha) — seed y script para prod

**Files:**
- Modify: `backend/app/api/seed_parcelas.py` (línea del Potrero 23: `23.0` → `2.3`)
- Create: `scripts/corregir_superficie_potrero_23.py` (mismo patrón que `scripts/cargar_superficie_valvulas.py`: `--db local|prod`, dry-run por defecto, `--aplicar` escribe, backup con `pg_dump` antes de escribir en prod, lee `DATABASE_PUBLIC_URL`/`DATABASE_URL` de `backend/.env` con su propia función, nunca imprime la URL)

**Interfaces:**
- Produces: script ejecutable por Fausto con `!`. `UPDATE parcelas SET superficie_ha = 2.3 WHERE nombre = 'Potrero 23' AND superficie_ha = 23`; informa filas afectadas y aborta si no hay exactamente 1 fila.

- [ ] **Step 1:** Cambiar el seed.
- [ ] **Step 2:** Escribir el script con dry-run (muestra la fila actual y qué cambiaría) y `--aplicar` (backup → UPDATE → verificación `SELECT`). Solo toca esa parcela.
- [ ] **Step 3:** Correrlo en local con `--db local` (dry-run y `--aplicar`) y verificar `SELECT nombre, superficie_ha FROM parcelas WHERE nombre='Potrero 23'`.
- [ ] **Step 4: Commit** `fix: Potrero 23 tiene 2.3 ha (seed y script de corrección para prod)`. **No correr contra prod:** lo hace Fausto con `!` antes de desplegar el backend.

---

### Task 5: Web — paso inicial goteo/manto

**Files:**
- Modify: `frontend/lib/api/riego.ts`, `frontend/components/produccion/IniciarRiegoForm.tsx`, `RiegoForm.tsx`, `RiegosEnCurso.tsx`, `RiegoTable.tsx`, `TipoRiegoSelector.tsx` (se mueve al primer paso o se reutiliza), `frontend/components/trazabilidad/Timeline.tsx`, y `frontend/app/dashboard/produccion/riego/page.tsx` / `documentacion/riego/page.tsx` solo si usan `cabezal`/`valvula` de un registro (revisar con grep).
- Leer `frontend/AGENTS.md` y la guía relevante en `node_modules/next/dist/docs/` antes de escribir.

**Interfaces:**
- Consumes (Task 2): contrato de request/response; `factor_aplicado` en respuestas.
- Produces (en `riego.ts`): `FACTOR_MANTO_SUPERFICIE = 0.25`; `valvulasManto(superficieHa: number): number` (`Math.max(1, Math.ceil(Math.round(superficieHa * 10_000) / 10_000))`); `RiegoCreate`/`RiegoUpdate`/`RiegoIniciarInput` con `cabezal?`/`valvula?`; `RiegoResponse`/`RiegoEnCurso` con `cabezal: string | null`, `valvula: string | null`, `factor_aplicado: number`; `calcMm(fechaInicio, horaInicio, fechaFin, horaFin, nValvulas: number, factor: number)` y `calcEnCurso(inicioISO: string, nValvulas: number, factor: number)` (el tercer/último parámetro pasa de `tipo` a `factor`). Se elimina `FACTOR_MANTO = 0.4` y `factorCaudal` del archivo; ningún importador debe quedar roto (buscar con grep).

- [ ] **Step 1:** Actualizar `riego.ts` (tipos y funciones de arriba).
- [ ] **Step 2:** `IniciarRiegoForm` y `RiegoForm`: primer control "¿Goteo o manto?" (`TipoRiegoSelector`), arriba de todo. Goteo: el formulario actual sin el selector de tipo adentro. Manto: lista de parcelas activas de tipo parral y potrero con superficie (ordenadas por nombre, con ha), sin cabezal, válvulas ni fertirriego; muestra "Manto · N válvulas · X L/h" con `valvulasManto`; el schema zod no exige `cabezal` en manto; payload manto sin `cabezal`/`valvula`/`fertilizante_*`. En `RiegoForm` (edición): un registro manto histórico (sin `n_valvulas_manto`, `cabezal` presente) se muestra como hoy y solo permite editar horario/responsable; no se re-convierte.
- [ ] **Step 3:** `RiegosEnCurso`/`RiegoTable`/`Timeline`: mostrar `Manto · {n_valvulas} válv.` cuando `cabezal` es `null`; "—" en columnas de cabezal/válvula; `calcEnCurso(r.inicio, r.n_valvulas, r.factor_aplicado)`.
- [ ] **Step 4:** Verificar: `cd frontend && npm run lint` (0 errores) y `node --stack-size=20000 node_modules/typescript/lib/tsc.js --noEmit` limpio y `npm run build`.
- [ ] **Step 5: Commit** `feat(web): riego a manto por parral o potrero completo`.

---

### Task 6: Mobile — paso inicial goteo/manto

**Files:**
- Modify: `mobile/app/(tabs)/riego.tsx`, `mobile/lib/types.ts` (tipos `RegistroRiego`, `RiegoPayload`, `RiegoIniciarPayload`, `RiegoEnCurso`; `calcRiegoTotales`; constantes de manto), `mobile/lib/api.ts` solo si tipa payloads de riego.
- Leer `mobile/AGENTS.md` (docs de Expo SDK 54).
- No tocar `app.json`, `eas.json`, `package.json`.

**Interfaces:**
- Consumes (Task 2): mismo contrato que Task 5.
- Produces (en `types.ts`): `FACTOR_MANTO_SUPERFICIE = 0.25`; `valvulasManto(superficieHa: number): number` (misma fórmula que web); `calcRiegoTotales(inicioISO, finISO, nValvulas: number, factor: number)`; `RegistroRiego`/`RiegoEnCurso` con `cabezal: string | null`, `valvula: string | null`, `factor_aplicado: number`; payloads con `cabezal?`/`valvula?`. Se elimina `FACTOR_MANTO = 0.4`/`factorCaudal` (ajustar los importadores en `riego.tsx`).

Flujo del wizard (en `riego.tsx`): `Step` gana `'tipo'` y `'parcela_manto'`. `startWizard` → `'tipo'`. `'tipo'` (nuevo componente `StepTipo`): dos tarjetas Goteo / Manto. Goteo → `'ubicacion'` (el `StepUbicacion` actual sin la sección "3. TIPO DE RIEGO"; `tipo` queda fijo en `'goteo'`; se renumeran las secciones). Manto → `'parcela_manto'` (nuevo `StepParcelaManto`: chips de parrales y potreros activos con `superficie_ha`, una sola selección, hint "N válvulas · X ha"; parcelas sin superficie no se listan) → `'modo'`. `StepDetalle` recibe `permitirFertirriego: boolean` (false en manto: no se muestra el toggle y `conFertirriego` queda false). `RiegoDraft`/`IniciarDraft`: `cabezal`/`valvulas` pueden estar vacíos en manto. `StepConfirmar` y `StepIniciarConfirmar`: en manto el resumen muestra Parcela, "Manto · N válvulas", sin filas de cabezal/válvulas/fertiriego, y el payload no lleva `cabezal`/`valvula`/`fertilizante_*` (la cola offline encola el mismo payload). Botón Atrás desde `'modo'` vuelve a `'ubicacion'` o `'parcela_manto'` según el tipo. En `RecentRiegos`: manto muestra `Manto · {n_valvulas} válv.` en vez de `C{cabezal} · V…`; el cronómetro usa `factor_aplicado`.

- [ ] **Step 1:** Actualizar `types.ts` y ajustar importadores.
- [ ] **Step 2:** Implementar `StepTipo`, `StepParcelaManto` y los cambios de `StepUbicacion`, `StepDetalle`, confirmaciones y `RecentRiegos` descritos arriba.
- [ ] **Step 3:** `cd mobile && node --stack-size=20000 node_modules/typescript/lib/tsc.js --noEmit` limpio.
- [ ] **Step 4:** Verificar a mano en Expo web o en dispositivo según se pueda (shim de `expo-secure-store` solo temporal, no commitear): goteo completo, manto retroactivo e "iniciar ahora".
- [ ] **Step 5: Commit** `feat(mobile): riego a manto por parral o potrero completo`.

---

### Task 7: Documentación y cierre

**Files:**
- Regenerate: `PROJECT_MAP.md` (`python scripts/generate_project_map.py`), `docs/sistema/Modelo de Datos.md` (`python scripts/generate_modelo_datos.py`; ver nota de `.env.prod` en la memoria si falla con `InvalidPasswordError`).
- Create: bitácora `docs/sistema/Bitácora/2026-10-26-riego-manto.md` (decisiones: regla por superficie, histórico 0.4 intacto, fix de Potrero 23, auditoría del borrado de registros).
- Modify: `docs/produccion/` solo si hay una nota vigente sobre riego a manto con el factor 0.4 (grep `0.4|40%`).

- [ ] **Step 1:** Delegar en el agente `docs-sync` o correr los generadores y escribir la bitácora.
- [ ] **Step 2: Commit** `docs: riego a manto por superficie`.

---

## Verificación final y despliegue (lo ejecuta Fausto)

1. Suite completa: `cd backend && ./venv/Scripts/python.exe -m pytest -q`; `cd frontend && npm run lint && npm run build`; `cd mobile && node --stack-size=20000 node_modules/typescript/lib/tsc.js --noEmit`.
2. Probar en local con click real (uvicorn + `npm run dev`): goteo, manto retroactivo, manto "iniciar ahora" y terminar, segundo manto en la misma parcela (409), editar un riego viejo.
3. Prod: backup → `scripts/corregir_superficie_potrero_23.py --db prod` (dry-run y luego `--aplicar`) → push (Railway corre la migración) → `vercel --prod` → `fingerprint:compare` y `eas update` (Android e iOS).
