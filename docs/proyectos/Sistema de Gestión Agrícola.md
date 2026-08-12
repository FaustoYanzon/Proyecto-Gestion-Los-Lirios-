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

## Estado actual (2026-08-10 — clima realmente arreglado, cola offline, layout Inicio, riego y alertas)

Detalle completo: [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]. Resumen:

- **El widget de clima nunca había funcionado** (ni antes ni después del "enriquecimiento" del 08-05/06) — el router de la API nunca se registró en `main.py`, en ningún commit desde que existe el archivo. Encontrado, corregido (+ 2 bugs más descubiertos al probar de punta a punta: `\r` corrupto en un import, columna de fecha sin timezone) y verificado en producción.
- **Cola de envíos offline (mobile) implementada** para tareas/riego/fito — pendiente confirmar en dispositivo real.
- **Backup:** `pg_restore --list` agregado, cierra el blindspot de dumps truncados del 08-05.
- **Riego (web):** error falso al confirmar corregido (mismo patrón que el bug de "terminar riego" del 07-27). Se descubrió que "iniciar riego en curso" ya existía en web desde el 07-17, solo sin descubrir — agregado un CTA de estado vacío en el Inicio.
- **Alertas:** nuevo panel tipo "buzón" (modal con todas las alertas, tildar/cancelar las oculta 48h — persistido en backend, compartido entre usuarios).
- **Layout del Inicio:** mapa más angosto y clickeable (lleva al mapa completo), "Riegos en curso" con el mismo patrón de panel que Alertas, dos bugs de superposición corregidos (altura del grid, z-index de los modales vs. Leaflet).
- Camilo confirmado y agregado como tester de Play Store (no estaba, a pesar de creerse hecho el 08-05).

## Próximos pasos (actualizado 2026-08-12, segunda sesión — cierre)

Pilot estable, sin bloqueantes de código pendientes. Puntos 2 y 3 del roadmap anterior confirmados por Fausto (probados en producción y en el dispositivo real de la finca, van bien). Puntos 1, 4 y 5 cerrados en esta sesión. Pendientes reales:

### Pendiente real

Ninguno bloqueante. Los puntos que quedaban del roadmap anterior ya están resueltos (ver abajo).

### Hecho en esta sesión (2026-08-12, segunda tanda — para referencia, no repetir)

1. **`vercel --prod` corrido** — la importación ARCA (CSV → Egresos/Ingresos + IVA) ya está en el frontend de producción.
4. **`SENTRY_DSN` seteado en Railway** (vía `railway variables --set`, DSN obtenido del proyecto `python-fastapi` en sentry.io) — Sentry queda activo en producción a partir del próximo redeploy del servicio (el set de la variable ya dispara uno).
5. **4° test de idempotencia agregado** para `POST /produccion/riego/iniciar` (`backend/tests/test_produccion_idempotency.py`) — expuso un bug real de paso: `ZoneInfo("America/Argentina/San_Juan")` depende de la base IANA del sistema operativo, ausente en Windows sin el paquete `tzdata` explícito (nunca se había ejercitado ese endpoint en un test). Agregado `tzdata` a `requirements.txt`. 44/44 tests backend pasando. Commit `7c4fde1`, pusheado — Railway redespliega solo (sin migraciones nuevas).
6. **Punto "deshacer descarte ARCA" — ya estaba resuelto, el roadmap había quedado desactualizado.** El follow-up de la sesión del 08-12 (misma tarde, commits `38858e6`/`f753702`) ya había agregado `POST /finanzas/arca/{id}/restaurar`, `DELETE /finanzas/arca/{id}` y la vista "Ver descartados" en `ComprobantesArcaPanel.tsx` — confirmado presente en el código actual. No había nada que construir, solo corregir este documento.

### Hecho en la sesión del 2026-08-12, primera tanda (para referencia — no repetir)

Importación de comprobantes ARCA (CSV) → Egresos/Ingresos + IVA compra/venta/saldo, completa (modelo, backend, frontend, alertas, verificada end-to-end con datos reales). Ver [[2026-08-12-importacion-comprobantes-arca-iva]].

### Hecho en la sesión del 2026-08-11 (para referencia — no repetir)

Ver el resumen completo en [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]]. Cierra los puntos 2-4 del roadmap anterior (logging/Sentry, tests de idempotencia riego/fito/cosecha, test de registro de routers) y adelanta el punto 1 (cola offline) con un build nuevo tras detectar que el publicado no tenía el módulo nativo necesario.

### Hecho en la sesión del 2026-08-10 (para referencia — no repetir)

Ver el resumen completo arriba y en [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]. Cierra los puntos 1-4 del roadmap anterior (cola offline, backup, revisión de Play Store, Camilo como tester).

### Roadmap (features nuevas, sin fecha)

- Costo por kg en dashboard de finanzas.
- Módulo de notificaciones (base ya existe en `notificaciones.py`).
- Responsividad mobile del frontend **web** (solo 11/43 componentes con breakpoints) — si algún encargado va a usar el navegador desde el celular en vez de la app.
- Integraciones Fase 5: Climagro real (solo si el dato de Open-Meteo se demuestra insuficiente), bot de WhatsApp (carga de egresos), agente ARCA (boletas), termógrafo IoT.

### Google Play Store (track Internal testing)

Decidido y arrancado el 2026-07-27, publicado en Internal testing el 2026-07-29, ficha enviada a revisión de Google el 2026-08-05 (pendiente, punto 3 de arriba), versión 3 (huella/login/clima/trabajador) publicada el 2026-08-06. Checklist completo: [[Play Store — checklist de publicación]].

## Ver también

- [[2026-08-12-importacion-comprobantes-arca-iva]]
- [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]]
- [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]
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
