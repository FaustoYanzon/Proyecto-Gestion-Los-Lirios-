---
tags: [sistema, bugs]
---

# Bugs Conocidos

> Última revisión: 2026-08-26 (costo por kg, avatar + cumpleaños — ver [[2026-08-26-costo-por-kg-avatar-cumpleanos]])

---

## 🔴 Abiertos — relevantes para el deploy de prueba

Ninguno al cierre del 2026-08-10 — el backup (único punto abierto desde el 08-05) se resolvió esta sesión, ver Resueltos abajo.

---

## 🟡 Riesgos conocidos, aceptables para una prueba corta (no bloquean, documentar)

- **Vercel NO auto-despliega en este proyecto.** Railway sí redespliega el backend solo en cada push a `main` (y corre `alembic upgrade head`), pero el frontend se quedó pegado en un deploy de 4 días hasta que se corrió `vercel --prod` a mano el 2026-07-14 — ver [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]. **Acordarse de correr `vercel --prod` (o `npx vercel --prod --yes` desde `frontend/`) después de cualquier push que toque `frontend/`.** `vercel ls` muestra el último deploy y su antigüedad si hay dudas.
- **Rate limiting en memoria de un solo proceso** (`login_throttle.py`, slowapi): correcto mientras el deploy corra con 1 worker uvicorn (hoy así, `railway.json` no fija `--workers`). Si se escala a multi-worker, hay que respaldar con Redis.
- **Sin refresh token**: al expirar el JWT, el usuario es deslogueado abruptamente sin aviso previo (`lib/api.ts`, interceptor 401).
- ~~Backup automático de producción configurado pero sin activar~~ — **activado 2026-07-27**: `install_backup_task.ps1` corrido, tarea `LosLirios-PG-Backup` registrada (diaria 21:00), probada con `Start-ScheduledTask` (dump real creado y copiado a OneDrive). **Sigue pendiente:** el test de restore que pide `scripts/BACKUP.md` (requiere un Postgres local corriendo, no se hizo todavía) — un backup no está "verificado" hasta que se prueba restaurarlo al menos una vez. También sigue siendo un backup que depende de que la PC de Fausto esté prendida a las 21:00 — si el piloto se vuelve permanente, migrar a un cron de Railway o GitHub Actions (ya anotado en `BACKUP.md` § Known limitations).
- **Lint del frontend no pasa**: 14 errores, todos el mismo patrón (`setState` síncrono dentro de `useEffect` al resetear paginación en `TareasTable.tsx`, `RiegoTable.tsx`, `FitosanitariosTable.tsx`). No rompe runtime.
- ~~Responsividad mobile del frontend web limitada~~ — **resuelta 2026-08-12**: headers de las 13 páginas de `finanzas/`/`producción/`/`admin` corregidos para apilar en mobile, y el panel de detalle de parcela en el mapa (ancho fijo de 288px) corregido a full-width por debajo de `sm`.
- ~~Módulo de notificaciones push solo tenía la mitad del camino hecho~~ — **resuelto 2026-08-12**: pantalla `/dashboard/admin/notificaciones` para componer y enviar. Los triggers automáticos desde Alertas quedan fuera de alcance a propósito, ver [[2026-08-12-notificaciones-y-responsividad]].
- **Dashboard finanzas sin costo por kg** todavía.
- **Cualquier campo `Decimal` de un endpoint de este backend llega al frontend como string, no `number`** — Pydantic lo serializa así por default. Mordió dos veces: "$NaN" en los totales de Egresos ([[2026-08-18-fix-totales-egresos-tareas-dashboards-por-rango]], causa distinta ahí) y `gdd_acumulado.toFixed is not a function` en la pestaña Clima ([[2026-08-19-clima-termografo-pronostico-extendido]]). Los tipos TS que declaran estos campos como `number` son una mentira estructural — TypeScript no valida contra la respuesta real de la API. Antes de usar `.toFixed()`, pasarlo a un gráfico, o hacer aritmética sobre un campo que en el backend es `Decimal`, convertir explícitamente con `Number(...)` en la capa de API del frontend (no en cada punto de uso).
- **Lockfiles pueden desincronizarse silenciosamente**: `npm install` local resuelve conflictos de peer dependencies con solo un warning, pero `npm ci` (usado en CI/EAS Build) los rechaza en seco. Antes de cualquier deploy que dependa de un lockfile, correr `rm -rf node_modules && npm ci` localmente para detectar el problema antes que el servidor de build.
- **OTA de mobile a veces necesita cerrar/reabrir la app dos veces** para aplicarse (expo-updates descarga en un launch, aplica en el siguiente) — causó confusión real el 2026-07-27 (Fausto vio comportamiento viejo — botón "Terminar" en Inicio — después de un `eas update` ya publicado). Si un fix mobile "no aparece" después de un deploy, antes de investigar código: cerrar la app del todo y reabrirla, dos veces si hace falta.
- **Cualquier dependencia nueva en mobile puede ser un módulo nativo sin darse cuenta** — publicarla solo con `eas update` (OTA) rompe la pantalla en los celulares ya instalados, porque el JS llama a un módulo que no está enlazado en el binario nativo (mismo bug que `@react-native-community/netinfo` en agosto y que casi se repite con `@react-native-picker/picker` el 2026-08-26, revertido a tiempo por un selector propio en JS puro). Antes de agregar cualquier paquete nuevo a `mobile/package.json` para publicar solo por OTA, confirmar que sea 100% JS — si tiene código nativo (Android/iOS), hace falta un `eas build` nuevo y resubir a Play Store.
- **`uvicorn --reload` en Windows deja procesos worker huérfanos si se mata solo el proceso reloader** — `Stop-Process -Id <PID del reloader>` no mata al worker hijo que WatchFiles spawnea; el worker viejo se queda vivo en el puerto 8000 sirviendo código desactualizado, aunque el proceso nuevo loguee "Application startup complete" sin errores (causó ~30 min de confusión real el 2026-08-26, ver [[2026-08-26-costo-por-kg-avatar-cumpleanos]]). Antes de reiniciar el backend local en este entorno, matar el árbol completo: `taskkill /F /IM python.exe /T`.

