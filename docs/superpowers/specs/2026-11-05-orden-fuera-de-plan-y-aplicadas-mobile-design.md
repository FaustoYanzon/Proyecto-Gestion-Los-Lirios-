# Orden "Del plan / Fuera del plan" y vista agrupada de aplicadas en mobile — Design

**Fecha:** 2026-11-05 · **Estado:** borrador para revisión de Fausto · **Revierte parcialmente:** la decisión del
2026-10-28 (`2026-10-28-plan-mensual-avance-design.md` §5) de quitar el selector Del plan / Fuera del plan del alta de
orden. Lo que sigue **no** reintroduce rondas ni vínculo orden→plan: es un interruptor de si la orden cuenta o no para el
cumplimiento.

Dos frentes independientes en un mismo plan. A y B se construyen y se prueban por separado; B no depende de A.

---

## Frente A — Interruptor Del plan / Fuera del plan al crear la orden

### A.1 Objetivo

> Al crear la orden, un botón **Del plan / Fuera del plan**. Del plan: todos los productos de la orden descuentan de lo
> que hay que aplicar ese mes; si un producto no está en el plan, ese producto queda como fuera del plan y el resto
> cuenta. Fuera del plan: ningún producto de la orden afecta el cumplimiento fitosanitario. Lo ya aplicado hasta hoy
> queda como del plan, salvo los productos que no estén en el plan.

Criterios de éxito:
1. Una orden marcada Fuera del plan no mueve ninguna celda de la matriz de cumplimiento, el panel «Pendiente del plan»,
   el banner ni la necesidad de stock.
2. Una orden Del plan se comporta exactamente como hoy (un producto ajeno al plan sigue saliendo como fila azul
   «no planificado»).
3. Todo lo existente queda «del plan» sin migrar datos.

### A.2 Decisiones

- **Un solo dato nuevo, en la orden:** `ordenes_aplicacion.fuera_de_plan BOOLEAN NOT NULL DEFAULT false`.
- **"Producto no está en el plan" no se guarda:** se sigue calculando al leer (variedad, mes, insumo), así que sigue
  siendo correcto si el plan se edita después.
- **Productos ajenos al plan dentro de una orden Del plan:** se muestran como hoy (fila azul «no planificado»).
  Decisión de Fausto, 2026-11-05.
- **Registros cargados a mano (sin orden):** cuentan como «del plan», como hoy.
- **Sin backfill:** las órdenes existentes toman `false` por el default; coincide con lo pedido para lo ya aplicado.

### A.3 Backend

- **Modelo/migración nueva** (no se editan las existentes): `ADD COLUMN fuera_de_plan` con `server_default=false`.
  Downgrade: `drop_column`. Skill `nueva-migracion`; un solo head.
- **Schemas** (`app/schemas/produccion.py`): `OrdenAplicacionCreate`/`OrdenAplicacionUpdate` aceptan
  `fuera_de_plan: bool = False`; `OrdenAplicacionResponse` lo devuelve. Un body viejo sin el campo equivale a `false`.
- **Router** (`app/api/ordenes_aplicacion.py`): crear y `PUT` lo persisten. El `PUT` ya está limitado a órdenes sin
  aplicaciones confirmadas; el interruptor hereda esa regla (queda fijo al confirmar la primera válvula).
- **Cálculo** (`app/services/plan_avance.py`, `_dosis_por_grupo`): al sumar la dosis aplicada se **excluyen los
  registros cuyo `orden_id` apunta a una orden con `fuera_de_plan = true`**. `RegistroFitosanitario.orden_id` ya es un
  `column_property` (`models/produccion.py` ~L885), así que alcanza un filtro por subconsulta. Es el único punto de
  cómputo: `calcular_avance`, `dosis_aplicada_por_parcela` y `pendiente_por_insumo` (necesidad de stock) lo heredan.
- **Contraste:** sin cambios de API. Con Fuera del plan la web no llama a `POST /plan-fitosanitario/contraste` y muestra
  la etiqueta localmente (menos red, un solo mecanismo). Con Del plan el contraste ya descuenta lo aplicado porque
  `dosis_aplicada_por_parcela` hereda el filtro de `_dosis_por_grupo`.
- No cambian: stock, carencia, confirmación por válvula, Deshacer/Eliminar/Reactivar (los registros de una orden
  Fuera del plan siguen existiendo y descontando stock; solo no cuentan para el plan).

### A.4 Web

- `NuevaOrdenAplicacion.tsx`: control segmentado **Del plan** (default) / **Fuera del plan** arriba del formulario.
  - Del plan: igual que hoy (etiquetas en vivo, panel «Pendiente del plan»).
  - Fuera del plan: se oculta el panel, todas las líneas muestran «Fuera del plan» y una línea explica «Esta orden no
    cuenta para el cumplimiento».
  - Al editar una orden existente se precarga el valor; deshabilitado si ya tiene válvulas confirmadas.
- `lib/api/ordenesAplicacion.ts`: el campo en los tipos (`OrdenAplicacion`, `OrdenAplicacionUpdate`).
- Lista de órdenes: insignia «Fuera del plan» en la tarjeta. Nada más.

### A.5 Pruebas

- Backend (SQLite en memoria): avance sin cambio para una orden Del plan; una orden Fuera del plan no mueve avance,
  banner ni necesidad de stock; orden Del plan con un producto ajeno → los del plan suman y el ajeno queda
  `no_planificado`; el contraste no cuenta lo aplicado por una orden Fuera del plan; `PUT` cambia el valor y se rechaza con aplicaciones
  confirmadas; body sin el campo = `false`; los registros manuales siguen contando.
