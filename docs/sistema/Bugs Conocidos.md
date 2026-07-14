---
tags: [sistema, bugs]
---

# Bugs Conocidos

> Última revisión: 2026-07-14 (primeros bugs reales de la semana piloto, ver [[2026-07-14-finanzas-ingresos-y-fixes-piloto]])

---

## 🔴 Abiertos — relevantes para el deploy de prueba

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
- **Sin `error.tsx`/`loading.tsx`/error boundaries** en el frontend (`app/` completo): una excepción no controlada en un render cae en la pantalla de error genérica de Next sin opción de reintentar.
- **Sin refresh token**: al expirar el JWT, el usuario es deslogueado abruptamente sin aviso previo (`lib/api.ts`, interceptor 401).
- **Lint del frontend no pasa**: 14 errores, todos el mismo patrón (`setState` síncrono dentro de `useEffect` al resetear paginación en `TareasTable.tsx`, `RiegoTable.tsx`, `FitosanitariosTable.tsx`). No rompe runtime.
- **Responsividad mobile del frontend web limitada**: solo 11 de 43 componentes usan breakpoints; el layout de dashboard es desktop-first. Si algún encargado prueba desde el celular en el navegador (no la app), la experiencia va a ser mala.
- **Dashboard finanzas sin costo por kg** todavía.
- **Lockfiles pueden desincronizarse silenciosamente**: `npm install` local resuelve conflictos de peer dependencies con solo un warning, pero `npm ci` (usado en CI/EAS Build) los rechaza en seco. Antes de cualquier deploy que dependa de un lockfile, correr `rm -rf node_modules && npm ci` localmente para detectar el problema antes que el servidor de build.

---

## ✅ Resueltos

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
- `app/models/__init__.py` (agregador "importar todos los modelos") no incluía `Trabajador`/`RolTrabajador`, aunque sí estaba en `backend/app/core/migrations/env.py` — las dos listas deberían coincidir. Rompía scripts standalone (`seed.py`, `seed_parcelas.py`) con `InvalidRequestError` al resolver `RegistroTrabajo.trabajador`; la app viva no se veía afectada porque `main.py` importa el router `trabajadores` directamente. Resuelto, commit `a8dea55`. Pendiente: revisar si otro modelo nuevo puede quedar afuera del mismo modo.
- `mobile/package-lock.json` desincronizado + conflicto de peer dependency `react-dom`/`react` (`react-dom@19.2.7` exige `react@^19.2.7`, proyecto fija `react@19.1.0`) — resuelto con `"overrides": {"react-dom": "19.1.0"}` en `mobile/package.json`, commits `f47c213` y `2844b35`.

---

## Ver también

- [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]
- [[2026-07-11-deploy-piloto-completado]]
- [[Arquitectura]]
- [[Dashboards]]
- [[Checklist Deploy de Prueba (Semana Piloto)]]