---

## ✅ Resueltos

**Sesión del 2026-08-13** (ver [[2026-08-13-mejoras-mapa]]):
- **Modo "Fenología" del mapa mostraba estados viejos (Latencia/Madurez, sin Post-Cosecha) — resuelto.** Leía del motor viejo (`fenologia.py`/`EstadoFenologico`) en vez del Ciclo de Campaña nuevo (`EstadoCampana`, ya se pedía pero no se usaba para pintar). El endpoint viejo queda intacto — sigue alimentando "tareas recomendadas".
- **Modos "Riego" y "Cumpl. riego" mostraban la misma info con etiquetas distintas — resuelto.** Se sacó "Riego" (objetivo anual), queda solo "Cumpl. riego" (contra el estado de campaña actual).
- **Objetivo de agua en el panel de parcela en litros, pedido en mm/año — resuelto.** 600 mm/año, derivado de la constante existente. Mobile no tenía esta barra en absoluto — agregada para paridad con web.
- **Capa "Cuadrantes de Riego" no se podía clickear — resuelto.** Tenía `interactive:false` explícito en ambas plataformas (cañerías/válvulas sí eran interactivas). Mismo popup genérico que ya usan esas dos.
- **Riegos en curso sin ninguna conexión visual al mapa — resuelto, a nivel parral.** Poll 30s, borde celeste punteado sobre el parral exacto. Deliberadamente NO a nivel cuadrante/cañería/válvula — `RegistroRiego.valvula` es un índice posicional por parcela, no el mismo espacio de nombres que las válvulas físicas del GeoJSON (sin tabla de equivalencia hoy, pintar a nivel cabezal sería impreciso y riesgoso en una herramienta de campo).
- **Hallazgo de proceso en mobile:** el primer intento de implementación del punto de riego en curso conectaba el dato directo al armado del HTML del WebView — se detectó a tiempo que eso recargaría el mapa completo cada 30s (perdiendo zoom/modo/capas). Corregido con `injectJavaScript` antes de deployar, no llegó a producción.

