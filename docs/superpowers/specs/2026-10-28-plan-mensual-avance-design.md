# Plan fitosanitario mensual con avance por producto — Design

**Fecha:** 2026-10-28 · **Reemplaza:** el modelo de "rondas" con vínculo explícito de
`2026-10-27-ordenes-multiproducto-plan-design.md` (la orden multiproducto/multivariedad se mantiene tal cual).

## 1. Objetivo y motivo

El ingeniero probó las órdenes con tarjetas de ronda y no le sirvió. Lo que quiere:

> El plan es una cantidad de producto **por hectárea, por variedad, por mes**. Cada aplicación
> confirmada dentro del mes se resta de lo que había que aplicar. Si se aplicó menos queda en
> **rojo**, si se aplicó de más en **azul**. Sin rondas.

Criterios de éxito:

1. Crear una orden es un formulario vacío y simple; al armarlo se ve, por producto, cómo encaja en el plan.
2. Lo que falta aplicar del mes se ve de un vistazo (panel en el formulario, banner en órdenes, matriz de cumplimiento).
3. Las aplicaciones cargadas a mano cuentan solas (hoy no cuentan sin correr un backfill).
4. Sin migración de datos riesgosa ni cambio en mobile (no hay OTA).

## 2. Qué NO cambia

- La orden: cabecera + N líneas (`ordenes_aplicacion_insumos`) + N variedades, confirmación por válvula, un
  `RegistroFitosanitario` por línea y válvula, movimientos de stock, Deshacer/Eliminar/Reactivar.
- La tabla `planes_fitosanitarios` y su pantalla de carga (`numero_aplicacion` sigue siendo la clave de **carga**
  del plan, ya no se usa para medir cumplimiento).
- Mobile: no se toca (los campos `numero_aplicacion` / `plan_fitosanitario_id` de las respuestas siguen existiendo, en `null`).

## 3. Modelo de cálculo (fuente única de verdad: `app/services/plan_avance.py`)

**Clave del objetivo:** `(temporada, variedad, mes, insumo_id)`. Dosis objetivo `D` = suma de `dosis_por_ha` de
todas las filas del plan con esa clave (dos rondas del mismo producto en el mismo mes suman).

**Parcelas alcanzadas:** parcelas activas cuya `Parcela.variedad` es la variedad de la clave.

**Fecha → mes:** el registro cuenta en el mes calendario de `RegistroFitosanitario.fecha`. La temporada es
mayo→abril (`temporada_de(fecha)` de `lotes_pasa.py`: `year` si mes ≥ 5, si no `year - 1`); los meses se
ordenan en campaña (`(mes - 5) % 12`).

**Aplicado en una parcela `p`, para (mes, insumo):** todos los registros con `parcela_id = p`, ese `insumo_id` y
fecha en ese mes, **hayan nacido de una orden o cargados a mano**. Cada registro pesa `w` = superficie de su
válvula (`registro.valvula_id` → `Valvula.superficie_ha`) o la de la parcela si `valvula_id` es null.
Dosis equivalente sobre toda la parcela: `d_p = Σ(w · dosis_por_ha) / ha_p`.
- Un retoque sobre la misma válvula suma completo (es producto realmente aplicado → puede dar azul).
- Una válvula sin superficie pesa 0. Si `ha_p` es null/0 la parcela no se puede ponderar: `d_p` = promedio de las
  dosis de sus registros (0 si no hay), y el porcentaje se calcula igual contra `D`.
- Los registros con `insumo_id` null (productos escritos a mano) no se pueden asociar: se ignoran.

**Estado por parcela** (`TOLERANCIA = 5 %`, constante del servicio): `pct = d_p / D`.
- `pendiente`: `d_p = 0` · `bajo` (rojo): `pct < 95 %` · `ok` (verde): `95 % ≤ pct ≤ 105 %` · `exceso` (azul): `pct > 105 %`.

**Estado agregado por (variedad, mes, insumo):** dosis promedio ponderada por hectáreas `Σ(d_p·ha_p)/Σha_p`.
Orden de prioridad: `pendiente` (todas las parcelas pendientes) → `bajo` (alguna pendiente o baja) → `exceso`
(alguna en exceso y ninguna baja) → `ok`. Lo faltante manda sobre lo sobrante: es lo accionable.

**No planificado:** registros en una variedad/mes de un producto que no está en el plan de ese mes generan una
fila con `dosis_plan = null` y estado `no_planificado` (azul). Si el ingeniero cambia de marca, se ven el
planificado en rojo y el usado como no planificado: es el comportamiento correcto.

