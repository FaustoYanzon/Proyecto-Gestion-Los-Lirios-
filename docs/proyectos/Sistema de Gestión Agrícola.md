---
tags: [proyecto, sistema, desarrollo]
---

# Sistema de Gestión Agrícola

## Objetivo

Reemplazar/complementar los workflows manuales de Excel y Power BI con un sistema web + mobile integrado para la gestión operativa de Los Lirios SA.

## Módulos

| Módulo | Backend | Frontend | Mobile |
|---|---|---|---|
| Auth / Usuarios | ✅ | ✅ | ✅ |
| Parcelas | ✅ | ✅ | parcial |
| Finanzas (ingresos/egresos/cheques) | ✅ | ✅ | — |
| Producción (tareas/riego/fito) | ✅ | parcial | parcial |
| Dashboards analíticos | — | en curso | — |
| Deploy / infraestructura | ✅ producción (piloto) | ✅ producción (piloto) | ✅ build distribuido (piloto) |

## Estado actual (2026-07-11 — piloto de prueba en producción)

- **Deploy: listo, en producción.** Los 5 bloqueantes de [[Checklist Deploy de Prueba (Semana Piloto)]] se resolvieron el 2026-07-10/11, junto con 7 problemas adicionales no anticipados (driver async de Postgres, root directory del monorepo, puerto del proxy de Railway, symlinks de Obsidian rompiendo el build de EAS en Windows, lockfile de mobile desincronizado, conflicto de peer dependency `react-dom`/`react`, entre otros). Backend en Railway, frontend en Vercel, mobile con build EAS distribuido a testers. Detalle completo: [[2026-07-11-deploy-piloto-completado]].
- **Backend: sólido.** Hardening de seguridad completado y verificado línea por línea (ver [[Arquitectura]] § Seguridad): secretos rotados y fuera de git, JWT migrado a PyJWT, rate limiting por IP + por username, invalidación de sesión vía `token_version`, autorización por rol server-side confirmada en rutas sensibles, suite de tests de regresión 11/11 passing **contra Python 3.12.10, la misma versión del deploy real**. Los 3 bugs críticos viejos y el dashboard de producción "roto" ya están resueltos (ver [[Bugs Conocidos]] § Resueltos). Bug adicional encontrado y resuelto durante el deploy: `app/models/__init__.py` no registraba el modelo `Trabajador`, rompiendo scripts standalone (`seed.py`).
- **Frontend: funcionalmente completo para el alcance actual, en producción.** Dashboards de finanzas, mano de obra y producción reconstruidos (commit `8691260`, "Cambio 5": KPIs D1-D4, presupuestos, metas de producción). `npm run build` compila limpio. Rutas admin (usuarios/parcelas) y mapa ya no son stubs. Gaps: TareaForm sin campo `finca` ni selector de trabajador, sin error boundaries, lint con errores no fatales.
- **Mobile: build de piloto distribuido, con OTA activado desde 2026-07-12.** Expo 54 / React Native 0.81, apunta al backend de Railway vía `eas.json`. `expo-updates` configurado (ver [[2026-07-12-ota-y-ux-cargar-tarea]]) — cambios de puro JS/UI ya se publican con `eas update`, sin rebuild ni reinstalación. Se rediseñaron 5 puntos de UX en el formulario de "Cargar Tarea" (ubicación agrupada por tipo, unidad con submenú, cantidad por teclado numérico, confirmación sin pantalla intermedia, cancelar wizard con "X").

## Estado actual (2026-07-14 — primera semana piloto, primeros bugs reales)

Detalle completo: [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]. Resumen:

- **Ingresos rediseñado** de venta-de-uva-por-kilo a libro general de cobros ("BD COBROS"), con `estado` (enum `no_registrado`/`facturado`) y `cuenta_destino` (combobox extensible, "+ Agregar nueva..."). Nueva pantalla de seguimiento de cheques (`/dashboard/finanzas/cheques`).
- **Bug de sesión (F5/pestaña nueva) resuelto:** root cause era `app/providers.tsx` sin llamar a `initAuth()`. Agregado guard de auth en `dashboard/layout.tsx`.
- **Históricos cargados a producción** (591 cosechas, 144 egresos, 370 presupuestos) — nunca se habían aplicado desde el deploy inicial, por eso el panel "Dirección" de KPIs en Inicio se veía vacío.
- **Hallazgo operativo importante: Vercel no auto-despliega en este proyecto.** Railway sí. Cualquier cambio de frontend necesita `vercel --prod` manual después del push — de lo contrario el pilot sigue sirviendo una build vieja sin avisar.

## Estado actual (2026-07-17 — 11 puntos de la primera semana piloto)