**Sesión del 2026-08-12, quinta tanda** (ver [[2026-08-12-notificaciones-y-responsividad]]):
- **Notificaciones push sin UI de envío — resuelto.** `/dashboard/admin/notificaciones` nuevo, sin cambios de backend.
- **Responsividad mobile del frontend web — resuelta en las 13 páginas identificadas.** Headers que no envolvían corregidos en 9; las otras 4 ya estaban bien resueltas con `flex-wrap`/`overflow-x-auto`. Hallazgo de paso: panel de detalle de parcela en el mapa con ancho fijo de 288px, corregido a full-width en mobile.

**Sesión del 2026-08-12, cuarta tanda** (ver [[2026-08-12-catalogo-trabajadores-vacio-y-fix]]):
- **Catálogo de `trabajadores` completamente vacío en producción desde el 08-05 — resuelto.** 105 de 106 registros de Tareas (y todos los de Riego/Fitosanitarios) tenían `trabajador_id`/`responsable_id` NULL. El combobox en sí funciona bien (verificado con una creación de prueba real en producción) — el gap era retroactivo: nunca se volvió a ejercitar el flujo de creación después del lanzamiento. `scripts/backfill_trabajadores.py` corrido en producción: 28 Trabajadores creados, 109 registros vinculados, 0 pendientes tras verificar.
- **Sin pantalla de administración para el catálogo de Trabajador — resuelto.** Nueva `/dashboard/admin/trabajadores` (CRUD completo, sin cambios de backend — los endpoints ya existían desde el 08-05).
- **Auditoría de integridad de datos** (pedida por Fausto tras encontrar el gap de arriba): revisado todo `app/models/*.py` buscando el mismo patrón (texto denormalizado + FK opcional sin vincular) en otro lado. No se encontró ningún otro caso — es aislado a `trabajador_id`/`responsable_id`.

**Sesión del 2026-08-12, tercera tanda** (ver [[2026-08-12-combobox-responsable-riego-fito]]):
- **El campo "responsable" de Riego y Fitosanitarios era texto libre, sin dedupe ni link a Trabajador — resuelto.** El combobox de Tareas (2026-08-05) nunca se había extendido a estos dos módulos, en ninguna de las dos plataformas. Agregado `responsable_id` (backend, migración `32b5a004492a`) + combobox de sugerencias (web: `ResponsableInput.tsx` nuevo, mobile: mismo patrón que `tareas.tsx`) en los 4 formularios (`RiegoForm`, `IniciarRiegoForm`, `FitosanitarioForm` web; `riego.tsx`, `fito.tsx` mobile). 47/47 tests backend, `tsc --noEmit` limpio en frontend y mobile.

**Sesión del 2026-08-12, segunda tanda** (cierre de los pendientes del roadmap del 08-12 — ver [[2026-08-12-importacion-comprobantes-arca-iva]]):
- **`SENTRY_DSN` seteado en Railway — Sentry activo en producción.** DSN obtenido de sentry.io (proyecto `python-fastapi`, no `python-fastapi-1` como se había anotado) vía Claude in Chrome, seteado con `railway variables --set` contra el servicio ya linkeado. El set de la variable disparó el redeploy solo.
- **Frontend con la importación ARCA desplegado a producción** (`vercel --prod`).
- **Bug real encontrado al agregar el 4° test de idempotencia (`POST /produccion/riego/iniciar`): `ZoneInfo("America/Argentina/San_Juan")` sin `tzdata` instalado explota con `ModuleNotFoundError`.** Windows no trae la base IANA de zonas horarias como sí la traen la mayoría de las imágenes Linux (por eso nunca se vio en Railway) — pero tampoco estaba declarado como dependencia explícita, así que cualquier imagen Linux minimalista sin tzdata del SO tendría el mismo problema en producción. Nunca se había detectado porque ningún test anterior ejercitaba ese endpoint. `tzdata==2026.3` agregado a `requirements.txt`. 44/44 tests backend pasando.
- **"Deshacer un descarte de comprobante ARCA" — confirmado que ya estaba resuelto, el roadmap había quedado desactualizado.** El follow-up de la sesión del 08-12 (misma tarde, commits `38858e6`/`f753702`) ya había agregado `POST /finanzas/arca/{id}/restaurar`, `DELETE /finanzas/arca/{id}` y la vista "Ver descartados" — confirmado en el código actual, no hizo falta construir nada.

