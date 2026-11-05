# Orden Del plan / Fuera del plan + aplicadas agrupadas en mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una orden de aplicación pueda marcarse «Fuera del plan» (no cuenta para el cumplimiento) y que la pestaña «Realizadas» de mobile muestre el árbol orden > parcela > válvula de la web.

**Architecture:** Frente A: columna `ordenes_aplicacion.fuera_de_plan`; el filtro vive en un único punto de cálculo (`plan_avance._dosis_por_grupo`), que alimenta avance, contraste, banner y necesidad de stock; la web agrega un interruptor. Frente B: solo mobile; se porta el agrupador puro de la web y se reemplaza `RecentList`.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pytest (SQLite), Next.js (`frontend/`), Expo SDK 54 (`mobile/`).

**Spec:** `docs/superpowers/specs/2026-11-05-orden-fuera-de-plan-y-aplicadas-mobile-design.md`

## Global Constraints

- IDs UUID `String(36)`; nunca commit en routers; PATCH con `exclude_unset`; plata/cantidades `Decimal`.
- Migración nueva (no editar las existentes): hoy el head es `0861ea1414eb`; debe quedar un solo head.
- Mobile y web de producción siguen funcionando contra el backend nuevo: un body sin `fuera_de_plan` equivale a `false`.
- Un registro sin orden (carga a mano) cuenta «del plan».
- Frente B: sin cambios de backend, solo lectura, rol < encargado ve un mensaje claro (no lista vacía por 403).
- Código/comentarios en inglés; textos de UI en español rioplatense.
- Branches: A en `feat/orden-fuera-de-plan`, B en `feat/aplicadas-mobile-agrupadas`, ambos desde `main`. Sin push ni deploy sin confirmación de Fausto. Probar en local antes de deployar (skill `verificar-local`).

## Review Focus

- Orden con `fuera_de_plan=true` que además tiene un producto que SÍ está en el plan: no debe sumar nada (ni en matriz ni en `pendiente_por_insumo`).
- Registro con `orden_id` NULL (carga a mano): sigue contando (cuidado con `NOT IN` y NULL).
- Mezcla en el mismo mes/producto: un registro de orden Del plan + otro de orden Fuera del plan → solo cuenta el primero.
- `PUT` que intenta cambiar `fuera_de_plan` con una válvula ya confirmada → 409, valor intacto.
- B: registros sin orden, válvula sin `orden_valvula_id`, campaña sin registros, y rol regador/obrero (403) no deben romper la pantalla.

---

## FRENTE A — Del plan / Fuera del plan

### Task 1: Columna, schemas y persistencia en la orden

**Files:**
- Modify: `backend/app/models/produccion.py` (clase `OrdenAplicacion`, ~L589-611)
- Create: `backend/app/core/migrations/versions/<rev>_orden_fuera_de_plan.py` (autogenerate; skill `nueva-migracion`)
- Modify: `backend/app/schemas/produccion.py` (`OrdenAplicacionResponse` ~L477, `OrdenAplicacionUpdate` ~L521)
- Modify: `backend/app/api/ordenes_aplicacion.py` (`_to_response` ~L121, crear ~L347, `PUT` ~L591)
- Test: `backend/tests/test_orden_fuera_de_plan.py` (nuevo)

**Interfaces:**
- Produces: `OrdenAplicacion.fuera_de_plan: bool`; campo `fuera_de_plan: bool` en `OrdenAplicacionResponse`, `OrdenAplicacionUpdate` y por herencia en `OrdenAplicacionCreate` (default `False`).

- [ ] **Step 1: Write failing tests** en `test_orden_fuera_de_plan.py` (usar los fixtures de `tests/helpers_ordenes.py` y el patrón de `test_ordenes_aplicacion.py`):
  - `test_crear_orden_sin_campo_es_del_plan`: POST sin `fuera_de_plan` → 201, `resp["fuera_de_plan"] is False`.
  - `test_crear_orden_fuera_de_plan`: POST con `fuera_de_plan=true` → `resp["fuera_de_plan"] is True`, y un GET de la orden lo devuelve igual.
  - `test_put_cambia_fuera_de_plan_sin_confirmaciones`: PUT con `true` → 200 y persiste.
  - `test_put_con_valvula_confirmada_no_cambia_fuera_de_plan`: confirmar una válvula, PUT con el valor contrario → 409 y GET sigue con el valor original.
