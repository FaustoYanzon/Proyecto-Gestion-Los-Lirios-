# Órdenes multiproducto / multivariedad con descuento contra el plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una orden de aplicación lleva N productos y N variedades, se crea con un toque desde una ronda pendiente del plan, y lo aplicado descuenta el plan por vínculo explícito (hectáreas).

**Architecture:** Tabla de líneas `ordenes_aplicacion_insumos` cuelga de la orden; cada confirmación de válvula/parcela crea un `RegistroFitosanitario` por línea, vinculado a su orden/parcela/válvula/línea y a la fila del plan. Los viejos campos de producto único de la orden quedan como shim sincronizado con la primera línea para no romper web/mobile viejos. El cumplimiento del plan se recalcula desde los registros vinculados, no por heurística.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + Pydantic v2 (pytest SQLite en memoria) · Next.js (`frontend/`, leer `frontend/AGENTS.md`) · Expo SDK 54 (`mobile/`, leer `mobile/AGENTS.md`).

**Spec:** `docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md`

**Desvío respecto del spec (decidido al leer el código):** las columnas viejas de `ordenes_aplicacion` (`insumo_id`, `dosis_por_ha`, `dias_carencia`, `dias_reingreso`, `variedad`, `plan_fitosanitario_id`) **siguen NOT NULL y se escriben desde la primera línea** (`_sincronizar_shim`) en vez de pasar a nullable. Evita relajar constraints y no rompe vistas/clientes; se borran en el cleanup. Las columnas `registro_fitosanitario_id` de las filas parcela/válvula **se mantienen** (= registro de la primera línea) hasta el cleanup.

## Global Constraints

- IDs UUID `String(36)`; `await db.flush()` + `await db.refresh(obj)` tras escribir; **nunca commit en routers** (commitea `get_db`).
- Rutas estáticas ANTES que parametrizadas; PATCH con `model_dump(exclude_unset=True)`.
- Plata/cantidades `Decimal`, nunca `float` en cálculos nuevos de cantidad; la API serializa Decimal como string.
- PEP 8, type hints, sin `except` pelado; código/comentarios en inglés, comentarios inline breves del *por qué*.
- Migraciones ya commiteadas no se editan; head actual `c3f1a8d27e54`. Tras modelo/router/migración correr `python scripts/generate_project_map.py` y `python scripts/generate_modelo_datos.py`.
- Tests: `cd backend && ./venv/Scripts/python.exe -m pytest <path> -q`. La suite completa debe quedar verde en cada commit.
- Nunca leer `backend/.env`/`mobile/.env`. Migración o backfill en **producción**: solo con confirmación explícita de Fausto (`scripts/migracion/_alembic_prod.py`). Push/deploy: confirmar antes. Probar en local con click real antes de deployar.
- Web: nada de Next que conozcas; leer `node_modules/next/dist/docs/`. Mobile: no tocar `eas.json` (invalida el OTA).

## Review Focus

1. Confirmar una válvula con N productos falla a mitad (superficie nula, insumo borrado) → no queda ningún registro ni movimiento de stock (Task 3).
2. Doble toque en "confirmar" / deshacer → 409 y el stock se descuenta/devuelve **una sola vez** por producto (Tasks 3, 4).
3. Línea con `numero_aplicacion` pero parcela de una variedad que el plan no contempla → registro sin `plan_fitosanitario_id`, sin error (Task 3).
4. Dos órdenes cubren la misma válvula para la misma fila del plan, o una parcela entera + sus válvulas → cobertura nunca supera `ha_total` (Task 6).
5. Cliente viejo: `POST /` con body de un solo producto y `GET` de una orden multivariedad devuelven `variedad`/`insumo_*` válidos, nunca null (Tasks 2, 5).
6. Insumo repetido en las líneas, lista de líneas vacía, orden de varias variedades sin superficie cargada → 422 con mensaje claro (Tasks 2, 3).

---

## Fase 1 — Backend base (deployable solo; web/mobile actuales siguen andando)

### Task 1: Modelo, migración y backfill

**Files:**
- Modify: `backend/app/models/produccion.py` (clases `OrdenAplicacion`, `OrdenAplicacionParcela`, `OrdenAplicacionValvula`, `RegistroFitosanitario`, `column_property` de `orden_id` ~l.784)
- Modify: `backend/app/models/__init__.py` (exportar `OrdenAplicacionInsumo`)
- Create: `backend/app/core/migrations/versions/<rev>_ordenes_multiproducto.py` (autogenerate + backfill a mano)
- Test: `backend/tests/test_ordenes_multiproducto_modelo.py`

