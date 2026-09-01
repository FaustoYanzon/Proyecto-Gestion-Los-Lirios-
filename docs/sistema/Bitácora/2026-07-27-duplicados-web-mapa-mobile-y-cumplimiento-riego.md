---
tags: [sistema, produccion, mobile, web, deploy, sesion]
---

# 2026-07-27 — Duplicados en formularios web, mapa mobile en blanco, cumplimiento de riego

> Contexto: Fausto reportó datos duplicados en tareas/riego (web) y la notificación de litros del riego en curso actualizándose segundo a segundo. Al arreglar eso se encontraron dos bugs más en cadena (el mapa mobile no mostraba ningún parral, y "Terminar" seguía disponible desde Inicio con un falso error). Cerrando esos, se retomó y terminó la migración a web de "Cumplimiento de riego por estado fenológico" — trabajo que había quedado a medio hacer y sin commitear de la sesión del 2026-07-20/22, completado en paralelo con **otra sesión de Claude Code corriendo al mismo tiempo sobre los mismos archivos** (ver nota de proceso al final).

## Resumen por punto

| # | Punto | Resultado |
|---|---|---|
| 1 | Duplicados en tareas/riego web | ✅ Resuelto — guard `useRef` nunca se había replicado del mobile (07-17) al web |
| 2 | Litros del riego en curso actualizándose segundo a segundo | ✅ Resuelto — ahora solo el cronómetro es en vivo, litros se muestran una sola vez al terminar |
| 3 | Mapa mobile sin ningún parral visible | ✅ Resuelto — `TypeError` real en `dashboard_eficiencia_hidrica` rompía el `Promise.all` completo |
| 4 | "Terminar" disponible desde Inicio (debía ser solo desde Riego) | ✅ Resuelto (web + mobile) |
| 5 | Falso "no se pudo terminar" con el riego ya terminado en el servidor | ✅ Resuelto — se verifica contra el servidor antes de mostrar error |
| 6 | Tarjeta "riegos en curso" — formato de etiqueta y ubicación | ✅ Unificado a "Cabezal X - Parcela Y - Vx+x+..." + agregada a Inicio web |
| 7 | Cumplimiento de riego por estado fenológico — capa de color en el mapa web | ✅ Completado (backend ya existía desde el 07-20/22, faltaba conectar el frontend web) |

## 1. Duplicados en tareas/riego (web)

**Causa raíz:** el 2026-07-17 se agregó un guard `useRef` síncrono contra doble-tap a los 5 wizards **mobile** (`tareas.tsx`, `riego.tsx`, `fito.tsx`, `campana.tsx`, `cosecha.tsx`). Ese fix **nunca se replicó en los formularios web** — `TareaForm.tsx` no se había tocado desde su creación, y el único cambio reciente de `RiegoForm.tsx` (2026-07-17, commit `1f832b3`) fue para agregar "riegos en curso", no el guard. Ambos formularios solo tenían `disabled={isSubmitting}` en el botón — estado de React, asíncrono, no bloquea un doble-click rápido.

**Fix:** mismo patrón `useRef` que ya tenía mobile, aplicado a `TareaForm.tsx`, `RiegoForm.tsx` e `IniciarRiegoForm.tsx` (el form de "Iniciar riego" del panel de riegos en curso, mismo gap).

**Bonus encontrado:** `scripts/limpiar_duplicados.py` agrupaba `registros_riego` por clave exacta incluyendo `inicio`/`fin` — pero en el flujo "Iniciar riego" (`POST /riego/iniciar`), `inicio` lo genera el servidor con `datetime.now()` en cada request, así que dos clicks duplicados nunca coincidían exactamente y el script nunca los detectaba. Cambiada la clave a `cabezal + parcela_id + valvula + responsable + fecha` (estable, no depende de precisión de reloj).

**Limpieza de datos en producción** (con `pg_dump` de respaldo automático antes de borrar): 4 filas de `registros_trabajo` y 3 de `registros_riego`, todas creadas el mismo 2026-07-27 en un rango de segundos — coincidían exactamente con lo reportado.

## 2. Litros del riego en curso — solo al terminar

La tarjeta "Riegos en curso" (web `RiegosEnCurso.tsx`, mobile `riego.tsx` y `index.tsx`) recalculaba y mostraba los litros en cada tick de 1 segundo del cronómetro. No era una notificación push repetida — no existe ningún código que reenvíe notificaciones sobre un riego en curso — era la tarjeta siempre visible actualizándose. Se sacó el número de litros del tick de 1s en los 3 lugares, dejando solo el tiempo transcurrido. El total final de litros se sigue mostrando una sola vez, en el diálogo de confirmación al apretar "Terminar" (eso ya existía, no se tocó).

