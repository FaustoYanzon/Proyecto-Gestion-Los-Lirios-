---
tags: [sistema, finanzas, bugs, deploy]
---

# 2026-07-14 — Fixes de la semana piloto + rediseño de Ingresos

> Contexto: primera semana de prueba piloto en producción. Fausto reportó 7 puntos (bugs + cambios) tras usar la app real. Sesión de trabajo en dos partes: primero diagnóstico y fix de los bugs reportados, después el rediseño de Ingresos que ya se había acordado en una charla previa (Claude Desktop) pero nunca se había aplicado al código real.

---

## Hallazgo raíz #1 — Vercel no auto-despliega en este proyecto

**El bug más importante del día no era de código: era de proceso.** Se aplicaron fixes de auth/z-index, se pusheó a `main`, y el pilot siguió mostrando el bug viejo. Investigando por qué:

- `vercel ls` mostró que el último deploy de producción tenía **4 días** — de antes de cualquier cambio de hoy.
- Railway **sí** auto-despliega en push a `main` (confirmado por logs: corre `alembic upgrade head` solo).
- Vercel **no** tiene el Git integration disparando redeploy automático en este proyecto — hay que correr `vercel --prod` a mano después de cada push que toque `frontend/`.

**Acción:** se corrió `vercel --prod` manualmente y se verificó contra el bundle servido (bajando los chunks JS reales de `frontend-six-jade-79.vercel.app` y buscando el código del fix) que el deploy nuevo sí llegó a producción. **Este paso hay que repetirlo cada vez que se pushee un cambio de frontend.**

Ambos CLIs (`vercel`, `@railway/cli`) están instalados y autenticados en la máquina de Fausto (`npx vercel`, `npx @railway/cli`) — permiten deployar, ver logs y correr comandos con las variables de entorno de cada servicio inyectadas (`railway run --service <nombre> -- <comando>`).

## Hallazgo raíz #2 — Los históricos nunca llegaron a producción

Fausto reportó que no veía el panel "Dirección" (KPIs D1-D4) en Inicio. Se investigó con una consulta de solo lectura contra la base de Railway (`DATABASE_PUBLIC_URL` del servicio Postgres — `DATABASE_URL` es un hostname interno de Railway, no resuelve desde una máquina externa) y se confirmó:

```
presupuestos: 0 filas · registros_cosecha: 0 filas · egresos: 0 filas
registros_trabajo: 0 · registros_riego: 0 · ciclos_campana: 0
```

Solo `parcelas` (36, seed) y `users` (3, creados a mano) tenían datos. La migración de históricos que se corrió en local (ver `scripts/migracion/`) **nunca se aplicó contra producción** — por eso el panel Dirección se ocultaba (su condición es `if (!hayDatos) return null` en `frontend/app/dashboard/page.tsx`, sin mensaje de "sin datos").

**Fix:** se corrió una variante del script (`migrate_excels.py`, adaptada para leer `DATABASE_PUBLIC_URL` en vez de `backend/.env` y **sin** cargar `ingresos.csv` — ver más abajo) contra producción. Resultado, coincide con los totales de control del README original:

- 591 cosechas (4.850.838 kg)
- 144 egresos (ARS 649.478.319)
- 370 líneas de presupuesto

Verificado post-carga: `vw_presupuesto_vs_real` para temporada 2026 devuelve 73 filas → el panel Dirección ya debería mostrarse.

## Bug de auth (F5 / pestaña nueva / sesión que se cierra)

Root cause real (no lo que se pensó en la charla de Claude Desktop): `frontend/app/providers.tsx` — el que realmente usa la app — **nunca llamaba a `initAuth()`**. Existía una copia vieja en `components/providers.tsx` con la lógica correcta pero huérfana (nadie la importaba). Sin `initAuth()`, el store de Zustand quedaba en `{user: null, isLoading: true}` para siempre en cada F5/pestaña nueva.

Fix aplicado (commit `0cbf98f`):
- `app/providers.tsx` ahora llama `initAuth()` una vez al montar.
- `frontend/app/dashboard/layout.tsx` agrega guard: spinner mientras `isLoading`, `router.replace('/login')` si `!isLoading && !user`. Antes no había ningún guard — por eso se veía la sidebar a medias con el badge de usuario en "?".
- `components/providers.tsx` quedó como re-export del archivo real, para no volver a tener dos versiones divergentes.

## Fix de z-index (filtros de Finca/Campaña tapados por el mapa)

`FincaSwitcher`/`CampanaSwitcher` estaban en `z-50` (Tailwind), Leaflet usa panes internos `z-[200-700]`. Subidos a `z-[1000]`. Commit `0cbf98f`.

## Rediseño de Ingresos → modelo "BD COBROS"

Acordado en la charla previa de Claude Desktop, aplicado hoy. El modelo viejo era literalmente venta-de-uva-por-kilo (`cliente`/`producto`/`variedad`/`kg_totales`/`precio_por_kg`). Reemplazado por un libro general de cobros calcado de la planilla BD COBROS de Fausto:

`destino` (enum: uva_mesa/bodega/pasa/alfalfa/cebolla/sandia/alquiler/otro) · `comprador` (texto libre) · `forma_pago` (enum, ahora incluye `echeque`) · `estado` · `cuenta_destino` · `banco`/`n_cheque`/`f_pago`/`uso_cheque` (cheques) · `monto`/`moneda`/`tipo_cambio` · `origen`/`finca`/`descripcion`.

**Los 259 registros viejos se descartaron** (decisión explícita de Fausto — no se migraron). Migración `c1d3f7a9e2b4` dropea y recrea la tabla `ingresos`; actualiza también `vw_kpi_comprador` (leía `ingresos.cliente`, ahora lee `comprador`).