Detalle completo: [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]. Resumen:

- **Riego: feature nueva "Riegos en curso"** — arrancar un riego con solo hora de inicio y cerrarlo después, con litros/tiempo calculados en vivo. Implementado en backend, web y mobile.
- **Mapa mobile arreglado de raíz:** `parcelas.coordenadas` (existía en el schema, nunca se había poblado) es ahora la fuente única de geometría para web y mobile — se sacó el snapshot hardcodeado de mobile. Agregada la parcela "Pasero 3" que faltaba, unificados colores y modos de color entre plataformas.
- **Históricos migrados de Excel borrados** (591 cosechas / 144 egresos / 370 presupuestos) por decisión de datos de Fausto — los va a re-analizar y recargar más adelante. No están disponibles hasta que eso pase.
- **Permisos aclarados:** crear = `require_encargado_up`, editar/borrar = `require_gerencial_up`, consistente entre `produccion.py`, `parcelas.py` y `finanzas.py`.
- **Filtro de Finca agregado** a los dashboards (cosmético, solo "Media Agua").
- **Pendiente sin resolver:** error genérico al cargar riego mobile con 2+ válvulas — necesita reproducirse en el dispositivo antes de poder arreglarse (ver [[Bugs Conocidos]]).

## Estado actual (2026-07-18 — egresos huérfanos corregidos)

Fausto notó que Mano de Obra (producción, $2.743.575) y Egresos (finanzas, $3.817.725) no coincidían. Causa: `limpiar_duplicados.py` (2026-07-17) borró `registros_trabajo` duplicados por SQL directo sin borrar el `Egreso` vinculado que genera cada uno (`_build_egreso_for_trabajo`), a diferencia del endpoint real `delete_trabajo`. Quedaron 14 egresos huérfanos por exactamente $1.074.150, la diferencia exacta. Corregido con `scripts/limpiar_egresos_huerfanos.py` (backup + dry-run + `--commit`) — ambos totales coinciden ahora en $2.743.575. Fix **solo de base de datos**, sin cambios de código, ya visible en producción sin necesidad de deploy. Detalle: [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]] § "Follow-up 2026-07-18".

## Estado actual (2026-07-27 — duplicados web, mapa mobile, cumplimiento de riego)

Detalle completo: [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]. Resumen:

- **Duplicados en tareas/riego web resueltos** — el guard anti doble-tap del 2026-07-17 nunca se había replicado del mobile al web. Limpiados en producción.
- **Mapa mobile funcionando de nuevo** — causa real era un `TypeError` en `dashboard_eficiencia_hidrica` con cualquier riego en curso, que tumbaba los 6 endpoints del mapa a la vez (`Promise.all`). Cambiado a `Promise.allSettled` — de paso corrige que `regador`/`obrero` tenían el mapa roto *siempre*, no solo con este bug.
- **"Cumplimiento de riego por estado fenológico" completado en web** — quedaba pendiente desde el 2026-07-20/22 (estaba empezado sin commitear). Ahora la capa de color y el panel de detalle por variedad funcionan igual en web y mobile.
- **UX de "riegos en curso" pulida**: litros solo se muestran al terminar (no en vivo), "Terminar" solo desde la pantalla de Riego (no desde Inicio), falso error al terminar corregido con verificación contra el servidor.
- Sesión trabajada en paralelo con otra instancia de Claude Code sobre los mismos archivos (sin coordinación previa) — convergieron al mismo resultado sin conflicto destructivo, pero es una práctica a evitar si no es intencional.

## Próximos pasos (actualizado 2026-08-06 — cierre de la sesión del 05/06 de agosto)

Sesión larga (dos días): backup, Play Store, combobox de Trabajador, refresh token, login por username + huella dactilar, clima, y deploy completo. Pilot estable, sin bloqueantes de código pendientes. Pendientes reales (no de código, salvo el punto 1):

### Pendiente real