**Interfaces:**
- Produces: `OrdenAplicacionInsumo(id, orden_id, insumo_id, dosis_por_ha: float, dias_carencia: int, dias_reingreso: int, numero_aplicacion: int | None, posicion: int)`, único `(orden_id, insumo_id)`, relación `insumo`.
- Produces: `OrdenAplicacion.lineas: list[OrdenAplicacionInsumo]` (cascade `all, delete-orphan`, `order_by=posicion`).
- Produces: en `RegistroFitosanitario`: columnas nullable indexadas `plan_fitosanitario_id`, `orden_insumo_id`, `orden_parcela_id`, `orden_valvula_id`; relaciones many-to-one `orden_parcela`, `orden_valvula`, `orden_insumo`. En `OrdenAplicacionParcela.registros` y `OrdenAplicacionValvula.registros` (one-to-many, `foreign_keys` explícitos). Se **eliminan** las relaciones `registro_fitosanitario` de ambas filas (las columnas se conservan sin relación).
- Produces: `RegistroFitosanitario.orden_id` (column_property) = `orden_id` de la fila parcela referida por `orden_parcela_id`.

- [ ] **Step 1: Escribir tests del modelo** — `test_linea_unica_por_orden_e_insumo` (dos líneas mismo insumo → `IntegrityError`), `test_orden_con_dos_lineas_ordenadas_por_posicion`, `test_registro_orden_id_sale_de_orden_parcela_id` (registro con `orden_parcela_id` → `registro.orden_id == orden.id`; sin vínculo → `None`). Reusar fixtures `create_user/create_insumo/create_parcela` (ver `tests/test_orden_valvulas.py:30`).
- [ ] **Step 2: Correr y ver fallar** — `pytest tests/test_ordenes_multiproducto_modelo.py -q` → FAIL (`OrdenAplicacionInsumo` no existe).
- [ ] **Step 3: Implementar modelos.** Los FK nuevos de `registros_fitosanitarios` hacia `ordenes_aplicacion_parcelas`/`_valvulas` crean un ciclo con las columnas `registro_fitosanitario_id` existentes: declararlos con `ForeignKey(..., use_alter=True, name="fk_registros_orden_parcela")` (y análogos) para que `create_all` en SQLite no falle. Si igual falla el ciclo, plan B: quitar el `ForeignKey` de esas dos columnas legacy y dejar solo el índice (anotar en el commit).
- [ ] **Step 4: Reescribir los usos rotos del código viejo** que referencian las relaciones eliminadas (`grep -rn "registro_fitosanitario\b\|\.orden_valvula\|\.orden_parcela" backend/app`): solo para que importe y arranque; la lógica nueva va en Tasks 3-4. Actualizar `_REGISTRO_CON_ORDEN_OPTS` en `services/aplicaciones.py` a las relaciones nuevas.
- [ ] **Step 5: Generar migración** — `./venv/Scripts/python.exe -m alembic revision --autogenerate -m "ordenes multiproducto"`; **revisar** el archivo. Agregar a mano, después de crear tabla y columnas: (a) por cada fila de `ordenes_aplicacion` insertar una línea (`posicion=0`, `numero_aplicacion` = el de su `plan_fitosanitario_id` si tiene) con `uuid4` generado en Python vía `op.get_bind()`; (b) `UPDATE registros_fitosanitarios` con subconsultas correlacionadas: `orden_parcela_id` (desde `ordenes_aplicacion_parcelas.registro_fitosanitario_id` y, para válvulas, desde la fila padre), `orden_valvula_id`, `orden_insumo_id` (la línea de esa orden) y `plan_fitosanitario_id` (desde `ordenes_aplicacion.plan_fitosanitario_id`). `downgrade()` borra columnas y tabla.
- [ ] **Step 6: Verificar migración en la DB local de desarrollo** (nunca prod): `alembic upgrade head`, consulta de control (`SELECT count(*) FROM ordenes_aplicacion` = `count(*) FROM ordenes_aplicacion_insumos`; registros de órdenes con `orden_parcela_id` no nulo), luego `alembic downgrade -1 && alembic upgrade head`.
- [ ] **Step 7: Suite completa** — `pytest -q`. Los tests viejos que usaban `registro_fitosanitario` de las filas se actualizan a `registros` en este mismo task (solo sus asserts/helpers, no su intención).
- [ ] **Step 8: Commit** — `feat(backend): modelo de órdenes multiproducto (líneas, vínculos de registro, migración y backfill)`.