**Sesión del 2026-08-11** (detalle completo en [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]]):
- **Sin logging estructurado ni exception handler genérico — resuelto.** Root logger a stdout (Railway lo captura) + `@app.exception_handler(Exception)` que loguea el traceback y devuelve un 500 genérico sin filtrar detalles internos; las rutas con `HTTPException` explícito siguen intactas. Sentry instalado y verificado en vivo (evento capturado en el dashboard); activación en producción pendiente de que Fausto agregue `SENTRY_DSN` en las env vars de Railway.
- **Tests de idempotencia faltantes en riego/fitosanitarios/cosecha — resuelto.** El backend ya soportaba idempotencia completa desde el 07-29; causa raíz del bug histórico "no such table: parcelas" identificada (fixture debía usar `TestSessionLocal`, no el engine de producción). 27/27 tests passing.
- **Sin test que valide routers registrados en `main.py` — resuelto.** Descubrimiento estático vía `ast` (no importa `seed_cosecha.py`/`seed_parcelas.py`, que tienen efectos secundarios al importarse) + verificación contra `app.routes`.
- **Cola offline (mobile) no estaba lista para probarse en la finca — resuelto antes de que se detectara en campo.** `@react-native-community/netinfo` (agregado el 08-10) es un módulo nativo compilado; el build publicado en Play Store (versionCode 3) es anterior a ese commit y no lo tenía enlazado. Build nuevo (versionCode 4) generado y en proceso de publicación en Prueba interna.

**Sesión del 2026-08-10** (detalle completo en [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]):
- **Widget de clima nunca funcionó — resuelto de raíz.** No era un bug de la sesión del 08-05/06 que lo "enriqueció" — nunca había funcionado desde que existe. Causa: `app.api.clima` nunca se registró en `main.py` (confirmado recorriendo todo el historial de git — ni un commit lo incluyó), `ClimaCache` no estaba en `app/models/__init__.py` (invisible para Alembic), y no existía migración para la tabla `clima_cache`. De paso encontrados y corregidos: un carácter `\r` corrupto en medio de una línea de `clima_cache.py` (rompía hasta el autogenerate) y `fetched_at` sin timezone mientras el código escribe datetimes aware (asyncpg lo rechazaba). Probado de punta a punta contra Postgres local antes de pushear.
- **Backup: fallos silenciosos en catch-up — resuelto.** Agregado `pg_restore --list` a `backup_postgres.ps1` (integridad real, no solo tamaño). Probado con un dump truncado simulado que pasaba el chequeo viejo — ahora se detecta.
- **Cola de envíos offline (mobile) implementada** — los 3 wizards (tareas/riego/fito) encolan en `AsyncStorage` si el POST falla sin respuesta del servidor, en vez de mostrar error y perder lo tipeado. Sincroniza sola al volver la señal. Pendiente de confirmar en dispositivo real (posible necesidad de `eas build` para el módulo nativo de `netinfo`).
- **Error falso al confirmar riego (web) — resuelto.** Mismo patrón que el bug de "terminar riego" del 07-27: `RiegoForm.tsx` mostraba error genérico aunque la escritura hubiera llegado. Ahora reintenta una vez más (seguro por `idempotency_key`/PUT idempotente) antes de mostrar error.
- **Camilo no estaba realmente como tester de Play Store** a pesar de creerse confirmado el 08-05 — verificado y agregado en Play Console.
- **Nuevo: panel de Alertas tipo "buzón"** — antes solo mostraba hasta 3 alertas sin forma de interactuar. Ahora es un modal con todas las alertas, tildar (✓) o cancelar (✕) las oculta 48h (backend nuevo: tabla `alertas_descartadas`, compartida entre usuarios — las alertas se calculan en vivo, no son filas persistidas, por eso no hay forma de "resolverlas" de verdad, solo descartarlas temporalmente).
- **"Riegos en curso" con el mismo patrón que Alertas** — con varios riegos activos a la vez, el Inicio ahora muestra el primero + "ver todos" en vez de la lista completa. Se descubrió que "iniciar riego" ya existía en web desde el 07-17 (`IniciarRiegoForm` en la página de Riego) — el problema era que el panel del Inicio desaparecía del todo sin ningún riego activo, sin pista de que la función existía; agregado un CTA de estado vacío.
- **Layout del Inicio:** mapa más angosto, widget de clima ampliado (mobile espejando a web), dos bugs de superposición corregidos (altura fija del grid en vez de max-height con overflow visible; z-index de los modales por debajo de los paneles de Leaflet). Mapa compacto ahora es clickeable → lleva al mapa completo.

