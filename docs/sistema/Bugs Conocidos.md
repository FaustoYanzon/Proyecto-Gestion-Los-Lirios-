---
tags: [sistema, bugs]
---

# Bugs Conocidos

> Última revisión: 2026-07-29 (cuarto incidente de duplicados — idempotencia real cerrada, ver [[2026-07-29-duplicados-cuarta-vez-idempotencia-real]])

---

## 🔴 Abiertos — relevantes para el deploy de prueba

### "Ciclo Campaña" crashea el APK standalone instalado (no en Expo Go) — necesita build nueva

**Reportado:** 2026-07-20/21. **Estado:** el botón cierra la app de golpe en el APK que los testers tienen instalado, pero el mismo código (mismo commit, mismo bundle) **no crashea corriendo vía Expo Go** — evidencia fuerte de un módulo nativo mal enlazado en esa build específica (compilada en julio), no un bug de JS. Se agregó un Error Boundary global (`mobile/components/ErrorBoundary.tsx`) como mitigación — si vuelve a pasar, muestra una pantalla de recuperación en vez de cerrar la app entera — pero **no resuelve la causa real**. Fix pendiente: correr `eas build --profile preview` para regenerar el APK con los módulos nativos bien enlazados y redistribuirlo (reinstalación completa, no alcanza con `eas update`/OTA). Detalle: [[2026-07-20-login-mobile-y-ciclo-campana]].

### Error genérico al cargar riego mobile con 2+ válvulas — sin reproducir

**Reportado:** 2026-07-17. **Estado:** hipótesis original descartada (overflow de `valvula String(20)` — el máximo real son 4 válvulas, 7 caracteres, muy por debajo del límite), no se encontró causa en el código de `riego.tsx`/backend. Como gran parte de ese flujo se reescribió el 2026-07-17 (timezone, guard anti doble-tap, bifurcación de riegos en curso), puede haberse resuelto de rebote — pero nunca se confirmó con el mensaje de error real. **Antes de tocar código de nuevo: reproducir en el dispositivo** (Riego → Registrar riego → Ya se hizo → 2+ válvulas → confirmar) y capturar el `detail` exacto que muestra el `Alert` (ya extrae el texto real del backend). Detalle: [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]].

### TareaForm sin campo `finca` ni selector de `trabajador`

**Archivo:** `frontend/components/produccion/TareaForm.tsx`
**Impacto:** El backend ya soporta `finca` explícita por registro (fix del 2026-06-08) y ya existe el modelo `Trabajador` + router `/trabajadores`, pero el frontend nunca fue actualizado: el formulario sigue mandando `trabajador_nombre` como texto libre (línea ~282-285) y no envía `finca` (cero referencias en el schema ni en `lib/api/produccion.ts`). Cero referencias a `/trabajadores/` en todo el frontend.
**Efecto práctico:** los registros de tarea diaria cargados durante la prueba van a seguir sin `finca` persistida a nivel de registro (solo el egreso derivado la tiene) y sin vínculo al `Trabajador` nuevo.
**Fix:** agregar selector de finca (default `media_agua` como hoy) y combo de trabajador con búsqueda sobre `GET /trabajadores/?is_active=true`, manteniendo `trabajador_nombre` como fallback legacy.

---

## 🟡 Riesgos conocidos, aceptables para una prueba corta (no bloquean, documentar)