1. **Cola de envíos offline para mobile** — próximo cambio de código a hacer. Spec completo listo para implementar directo, sin re-investigar: [[Spec — Cola de envíos offline (mobile)]]. Hoy los selectores de parcela/trabajador funcionan sin conexión (cache), pero el `POST` final de Confirmar todavía necesita señal en el momento — si un operario pierde señal justo al confirmar, no hay cola de reintento y se pierde lo tipeado. Los 6 endpoints de creación ya soportan `idempotency_key`, así que la cola es viable sin riesgo de duplicar. Decisión tomada con Fausto el 2026-08-05 de documentarlo en vez de implementarlo de apuro.
2. **Backup automático: fallos silenciosos en las corridas de catch-up** — encontrado el 2026-08-05 al correr el test de restore (el mecanismo en sí funciona, probado con un dump real). De los últimos 15 días, 7 dumps generados fuera del horario de 21:00 quedaron en 0 bytes/truncados sin dejar rastro en `backup.log`. **Evaluado con Fausto, no ejecutado todavía:** verificación real de integridad (`pg_restore --list`, no solo el chequeo de tamaño >10KB que ya existe) + revisar el trigger de arranque (`StartWhenAvailable`). Ver [[Bugs Conocidos]].
3. **Revisión de contenido de Google Play todavía en curso** — ficha enviada el 2026-08-05 (hasta 7 días de plazo típico). Confirmar el resultado cuando llegue.
4. **Confirmar que Camilo quedó agregado como tester** de Internal testing (Fausto se encargó de hacerlo él mismo el 2026-08-05, no verificado desde Claude).
5. Logging estructurado + exception handler genérico en el backend (hoy un 500 no deja rastro propio más allá de lo que capture Railway). Evaluar Sentry (u similar) en vez de solo logs de Railway — propuesto el 2026-08-05, no decidido todavía.
6. Extender `backend/tests/test_produccion_idempotency.py` a riego/fito/cosecha (falta resolver una fixture de `Parcela` para tests) — menor, no bloqueante.

### Hecho en la sesión del 2026-08-05/06 (para referencia — no repetir)

- Test de restore del backup corrido y verificado; hallazgo de arriba (punto 2) surgió de esto.
- Ficha de Play Store enviada a revisión (nunca se había enviado, quedó como borrador desde el 07-29).
- Combobox de Trabajador (web + mobile), con creación automática si el nombre no matchea ninguno existente. Detalle: [[2026-08-05-trabajador-combobox-refresh-token-backup-check]].
- Refresh token (backend + web + mobile) — ya no desloguea abrupto al expirar el JWT.
- `email` editable en `UserUpdate`/admin de usuarios.
- Login por `username` en vez de email (columna nueva + migración), "Recordarme" conectado de verdad en web y mobile, huella dactilar real en mobile (antes un placeholder). Detalle: [[2026-08-05-login-username-biometria-clima]].
- Clima enriquecido (viento, humedad, UV, sensación térmica) vía Open-Meteo — se evaluó y descartó scrapear Climagro por ahora. Bug de finca corregido (`los_mimbres`→`media_agua`), widget mobile conectado a datos reales (antes texto fijo).
- Deploy completo: Railway (migración de `username` corrida sola), `vercel --prod`, `eas build` de producción (módulo nativo de huella) **publicado en Internal testing como versión 3 (1.0.0)** el 2026-08-06.
- `EXPO_PUBLIC_API_URL` hosteada en EAS para `production` y fix de error falso al cancelar riego mid-submit — hechos el 2026-07-30 en una sesión que Fausto hizo solo, sin documentar en su momento (encontrada recién el 2026-08-05).
- Confirmado resuelto por Fausto: crash de "Ciclo Campaña" en el APK standalone, y el bug de riego con 2+ válvulas.

### Roadmap (features nuevas, sin fecha)

- Costo por kg en dashboard de finanzas.
- Módulo de notificaciones (base ya existe en `notificaciones.py`).
- Responsividad mobile del frontend **web** (solo 11/43 componentes con breakpoints) — si algún encargado va a usar el navegador desde el celular en vez de la app.
- Integraciones Fase 5: Climagro real (solo si el dato de Open-Meteo se demuestra insuficiente), bot de WhatsApp (carga de egresos), agente ARCA (boletas), termógrafo IoT.

### Google Play Store (track Internal testing)

Decidido y arrancado el 2026-07-27, publicado en Internal testing el 2026-07-29, ficha enviada a revisión de Google el 2026-08-05 (pendiente, punto 3 de arriba), versión 3 (huella/login/clima/trabajador) publicada el 2026-08-06. Checklist completo: [[Play Store — checklist de publicación]].

## Ver también

- [[Spec — Cola de envíos offline (mobile)]]
- [[2026-08-05-login-username-biometria-clima]]
- [[2026-08-05-trabajador-combobox-refresh-token-backup-check]]
- [[Play Store — checklist de publicación]]
- [[2026-07-29-duplicados-cuarta-vez-idempotencia-real]]
- [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]
- [[2026-07-20-login-mobile-y-ciclo-campana]]
- [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]
- [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]
- [[2026-07-11-deploy-piloto-completado]]
- [[2026-07-12-ota-y-ux-cargar-tarea]]
- [[Arquitectura]]
- [[Stack Técnico]]
- [[Bugs Conocidos]]
- [[Dashboards]]
- [[Checklist Deploy de Prueba (Semana Piloto)]]