- [ ] **Step 2: Run** `cd backend && ./venv/Scripts/python.exe -m pytest tests/test_orden_fuera_de_plan.py -v` → FAIL.
- [ ] **Step 3: Model:** `fuera_de_plan: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa.false(), default=False)` en `OrdenAplicacion`.
- [ ] **Step 4: Migración:** `alembic revision --autogenerate -m "orden fuera de plan"`; revisar que solo haga `add_column` con `server_default=sa.false()` y `drop_column` en el downgrade; `alembic heads` = un head; `alembic upgrade head` en la base local.
- [ ] **Step 5: Schemas/router:** `fuera_de_plan: bool = False` en `OrdenAplicacionUpdate` (lo hereda Create) y `fuera_de_plan: bool = False` en la respuesta; `_to_response` lo copia; crear lo asigna; el `PUT` lo asigna en el mismo bloque donde ya valida «sin aplicaciones confirmadas» (la validación existente produce el 409; no duplicarla).
- [ ] **Step 6: Run** los tests nuevos y `./venv/Scripts/python.exe -m pytest` completo → todo verde.
- [ ] **Step 7: Commit** en `feat/orden-fuera-de-plan`: `feat(ordenes): columna fuera_de_plan en la orden de aplicación`.

### Task 2: El avance ignora lo aplicado por órdenes Fuera del plan

**Files:**
- Modify: `backend/app/services/plan_avance.py` (`_dosis_por_grupo`, ~L97-139)
- Test: `backend/tests/test_plan_avance.py` (agregar), `backend/tests/test_plan_contraste.py` (agregar)

**Interfaces:**
- Consumes: `OrdenAplicacion.fuera_de_plan` (Task 1); `RegistroFitosanitario.orden_id` (`column_property`, escalar, puede ser NULL).
- Produces: sin firmas nuevas. `calcular_avance`, `dosis_aplicada_por_parcela`, `pendiente_por_insumo` y `calcular_contraste` heredan el filtro.

- [ ] **Step 1: Write failing tests** (con los helpers `_registro`/`_escenario` de `test_plan_avance.py`; crear la orden con `fuera_de_plan` y un registro por válvula confirmada, o enlazar el registro a la orden como lo hace `test_registro_de_orden_por_valvula_usa_su_superficie`):
  - `test_orden_fuera_de_plan_no_suma_al_avance`: parcela entera, producto del plan; registro de orden fuera → estado `pendiente`, `dosis_aplicada == 0`.
  - `test_orden_del_plan_sigue_sumando`: misma escena con `fuera_de_plan=false` → `ok`.
  - `test_mezcla_orden_del_plan_y_orden_fuera_solo_cuenta_la_del_plan`: dos registros mismo mes/producto → `dosis_aplicada` = solo el de la orden del plan.
  - `test_registro_a_mano_sigue_contando_con_ordenes_fuera_en_la_base`: existe una orden fuera en la DB y un registro sin orden → el registro cuenta (cubre NULL en `NOT IN`).
  - `test_producto_ajeno_en_orden_del_plan_sigue_no_planificado`: sin cambios respecto de hoy.
  - `test_necesidad_de_stock_ignora_ordenes_fuera_de_plan`: `pendiente_por_insumo` sigue pidiendo todo lo del plan cuando lo aplicado vino de una orden fuera.
  - `test_contraste_no_descuenta_lo_aplicado_por_orden_fuera`: `dosis_aplicada_promedio == 0` en la etiqueta.
- [ ] **Step 2: Run** `./venv/Scripts/python.exe -m pytest tests/test_plan_avance.py tests/test_plan_contraste.py -v` → los nuevos FALLAN.
- [ ] **Step 3: Implement** en `_dosis_por_grupo`: agregar al `.where(...)` la condición `or_(RegistroFitosanitario.orden_id.is_(None), RegistroFitosanitario.orden_id.not_in(select(OrdenAplicacion.id).where(OrdenAplicacion.fuera_de_plan.is_(True))))`. El `is_(None)` explícito es obligatorio: `NULL NOT IN (...)` es NULL y dejaría afuera las cargas a mano. Importar `OrdenAplicacion` y `or_`.
- [ ] **Step 4: Run** los dos archivos y el suite completo → verde.
- [ ] **Step 5: Commit:** `feat(plan): las órdenes fuera de plan no cuentan para el cumplimiento`.

### Task 3: Web — interruptor, insignia y tipos