- **Vercel NO auto-despliega en este proyecto.** Railway sí redespliega el backend solo en cada push a `main` (y corre `alembic upgrade head`), pero el frontend se quedó pegado en un deploy de 4 días hasta que se corrió `vercel --prod` a mano el 2026-07-14 — ver [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]. **Acordarse de correr `vercel --prod` (o `npx vercel --prod --yes` desde `frontend/`) después de cualquier push que toque `frontend/`.** `vercel ls` muestra el último deploy y su antigüedad si hay dudas.
- **Rate limiting en memoria de un solo proceso** (`login_throttle.py`, slowapi): correcto mientras el deploy corra con 1 worker uvicorn (hoy así, `railway.json` no fija `--workers`). Si se escala a multi-worker, hay que respaldar con Redis.
- **Sin logging estructurado ni exception handler genérico** en el backend: los 500 no dejan rastro propio, solo lo que capture la plataforma de hosting. Con pocos usuarios de prueba es tolerable, pero conviene revisar logs de Railway a diario durante la semana.
- **Sin refresh token**: al expirar el JWT, el usuario es deslogueado abruptamente sin aviso previo (`lib/api.ts`, interceptor 401).
- ~~Backup automático de producción configurado pero sin activar~~ — **activado 2026-07-27**: `install_backup_task.ps1` corrido, tarea `LosLirios-PG-Backup` registrada (diaria 21:00), probada con `Start-ScheduledTask` (dump real creado y copiado a OneDrive). **Sigue pendiente:** el test de restore que pide `scripts/BACKUP.md` (requiere un Postgres local corriendo, no se hizo todavía) — un backup no está "verificado" hasta que se prueba restaurarlo al menos una vez. También sigue siendo un backup que depende de que la PC de Fausto esté prendida a las 21:00 — si el piloto se vuelve permanente, migrar a un cron de Railway o GitHub Actions (ya anotado en `BACKUP.md` § Known limitations).
- **Lint del frontend no pasa**: 14 errores, todos el mismo patrón (`setState` síncrono dentro de `useEffect` al resetear paginación en `TareasTable.tsx`, `RiegoTable.tsx`, `FitosanitariosTable.tsx`). No rompe runtime.
- **Responsividad mobile del frontend web limitada**: solo 11 de 43 componentes usan breakpoints; el layout de dashboard es desktop-first. Si algún encargado prueba desde el celular en el navegador (no la app), la experiencia va a ser mala.
- **Dashboard finanzas sin costo por kg** todavía.
- **Lockfiles pueden desincronizarse silenciosamente**: `npm install` local resuelve conflictos de peer dependencies con solo un warning, pero `npm ci` (usado en CI/EAS Build) los rechaza en seco. Antes de cualquier deploy que dependa de un lockfile, correr `rm -rf node_modules && npm ci` localmente para detectar el problema antes que el servidor de build.
- **OTA de mobile a veces necesita cerrar/reabrir la app dos veces** para aplicarse (expo-updates descarga en un launch, aplica en el siguiente) — causó confusión real el 2026-07-27 (Fausto vio comportamiento viejo — botón "Terminar" en Inicio — después de un `eas update` ya publicado). Si un fix mobile "no aparece" después de un deploy, antes de investigar código: cerrar la app del todo y reabrirla, dos veces si hace falta.

---

## ✅ Resueltos

**Sesión del 2026-07-29 — cuarto incidente de duplicados, causa distinta a las tres anteriores (idempotencia real cerrada):**
Volvieron a aparecer duplicados en `registros_trabajo`, visibles en mobile y web. Verificado contra el código (no contra las notas viejas) que los 3 fixes anteriores (guard `useRef` mobile 07-17, retry GET-only 07-23, guard `useRef` web 07-27) seguían intactos, sin regresión. Diagnóstico contra datos reales de producción: 29 grupos de duplicados en `registros_trabajo` (32 filas), 0 en riego/fito/cosecha — el gap entre cada par era consistentemente de 2.6 a 7.5 segundos, no milisegundos, lo que descarta "mismo trabajador cargado dos veces en un mismo request" (eso daría timestamps casi idénticos) y confirma que son dos requests HTTP separados: el encargado tocó "Guardar", la respuesta tardó unos segundos, no vio confirmación a tiempo y volvió a tocar "Guardar" ya con el guard `useRef` liberado (porque el primer request ya había terminado). Ningún guard de doble-tap puede distinguir eso de una carga nueva legítima — exactamente el riesgo de "sin idempotencia real del lado backend" que estaba documentado y diferido desde el 2026-07-23.
- **Cerrado de una vez:** `idempotency_key` (UUID generado por el cliente, uno por envío lógico del form/wizard) + índice único parcial en los 4 modelos de producción (`RegistroTrabajo`, `RegistroRiego`, `RegistroFitosanitario`, `RegistroCosecha`). Los 6 endpoints de creación (`trabajo/`, `trabajo/masivo`, `riego/`, `riego/iniciar`, `fitosanitarios/`, `cosecha/`) devuelven el registro ya existente ante un reintento con la misma key, en vez de duplicar. Mobile (5 wizards) y web (4 forms) generan la key una sola vez al entrar al formulario/step de confirmación y la reutilizan en cualquier reintento.
- **Bonus encontrado durante el diagnóstico de código:** ni el wizard mobile ni el form web ni el backend (`create_trabajo_masivo`) impedían que el mismo trabajador quedara cargado dos veces dentro de una misma carga con varios trabajadores — un envío 100% legítimo (sin doble-tap) generaría dos filas idénticas. No era la causa de este incidente puntual (confirmado por los timestamps), pero se cerró igual: bloqueo de nombre repetido en mobile, web y backend (400 si el backend lo detecta, defensa en profundidad).
- **Limpieza en producción:** 32 filas de `registros_trabajo` (y sus `Egreso` vinculados en cascada) del 2026-07-29 borradas con `scripts/limpiar_duplicados.py --commit`, backup previo automático.
- **Nuevo:** `backend/tests/test_produccion_idempotency.py` — primera cobertura de test automatizado para `produccion.py` (antes solo existía `test_auth.py`). Cubre reintento con misma key (simple y masivo) y rechazo de nombre repetido en carga masiva, contra la DB de test en memoria.
- Pendiente, no bloqueante: el mismo test para `registros_riego`/`registros_fitosanitarios`/`registros_cosecha` necesita una fixture de `Parcela` para la suite de tests que no se resolvió en esta sesión (un intento directo con `TestSessionLocal` dio `no such table: parcelas` en el entorno de test, causa no identificada, no relacionada con el código de producción — el patrón de esos 3 endpoints es idéntico al de `registros_trabajo`, que sí está cubierto).

