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

## Próximos pasos (actualizado 2026-08-05, segunda tanda)

Con los bugs agudos de datos/UX cerrados y varios gaps de UX/auth del backend cerrados esta sesión, el pilot sigue estable. Orden sugerido:

### Ahora (bloqueantes o casi gratis)

1. **Cola de envíos offline para mobile** — decisión tomada con Fausto el 2026-08-05: documentar como próximo cambio explícito, no improvisarlo. Hoy los selectores de parcela/trabajador funcionan sin conexión (cache), pero el `POST` final de Confirmar todavía necesita señal en el momento — si un operario pierde señal justo al confirmar, no hay cola de reintento y se pierde lo tipeado. Los 6 endpoints de creación ya soportan `idempotency_key`, así que la cola es viable sin riesgo de duplicar — pero es una feature con bastante superficie (detección de conectividad, persistencia local, UI de "pendiente de sincronizar", reintento con backoff, manejo de conflictos si el registro referenciado ya no existe) que merece su propia sesión, bien probada, en vez de ir pegada a otro cambio. Detalle de la decisión: [[2026-08-05-login-username-biometria-clima]].
2. **`eas build` nueva pendiente por el módulo de huella dactilar** — `expo-local-authentication` es nativo, el login por huella (hecho 2026-08-05) no se puede distribuir por `eas update`. Aprovechar este build para cualquier otro cambio nativo pendiente.
3. ~~Backup automático: fallos silenciosos en las corridas de catch-up~~ — encontrado el 2026-08-05 al fin correr el test de restore (el mecanismo en sí funciona, probado). De los últimos 15 días, 7 dumps generados fuera del horario de 21:00 quedaron en 0 bytes/truncados sin dejar rastro en `backup.log`. **Pendiente evaluado con Fausto, no ejecutado todavía:** verificación real de integridad (`pg_restore --list`) + revisar el trigger de arranque. Ver [[Bugs Conocidos]].
4. ~~Verificar estado de Play Store~~ — **hecho 2026-08-05**: se encontró que la ficha completa (armada el 07-29) nunca se había enviado a revisión, solo quedó guardada como borrador. Enviados los 8 cambios pendientes con confirmación de Fausto — Google ya los tiene "en proceso de revisión" (hasta 7 días). Camilo lo agrega Fausto directamente.
5. ~~`eas build --profile preview` nueva para el APK~~ — **hecho**: el crash de "Ciclo Campaña" en el standalone se confirmó resuelto (con el build de producción `v1.0.0-2`) el 2026-08-05.
6. ~~Login por email en vez de usuario, sin "recordarme" funcional, sin huella~~ — **hecho 2026-08-05**: `username` nuevo (columna + login), "Recordarme" conectado en web y mobile, huella dactilar real en mobile (pendiente el build nativo, punto 2 de arriba). Detalle: [[2026-08-05-login-username-biometria-clima]].
7. ~~Widget de clima poco profesional / hardcodeado en mobile~~ — **hecho 2026-08-05**: enriquecido Open-Meteo (viento, humedad, UV, sensación térmica) en vez de scrapear Climagro (evaluado y descartado por ahora, ver detalle). Bug de finca corregido (`los_mimbres`→`media_agua`), widget mobile conectado a datos reales (antes era texto fijo).

### Corto plazo (antes de escalar a más usuarios/fincas)

4. ~~Reproducir el bug de riego con 2+ válvulas~~ — **confirmado resuelto** el 2026-08-05 (sin causa puntual identificada, se resolvió de rebote con alguna reescritura previa de `riego.tsx`).
5. ~~Idempotencia real en el backend~~ — **hecho 2026-07-29**, tras un cuarto incidente de duplicados: `idempotency_key` + índice único parcial en los 4 modelos de producción, los 6 endpoints de creación devuelven el registro existente ante un reintento en vez de duplicar. Detalle: [[2026-07-29-duplicados-cuarta-vez-idempotencia-real]]. Pendiente menor no bloqueante: extender `backend/tests/test_produccion_idempotency.py` a riego/fito/cosecha (falta resolver una fixture de `Parcela` para tests).
6. ~~Completar `TareaForm` web (selector de `Trabajador`) y el equivalente en mobile~~ — **hecho 2026-08-05**: combobox con sugerencias contra `GET /trabajadores/`, crea el `Trabajador` nuevo automáticamente si no matchea ninguno. El campo `finca` se dio por resuelto por decisión de negocio (solo Media Agua, ya es el default del backend). Detalle: [[2026-08-05-trabajador-combobox-refresh-token-backup-check]].
7. ~~Refresh token~~ — **hecho 2026-08-05**: `POST /auth/refresh`, 30 días, ligado a `token_version`; web y mobile reintentan silenciosamente ante un 401 por expiración.
8. Logging estructurado + exception handler genérico en el backend (hoy un 500 no deja rastro propio más allá de lo que capture Railway). Evaluar Sentry (u similar) en vez de solo logs de Railway — propuesto el 2026-08-05, no decidido todavía.
9. ~~Crear `EXPO_PUBLIC_API_URL` como variable EAS hosteada para el entorno `production`~~ — **hecho 2026-07-30** (sesión sin documentar en su momento, encontrada el 2026-08-05).
10. ~~`PUT /users/{id}` no soporta cambiar `email`~~ — **hecho 2026-08-05**: agregado a `UserUpdate` con el mismo chequeo de unicidad de `/auth/register`.

### Roadmap (features nuevas)

11. Costo por kg en dashboard de finanzas.
12. Módulo de notificaciones (base ya existe en `notificaciones.py`).
13. Responsividad mobile del frontend **web** (solo 11/43 componentes con breakpoints) — si algún encargado va a usar el navegador desde el celular en vez de la app.
14. Integraciones Fase 5: Climagro (clima real), bot de WhatsApp (carga de egresos), agente ARCA (boletas), termógrafo IoT.

### En curso: publicar en Google Play Store (track Internal testing)

Decidido y arrancado el 2026-07-27, publicado en Internal testing el 2026-07-29, ficha enviada a revisión de Google el 2026-08-05 (hasta 7 días). Pendiente: confirmar el resultado de la revisión y que Camilo haya quedado agregado como tester. Checklist completo: [[Play Store — checklist de publicación]].

## Ver también

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