**Sesión del 2026-08-05:**
- **`TareaForm` sin selector de `Trabajador` (texto libre) — resuelto.** Combobox con sugerencias contra `GET /trabajadores/` (web y mobile); si el nombre tipeado no matchea ninguno existente, se crea el `Trabajador` nuevo automáticamente al confirmar en vez de quedar como texto libre suelto. El backend ya soportaba `trabajador_id` de punta a punta desde antes (nadie lo había conectado desde el frontend) — cero cambios de backend. El campo `finca` que faltaba en el mismo formulario se dio por resuelto por decisión de negocio: solo se trabaja con Media Agua, que ya es el default del backend.
- **Sin refresh token — resuelto.** `POST /auth/refresh` nuevo + refresh token emitido en el login (30 días, ligado a `token_version`). Web y mobile reintentan silenciosamente ante un 401 por expiración en vez de deslogear de una.
- **`PUT /users/{id}` no soportaba cambiar `email` — resuelto.** Agregado a `UserUpdate` con el mismo chequeo de unicidad que ya tenía `/auth/register`.
- Detalle completo (incluye el hallazgo real de esta sesión sobre el backup) en [[2026-08-05-trabajador-combobox-refresh-token-backup-check]].

**Confirmados resueltos por Fausto el 2026-08-05 (arreglados en la sesión intermedia del 2026-07-30, sin causa puntual documentada):**
- **"Ciclo Campaña" crasheaba el APK standalone** — confirmado resuelto con el build de producción `v1.0.0-2`.
- **Error genérico al cargar riego con 2+ válvulas** — confirmado resuelto, sin causa puntual identificada (se resolvió de rebote con alguna reescritura de `riego.tsx` o con el fix del 07-30 de "no disparar error/éxito falso al cancelar riego con la X mid-submit").

**Sesión del 2026-07-30 (hecha por Fausto directo, sin Claude Code — encontrada sin documentar el 2026-08-05):**
- Selector de temporada al crear una tarea nueva/personalizada (backend + web + mobile) — antes quedaba siempre en "general".
- Campo Observaciones agregado al wizard de tareas en mobile (ya viajaba en el schema, mobile no lo enviaba).
- `EXPO_PUBLIC_API_URL` creada como variable hosteada en EAS para `production` — cierra el mismo riesgo que ya se había cerrado para `preview` el 07-20/22.
- Fix: cancelar un riego con la X mientras el submit seguía en curso disparaba un error/éxito falso fuera de contexto.

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

- [[2026-08-26-costo-por-kg-avatar-cumpleanos]]
- [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]]
- [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]
- [[2026-08-05-trabajador-combobox-refresh-token-backup-check]]
- [[2026-07-29-duplicados-cuarta-vez-idempotencia-real]]
- [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]
- [[2026-07-20-login-mobile-y-ciclo-campana]]
- [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]
- [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]
- [[2026-07-11-deploy-piloto-completado]]
- [[Arquitectura]]
- [[Dashboards]]
- [[Checklist Deploy de Prueba (Semana Piloto)]]