### Task 2: Crear, editar y eliminar órdenes con líneas (+ compatibilidad de body viejo)

**Files:**
- Modify: `backend/app/schemas/produccion.py` (bloque "Órdenes de Aplicación", l.350-475)
- Modify: `backend/app/api/ordenes_aplicacion.py` (`_to_response`, `_ORDEN_LOAD_OPTS`, `_resolve_parcelas_orden`, `crear_orden_*`, `actualizar_orden_extra`, `eliminar_orden_extra`, `_avisar_orden_nueva`)
- Test: `backend/tests/test_ordenes_multiproducto_crear.py` (+ ajustar `tests/test_ordenes_aplicacion.py`, `tests/test_push_ordenes.py` solo si cambia algún assert de forma)

**Interfaces:**
- Produces schemas: `OrdenAplicacionLineaCreate(insumo_id: str, dosis_por_ha: float [gt=0], dias_carencia: int [ge=0], dias_reingreso: int [ge=0], numero_aplicacion: int | None = None)`; `OrdenAplicacionCreate(temporada: int, objetivo: str, fecha_planificada: date, lineas: list[OrdenAplicacionLineaCreate] [min 1], parcela_ids: list[str] | None, valvula_ids: list[str] | None, variedad: VariedadUva | None, notas: str | None)`; `OrdenAplicacionLineaResponse(id, insumo_id, insumo_nombre, insumo_unidad, dosis_por_ha, dias_carencia, dias_reingreso, numero_aplicacion)`.
- `OrdenAplicacionCreate` tiene un `model_validator(mode="before")` que, si no viene `lineas` pero sí `insumo_id`, arma una línea con `insumo_id/dosis_por_ha/dias_carencia/dias_reingreso` (body viejo de `OrdenAplicacionCreateExtra`). `OrdenAplicacionUpdate` = mismo shape sin `temporada`, con el mismo validator (reemplaza `OrdenAplicacionUpdateExtra`, que se elimina).
- `OrdenAplicacionResponse` suma `lineas: list[OrdenAplicacionLineaResponse]` y `variedades: list[VariedadUva]`; conserva `insumo_id/insumo_nombre/insumo_unidad/dosis_por_ha/dias_*/variedad/plan_fitosanitario_id` desde la **primera línea** (shim). `variedad` = variedad de la parcela de mayor `superficie_ha` (nunca null).
- Produces: `async def _crear_orden(db, data: OrdenAplicacionCreate, user: User) -> OrdenAplicacion` y `_sincronizar_shim(orden: OrdenAplicacion) -> None` (privados del router).
- Resolución de parcelas: `parcela_ids` explícito (varias variedades permitidas, activas); `parcela_ids=None` + `variedad` → todas las activas de esa variedad; ninguno de los dos → 422.

- [ ] **Step 1: Tests** (`test_ordenes_multiproducto_crear.py`): `test_crea_orden_con_4_lineas_y_2_variedades` (POST `/ordenes-aplicacion/` con `lineas` y parcelas de `flame` y `malbec` → 201, `len(lineas)==4`, `variedades` con ambas, `origen=="extra"`); `test_origen_plan_si_alguna_linea_tiene_numero_aplicacion` (crea fila de plan y manda `numero_aplicacion` → `origen=="plan"`); `test_numero_aplicacion_sin_ronda_en_plan_da_422`; `test_insumo_repetido_da_422`; `test_lineas_vacias_da_422`; `test_body_viejo_un_producto_sigue_funcionando` (payload de `_payload_extra` en `tests/test_orden_valvulas.py:78` → 201 con una línea y shim `insumo_id` correcto); `test_desde_plan_sigue_funcionando` (usa `plan_fitosanitario_id` → una línea con su `numero_aplicacion`); `test_put_edita_orden_del_plan_sin_confirmaciones` (hoy 409 por origen); `test_put_y_delete_bloqueados_si_hay_confirmaciones` (409); `test_get_orden_multivariedad_devuelve_variedad_valida`.
- [ ] **Step 2: Ver fallar** — `pytest tests/test_ordenes_multiproducto_crear.py -q`.
- [ ] **Step 3: Implementar** schemas y router según Interfaces. `POST /desde-plan` se reduce a armar un `OrdenAplicacionCreate` de una línea (insumo/dosis del plan, `numero_aplicacion=plan.numero_aplicacion`) y llamar `_crear_orden`. Validación de `numero_aplicacion`: debe existir una fila `PlanFitosanitario(temporada, numero_aplicacion, insumo_id=línea.insumo_id)` para al menos una variedad de las parcelas elegidas. `_get_orden_extra_editable` → `_get_orden_editable` sin el chequeo de `origen` (conserva el 409 por confirmaciones). `PUT` reemplaza líneas (delete-orphan) y parcelas como hoy, y re-sincroniza el shim. `_ORDEN_LOAD_OPTS` suma `lineas.insumo` y `parcelas.valvulas.registros`/`parcelas.registros`. Push: con 1 línea el texto queda igual que hoy (`"{insumo} · {parcelas}"`); con N: `"{primer insumo} +{N-1} más · {parcelas}"`.
- [ ] **Step 4: Ver pasar** + `pytest tests/test_ordenes_aplicacion.py tests/test_orden_valvulas.py tests/test_push_ordenes.py -q`.
- [ ] **Step 5: Commit** — `feat(backend): órdenes de aplicación con varias líneas y variedades`.

