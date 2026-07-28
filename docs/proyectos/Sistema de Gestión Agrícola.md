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

## Próximos pasos (actualizado 2026-07-27)

Con los bugs agudos de datos/UX de esta semana cerrados, el pilot está en un estado bastante estable. Orden sugerido:

### Ahora (bloqueantes o casi gratis)

1. **`eas build --profile preview` nueva para el APK** — el crash de "Ciclo Campaña" en el standalone instalado sigue sin resolverse de raíz (solo mitigado con Error Boundary) y necesita una build nueva, no alcanza con OTA. Aprovechar esta build para **decidir de una vez el tema Play Store** (ver más abajo) en vez de volver a distribuir un APK suelto.
2. ~~Activar el backup automático~~ — **hecho 2026-07-27**: tarea `LosLirios-PG-Backup` registrada y probada (dump real, copiado a OneDrive). Pendiente menor: el test de restore que pide `BACKUP.md` (necesita un Postgres local levantado).
3. ~~Guard anti doble-tap en `FitosanitarioForm.tsx`~~ — **hecho 2026-07-27**.

### Corto plazo (antes de escalar a más usuarios/fincas)

4. **Reproducir el bug de riego con 2+ válvulas** en el dispositivo (nunca se logró capturar el error real) — ver [[Bugs Conocidos]].
5. **Idempotencia real en el backend** (columna `idempotency_key` + `UniqueConstraint` parcial en los 4 modelos de producción) — diferida desde el 2026-07-23. Hoy la protección contra duplicados es 100% del lado cliente (guards `useRef`); cualquier vector nuevo (dos dispositivos, un retry futuro, un bug) puede volver a duplicar datos sin que el backend lo impida.
6. Completar `TareaForm` **web** (campo `finca` + selector de `Trabajador`) y el equivalente en mobile (`tareas.tsx` solo tiene texto libre para el nombre) — el backend y el modelo `Trabajador` ya existen, falta conectar el frontend.
7. Refresh token (hoy el JWT expira y desloguea sin aviso).
8. Logging estructurado + exception handler genérico en el backend (hoy un 500 no deja rastro propio más allá de lo que capture Railway).

### Roadmap (features nuevas)

9. Costo por kg en dashboard de finanzas.
10. Módulo de notificaciones (base ya existe en `notificaciones.py`).
11. Responsividad mobile del frontend **web** (solo 11/43 componentes con breakpoints) — si algún encargado va a usar el navegador desde el celular en vez de la app.
12. Integraciones Fase 5: Climagro (clima real), bot de WhatsApp (carga de egresos), agente ARCA (boletas), termógrafo IoT.

### En curso: publicar en Google Play Store (track Internal testing)

Decidido y arrancado el 2026-07-27. Checklist completo con lo ya hecho (build de producción lanzado, política de privacidad publicada, assets gráficos generados) y lo pendiente del lado de Fausto (cuenta de developer, ficha de la app, testers): [[Play Store — checklist de publicación]].

## Ver también

- [[Play Store — checklist de publicación]]
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
