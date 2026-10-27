---
fecha: 2026-10-27
tags: [sistema, bitacora, produccion, fitosanitarios, ordenes-aplicacion, plan]
---

# Bitácora 2026-10-27: órdenes de aplicación multiproducto y multivariedad, con descuento contra el plan

Una orden de aplicación ahora puede llevar varios productos y varias variedades, y cada aplicación confirmada descuenta de la ronda del plan fitosanitario que cubre. Spec: `docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md`. Decisión: [[2026-10-27-ordenes-multiproducto]]. Rama `feat/ordenes-multiproducto`, **sin push ni deploy** a la fecha de esta nota. Click-through web y prueba en dispositivo siguen pendientes.

## Qué cambió

- **Modelo y migración:**
  - Tabla nueva `ordenes_aplicacion_insumos` (líneas de producto de la orden: insumo, dosis por ha, unidad).
  - `registros_fitosanitarios` gana `plan_fitosanitario_id`, `orden_insumo_id`, `orden_parcela_id`, `orden_valvula_id` (el vínculo con el plan deja de ser heurístico).
  - Las columnas shim de `ordenes_aplicacion` (insumo, dosis, variedad del producto único) **siguen NOT NULL** y se sincronizan desde la primera línea, para clientes viejos.
  - Las columnas legacy `registro_fitosanitario_id` de parcela/válvula **se conservan**.
- **API:**
  - `POST /ordenes-aplicacion/` unificado con `lineas`; los bodies legacy (un solo producto, `desde-plan`) se siguen aceptando.
  - `PUT` y `DELETE` para todos los orígenes hasta la primera confirmación.
  - 409 si un `PUT` con body legacy llega a una orden con más de una línea (evita perder en silencio las líneas 2..N).
  - Nuevo `GET /plan-fitosanitario/rondas-pendientes`.
  - `cumplimiento` y `necesidad-stock` pasan a medirse por hectáreas.
  - Confirmar crea un registro por línea; Deshacer, Eliminar y Reactivar actúan sobre la válvula (o parcela) completa, con todos sus registros hermanos, fotos incluidas.
- **Backfill:** `scripts/migracion/backfill_plan_registros.py` con `--local` / `--apply`. Sin `--local` lee PRODUCCIÓN; `--apply` pide escribir `SI`. Una sola transacción.
- **Web:** flujo por tarjetas (nueva orden desde una ronda del plan), productos múltiples en listados, barras de cumplimiento por hectáreas, repaso.
- **Mobile:** lista de productos por orden; la cantidad por válvula se calcula con redondeo half-even idéntico al servidor (`mobile/lib/cantidad.ts`, BigInt; un test del backend fija el contrato). `mobile/tsconfig.json` excluye `dist/` (el export web local desbordaba el stack de `tsc`); `tsconfig.json` no entra en el fingerprint, así que el OTA no se ve afectado.

## Decisiones que importan a futuro

- **El redondeo sigue half-even** (default de `Decimal`) en el backend; mobile lo reproduce. Con half-up el operario vería 3,53 donde el stock guardado dice 3,52.
- **La cobertura se mide por hectáreas**, no por cantidad de parcelas. Una parcela con todas sus válvulas activas cubiertas cuenta como completa aunque la suma de superficies de válvulas quede apenas por debajo de `Parcela.superficie_ha`; el porcentaje se limita a 99 si faltan hectáreas y a 1 si hay alguna cubierta.
- **Backfill: los manuales duplicados del mismo día se fusionan** en una sola aplicación (agrupación consciente de los registros ya vinculados a órdenes). Un registro manual con `valvula_id` pero sin `orden_valvula_id` se trata como parcela completa.
- **La clave de tarjeta es el conjunto pendiente de cada variedad**, no la ronda nominal; así una tarjeta desaparece cuando su conjunto se cubre.
- **Los meses se ordenan en orden de campaña** (mayo → abril).
- Si una parcela no tiene variedad, `ValvulaARevisar.variedad` cae a la del shim de la orden.
- La web usa el flag `parcial` (el spec lo llama `completa`).

## Orden de despliegue (checklist)

El orden importa: cada paso cierra una ventana en la que el sistema queda inconsistente.