**Sin arrastre:** lo faltante de un mes no se suma al siguiente. Queda rojo en su mes (el avance de meses
pasados no se borra). El formulario de órdenes lo sugiere (§5), no lo mueve.

## 4. Backend

### Endpoints (`app/api/plan_fitosanitario.py`)

- `GET /plan-fitosanitario/avance?temporada=&mes=&variedad=` (encargado+) → lista de
  `AvanceItem { variedad, mes, insumo_id, insumo_nombre, unidad, dosis_plan | null, dosis_aplicada_promedio,
  porcentaje, estado, ha_total, parcelas: [{ id, nombre, ha, dosis_aplicada, porcentaje, estado }] }`.
  `mes` y `variedad` opcionales (sin `mes`: toda la temporada, para la matriz). Cantidades como `Decimal`.
- `POST /plan-fitosanitario/contraste` (encargado+, solo lectura) — alimenta las etiquetas del formulario.
  Body `{ fecha, parcelas: [{ parcela_id, valvula_ids?: [] }], lineas: [{ insumo_id, dosis_por_ha }] }`.
  Para cada línea y cada variedad de las parcelas elegidas devuelve
  `{ estado: en_plan | excede | fuera_del_plan, dosis_plan, dosis_aplicada_promedio, dosis_proyectada_promedio, porcentaje_proyectado }`.
  El área elegida pesa por las válvulas seleccionadas (o la parcela entera). `dosis_proyectada = d_p + dosis·ha_sel/ha_p`
  sobre el área elegida, ponderado por hectáreas. `fuera_del_plan` si no hay objetivo para esa variedad/mes/producto;
  `excede` si `porcentaje_proyectado > 105 %`; si no `en_plan`. Los meses de `fecha` siguen §3.
- `GET /plan-fitosanitario/necesidad-stock` conserva su forma. Nuevo cálculo: por clave y parcela
  `max(D·ha_p − d_p·ha_p, 0)` (el exceso de una parcela no compensa a otra), sumado por insumo, **solo meses no
  cerrados** (mes actual y siguientes de la temporada actual; toda la temporada si es futura; nada si es pasada).
  `hoy` inyectable para tests.
- **Se eliminan:** `GET /cumplimiento`, `GET /rondas-pendientes`, el guard 409 al borrar una fila del plan con
  vínculos (ya no hay vínculos que proteger).
- `POST /plan-fitosanitario/` y `PUT`: un duplicado de `(temporada, variedad, numero_aplicacion, insumo_id)` devuelve
  **409** con mensaje claro (por el índice único de §6).

### Órdenes (`app/api/ordenes_aplicacion.py`)

- Crear/editar ya no resuelve ni guarda vínculo al plan: se quitan `resolver_plan_id` (de `plan_vinculo.py`) y
  `_lineas_conservando_ronda`; `RegistroFitosanitario.plan_fitosanitario_id`, `orden_*` y las columnas shim quedan
  sin escribirse (las columnas no se tocan; limpieza futura).
- `lineas[].numero_aplicacion` se sigue **aceptando e ignorando**; `POST /desde-plan` queda como alias de `POST /` por
  compatibilidad con web cacheada.
- Las respuestas siguen devolviendo `numero_aplicacion` y `plan_fitosanitario_id` en `null` (mobile viejo).

### Código que se borra

`services/plan_cobertura.py`, `plan_vinculo.py`, `plan_backfill.py`, `scripts/migracion/backfill_plan_registros.py`
y sus tests (`test_plan_cobertura`, `test_plan_rondas_pendientes`, `test_backfill_plan_registros`, partes de
`test_cumplimiento_fitosanitario` y de los tests de órdenes que asertan el vínculo al plan). Se **conservan**
`plan_duplicados.py` + `limpiar_duplicados_plan.py` y `pregate_ordenes_multiproducto.py` (ajustado para no depender de
lo borrado). Actualizar `scripts/migracion/README.md`.

## 5. Web