## 3. Mapa mobile sin ningún parral — causa raíz real

`mobile/app/(tabs)/mapa.tsx` pide 6 endpoints en paralelo con `Promise.all` para armar el mapa (parcelas, estado de campaña, fenología, cosecha, eficiencia hídrica, cumplimiento de riego). Confirmado en logs de Railway (`railway logs`):

```
File "/app/app/api/produccion.py", line 220, in dashboard_eficiencia_hidrica
    row.duracion_horas * RegistroRiego.LITROS_POR_HORA_VALVULA * n_valvulas
TypeError: unsupported operand type(s) for *: 'NoneType' and 'float'
```

`GET /produccion/dashboard/eficiencia-hidrica` no filtraba los riegos "en curso" (`duracion_horas = None`, nullable desde el 2026-07-17) antes de multiplicar. Con `Promise.all`, ese único 500 tumbaba **todo el mapa** — ni siquiera `parcelas` (que no depende de ese endpoint) llegaba a setearse, porque `Promise.all` rechaza entero si cualquiera de las promesas falla.

**Fix backend:** agregado `RegistroRiego.duracion_horas.is_not(None)` al `WHERE` de la query de litros en `dashboard_eficiencia_hidrica` (`produccion.py`).

**Fix de resiliencia (mobile):** `Promise.all` → `Promise.allSettled` en `loadData()` de `mapa.tsx`. Efecto colateral encontrado de paso: **2 de los 6 endpoints** (`/produccion/campana/estado-actual/` y `/produccion/cosecha/resumen/por-parcela`, ambos `require_encargado_up`) le devuelven 403 a los roles `regador`/`obrero` — con `Promise.all` eso también tumbaba el mapa entero para esos roles, **siempre**, no solo cuando había un riego en curso. Con `allSettled`, los polígonos (que solo dependen de `parcelas`, `require_any_role`) se dibujan igual aunque esas dos capas opcionales fallen.

## 4-5. Terminar solo desde Riego + falso error

**Terminar solo desde Riego:** se sacó el botón "Terminar" de las tarjetas de riego en curso en Inicio (web `dashboard/page.tsx` vía prop `showTerminar={false}` en `RiegosEnCurso.tsx`; mobile `index.tsx`, se eliminó `handleTerminar`/`terminandoId`/el botón entero de `RiegosEnCursoInicio`). Sigue disponible únicamente en la pantalla/página dedicada de Riego.

**Falso error al terminar:** confirmado en logs de Railway que un `POST /riego/{id}/terminar` respondió 200 OK en el momento exacto en que Fausto reportó el error — la escritura sí había llegado y se había aplicado, pero la respuesta no volvió al cliente (hipo de red, mismo patrón de conectividad rural documentado el 2026-07-20). El endpoint además **no es idempotente**: terminar un riego ya terminado devuelve 400 ("Este riego ya fue terminado"), así que un reintento ciego del usuario no ayuda. Fix: antes de mostrar el error, `handleTerminar` (web `RiegosEnCurso.tsx`, mobile `riego.tsx`) hace un `GET /riego/en-curso` y si el riego ya no aparece ahí, lo trata como éxito en vez de mostrar error.

## 6. Formato de etiqueta + tarjeta en Inicio web

Unificado a `Cabezal X - Parcela Y - Vx+x+...` en los 3 lugares (antes cada uno tenía un orden/formato distinto, y el de Inicio mobile ni siquiera mostraba el nombre de la parcela). Se agregó el panel "Riegos en curso" al Inicio web, al costado del mapa, debajo de Alertas — antes solo existía en `/dashboard/produccion/riego`.

## 7. Cumplimiento de riego por estado fenológico — completado en web

La sesión del 2026-07-20/22 había dejado explícitamente pendiente el espejo web de esta feature (ver [[2026-07-20-login-mobile-y-ciclo-campana]] § "Pendiente"). El trabajo ya estaba empezado **sin commitear** en el working tree (`frontend/lib/api/produccion.ts`, `frontend/components/map/FincaMap.tsx`) pero `FincaMapInner.tsx` nunca se terminó de conectar: `getPolyStyle` no recibía `cumplimientoByParcelaId` en la llamada real (el argumento faltaba), no había botón para seleccionar el modo "Cumplimiento" en el mapa, y quedaba una referencia rota a `getEstadoActual` (ya no importado). El mapa mobile, en cambio, tenía el modo de color bien conectado pero el panel de detalle de cada parral seguía leyendo del sistema viejo (`/produccion/campana/estado-actual/`, por parcela) en vez del nuevo (`/produccion/estado-campana/actual`, por variedad).