**Sesión del 2026-07-27** (detalle completo en [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]):
- **Duplicados en tareas/riego web:** el guard `useRef` anti doble-tap del 2026-07-17 nunca se había replicado del mobile al web. Agregado a `TareaForm.tsx`, `RiegoForm.tsx`, `IniciarRiegoForm.tsx`. De paso, `scripts/limpiar_duplicados.py` no detectaba duplicados del flujo "iniciar riego" (agrupaba por `inicio` exacto, que el servidor genera distinto en cada request) — clave corregida. 4 filas de `registros_trabajo` + 3 de `registros_riego` limpiadas en producción.
- **Mapa mobile sin ningún parral:** `GET /produccion/dashboard/eficiencia-hidrica` tiraba `TypeError` con cualquier riego en curso (no filtraba `duracion_horas = None`), y como el mapa pide 6 endpoints con `Promise.all`, ese único 500 tumbaba todo. Fix backend + cambiado a `Promise.allSettled` en mobile (de paso se encontró que 2 de esos 6 endpoints le devuelven 403 siempre a `regador`/`obrero`, rompiéndoles el mapa incluso sin el bug de arriba).
- **Litros del riego en curso ya no se actualizan segundo a segundo** — solo el cronómetro; el total se muestra una vez, al terminar.
- **"Terminar" ya no está disponible desde Inicio** (web + mobile), solo desde la pantalla/página de Riego. Agregado el panel "Riegos en curso" al Inicio web.
- **Falso "no se pudo terminar el riego"** cuando la escritura sí había llegado al servidor (confirmado en logs, 200 OK) pero la respuesta se perdió en el camino — ahora se verifica contra el servidor antes de mostrar error.
- **Cumplimiento de riego por estado fenológico completado en web** (backend y mobile ya existían desde el 2026-07-20/22, quedaba pendiente el mapa web — estaba empezado sin commitear y a medio conectar). Litros del panel de detalle también en m³.
- **Fast-follow mismo día:** backup automático activado (tarea `LosLirios-PG-Backup`, diaria 21:00, probada) y guard anti doble-tap agregado a `FitosanitarioForm.tsx` (último form web que le faltaba).

**2026-07-23 — recurrencia de duplicados, causa distinta a la del 07-17:**
El interceptor de retry agregado el 2026-07-20 en `mobile/lib/api.ts` (para tolerar wifi rural) reintentaba automáticamente cualquier request sin `error.response`, incluidos POST — un timeout no distingue "nunca llegó al servidor" de "se procesó y se perdió la respuesta". Corregido a retry GET-only. 19 pares de `registros_trabajo` duplicados limpiados. Detalle completo solo en memoria de proyecto (no se había documentado en la bóveda en su momento — la sesión del 2026-07-27 lo nota como pendiente resuelto).