- **`NuevaOrdenAplicacion.tsx`:** sin selector Del plan/Fuera del plan y sin `RondaCard`. Formulario vacío: fecha
  (la existente `fecha_planificada`), variedades/parcelas/válvulas, líneas de producto agregadas a mano.
  - Cada línea muestra una etiqueta en vivo (debounce) con `POST /contraste`: **En plan** («Plan Malbec octubre:
    2 kg/ha · aplicado 1,2 · con esta orden 100 %»), **Excede** («pasa de 105 %») o **Fuera del plan** («Mancozeb no
    está en el plan de octubre para Malbec»). Nunca bloquea.
  - Insignia del conjunto: ninguna línea en plan → «Fuera del plan»; alguna fuera → «Mixta»; todas en plan →
    «Del plan» si todas proyectan ≥ 95 %, si no «Parcial».
  - **Panel «Pendiente del plan»** (`GET /avance?mes&variedad`) para las variedades y el mes elegidos: ítems rojos con
    botón «agregar» que suma una línea con la dosis faltante (`dosis_plan − dosis_aplicada_promedio`, editable). Si el
    mes anterior quedó en rojo, una sección «Pendiente de <mes anterior>» ofrece lo mismo (sugerencia, sin arrastre).
- **`ordenes-aplicacion/page.tsx`:** banner «<Mes>: faltan N productos en M variedades» desde `/avance` del mes
  actual, solo si hay rojos; enlaza a cumplimiento.
- **`cumplimiento-fitosanitario/page.tsx`:** matriz variedad × producto (filas) por mes en campaña (columnas); cada
  celda muestra el porcentaje y un texto/ícono además del color (rojo / verde / azul, accesible sin color); clic abre
  el detalle por parcela. Filtros: temporada, variedad. Las filas «no planificado» van al pie de su variedad.
- `AplicacionesRealizadas.tsx`, `ARevisarPanel.tsx`, `FincaMap.tsx`, `lib/api/*.ts`: quitar toda referencia a
  rondas / `numero_aplicacion` en la UI; `crearOrden` sigue igual. `inventarios/insumos/page.tsx`: sin cambios (misma forma).
- Push al ingeniero por faltantes: **fuera de alcance** (primero se mide el ruido del banner).

## 6. Migración

Una sola, nueva (no se editan las existentes): índice único `ux_planes_fitosanitarios_clave` sobre
`planes_fitosanitarios (temporada, variedad, numero_aplicacion, insumo_id)`. Sin él, una fila duplicada duplicaría el
objetivo en silencio. Producción se limpió el 2026-10-27 (109 → 92 filas) pero **el `pregate` de solo lectura se
corre antes de pushear**: si hay duplicados, la migración falla y Railway no arranca. Downgrade: `drop_index`.

## 7. Pruebas

Backend (SQLite en memoria): avance con parcela entera, válvulas parciales (cobertura 1,5/6 ha → rojo), banda ±5 %
(95/105 exactos), exceso, retoque sumado, no planificado (cambio de marca), registros a mano sin vínculo, dos filas
del mismo producto/mes que suman, límites de temporada (30/abr y 1/may) y de mes, parcela sin superficie, válvula sin
superficie, parcela inactiva, `insumo_id` null ignorado; contraste (las tres etiquetas, válvulas elegidas, varias
variedades); necesidad de stock con `hoy` inyectado (mes cerrado excluido); 409 por duplicado; compat de órdenes
(`numero_aplicacion` aceptado e ignorado, `/desde-plan`). Suite completa verde; `tsc`, `lint`, `build`.
Click real en local (skill `verificar-local`): orden del plan completa → verde; parcial → rojo; sobre-dosis → azul;
producto ajeno → «Mixta» y fila azul; botón «agregar» del panel; banner; matriz.

## 8. Despliegue

Orden: pregate prod → push a `main` (Railway migra y publica) → `npx vercel --prod` **enseguida**. Hay una ventana
de minutos en que la web vieja llama endpoints eliminados (`/rondas-pendientes`, `/cumplimiento`): aceptado (piloto,
un solo usuario operando la pantalla); se avisa a Fausto. Sin OTA ni build. Documentar en Bitácora/Decisiones y
regenerar PROJECT_MAP y Modelo de Datos.

## 9. Supuestos y límites declarados

- Plan por variedad; las parcelas heredan la variedad actual de su ficha (si una parcela cambia de variedad, el
  historial de la temporada se reatribuye).
- Las aplicaciones se miden por la fecha del registro (confirmación), no la de la orden: una orden confirmada el 2/nov
  cuenta en noviembre aunque estuviera planificada para octubre.
- Sin motivo obligatorio para productos fuera del plan (decisión de Fausto, 2026-10-28).
- Cleanup futuro: quitar columnas de vínculo/shim que quedan sin uso.