### Task 3: Confirmación N registros (válvula y parcela)

**Files:**
- Modify: `backend/app/api/ordenes_aplicacion.py` (`confirmar_valvula`, `confirmar_aplicacion`, `_valvula_response`, `_to_response`, `subir_foto_*`)
- Create: `backend/app/services/plan_vinculo.py`
- Test: `backend/tests/test_ordenes_multiproducto_confirmar.py`

**Interfaces:**
- Produces (`plan_vinculo.py`): `async def resolver_plan_id(db: AsyncSession, *, temporada: int, variedad: VariedadUva, insumo_id: str, numero_aplicacion: int | None) -> str | None` — `None` si `numero_aplicacion` es `None` o no hay fila `(temporada, variedad, insumo_id, numero_aplicacion)`.
- Produces (privado en el router): `async def _crear_registros_orden(db, *, orden: OrdenAplicacion, parcela: Parcela, item: OrdenAplicacionParcela, fila: OrdenAplicacionValvula | None, superficie_ha: Decimal, fecha: date, responsable: str, responsable_id: str | None, observaciones: str | None, user_id: str) -> list[RegistroFitosanitario]` — uno por línea, cada uno con `orden_parcela_id`, `orden_valvula_id` (si hay fila), `orden_insumo_id`, `plan_fitosanitario_id`, `cantidad_total = dosis × superficie_ha` (`Decimal`, 2 decimales), `dias_*` de la línea, y su movimiento de stock vía `_aplicar_movimiento_stock`.
- Consumes: `OrdenAplicacion.lineas`, columnas nuevas de `RegistroFitosanitario` (Task 1).
- Contrato: `fila.registro_fitosanitario_id` / `item.registro_fitosanitario_id` = id del registro de la primera línea (shim); `OrdenAplicacionValvulaResponse.registro_fitosanitario_id` igual. Las fotos de válvula/parcela se crean con `orden_valvula_id` y `registro_fitosanitario_id` = registro de la primera línea (el borrado ya busca por `orden_valvula_id`, ver `_fotos_de_valvula`).

- [ ] **Step 1: Tests**: `test_confirmar_valvula_crea_un_registro_por_linea_con_stock` (3 líneas, valvula 2 ha, dosis 1.5/2/0.15 → 3 registros con `cantidad_total` 3.00/4.00/0.30, stock de cada insumo bajó exactamente eso, 3 `MovimientoStock`); `test_confirmar_parcela_sin_valvulas_crea_n_registros`; `test_registro_vincula_fila_del_plan_segun_variedad_de_la_parcela` (orden con 2 variedades, plan con una fila por variedad → cada registro apunta a la fila de su variedad); `test_linea_sin_fila_de_plan_para_la_variedad_deja_plan_id_nulo` (Review 3); `test_confirmar_con_valvula_sin_superficie_da_422_y_no_deja_nada` (Review 1: sin registros, sin movimientos, stock intacto); `test_confirmar_dos_veces_da_409_y_descuenta_una_vez` (Review 2); `test_no_aplicada_no_crea_registros`; `test_carencia_de_cada_registro_es_la_de_su_linea`.
- [ ] **Step 2: Ver fallar** — `pytest tests/test_ordenes_multiproducto_confirmar.py -q`.
- [ ] **Step 3: Implementar** `resolver_plan_id` (un `select` por línea+variedad; cachear en dict dentro de la llamada) y `_crear_registros_orden`. Calcular **todas** las cantidades y validar superficie antes del primer `db.add` (el rollback de `get_db` es la red de seguridad, no la validación). `confirmar_valvula`/`confirmar_aplicacion` usan el helper; el resto de su flujo (lock `bloquear_orden`, finca, responsable, estados, `recalcular_estado_orden`, aviso de revisión) no cambia. `orden.insumo` deja de usarse.
- [ ] **Step 4: Ver pasar** + suite completa.
- [ ] **Step 5: Commit** — `feat(backend): confirmar válvula/parcela crea un registro por producto y los vincula al plan`.