0. **Compuertas de datos antes de deployar** (consultas de solo lectura, pero contra PROD: con el OK de Fausto).
   - (a) Filas duplicadas del plan: `SELECT temporada, variedad, numero_aplicacion, insumo_id, count(*) FROM planes_fitosanitarios GROUP BY 1,2,3,4 HAVING count(*)>1`. Debe devolver 0 filas, o limpiarlas antes. Si no, una tarjeta lista el producto dos veces, el POST da 422 y la ronda nunca desaparece. El índice único va en la migración de limpieza.
   - (b) Contar `Valvula.superficie_ha IS NULL`: una válvula sin superficie suma 0 ha a la cobertura (y confirmarla da 422).
   - (c) Probar migración y backfill sobre un dump restaurado. La base local no tenía órdenes de plan ni confirmaciones de parcela completa, así que esas ramas nunca corrieron con datos reales.
1. **Backup de prod y ventana tranquila.** La migración toma `ACCESS EXCLUSIVE` sobre `registros_fitosanitarios` durante toda su transacción. Si el contenedor viejo confirma en ese momento puede haber un deadlock, y Postgres/Railway reintentan.
2. **Merge/push a `main` = migración de prod.** `backend/railway.json` arranca con `alembic upgrade head && uvicorn`, así que el deploy de Railway migra prod solo. **No** migrar a mano antes con `_alembic_prod.py`: eso solo alarga la ventana en que el contenedor viejo corre sobre el esquema nuevo. El merge a `main` necesita el OK explícito de Fausto.
   - Mientras convive el contenedor viejo, sus confirmaciones escriben solo el `registro_fitosanitario_id` legacy. El código nuevo ya lo tolera: Deshacer, Reactivar y Eliminar también buscan por el vínculo legacy, y `orden_id` cae en él. Esa es la defensa principal.
   - Apenas el contenedor nuevo esté vivo, correr dos chequeos de reparación:
     - `SELECT o.id FROM ordenes_aplicacion o WHERE NOT EXISTS (SELECT 1 FROM ordenes_aplicacion_insumos l WHERE l.orden_id = o.id)`: órdenes que creó el backend viejo después del DDL.
     - Registros referenciados por `ordenes_aplicacion_parcelas.registro_fitosanitario_id` u `ordenes_aplicacion_valvulas.registro_fitosanitario_id` con `orden_parcela_id IS NULL`.
   - Si alguno devuelve filas, re-correr los pasos 1-3 del backfill de la migración como SQL suelto e idempotente:
     - paso 1 con `WHERE NOT EXISTS (SELECT 1 FROM ordenes_aplicacion_insumos l WHERE l.orden_id = o.id)`;
     - paso 2 con `AND r.orden_parcela_id IS NULL`;
     - paso 3 con `AND r.orden_insumo_id IS NULL`, para no pisar el vínculo por línea/variedad que ya escribió el código nuevo.
3. **Backfill del vínculo registro-plan, inmediatamente después y ANTES de que alguien use tarjetas o cumplimiento.**
   - Primero dry-run (lee PROD: solo con el OK de Fausto) y revisar el resumen, incluido el conteo "Asignados con valvula_id sin orden".
   - Después `--apply`, escribiendo `SI`.
   - Hasta que corra, `/cumplimiento`, `/necesidad-stock` y `/rondas-pendientes` muestran todas las rondas como pendientes: la migración solo vincula los registros que vinieron de órdenes del plan.
   - Las aplicaciones cargadas en el formulario manual de Fitosanitarios (web `FitosanitarioForm`, mobile `app/fito.tsx`) nunca traen vínculo al plan, así que nunca cubren una ronda. El script es idempotente y se puede re-correr periódicamente. La alternativa a futuro es un vínculo opcional al plan en el formulario manual.
4. **OTA de mobile ANTES del deploy web:** `eas update --branch preview --environment preview -m "..."`, según `mobile/AGENTS.md` (no tocar `eas.json`). Con la web viva, un encargado ya puede crear una orden de 3 productos. Un teléfono con el OTA viejo mostraría solo el primero y el operario no se enteraría de los otros. Esperar la adopción del OTA, o acordar que nadie cree órdenes multiproducto hasta entonces.
5. **Web:** `npx vercel --prod` desde `frontend/` (no auto-despliega).
6. Click-through en web y en dispositivo (con una lista larga de productos: revisar el teclado, no hay `KeyboardAvoidingView`).
7. Regenerar `docs/sistema/Modelo de Datos.md` **solo después** de que prod esté migrada: el generador lee PROD vía `scripts/migracion/.env.prod`.

## Rollback

