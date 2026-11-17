# Paseros en el mapa y fuera de riego/fito — diseño corto

Fecha: 2026-11-16 · Estado: **implementado y desplegado** (2026-11-17, PR #10, merge `55c4acf`; backend en Railway, web en Vercel). Aprobado por Fausto (alcance y decisiones P1/P2) · Tamaño: cambio chico, web + backend. Primero de una serie (ver "Contexto"). Desviaciones al final del documento.

## Contexto
Serie acordada con Fausto: 1) paseros en el mapa (este doc) → 2) riego a manto 60 mm → 3) alfalfa → 4) anulación de pasa (solo super_admin) → 5) mobile (paseros y entregas de pasa/alfalfa). Este doc cubre solo el 1, web primero; mobile después por OTA.

## Intención
Un pasero es un depósito de uva fresca para hacer pasa, no se riega ni se fumiga. Hoy su panel del mapa muestra riego, cumplimiento y fito como si fuera un parral. Debe mostrar tareas, gasto y cuánta uva tiene, en kg, con una barra de colores por variedad.

## Goals
- Panel del pasero en el mapa: superficie, costo laboral, últimas tareas, **uva fresca (kg) con barra por variedad**; sin riego, fito, cabezal, cosecha, ciclo de campaña ni fenología.
- Acciones rápidas del pasero: solo «+ Tarea».
- Mapa: en los modos «cumplimiento» y «fito» el pasero se pinta neutro.
- Los paseros no se pueden elegir ni aceptar en riego, aplicaciones fito, órdenes de aplicación ni plan fitosanitario (web y backend).

## Non-goals
- Mobile (queda para el paso 5, por OTA).
- Borrar registros históricos de riego/fito que pudieran existir en paseros: quedan guardados, ocultos.
- Excluir paseros de `GET /parcelas`: Alta de producción y Tareas los necesitan.

## Decisiones (Fausto)
- Sacar los paseros de todo lo de riego/fito/cumplimiento. Web primero, mobile después por OTA.

## Supuestos míos (a validar)
- «Cuánta uva tienen» = `uva_disponible_kg` de `GET /pasero/stock?pasero_id=` (ingresada − consumida por la levantada), sumada y por variedad.
- `/pasero/stock` exige `encargado` o superior: la tarjeta de uva se muestra solo a esos roles; para el resto, el panel no la muestra (sin error).
- Colores de la barra: los mismos de la variedad en el modo «variedad» del mapa (`VAR_COLORS`).

## Approaches
1. **Condicional en el panel + guardas en backend (elegida):** una rama `tipo === 'pasero'` en `ParcelPanel`, filtros en los selectores web y validación 422 en los endpoints. Trade-off: toca varios archivos, pero cada cambio es mínimo y el backend queda protegido aunque un cliente viejo (mobile) siga ofreciendo paseros.
2. Solo ocultar en la UI: más rápido, pero el mobile actual y la API seguirían aceptando riego/fito en paseros. Descartada.
3. Excluir paseros en `GET /parcelas` por defecto: rompería Alta de producción y Tareas. Descartada.

## Diseño
### Backend (`backend/app`)
- `api/produccion.py`: `_normalizar_riego` (rama goteo) rechaza parcela `pasero` (422); `POST/PUT /fitosanitarios/` rechazan parcela `pasero` (422).
- `api/ordenes_aplicacion.py` `_resolve_parcelas_orden`: ambas rutas (`parcela_ids` y por `variedad`) excluyen/rechazan `pasero`.
- `services/plan_avance.py` (`parcelas_stmt`) y `services/plan_contraste.py`: filtran `tipo != pasero`.
- Tests pytest: goteo y fito sobre un pasero → 422; orden por variedad no incluye pasero; plan_avance no cuenta pasero.

### Web (`frontend`)
- `components/map/FincaMapInner.tsx` `ParcelPanel`: para `tipo === 'pasero'` se ocultan cosecha, ciclo, fenología, agua, fito y cabezal; se desactivan las queries `panel-riego`/`panel-fito`; se agrega la tarjeta «Uva fresca» (total kg + barra segmentada por variedad con % y kg en la leyenda; estado vacío «Sin uva ingresada»). Acciones rápidas: solo «+ Tarea».
- `getPolyStyle`: en modos `cumplimiento` y `fito` el pasero va neutro.
- Selectores: `produccion/riego/page.tsx` (`parralesConRiego`), `NuevaOrdenAplicacion.tsx` (grupos por variedad), `plan-fitosanitario/page.tsx` (`variedadesDisponibles`) excluyen `pasero`.

## A cargo del builder
Textos exactos, estilo de la tarjeta y de la barra, nombres de queries.

## Verificación
pytest (backend), `npm run lint && npm run build` (frontend), y click real en local con un pasero con ingresos de dos variedades: panel, modos del mapa y selectores. Backend en Railway por push a `main`; web a Vercel manual.

## Estado final y desviaciones

**Estado:** implementado y desplegado el 2026-11-17 (PR #10, merge `55c4acf`). Backend en Railway, web en Vercel. Mobile queda para el paso 5 (fuera de este diseño).

**Desviaciones respecto de este diseño:**

- **Colores de variedad.** `VAR_COLORS` pasó a `components/map/varColors.ts`. La spec decía reusar el de la variedad del mapa.
- **Red Globe.** Cambió a `#9f1239` para distinguirlo de Flame (commit `114ee1f`). No estaba en la spec.
- **Bug del mismo PR corregido.** Editar un registro histórico de pasero sin cambiar de parcela daba 422. Corregido en `ad8636f`.
- **Consecuencia no prevista.** Una orden de aplicación vieja que ya incluye un pasero no se puede guardar hasta quitar el pasero (422 en `_resolve_parcelas_orden`).
- **Mobile.** El backend ya rechaza paseros en riego y fito, pero el mapa y los selectores de mobile todavía los ofrecen. Pendiente del paso 5.