### Task 4: Deshacer, Eliminar y Reactivar sobre la válvula completa

**Files:**
- Modify: `backend/app/services/aplicaciones.py`, `backend/app/api/produccion.py` (solo logs/ajustes de firma si hace falta)
- Test: `backend/tests/test_eliminar_reactivar_aplicacion.py` (agregar casos; actualizar los existentes si cambió el vínculo), `backend/tests/test_ordenes_multiproducto_deshacer.py`

**Interfaces:**
- Consumes: `OrdenAplicacionValvula.registros`, `OrdenAplicacionParcela.registros` (Task 1).
- Produces: `async def registros_de_fila(db, *, fila_valvula: OrdenAplicacionValvula | None = None, item: OrdenAplicacionParcela | None = None) -> list[RegistroFitosanitario]` (válvula: por `orden_valvula_id`; parcela entera: por `orden_parcela_id` con `orden_valvula_id IS NULL`). `RegistroEliminado` suma `registros_eliminados: int = 0` (default, compatible con los usos actuales).
- `deshacer_fila_valvula`, `reactivar_registro`, `eliminar_registro` operan sobre **todos** los registros hermanos aunque se invoquen con uno solo; revierten cada movimiento de stock (`revertir_movimiento_stock`), borran registros y fotos, y limpian los shims `registro_fitosanitario_id` de la fila.

- [ ] **Step 1: Tests**: `test_deshacer_valvula_devuelve_stock_de_todos_los_productos` (3 registros, stock vuelve a su valor inicial por insumo, 0 registros, fila pendiente); `test_reactivar_un_registro_reactiva_toda_la_valvula`; `test_eliminar_un_registro_saca_toda_la_valvula_de_la_orden` (y, si era la única válvula, la parcela y la orden — como hoy); `test_eliminar_parcela_entera_con_n_registros`; `test_doble_deshacer_da_409_y_no_devuelve_stock_dos_veces` (Review 2); `test_deshacer_borra_fotos_de_la_valvula`.
- [ ] **Step 2: Ver fallar**, **Step 3: Implementar** reemplazando `_borrar_registro_de_valvula` por una versión sobre `registros_de_fila`; mantener el orden actual de operaciones (revertir stock → fotos → desvincular → borrar registros) y los `flush` intermedios que evitan violar FK.
- [ ] **Step 4: Ver pasar** + suite completa.
- [ ] **Step 5: Commit** — `feat(backend): deshacer/eliminar/reactivar actúan sobre todos los productos de la válvula`.

### Task 5: A revisar, compatibilidad de clientes viejos y deploy de la fase 1

**Files:**
- Modify: `backend/app/api/ordenes_aplicacion.py` (`list_valvulas_a_revisar`), `backend/app/schemas/produccion.py` (`ValvulaARevisarResponse`)
- Test: `backend/tests/test_ordenes_multiproducto_compat.py`

**Interfaces:** `ValvulaARevisarResponse` suma `productos: list[ProductoAplicadoResponse]` (`insumo_id, insumo_nombre, dosis_por_ha`), conserva `insumo_id/insumo_nombre/dosis_por_ha` de la primera línea; `variedad` = la de la parcela de la fila (no la shim de la orden).

- [ ] **Step 1: Tests**: `test_a_revisar_lista_todos_los_productos`; `test_cliente_viejo_flujo_completo` (crear con body viejo → `/pendientes` → confirmar válvula → respuesta con `registro_fitosanitario_id` no nulo); `test_pendientes_filtra_por_finca_con_lineas`.
- [ ] **Step 2-3: Fallar, implementar, pasar.**
- [ ] **Step 4: Revisión y regeneración de docs** — skill `revisar-antes-de-commit` (code-reviewer + qa-tester), luego `python scripts/generate_project_map.py` y `python scripts/generate_modelo_datos.py`.
- [ ] **Step 5: Commit** — `feat(backend): a-revisar con productos y pruebas de compatibilidad`.
- [ ] **Step 6: Probar en local** (skill `verificar-local`: uvicorn + web actual): crear una orden de un producto desde la web actual y confirmar una válvula; debe andar sin tocar el frontend.
- [ ] **Step 7: Deploy de la fase 1 — PAUSA: pedir confirmación a Fausto** (migración en prod incluida; backup antes). Skill `deploy-lirios` + agente `release-manager`. Verificar en prod las órdenes vivas (Parral 2/11/15): cada una con 1 línea y registros vinculados.