- Web: `tsc`, lint, build y click real en local (skill `verificar-local`) con las dos opciones.
- Mobile no se toca en A: ignora el campo nuevo.

### A.6 Despliegue

Backup → push a `main` (Railway corre la migración, solo `ADD COLUMN`) → `npx vercel --prod` desde `frontend/`.
Sin OTA. Ventana corta en la que la web vieja no manda el campo: el backend usa `false` (comportamiento actual).
Regenerar `PROJECT_MAP.md` y `Modelo de Datos.md` (este último lo corre Fausto, lee prod).

---

## Frente B — Aplicadas en mobile como en la web (orden > parcela > válvula)

### B.1 Estado actual

`mobile/app/fito.tsx`, pestaña «Realizadas»: componente local `RecentList` que pide `GET /produccion/fitosanitarios/?limit=10`
(10 registros planos, sin filtros ni paginación) y muestra producto, parcela y fecha. Sin carencia, válvula ni orden.
El tipo `RegistroFitosanitario` de mobile omite `orden_id`, `orden_valvula_id` y `observaciones`, que el backend ya envía.
Los endpoints de lectura exigen **encargado o superior**: regador/obrero reciben 403 y hoy ven la lista vacía.

### B.2 Diseño

- **Datos:** la campaña completa (mayo → abril) de `GET /produccion/fitosanitarios/`, paginando de a 1000 como la web,
  más `GET /ordenes-aplicacion/?temporada=` (cliente nuevo; el tipo `OrdenAplicacion` de mobile ya existe). Nombres de
  parcela desde `/parcelas/mapa` (ya cacheado). Sin cambios de backend ni migración: `orden_valvula_id` ya llega.
- **Lógica:** portar a `mobile/lib/` el agrupador puro de la web (`frontend/lib/fitosanitariosAgrupar.ts`:
  `agruparRegistros`, `carenciaPorParcela`, `hoyLocalISO`, `diasEntre`, `formatFecha`), cambiando solo los imports de
  tipos. Extender `RegistroFitosanitario` con `orden_id`, `orden_valvula_id` y `observaciones`. Los tipos de válvula de
  mobile son `OrdenAplicacionParcelaItem`/`OrdenAplicacionValvulaItem`; se mapean a los de la web.
- **Pantalla:** reemplazar `RecentList` por un componente nuevo (p. ej. `components/AplicacionesAgrupadas.tsx`), árbol
  colapsable:
  - **Orden:** objetivo («Cargas manuales (sin orden)» / «Orden de otra campaña» como en la web), fecha planificada,
    N parcelas, productos de las líneas.
  - **Parcela:** nombre, N aplicaciones, última fecha, y chip de carencia (días hasta `fecha_habilitacion_cosecha` más
    lejana) o «Habilitado» en verde. Colores: ≥ 15 días rojo, ≥ 7 ámbar, menos amarillo (tokens de `lib/theme.ts`).
  - **Válvula:** nombre, fecha y responsable, y cada producto con su dosis/ha.
  - Orden más reciente primero; la primera orden abierta y las parcelas cerradas por defecto; «sin orden» al final.
- **Solo lectura.** Sin editar, eliminar ni reactivar (siguen en la web). «Deshacer» ya existe en la pestaña Pendientes.
- **Roles:** para regador/obrero la pestaña muestra un mensaje claro («Esta vista es para encargados») en lugar de la
  lista vacía por 403. No se toca el backend ni los permisos. Decisión de Fausto, 2026-11-05.
- **Offline:** mismo patrón de caché que hoy (TTL 15 min, `lib/cache.ts`): mostrar lo guardado y refrescar por detrás;
  un error de red no vacía la pantalla.
- **Pull-to-refresh** recarga registros y órdenes, además del remount de `OrdenesPendientes` que ya existe.

### B.3 Pruebas

No hay runner de tests en mobile ni en web. Verificación:
- Script de Node que corre el agrupador portado sobre registros reales de prod (solo lectura) y compara el árbol con el
  de la web para la misma campaña.
- `npx tsc --noEmit` limpio.
- Revisión visual en un build real por Fausto (la UI nativa no se prueba en el navegador).

### B.4 Despliegue

OTA (`eas update --branch production --environment production`) **después** de A, con
`eas-cli fingerprint:generate --platform android|ios --environment production` comparado contra los builds vigentes
(Android `1ccf455d…`, iOS `07054827…`). Si el fingerprint cambia, hace falta build nuevo y no OTA.
`EXPO_PUBLIC_API_URL` explícita, como siempre. Verificar el bundle publicado.

---

## Fuera de alcance

Rondas y vínculo orden→plan, editar el plan, acciones de escritura en la vista de mobile, abrir la lectura de
registros a regador/obrero, y cualquier cambio en cuentas de usuario (punto aparte).

## Riesgos y supuestos

- A revierte una decisión del 28/10; queda documentada acá y en la bitácora.
- Excluir registros por orden vuelve la dosis aplicada dependiente de `orden_id`. Un registro sin orden (carga a mano)
  cuenta «del plan». El borrado de una orden ya está limitado a órdenes sin aplicaciones confirmadas, así que no deja
  registros huérfanos; a verificar en el plan de implementación.
- B asume volumen moderado (campaña actual: pocas órdenes). Si la campaña crece a miles de registros, la carga
  completa en mobile se revisa (ventana por fecha).
