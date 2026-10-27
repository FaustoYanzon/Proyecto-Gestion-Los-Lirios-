# Órdenes de aplicación multiproducto, multivariedad y descuento contra el plan

Fecha: 2026-10-27 · Origen: las órdenes reales del agrónomo son mezclas ("Curación tintos:
Super folpan 1,5 kg + Mancozeb 2 kg + Oxicloruro 1 kg + Oponente 0,15 lt", todo por ha) sobre
varias variedades. Hoy una orden es 1 producto y 1 variedad.

## Objetivo
1. Una orden de aplicación lleva **N productos** (cada uno con su dosis/ha) y **N variedades**.
2. Crear la orden "del plan" es un toque: el ingeniero elige una **ronda pendiente** (tarjeta) y
   se precarga todo. También existe "fuera del plan".
3. Lo realmente aplicado **descuenta lo pendiente de cada ronda del plan** mediante un vínculo
   explícito (no por heurística), y alimenta `necesidad-stock`.
4. El operario confirma por válvula como hoy; una confirmación registra **todos** los productos.

## Decisiones tomadas (con Fausto)
- Varias variedades por orden; el descuento se calcula por la variedad de cada parcela.
- "Ronda" = una ronda del plan (`numero_aplicacion` de una variedad, con todos sus productos).
- Una ronda cuenta como **cubierta por hectáreas aplicadas** del producto, aunque la dosis difiera
  del plan; el desvío de dosis se muestra aparte.
- Una orden puede cubrir solo parte de una ronda; lo no cubierto reaparece como tarjeta.
- El plan no tiene fecha (solo `mes`): **no se hace match por fecha**. La ronda se elige a mano
  (tarjeta); la fecha solo es `fecha_planificada`, con aviso si cae fuera del mes del plan.
- Deshacer / Eliminar / Reactivar actúan sobre la **válvula completa** (todos sus productos).

## Modelo de datos
- **`ordenes_aplicacion_insumos`** (nueva): `id`, `orden_id`, `insumo_id`, `dosis_por_ha`,
  `dias_carencia`, `dias_reingreso`, `numero_aplicacion` (null = producto fuera del plan), `orden`
  (posición). Único `(orden_id, insumo_id)`.
- **`OrdenAplicacion`**: pierde su significado de producto único. `insumo_id`, `dosis_por_ha`,
  `dias_carencia`, `dias_reingreso`, `plan_fitosanitario_id`, `variedad` quedan **deprecados**:
  nullable, sin escribirse en órdenes nuevas, y se eliminan en una migración posterior cuando no
  queden clientes viejos. `origen` = `plan` si alguna línea tiene `numero_aplicacion`, si no `extra`.
- **`RegistroFitosanitario`** suma `plan_fitosanitario_id` (nullable), `orden_insumo_id`,
  `orden_parcela_id` y `orden_valvula_id` (nullable, indexados). Reemplazan los vínculos 1-1 actuales
  (`OrdenAplicacionParcela/Valvula.registro_fitosanitario_id`, únicos), que no soportan N registros
  por válvula. Un registro sigue siendo **1 producto**: trazabilidad, ficha PDF y vistas KPI no cambian.
- `plan_fitosanitario_id` del registro se resuelve **al confirmar**:
  fila del plan con `(temporada, variedad de la parcela, insumo, numero_aplicacion de la línea)`.
  Sin fila que coincida (ej. variedad que el plan no contempla) queda null = aplicación extra.
- Fotos: cuelgan de `orden_valvula_id` / `orden_parcela_id`, no de un registro puntual
  (`_fotos_de_valvula` ya lo contempla); no se duplican por producto.
- Migración + backfill, **en este orden**: (1) crear tabla y columnas; (2) cada orden existente
  pasa a 1 línea; (3) rellenar los nuevos FK de los registros desde los vínculos viejos;
  (4) `plan_fitosanitario_id`: directo desde `orden.plan_fitosanitario_id` si la orden vino del
  plan; para registros históricos sin orden (temporada vigente), la heurística actual **una sola
  vez** en un script de `scripts/migracion/` (se corre en prod solo con OK de Fausto). Los
  vínculos viejos se mantienen escritos para 1 línea hasta el cleanup.

## API
- `POST /ordenes-aplicacion/` (unificado) — body: `temporada`, `parcela_ids`, `valvula_ids?`,
  `fecha_planificada`, `objetivo`, `notas?`, `lineas: [{insumo_id, dosis_por_ha, dias_carencia,
  dias_reingreso, numero_aplicacion?}]`. Validaciones: ≥1 línea; insumos distintos; parcelas
  activas (varias variedades permitidas); `numero_aplicacion` solo si existe esa ronda en el plan
  para alguna variedad de las parcelas. `POST /desde-plan` queda como atajo compatible (1 línea).
- `PUT /{id}` y `DELETE /{id}`: **todas** las órdenes (plan o extra) son editables/eliminables
  mientras nada esté confirmado (hoy solo las extra). Las líneas se reemplazan completas.
- `GET /plan-fitosanitario/rondas-pendientes?temporada=` — tarjetas para el selector:
  `{numero_aplicacion, objetivo, mes, lineas:[{insumo, dosis_por_ha, unidad}],
  variedades:[{variedad, ha_pendientes, parcelas:[{id, nombre, ha_pendientes, completa}]}]}`.
  Agrupación: filas del plan con mismo `numero_aplicacion` + `objetivo` + mismo conjunto
  (insumo, dosis) en distintas variedades. Dosis distinta → tarjetas separadas.
  Parcelas con la ronda totalmente pendiente vienen tildadas; las parcialmente cubiertas vienen
  destildadas con marca "parcial" (una orden aplica todas sus líneas a todas sus parcelas).
- `GET /plan-fitosanitario/cumplimiento` y `/necesidad-stock`: se reescriben (ver abajo).
- `OrdenAplicacionResponse`: suma `lineas: [...]` y `variedades: [...]`; mantiene `insumo_id`,
  `insumo_nombre`, `dosis_por_ha`, `variedad` (= primera línea / variedad de mayor superficie)
  como shim para clientes viejos, marcados deprecados.
- `confirmar_valvula` / `confirmar_aplicacion`: misma firma; crean **un registro por línea** y un
  movimiento de stock por línea, en la misma transacción, bajo el lock de la orden. Cantidad por
  línea = `dosis × superficie`. `no_aplicada` no crea registros. Idempotencia: el 409 "ya
  confirmada" por fila sigue siendo la guarda.
- `a-revisar`: devuelve `productos` (lista) además del shim.
- `deshacer`, `reactivar`, `eliminar` (`app/services/aplicaciones.py`): operan sobre todos los
  registros de la válvula/parcela (por `orden_valvula_id`/`orden_parcela_id`): revierten N
  movimientos de stock, borran N registros y sus fotos.

## Cumplimiento del plan (reemplaza la heurística)
Por fila del plan (variedad + ronda + producto):
- `ha_total` = Σ `superficie_ha` de las parcelas activas de la variedad.
- `ha_cubiertas` = Σ superficie de las unidades **distintas** (válvula, o parcela entera si el
  registro es de parcela) con un registro cuyo `plan_fitosanitario_id` es esa fila. Distinto evita
  contar dos veces un repaso sobre la misma válvula.
- `pendiente_ha = ha_total − ha_cubiertas`; `pendiente_cantidad = dosis_plan × pendiente_ha`;
  estado `pendiente | parcial | completo`; `porcentaje` por hectáreas (hoy es por cantidad de parcelas).
- Desvío de dosis: dosis real promedio ponderada vs `dosis_por_ha` del plan.
- `necesidad-stock` suma `pendiente_cantidad` por insumo contra `stock_actual`.

## Web
- Nueva orden: selector **Del plan | Fuera del plan**. Del plan → tarjetas de rondas pendientes;
  un toque precarga variedades, parcelas, productos y dosis; editable (destildar parcelas, cambiar
  dosis, quitar/agregar producto, elegir válvulas). Fuera del plan → mismo formulario vacío.
- Listado de órdenes: productos como chips; variedades múltiples.
- Aplicaciones realizadas: cada producto es una fila (1 registro = 1 producto); Eliminar/Reactivar
  avisa que afecta a toda la válvula y lista los productos.
- Pantalla de cumplimiento: barras por hectáreas, desvío de dosis, pendiente por producto.
- "Crear orden de repaso" precarga las líneas de la orden original.

## Mobile
- `OrdenesPendientes.tsx`: la orden muestra la lista de productos con dosis; el modal de la válvula
  muestra cada producto con su cantidad calculada y confirma todo junto. Un push de orden nueva
  dice "Curación tintos · 4 productos · parrales…".

## Fases (cada una se prueba en local antes de deployar)
1. **Backend base**: tabla de líneas, columnas nuevas, migración + backfill, confirmación N
   registros, deshacer/eliminar/reactivar multi-registro, shims de compatibilidad, tests.
   Deploy Railway (la web y el mobile actuales siguen funcionando con los shims).
2. **Backend plan**: `POST /` unificado, `PUT/DELETE` ampliado, `rondas-pendientes`, cumplimiento y
   necesidad-stock nuevos, script de backfill de históricos, tests.
3. **Web**: formulario con tarjetas, listados, cumplimiento. Deploy manual Vercel.
4. **Mobile**: lista de productos y confirmación. OTA (`eas update`, sin tocar `eas.json`).
5. **Cleanup** (otra migración, más adelante): quitar columnas deprecadas y shims.

## Riesgos y bordes
- **Deshacer/Eliminar/Reactivar** es lo recién desplegado y lo más delicado: cubrir con tests de
  atomicidad (falla a mitad de la confirmación → ningún registro ni movimiento) y de doble toque.
- **Numeración del plan**: la tarjeta agrupa por `numero_aplicacion` + `objetivo` + productos. Si el
  mismo "Curación tintos" tiene número distinto entre variedades, salen tarjetas separadas. El
  formulario de plan ya crea una fila por variedad con el mismo número; hay que cargarlo así.
- **Parcela parcialmente cubierta** en una ronda: destildada y marcada; si el ingeniero la fuerza,
  se duplica la aplicación real (stock real, correcto) pero la cobertura no suma de más.
- **Carencia por producto**: la carencia efectiva de la válvula es la máxima de sus productos
  (cada registro conserva la suya). Verificar en el plan si `Insumo` trae carencia para precargarla.
- **Unidades**: la dosis se interpreta en la unidad del insumo (ej. "0,150 cc" en el ejemplo es
  0,15 lt; revisar la unidad cargada del insumo Oponente).
- **Clientes viejos**: shims hasta el cleanup; el OTA llega a todos los binarios, pero hay que
  esperar a que se actualicen antes de quitar columnas.
- **Prod**: migración y backfill en producción solo con confirmación de Fausto
  (`scripts/migracion/_alembic_prod.py`).