**Completado:**
- Web (`FincaMapInner.tsx`): botón "Cumpl. riego" en el selector de capas, coloreado por `cumplimiento_pct` del estado de Ciclo de Campaña actual (semáforo, mismos umbrales que el modo "Riego" anual — pero es un modo aparte, no lo reemplaza: "Riego" mide contra el objetivo anual de 6M L/ha, "Cumplimiento" mide contra los riegos esperados del estado fenológico actual). Panel de detalle de cada parral: sección "Ciclo de Campaña" ahora lee del sistema nuevo por variedad.
- Mobile (`mapa.tsx`): panel de detalle corregido para usar `getEstadoCampanaActual()` (ya estaba importado pero sin usar) en vez del endpoint viejo.
- Litros del panel de detalle mostrados también en m³, ambas plataformas.
- El motor de fenología automática (tareas recomendadas de Inicio, `app.core.fenologia`) no se tocó — sigue siendo un sistema separado a propósito.

**Nota importante sobre lo que vas a ver ahora:** hoy (27/07) el estado vigente de Ciclo de Campaña es **Post-Cosecha** (arrancó el 1/mayo, se espera apenas 1 riego "estándar" para toda esa ventana de ~4.5 meses). Con prácticamente cero riego cargado desde esa fecha, el mapa en modo "Cumplimiento" va a mostrar casi todos los parrales en **rojo** (déficit severo) — es el resultado esperado de la fórmula tal como se definió, no un bug.

### Nota de proceso — dos sesiones de Claude Code editando el mismo archivo en simultáneo

Mientras se investigaba este punto, `FincaMapInner.tsx` y luego `mobile/app/(tabs)/mapa.tsx` se modificaron solos en pleno análisis (herramienta de edición devolviendo "file modified since read" repetidamente). Resultó ser **otra sesión de Claude Code, en otra ventana de Fausto, trabajando en el mismo pedido en paralelo** sin que ninguna de las dos sesiones supiera de la otra. Terminaron completando el mismo trabajo casi en simultáneo — sin conflicto destructivo de fondo porque ambas convergían al mismo patrón (el que ya usaba mobile), pero generó carreras de edición reales. La otra sesión terminó commiteando y deployando primero (`49512a7`); esta sesión completó y commiteó el resto (fix de falso error al terminar, que había quedado sin commitear pero ya deployado igual porque `vercel --prod`/`eas update` suben el directorio de trabajo tal cual está, no solo lo commiteado). **Lección:** si se van a correr sesiones de Claude Code en paralelo sobre el mismo repo, mejor coordinarlas explícitamente (uno por área/archivo) para evitar este tipo de carrera, aunque en este caso no causó daño.

## Deploy de esta sesión

- Commits a `main`: `3f3c31a` (duplicados + litros en vivo), `11f9e87` (mapa mobile + formato tarjetas), `49512a7` (otra sesión — cumplimiento web + fix mobile), `fe43735` (falso error al terminar).
- Sin migraciones nuevas — todos los cambios de esta sesión son de código o de limpieza de datos puntual.
- Backend: Railway auto-desplegó en cada push.
- Frontend: `vercel --prod` corrido 3 veces durante la sesión.
- Mobile: `eas update --branch preview --environment preview` corrido 3 veces.

## Pendientes para seguir

- 🟡 **`FitosanitarioForm.tsx` (web) tiene el mismo gap de guard anti doble-tap** que tenían `TareaForm`/`RiegoForm` — no reportado como bug todavía, pero es la misma clase de bug, fix mecánico si se quiere cerrar del todo.
- 🔴 Sigue abierto: crash de "Ciclo Campaña" en el APK standalone instalado (necesita `eas build` nueva, no alcanza con OTA) — ver [[Bugs Conocidos]].
- 🔴 Sigue abierto: error genérico con 2+ válvulas en riego mobile — nunca reproducido con el mensaje real.
- 🟡 Hardening de idempotencia real (idempotency key de punta a punta) sigue diferido desde el 2026-07-23 — hoy los duplicados se siguen previniendo con guards del lado cliente (`useRef`), no con protección real del backend.

## Ver también

- [[2026-07-20-login-mobile-y-ciclo-campana]]
- [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]
- [[Bugs Conocidos]]
- [[Arquitectura]]
- [[Sistema de Gestión Agrícola]]