- **El "rollback" de Railway no sirve.** Redeploya la imagen anterior contra una base que ya está en la revisión `71e969f8521f`: `alembic upgrade head` falla con "Can't locate revision" y el servicio queda caído después de los 3 reintentos (`restartPolicyMaxRetries: 3`).
- **`alembic downgrade c3f1a8d27e54` pierde datos.** Borra `ordenes_aplicacion_insumos` y los vínculos nuevos de los registros. Eso PIERDE los productos 2..N de toda orden multilínea y deja sus registros sin vínculo a ninguna orden; solo el de la primera línea queda en el `registro_fitosanitario_id` legacy. Es sin pérdida únicamente con datos de una sola línea. El docstring del `downgrade()` de la migración ya lo dice.
- **Runbook:**
  1. Backup primero.
  2. Preferir un fix hacia adelante (commit nuevo a `main`) antes que un downgrade.
  3. Un downgrade en prod necesita el OK explícito de Fausto y se corre vía `scripts/migracion/_alembic_prod.py`.

## Pendiente post-deploy

- **`Modelo de Datos.md` no se regeneró.** `scripts/generate_modelo_datos.py` lee el esquema de PRODUCCIÓN (vía `scripts/migracion/.env.prod`, solo lectura) y prod todavía no tiene la migración. `PROJECT_MAP.md` sí se regeneró.
- Click-through web y prueba en dispositivo + OTA no hechos.
- Memoria `project_ordenes_multiproducto` y su entrada en `MEMORY.md`: proponer a Fausto, no se tocó.

## Pendientes y limpieza futura

- **Plan de limpieza (otro plan):** migración que elimine las columnas shim de `ordenes_aplicacion`, las `registro_fitosanitario_id` de filas parcela/válvula y los campos shim de las respuestas, cuando no queden builds viejos (revisar Play Console y adopción del OTA). Al sacar las legacy, quitar también el fallback de `registros_de_fila`, `_vincular_registro_legacy` y la `coalesce` de `RegistroFitosanitario.orden_id`.
- **Índice único en `planes_fitosanitarios (temporada, variedad, numero_aplicacion, insumo_id)`**, en la migración de limpieza, después de limpiar duplicados (ver compuerta 0a).
- **M3 (preexistente):** `_aplicar_movimiento_stock` hace read-modify-write de `Insumo.stock_actual`, cargado antes del lock por orden. Dos órdenes distintas que consumen el mismo insumo a la vez pueden perder una actualización. Pasar a un `UPDATE ... SET stock_actual = stock_actual - :q` atómico.
- **M5:** el backfill trata como parcela completa un registro manual que tiene `valvula_id` pero no tiene válvula de orden (el resumen lo cuenta en "Asignados con valvula_id sin orden").
- **M7:** cantidades `float` en las respuestas nuevas (`ha_pendientes` y `dosis_por_ha` de rondas pendientes, `cantidad_pendiente`/`faltante` de necesidad de stock, `dosis_por_ha` de las líneas). Pasar a `Decimal` serializado como string, como el resto de la API.
- El filtro `GET /ordenes-aplicacion/?variedad=` hace OR con la columna shim; sacarlo en la limpieza.
- `OrdenAplicacionInsumo.dosis_por_ha` es `Float`; pasar a `Numeric` en la limpieza.
- Líneas sin deduplicar por `insumo_id` si una variedad repite insumo en una misma ronda; filas duplicadas del plan (misma temporada/variedad/insumo/número) se vuelven rondas sucesivas.
- Body mixto (`lineas` + `insumo_id` de nivel superior): se ignora el de nivel superior en silencio.
- Backfill: un registro de orden con `orden_parcela_id` pero sin `plan_fitosanitario_id` no entra en el mapa de vinculados del día.
- Web: `AplicacionesRealizadas` no usa `apiErrorMessage` en Eliminar/Reactivar (un 422 con lista cae al texto genérico); `NuevaOrdenAplicacion.tsx` (~715 líneas) conviene partirlo; `RegistroFitosanitarioResponse` no expone `orden_valvula_id`; la barra de cumplimiento no se limita a 0-100 y muestra "(+0%)".
- Mobile: `check-cantidad.mjs` pide Node >= 22.18 y no corre en CI; "No aplicada" en una válvula sin superficie sigue rotulando "(cantidad para esta válvula)" con "—".
- Cobertura: `estado` y `parcelas_aplicadas` pueden discrepar cuando hay parcelas sin superficie; la dosis promedio cuenta dos veces los retoques.
- Tooling: `generate_modelo_datos.py` lee prod sin avisar; evaluar un flag explícito o apuntarlo a local por defecto.