---

## Fase 2 — Backend del plan

### Task 6: Cobertura por hectáreas, cumplimiento y necesidad de stock

**Files:**
- Create: `backend/app/services/plan_cobertura.py`
- Modify: `backend/app/api/plan_fitosanitario.py` (`_calcular_cumplimiento`, endpoints `/cumplimiento` y `/necesidad-stock`), `backend/app/schemas/produccion.py` (`CumplimientoPlanItem`)
- Test: `backend/tests/test_cumplimiento_fitosanitario.py` (reescribir), `backend/tests/test_plan_cobertura.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) class CoberturaParcela: plan_id: str; parcela_id: str; ha_parcela: Decimal; ha_cubiertas: Decimal` y `async def cobertura_por_parcela(db: AsyncSession, temporada: int, variedad: VariedadUva | None = None) -> list[CoberturaParcela]` — una entrada por (fila del plan × parcela activa de su variedad). `ha_cubiertas` = superficie de la parcela si algún registro vinculado es de parcela entera (`orden_valvula_id IS NULL`), si no Σ superficie de válvulas **distintas** con registro vinculado, siempre `min(…, ha_parcela)`.
- `CumplimientoPlanItem` conserva sus campos (`parcelas_total`, `parcelas_aplicadas` = parcelas con `ha_cubiertas >= ha_parcela`, `porcentaje`, `estado`) y suma `ha_total`, `ha_cubiertas`, `pendiente_ha`, `pendiente_cantidad` (float) y `dosis_real_promedio: float | None` (ponderada por hectárea sobre los registros vinculados). `porcentaje` pasa a ser por hectáreas.
- `necesidad-stock`: `cantidad_pendiente` por insumo = Σ `dosis_plan × pendiente_ha` de todas sus filas; resto igual.

- [ ] **Step 1: Tests** (`test_plan_cobertura.py`): `test_sin_registros_todo_pendiente`; `test_cubre_por_hectareas_de_valvulas_aplicadas` (parral 6 ha con válvulas 1/2/3, se aplican 21 y 23 → `ha_cubiertas == 4`); `test_registro_de_parcela_entera_cubre_toda_la_parcela`; `test_dos_ordenes_misma_valvula_no_suman_dos_veces` y `test_parcela_entera_mas_valvulas_no_excede_total` (Review 4); `test_registro_sin_plan_id_no_cubre`; `test_dosis_distinta_igual_cubre_y_reporta_desvio`; `test_necesidad_stock_usa_hectareas_pendientes`. Reescribir `test_cumplimiento_fitosanitario.py` con registros vinculados (los viejos asumían la heurística N-ésima).
- [ ] **Step 2-3: Fallar, implementar** (una consulta de registros con `plan_fitosanitario_id IN (…)` y joins a `Valvula`/`Parcela`; agrupar en Python), **pasar**, suite completa.
- [ ] **Step 4: Commit** — `feat(backend): cumplimiento del plan por hectáreas con vínculo explícito`.

### Task 7: Rondas pendientes (tarjetas)

**Files:**
- Modify: `backend/app/api/plan_fitosanitario.py` (nueva ruta `GET /rondas-pendientes`, declarada **antes** de cualquier ruta con `/{plan_id}`), `backend/app/schemas/produccion.py`
- Test: `backend/tests/test_plan_rondas_pendientes.py`

**Interfaces:**
- Consumes: `cobertura_por_parcela` (Task 6).
- Produces schemas: `RondaPendienteLinea(insumo_id, insumo_nombre, unidad, dosis_por_ha: float)`, `RondaPendienteParcela(id, nombre, ha_pendientes: float, parcial: bool)`, `RondaPendienteVariedad(variedad, ha_pendientes: float, parcelas: list[RondaPendienteParcela])`, `RondaPendiente(numero_aplicacion, objetivo, mes, lineas, variedades)`; endpoint `GET /plan-fitosanitario/rondas-pendientes?temporada=` → `list[RondaPendiente]`, requiere `require_encargado_up`.
- Reglas: se agrupan filas del plan con igual `(numero_aplicacion, objetivo)` y mismo conjunto `(insumo_id, dosis_por_ha)`; dosis distinta → tarjeta aparte. Una variedad entra a la tarjeta si alguna de sus filas tiene `pendiente_ha > 0`. `parcial=True` si la parcela tiene cubierta alguna (pero no todas) de las líneas de la tarjeta, y la UI la destilda. Orden: `numero_aplicacion`, `mes`. Una tarjeta sin variedades pendientes no se devuelve.