**Files:**
- Modify: `frontend/lib/api/ordenesAplicacion.ts` (`OrdenAplicacion`, `OrdenAplicacionUpdate`)
- Modify: `frontend/components/produccion/NuevaOrdenAplicacion.tsx` (estado ~L357; contraste ~L552-583; submit ~L665; paneles ~L938)
- Modify: `frontend/app/dashboard/produccion/ordenes-aplicacion/page.tsx` (tarjeta de la orden; `OrdenCard`)

**Interfaces:**
- Consumes: campo `fuera_de_plan` de la API (Task 1).
- Produces: `OrdenAplicacion.fuera_de_plan: boolean`; `OrdenAplicacionUpdate.fuera_de_plan?: boolean`.

- [ ] **Step 1: Types:** agregar los dos campos en `lib/api/ordenesAplicacion.ts`.
- [ ] **Step 2: Interruptor** en `NuevaOrdenAplicacion.tsx`: `const [fueraDePlan, setFueraDePlan] = useState(orden?.fuera_de_plan ?? false)`; control segmentado «Del plan» / «Fuera del plan» arriba del formulario, deshabilitado si la orden editada ya tiene válvulas confirmadas (usar la misma condición que ya bloquea la edición). El body de `crearOrden`/`actualizarOrden` lleva `fuera_de_plan: fueraDePlan`.
- [ ] **Step 3: Comportamiento Fuera del plan:** `contrasteKey` queda vacío (no se llama a `postContraste`); `resultadoDe` y `resumenOrden` devuelven «Fuera del plan» localmente para cada línea; no se renderiza `PendientePlan`; texto fijo «Esta orden no cuenta para el cumplimiento». Con Del plan no cambia nada respecto de hoy.
- [ ] **Step 4: Insignia** «Fuera del plan» en la tarjeta de la orden cuando `orden.fuera_de_plan`.
- [ ] **Step 5: Verify:** `cd frontend && npx tsc --noEmit && npm run lint && npm run build` sin errores nuevos.
- [ ] **Step 6: Click real en local** (skill `verificar-local`, backend con la migración aplicada): crear una orden en cada modo; con Fuera del plan no aparece el panel y la matriz de cumplimiento no se mueve al confirmar; con Del plan igual que hoy; editar una orden y ver el interruptor precargado y bloqueado tras confirmar. Consola y red sin errores.
- [ ] **Step 7: Commit:** `feat(web): interruptor Del plan / Fuera del plan en la orden de aplicación`.

### Task 4: Revisión y deploy del frente A

- [ ] **Step 1:** skill `revisar-antes-de-commit` sobre la branch (code-reviewer + qa-tester). Resolver bloqueantes.
- [ ] **Step 2:** `docs-sync`: regenerar `PROJECT_MAP.md`; bitácora de la sesión.
- [ ] **Step 3:** Confirmar con Fausto; backup (`scripts/backup_postgres.ps1`, lo corre él); merge `--no-ff` a `main` y push (Railway migra); verificar en logs `Running upgrade 0861ea1414eb -> <rev>`; verificación directa de la columna en prod con un script de solo lectura.
- [ ] **Step 4:** `cd frontend && npx vercel --prod` (lo corre Fausto); `Modelo de Datos.md` regenerado (lo corre Fausto).

---

## FRENTE B — Aplicadas en mobile como en la web

### Task 5: Tipos, cliente de API y agrupador portado

**Files:**
- Modify: `mobile/lib/types.ts` (`RegistroFitosanitario` ~L105-122)
- Modify: `mobile/lib/api.ts` (cliente nuevo)
- Create: `mobile/lib/fitosanitariosAgrupar.ts` (port de `frontend/lib/fitosanitariosAgrupar.ts`)
- Create: `scripts/verificar_agrupador_mobile.mjs` (comparación contra la web, solo lectura)

**Interfaces:**
- Produces:
  - `RegistroFitosanitario` ganando `orden_id: string | null`, `orden_valvula_id: string | null`, `observaciones: string | null`, `fecha_habilitacion_cosecha: string | null`.
  - `getRegistrosCampania(temporada: number): Promise<RegistroFitosanitario[]>` (pagina de a 1000 con `fecha_desde=${temporada}-05-01`, `fecha_hasta=${temporada+1}-04-30`, igual que la web).
  - `getOrdenesCampania(temporada: number): Promise<OrdenAplicacion[]>` → `GET /ordenes-aplicacion/?temporada=`.
  - En `fitosanitariosAgrupar.ts`: `hoyLocalISO()`, `diasEntre(a, b)`, `formatFecha(iso)`, `carenciaPorParcela(registros, hoy)`, `agruparRegistros(registros, ordenes)` con las mismas firmas y reglas que la web (clave de válvula `orden_valvula_id` → `'parcela'` si hay `orden_id` → `manual:${fecha}`; orden más reciente primero; el grupo sin orden siempre al final), cambiando solo los imports de tipos a los de `mobile/lib/types.ts`.