**Nueva pantalla:** `/dashboard/finanzas/cheques` — cheques cobrados con `uso_cheque` editable inline (NULL/vacío = disponible).

### Follow-up del mismo día: `estado` y `cuenta_destino`

Quedaron como texto libre en el primer pase por falta de certeza. Fausto confirmó los valores reales:

- **`estado`** → enum cerrado `EstadoIngreso`: `no_registrado` (NR, "en negro") / `facturado` (FACT). Migración `f8a6e10ed72e` convierte la columna in-place (mapeo defensivo de texto legado a los nuevos valores, `NULL` si no matchea nada).
- **`cuenta_destino`** → sigue siendo texto libre en la base (no se cerró a enum), pero el formulario ahora ofrece un combobox: las 6 cuentas conocidas (CAJA, BSJ, MP CAMILO, GM, GALICIA NICO, NARANJA NICO) + cualquier valor ya usado por cualquier usuario, vía `GET /finanzas/ingresos/cuentas-destino` (distinct sobre la columna + seed). Opción "+ Agregar nueva..." con un `<input>` condicional (mismo patrón sentinel-value que ya existía en `TareaForm.tsx` para "+ Nueva tarea..."). Sin tabla de lookup aparte: un valor nuevo queda disponible para todos apenas se guarda el primer Ingreso que lo usa.

Commit `604664b`.

## Bug encontrado de paso (no reportado por Fausto)

`frontend/lib/api/flujo.ts` seguía leyendo `ing.cliente` (campo eliminado del modelo nuevo) — rompía `npm run build`. Corregido a `ing.comprador` antes del primer deploy del día.

## Segunda tanda del mismo día — refuerzos de robustez + UI de Inicio

Cambios locales (hechos en una sesión previa de Claude Desktop directamente sobre el filesystem real, aplicados/commiteados/deployados en esta sesión de Claude Code — mismo patrón que el resto del día: primero se revisó el diff completo, se corrió `tsc`/`npm run build`/import de backend, y recién ahí se commiteó).

**Backend — registro de modelos, único punto de verdad.** `backend/app/core/migrations/env.py` importaba los modelos uno por uno (`app.models.user`, `app.models.parcela`, ...) y se había ido desactualizando — le faltaban `presupuesto` y `push_token`, lo que hacía que `alembic revision --autogenerate` propusiera `DROP TABLE` para esas tablas si alguien corría un autogenerate sin darse cuenta. Ahora `env.py`, `core/seed.py`, `api/seed_cosecha.py` y `api/seed_parcelas.py` importan todos `app.models` (el agregador) en vez de módulos sueltos — un solo lugar que mantener sincronizado. Resuelve el "pendiente" que había quedado abierto en [[Bugs Conocidos]] sobre `Trabajador` faltante en el agregador.

**Backup de Postgres apunta a producción.** `scripts/backup_postgres.ps1` y `scripts/BACKUP.md` reescritos: por default ahora hace `pg_dump` de la base de **Railway** (vía `DATABASE_PUBLIC_URL`, no `DATABASE_URL` — ese es el hostname interno de Railway y no resuelve desde afuera), con `-UrlKey DATABASE_URL -Label local` como opción para seguir respaldando la base local si hace falta. Nombres de archivo con label (`los_lirios_prod_*.dump` / `los_lirios_local_*.dump`), y el restore test de la guía ahora valida contra los totales conocidos post-migración (591 cosechas / 144 egresos / 370 presupuestos).

⚠️ **Pendiente — requiere que Fausto lo haga a mano:** agregar `DATABASE_PUBLIC_URL=postgresql://postgres:<pass>@nozomi.proxy.rlwy.net:52538/railway` (valor real en Railway → servicio Postgres → Variables) a `backend/.env`, y después correr `install_backup_task.ps1` + `Start-ScheduledTask -TaskName 'LosLirios-PG-Backup'` para probarlo. Claude Code tiene prohibido explícitamente leer o modificar `backend/.env` (instrucción del propio `CLAUDE.md` del repo), así que este paso puntual no se ejecutó.

**UI de Inicio simplificada.** `frontend/app/dashboard/page.tsx`: se sacaron las dos tarjetas KPI de "Jornales este mes" y "Egresos ARS este mes" (quedan Dirección/D1, mapa compacto, clima, alertas/fenología) y el mapa se achicó (`gridTemplateColumns` de `2.2fr 1fr` a `1.6fr 1fr`, alto máx. 380px). Menos ruido en la pantalla que más se usa a diario.

**Error/loading boundaries + logos reales.** Nuevos `frontend/app/dashboard/error.tsx` (boundary a nivel de segmento — una pantalla rota ya no tira abajo toda la sidebar) y `dashboard/loading.tsx` (skeleton en vez de spinner). Resuelve el riesgo que estaba listado en [[Bugs Conocidos]] ("Sin error.tsx/loading.tsx"). `frontend/public/logo.svg`, `logo-mark.svg` y `frontend/app/favicon.ico` pasan de placeholder al logo real de Los Lirios.

Commits: `6c014a8` (backend + backup), `07f4127` (frontend). Desplegado: Railway auto (confirmado por logs, sin migración nueva esta vez), Vercel manual (`vercel --prod`, mismo paso obligatorio de siempre en este proyecto).

## Ver también

- [[Bugs Conocidos]]
- [[Arquitectura]]
- [[Stack Técnico]]
- [[Sistema de Gestión Agrícola]]
- [[2026-07-11-deploy-piloto-completado]]