- [ ] **Step 1: Tests**: `test_agrupa_variedades_con_misma_ronda_y_productos` (3 variedades, 4 productos → 1 tarjeta, 4 líneas, 3 variedades); `test_dosis_distinta_separa_tarjetas`; `test_ronda_cubierta_no_aparece`; `test_parcela_con_una_linea_cubierta_viene_parcial`; `test_orden_parcial_deja_pendiente_el_resto` (una orden con 3 de 4 productos → la tarjeta reaparece solo con el producto faltante); `test_ruta_estatica_no_choca_con_plan_id`; `test_requiere_encargado`.
- [ ] **Step 2-4: Fallar, implementar, pasar** + suite.
- [ ] **Step 5: Commit** — `feat(backend): endpoint de rondas pendientes del plan`.

### Task 8: Backfill de registros históricos y deploy de la fase 2

**Files:**
- Create: `scripts/migracion/backfill_plan_registros.py` (leer `scripts/migracion/README.md` y copiar su patrón de conexión; **sin** credenciales en el código)
- Test: `backend/tests/test_backfill_plan_registros.py` (importar la función pura de asignación)

**Interfaces:** función pura `asignar_plan_a_registros(planes, parcelas_por_variedad, registros) -> dict[str, str]` (`registro_id -> plan_id`) con la heurística vieja (N-ésimo registro del mismo insumo en una parcela cubre la N-ésima ronda del plan de esa variedad); el script solo carga datos, llama la función e imprime el resumen. Argumentos: `--temporada` (obligatorio), `--apply` (sin él es dry-run). Solo toca registros sin `orden_id` y sin `plan_fitosanitario_id` de la temporada.

- [ ] **Step 1-3: Tests de la función pura** (`test_n_esima_aplicacion_cubre_n_esima_ronda`, `test_registros_con_plan_id_no_se_tocan`, `test_registro_de_otra_temporada_no_se_asigna`), fallar, implementar, pasar.
- [ ] **Step 4: Dry-run en local** y revisar el resumen a mano. Commit — `feat(scripts): backfill del vínculo registro-plan para la temporada vigente`.
- [ ] **Step 5: Revisión + docs** (skill `revisar-antes-de-commit`; regenerar PROJECT_MAP/Modelo de Datos).
- [ ] **Step 6: Deploy de la fase 2 — PAUSA: confirmar con Fausto.** Después del deploy: dry-run en prod, mostrar el resumen a Fausto y correr `--apply` **solo con su OK**.

---

## Fase 3 — Web (delegar en el agente `frontend-nextjs`; leer `frontend/AGENTS.md`)

### Task 9: Cliente API y tipos

**Files:** Modify `frontend/lib/api/ordenesAplicacion.ts`; Modify (o Create si no existe) el módulo de API del plan fitosanitario (buscar con `grep -rn "plan-fitosanitario" frontend/lib`).

**Interfaces:** tipos TS espejo de los schemas de Tasks 2/6/7 (`OrdenAplicacionLinea`, `RondaPendiente`, etc.); decimales como `Number()` al consumir; funciones `crearOrden(body: OrdenAplicacionCreate)`, `actualizarOrden(id, body)`, `getRondasPendientes(temporada)`.

- [ ] **Step 1:** implementar. **Step 2:** `cd frontend && npm run lint && npm run build` (el build type-checkea) → sin errores. **Step 3:** commit — `feat(web): cliente API de órdenes multiproducto y rondas pendientes`.

### Task 10: Formulario "Nueva orden" con selector y tarjetas

**Files:** Create `frontend/components/produccion/NuevaOrdenAplicacion.tsx` y `frontend/components/produccion/RondaCard.tsx`; Modify `frontend/app/dashboard/produccion/ordenes-aplicacion/page.tsx` (hoy 1063 líneas: extraer el formulario actual y usar el nuevo componente).