- [ ] **Step 1:** Extender el tipo y agregar los dos clientes siguiendo el estilo de `mobile/lib/api.ts` (instancia `api`, paginación en bucle hasta una página < 1000).
- [ ] **Step 2:** Portar el agrupador; los tipos de válvula de mobile son `OrdenAplicacionParcelaItem`/`OrdenAplicacionValvulaItem`.
- [ ] **Step 3:** `scripts/verificar_agrupador_mobile.mjs`: toma un JSON de registros y órdenes (exportado por Fausto con `!` desde prod, solo lectura, o de la base local) y verifica que el agrupador de `frontend/lib` y el de `mobile/lib` devuelven árboles idénticos (mismos grupos, orden y conteos), más casos fijos: registro sin orden, válvula sin `orden_valvula_id`, campaña vacía, carencia vigente vs vencida.
- [ ] **Step 4:** Run `node scripts/verificar_agrupador_mobile.mjs` → pasa; `cd mobile && npx tsc --noEmit` → exit 0.
- [ ] **Step 5: Commit** en `feat/aplicadas-mobile-agrupadas`: `feat(mobile): agrupador de aplicadas portado de la web`.

### Task 6: Pantalla «Realizadas» agrupada

**Files:**
- Create: `mobile/components/AplicacionesAgrupadas.tsx`
- Modify: `mobile/app/fito.tsx` (`RecentList` L30-64, `loadRegistros` L87-96, pestañas L125-136)

**Interfaces:**
- Consumes: `agruparRegistros`, `carenciaPorParcela`, `getRegistrosCampania`, `getOrdenesCampania` (Task 5); tokens de `mobile/lib/theme.ts`; caché `getCache`/`setCache` (`mobile/lib/cache.ts`, TTL de `CACHE_TTL.fitosanitarios`).
- Produces: `<AplicacionesAgrupadas registros ordenes parcelas hoy />` (props tipadas con los tipos de mobile).

- [ ] **Step 1:** Componente con tres niveles colapsables (orden → parcela → válvula): orden = objetivo + fecha planificada + N parcelas + productos; parcela = nombre, N aplicaciones, última fecha y chip de carencia (≥ 15 días rojo, ≥ 7 ámbar, menos amarillo) o «Habilitado» en verde; válvula = nombre, fecha, responsable y productos con dosis/ha. Primera orden abierta, parcelas cerradas por defecto. Estado vacío con `ui/EmptyState`.
- [ ] **Step 2:** `fito.tsx`: reemplazar `RecentList` por el componente; `loadRegistros` carga registros y órdenes de la campaña vigente (`temporada` mayo→abril) en paralelo, con el patrón de caché actual (mostrar caché, refrescar por detrás, error de red no vacía la pantalla); el pull-to-refresh recarga ambos y mantiene el remount de `OrdenesPendientes`.
- [ ] **Step 3:** Rol: si el usuario es regador u obrero (o la API responde 403), la pestaña muestra «Esta vista es para encargados» en lugar de la lista; no se hace la carga.
- [ ] **Step 4: Verify:** `cd mobile && npx tsc --noEmit` → exit 0; correr el script de Task 5 otra vez.
- [ ] **Step 5: Commit:** `feat(mobile): pestaña Realizadas agrupada por orden, parcela y válvula`.

### Task 7: Revisión y OTA del frente B

- [ ] **Step 1:** skill `revisar-antes-de-commit` sobre la branch; `docs-sync` (bitácora).
- [ ] **Step 2:** Fingerprint local contra los builds vigentes: `npx eas-cli fingerprint:generate --platform android --environment production` y `--platform ios`; deben dar `1ccf455d…` / `07054827…`. Si no coinciden, parar: hace falta build nuevo, no OTA.
- [ ] **Step 3:** Con confirmación de Fausto y después del frente A en prod: merge a `main`, push, y Fausto corre `cd /c/claude-projects/los-lirios/mobile && EXPO_PUBLIC_API_URL=https://proyecto-gestion-los-lirios-production.up.railway.app npx eas-cli update --branch production --environment production -m "<mensaje>"`.
- [ ] **Step 4:** Verificar el bundle publicado (URL de prod grabada, sin IP local). La prueba visual nativa la hace Fausto en su dispositivo con la app actualizada.