**2026-07-18 — Mano de Obra y Egresos no coincidían ($2.743.575 vs $3.817.725):**
Efecto colateral de la limpieza de duplicados del día anterior — `limpiar_duplicados.py` borró `registros_trabajo` por SQL directo sin borrar el `Egreso` vinculado (`fuente='trabajo_diario'`), a diferencia del endpoint real. 14 egresos huérfanos ($1.074.150, la diferencia exacta) borrados con `scripts/limpiar_egresos_huerfanos.py`. Fix solo de datos, sin cambios de código. Detalle: [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]] § "Follow-up 2026-07-18".

**Sesión del 2026-07-17** (detalle completo en [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]):
- **Duplicados por doble-tap** en carga de tareas/riego mobile: `setLoading(true)` es estado de React, no sincrónico. Guard `useRef` síncrono agregado a los 5 wizards. 14 filas duplicadas de `registros_trabajo` borradas (`scripts/limpiar_duplicados.py`).
- **Desfasaje horario -3h** en riego (mobile y web): el datetime se armaba sin offset de timezone, Postgres lo grababa asumiendo UTC. Ahora incluye `-03:00` explícito.
- **Crash "Ciclo Campaña" mobile:** no era un crash, era un 404 silencioso — el submit apuntaba a `/produccion/campana/ciclo/` (no existe), corregido a `/produccion/campana/` + payload ajustado al schema real.
- **Mapa mobile desactualizado:** causa raíz real era `parcelas.coordenadas` en `null` en las 36 filas de producción (nunca poblada), no un problema de código de mobile per se. Poblada desde el KML real + agregada la parcela "Pasero 3" que faltaba. `mapa.tsx` reescrito para dibujar desde la API, colores unificados con el web, sumados los modos Cosecha/Riego, sacadas las cañerías viejas hardcodeadas.
- **Consistencia UX de formularios:** `riego.tsx`/`fito.tsx`/`campana.tsx` mobile unificados al patrón de `tareas.tsx` (toast + vuelta a lista + X de cancelar).
- **Históricos migrados mal cargados:** decisión de datos de Fausto, no bug — borrados 591 `registros_cosecha`, 144 `egresos`, 370 `presupuestos` (marca `migracion_excel`). `ingresos` no se tocó.
- **Filtro de Finca ausente en dashboards:** agregado (cosmético, solo "Media Agua" — ninguna tabla de producción tiene columna `finca` todavía).
- **Permisos de crear vs editar/borrar aclarados:** crear (trabajo/riego/fito/campaña/cosecha) = `require_encargado_up`; editar/borrar = `require_gerencial_up`. `parcelas` bajó de `require_super_admin` a `require_gerencial_up`.
- **Feature nueva: Riegos en curso** (backend + web + mobile) — ver detalle en el documento de la sesión.
- Punto pendiente sin resolver de esta tanda: ver 🔴 arriba (error con 2+ válvulas).

**Segunda tanda, 2026-07-14** (detalle en [[2026-07-14-finanzas-ingresos-y-fixes-piloto]] § "Segunda tanda"):
- **Registro de modelos frágil, uno por uno, en `alembic/env.py` y en los scripts standalone** (`seed.py`, `seed_cosecha.py`, `seed_parcelas.py`) — ya le faltaban `presupuesto`/`push_token` y podía volver a pasar con cualquier modelo nuevo. Ahora todos importan `app.models` (el agregador) como único punto de verdad. Cierra el "pendiente" que había quedado abierto más abajo sobre `Trabajador`.
- **Sin `error.tsx`/`loading.tsx`/error boundaries** en el frontend: agregados a nivel de segmento en `frontend/app/dashboard/` (`error.tsx` + `loading.tsx`). Cubre `/dashboard` y todas sus subrutas; el resto del árbol de `app/` (login, etc.) sigue sin boundary propio.