**Contrato de UI (no negociable):** selector **Del plan | Fuera del plan** (por defecto Del plan). Del plan → lista de `RondaCard` (objetivo, mes, productos con dosis y unidad, variedades con hectáreas pendientes); un toque precarga variedades, parcelas (las `parcial` destildadas con badge), líneas y `numero_aplicacion`. Editable: destildar parcelas, cambiar dosis, quitar/agregar producto, elegir válvulas. Al cambiar el producto de una línea se borra su `numero_aplicacion`; al agregar un producto nuevo queda sin él. Carencia/reingreso se piden por línea (los `Insumo` no los traen). Aviso no bloqueante si la fecha planificada cae fuera del mes de la ronda. Fuera del plan → mismo formulario vacío con multi-variedad. Edición de órdenes existentes (cualquier origen) reutiliza el componente. Un mensaje de error de la API (422) se muestra tal cual.

- [ ] **Step 1:** implementar. **Step 2:** `npm run lint && npm run build`. **Step 3:** probar en local con Claude in Chrome (skill `verificar-local`): crear la orden "Curación tintos" desde una tarjeta con 4 productos y varias variedades, editar una dosis, crear una fuera del plan, editar una orden sin confirmaciones. **Step 4:** commit — `feat(web): nueva orden desde ronda del plan con tarjetas`.

### Task 11: Listados, aplicaciones realizadas, cumplimiento y repaso

**Files:** Modify `frontend/app/dashboard/produccion/ordenes-aplicacion/page.tsx` (lista: productos como chips, variedades), `frontend/components/produccion/AplicacionesRealizadas.tsx` (Eliminar/Reactivar avisan que afectan a toda la válvula y listan sus productos), `frontend/app/dashboard/produccion/fitosanitarios/page.tsx` (panel A revisar: `productos`; "Crear orden de repaso" precarga las líneas de la orden original), pantalla de cumplimiento del plan (barras por hectáreas, desvío de dosis, pendiente por producto — ubicarla con `grep -rn "cumplimiento" frontend`).

- [ ] **Step 1:** implementar. **Step 2:** `npm run lint && npm run build`. **Step 3:** click real en local: ver el cumplimiento bajar al confirmar válvulas desde la API, Eliminar de un producto avisa y saca toda la válvula. **Step 4:** commit — `feat(web): productos múltiples en listados, cumplimiento por hectáreas y repaso`.
- [ ] **Step 5: Deploy web — PAUSA: confirmar con Fausto**; `npx vercel --prod` (no auto-despliega) vía skill `deploy-lirios`.

---

## Fase 4 — Mobile (delegar en `mobile-expo`; leer `mobile/AGENTS.md`)

### Task 12: Lista de productos y confirmación

**Files:** Modify `mobile/lib/types.ts` (tipos de línea y `variedades`), `mobile/components/OrdenesPendientes.tsx` (710 líneas; extraer a un componente propio el bloque de productos si crece).

**Contrato de UI:** la orden muestra la lista de productos con dosis y unidad; el modal de la válvula lista cada producto con su cantidad calculada (`dosis × superficie_ha` de la válvula) y confirma todo junto (un solo POST, un solo flujo de foto/observaciones); si la API devuelve 422 por superficie, mostrar el mensaje. Sin cambios en el flujo de deshacer. Compatible hacia atrás: si la respuesta no trae `lineas`, usar los campos de producto único.

- [ ] **Step 1:** implementar. **Step 2:** `cd mobile && npx tsc --noEmit` → sin errores. **Step 3:** probar en el emulador/dispositivo contra el backend local una orden de 4 productos y una vieja de 1. **Step 4:** commit — `feat(mobile): órdenes con varios productos`.
- [ ] **Step 5: OTA — PAUSA: confirmar con Fausto.** `eas update ... --environment <env>` según `mobile/AGENTS.md`, sin tocar `eas.json`. Verificar en un celular con la app instalada.

---

## Cierre

### Task 13: Documentación y bitácora

- [ ] Agente `docs-sync`: regenerar `PROJECT_MAP.md` y `docs/sistema/Modelo de Datos.md`, escribir la entrada de bitácora, actualizar `docs/sistema/Arquitectura` si menciona órdenes de un solo producto, y proponer la memoria `project_ordenes_multiproducto` (índice en `MEMORY.md`).
- [ ] **Cleanup futuro (otro plan, no ahora):** migración que elimina las columnas shim de `ordenes_aplicacion`, `registro_fitosanitario_id` de filas parcela/válvula y los campos shim de las respuestas, cuando no queden builds viejos (revisar Play Console / OTA adoption).
