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

## Próximos pasos

1. **Semana de prueba piloto en curso** — revisar `railway logs` a diario (no hay logging estructurado ni exception handler genérico todavía), recolectar feedback de testers.
2. Completar `TareaForm` **web** (campo `finca` + selector de trabajador) si la prueba va a validar el flujo completo de mano de obra — el mobile (`tareas.tsx`) no tiene selector de `Trabajador` tampoco, solo texto libre para el nombre.
3. Costo por kg en dashboard de finanzas.
4. Módulo de notificaciones (base existe en `notificaciones.py`).
5. **Rutina de backup automático de PostgreSQL** — hoy solo hay backups manuales puntuales (el último, 2026-07-10, antes de arrancar el piloto: `pg_backups/loslirios_railway_20260710_pilot.dump`). Definir cadencia (diaria sugerida) y automatizarla, idealmente con un cron/Task Scheduler que corra `pg_dump` contra la URL pública de Railway.
6. ~~Error boundaries en frontend~~ — hecho 2026-07-14 (`dashboard/error.tsx`/`loading.tsx`). Refresh token sigue pendiente.
7. ~~Revisar si algún otro script standalone tiene el mismo riesgo que `seed.py`~~ — hecho 2026-07-14: `env.py`/`seed.py`/`seed_cosecha.py`/`seed_parcelas.py` importan todos el agregador `app.models`.
8. ~~Agregar `DATABASE_PUBLIC_URL` a `backend/.env`~~ — hecho 2026-07-17 (Fausto lo sacó de Railway vía `railway variables`, Claude Code lo agregó al archivo sin leer su contenido). **Sigue pendiente:** correr `install_backup_task.ps1` + `Start-ScheduledTask -TaskName 'LosLirios-PG-Backup'` para activar la rutina automática — el 2026-07-17 se tomaron varios backups manuales puntuales (`pg_backups/los_lirios_prod_*.dump`) pero la tarea programada todavía no se instaló.

## Ver también

- [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]
- [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]
- [[2026-07-11-deploy-piloto-completado]]
- [[2026-07-12-ota-y-ux-cargar-tarea]]
- [[Arquitectura]]
- [[Stack Técnico]]
- [[Bugs Conocidos]]
- [[Dashboards]]
- [[Checklist Deploy de Prueba (Semana Piloto)]]