**Primeros bugs reales de la semana piloto, 2026-07-14** (detalle completo en [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]):
- **Sesión se cerraba en F5/pestaña nueva, badge de usuario en "?":** root cause era que `frontend/app/providers.tsx` (el que realmente usa la app) nunca llamaba a `initAuth()` — el store quedaba en `isLoading: true` para siempre. Agregado el guard de auth en `dashboard/layout.tsx` (spinner + redirect a `/login`) y la llamada a `initAuth()` en `providers.tsx`.
- **Filtros de Finca/Campaña tapados por el mapa** en Inicio y Mapa: `z-50` (Tailwind) por debajo de los panes de Leaflet (`z-[200-700]`). Subidos a `z-[1000]`.
- **Panel "Dirección" (KPIs D1-D4) invisible en Inicio:** no era un bug de código — la base de producción tenía 0 filas en `presupuestos`/`registros_cosecha`/`egresos`/etc. La migración de históricos corrida en local nunca se había aplicado contra Railway. Cargados 591 cosechas, 144 egresos, 370 presupuestos contra producción; verificado que las vistas KPI ya devuelven datos.
- **Ingresos rediseñado** de venta-de-uva-por-kilo a libro general de cobros ("BD COBROS"), + nueva pantalla de seguimiento de cheques. `estado` y `cuenta_destino` (inicialmente texto libre) pasaron a enum cerrado y combobox extensible respectivamente, mismo día, tras confirmar los valores reales con Fausto.
- **Causa por la que los fixes de código no se veían en el pilot:** Vercel no auto-despliega en este proyecto (ver 🟡 arriba) — el deploy de producción tenía 4 días de atraso.

**Verificado contra código real el 2026-07-10:**
- **Finca hardcodeada en `_build_egreso_for_trabajo`** (`backend/app/api/produccion.py`) — arreglado 2026-06-08, `finca` ahora es parámetro explícito derivado de `carga.finca`.
- **`await db.commit()` directo en `notificaciones.py`** — arreglado 2026-06-08, reemplazado por `db.flush()`.
- **`datetime.utcnow()` deprecado** — arreglado 2026-06-08 en todos los modelos y servicios, reemplazado por `datetime.now(timezone.utc)`.
- **Widget de clima con datos hardcodeados** (`frontend/app/dashboard/page.tsx`) — arreglado 2026-06-08, `ClimateCard` llama a `GET /clima/actual` real vía TanStack Query.
- **Dashboard Producción mostraba jornales en vez de métricas reales** — reconstruido completo (commit `8691260`, 2026-07-08, "Cambio 5"): kg/ha por parral y variedad, curva S de cosecha, desvío vs plan, eficiencia hídrica, estado fenológico.

**Deploy de prueba piloto, 2026-07-10/11** (detalle completo en [[2026-07-11-deploy-piloto-completado]]):
- Config de deploy (`railway.json`, `runtime.txt`) commiteada y pusheada.
- Suite de tests validada contra Python 3.12.10 (11/11 passing, coincide con `runtime.txt`).
- `CORS`/`SECRET_KEY` de producción verificados y confirmados fuertes (`SECRET_KEY` de 64 bytes urlsafe generado nuevo, `ALLOWED_ORIGINS` apunta al dominio real de Vercel).
- Mobile apuntaba a IP de LAN — corregido, `EXPO_PUBLIC_API_URL` fijo al dominio de Railway vía `eas.json`, build EAS distribuido a testers.
- `app/models/__init__.py` (agregador "importar todos los modelos") no incluía `Trabajador`/`RolTrabajador`, aunque sí estaba en `backend/app/core/migrations/env.py` — las dos listas deberían coincidir. Rompía scripts standalone (`seed.py`, `seed_parcelas.py`) con `InvalidRequestError` al resolver `RegistroTrabajo.trabajador`; la app viva no se veía afectada porque `main.py` importa el router `trabajadores` directamente. Resuelto, commit `a8dea55`. Causa raíz (imports uno por uno en vez del agregador) cerrada definitivamente el 2026-07-14, commit `6c014a8` — ver arriba.
- `mobile/package-lock.json` desincronizado + conflicto de peer dependency `react-dom`/`react` (`react-dom@19.2.7` exige `react@^19.2.7`, proyecto fija `react@19.1.0`) — resuelto con `"overrides": {"react-dom": "19.1.0"}` en `mobile/package.json`, commits `f47c213` y `2844b35`.

---

## Ver también

- [[2026-07-29-duplicados-cuarta-vez-idempotencia-real]]
- [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]
- [[2026-07-20-login-mobile-y-ciclo-campana]]
- [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]
- [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]
- [[2026-07-11-deploy-piloto-completado]]
- [[Arquitectura]]
- [[Dashboards]]
- [[Checklist Deploy de Prueba (Semana Piloto)]]
