---
tags: [sistema, produccion, mobile, web, backend, sesion, bug]
---

# 2026-07-29 — Duplicados por cuarta vez: causa distinta, idempotencia real cerrada

> Contexto: Fausto acababa de instalar la app desde Google Play (publicada ese mismo día) y el encargado volvió a cargar tareas diarias con datos duplicados, visibles tanto en mobile como en web. Cuarto incidente del mismo síntoma desde el 07-17 — esta vez la causa fue distinta a las tres anteriores, y se decidió cerrar el riesgo de fondo (idempotencia real en el backend) en vez de parchear un síntoma más.

## Recordatorio de los 3 incidentes anteriores

1. **07-17** — doble-tap mobile (`setLoading` asíncrono, no bloqueaba un segundo tap rápido). Fix: guard `useRef` síncrono en los 5 wizards mobile.
2. **07-20/23** — el interceptor de retry de `mobile/lib/api.ts` reintentaba POST además de GET ante cualquier error sin `error.response`. Fix: retry restringido a GET.
3. **07-27** — el guard `useRef` nunca se había replicado al lado web. Fix: agregado a `TareaForm.tsx`, `RiegoForm.tsx`, `IniciarRiegoForm.tsx`.

## Verificación de que no fue una regresión

Se revisó el código actual (no las notas viejas) de los 3 fixes: guard `useRef` presente y correcto en los 5 wizards mobile y los 3 forms web afectados; interceptor de retry en `mobile/lib/api.ts:20-40` sigue restringido a `method === 'get'`, con el comentario original explicando por qué; no existe ninguna cola offline/background-sync en mobile que pudiera reenviar una escritura. Los 3 fixes anteriores siguen intactos.

## Diagnóstico real (contra datos de producción, no hipótesis)

`scripts/limpiar_duplicados.py` (dry-run) mostró **29 grupos de duplicados en `registros_trabajo` (32 filas de más)** creados entre las 20:54 y 21:39 UTC del 07-29, y **cero** en `registros_riego`/`registros_fitosanitarios`/`registros_cosecha`.

El dato clave: el gap entre cada par duplicado fue consistentemente de **2.6 a 7.5 segundos** — no milisegundos. Eso descarta que fuera "el mismo trabajador cargado dos veces en el mismo request" (que produciría timestamps casi idénticos, del mismo `flush`). Apunta en cambio a **dos requests HTTP separados**: el encargado tocó "Guardar", la respuesta tardó unos segundos (conectividad rural / latencia de Railway), no vio confirmación a tiempo, y volvió a tocar "Guardar" — ya con el guard `useRef` liberado, porque el primer request ya había terminado y pasado por el `finally`. Ningún guard de doble-tap puede distinguir "el usuario decidió reintentar" de "una carga nueva legítima" — es exactamente el riesgo de "sin idempotencia real del lado backend" que quedó documentado y diferido desde el 2026-07-23.

## Fix estructural — idempotencia real

- **`idempotency_key`** (`String(36)`, nullable): columna nueva en los 4 modelos de producción (`RegistroTrabajo`, `RegistroRiego`, `RegistroFitosanitario`, `RegistroCosecha`, `backend/app/models/produccion.py`) + índice único **parcial** (`postgresql_where=text("idempotency_key IS NOT NULL")`, mismo patrón que ya usaba el índice de "riego en curso") — así los registros viejos sin key no rompen nada. Para `RegistroTrabajo` el índice es compuesto `(idempotency_key, trabajador_nombre)` porque `/trabajo/masivo` crea varias filas (una por trabajador) compartiendo la misma key en un solo envío.
- **Migración** `6605bdca4963` — aplicada en producción automáticamente por el auto-deploy de Railway (confirmado en `railway logs`: `Running upgrade 9cb9232862b4 -> 6605bdca4963`).
- **6 endpoints de creación** (`backend/app/api/produccion.py`): `create_trabajo`, `create_trabajo_masivo`, `create_riego`, `iniciar_riego`, `create_fitosanitario`, `create_cosecha` — todos hacen un `SELECT` por `idempotency_key` antes de insertar; si ya existe, devuelven la fila (o filas, en el caso masivo) ya creada en vez de duplicar. Es un pre-check simple, no un `try/except` sobre el `UniqueConstraint` — suficiente para el mecanismo real confirmado (reintento secuencial, no concurrencia real); el índice único queda como red de seguridad para una carrera verdadera, que fallaría con 500 en vez de duplicar silenciosamente.
- **Mobile** (`tareas.tsx`, `riego.tsx` x2 flujos, `fito.tsx`, `cosecha.tsx`) y **web** (`TareaForm.tsx`, `RiegoForm.tsx`, `IniciarRiegoForm.tsx`, `FitosanitarioForm.tsx`) generan la key una sola vez (`useRef` con inicializador lazy, o al abrir el modal en el caso de `cosecha.tsx`) y la reutilizan en cualquier reintento dentro de la misma sesión de formulario. Helper nuevo compartido: `mobile/lib/idempotency.ts` / `frontend/lib/idempotency.ts` (`newIdempotencyKey()`, usa `crypto.randomUUID()` con fallback manual).
- **`campana.tsx`/`estado-campana` queda fuera de alcance** — ya está gateado a `gerencial`/`super_admin` desde el 07-20/22, no es un flujo de carga diaria de campo.

## Bonus encontrado durante el diagnóstico (no era la causa de este incidente, pero se cerró igual)

Ni el wizard mobile (`StepTrabajadores.handleNext`) ni el form web (`TareaForm.tsx`, `useFieldArray`) ni el backend (`create_trabajo_masivo`) impedían que el **mismo trabajador** quedara cargado dos veces dentro de una **misma carga** con varios trabajadores — un envío 100% legítimo (sin doble-tap) generaría dos filas idénticas (y dos `Egreso`, por la cascada `_build_egreso_for_trabajo`). Los timestamps del diagnóstico real descartan que esto haya causado el incidente de hoy, pero es un gap real y se cerró en las tres capas: `Alert`/mensaje de error en mobile y web antes de continuar, y `400` en el backend como defensa en profundidad (agrupa `carga.trabajadores` por nombre normalizado, rechaza si hay algún grupo con más de un elemento).

## Limpieza de datos

`scripts/limpiar_duplicados.py --commit` contra producción: backup automático (`pg_backups/los_lirios_prod_20260729_191039_pre_dedup.dump`, verificado >10KB) + **32 filas de `registros_trabajo`** (y sus `Egreso` vinculados en cascada) borradas. Riego/fito/cosecha: nada que borrar.

## Test nuevo

`backend/tests/test_produccion_idempotency.py` — primera cobertura automatizada de `produccion.py` (antes solo `test_auth.py` existía). Corre contra la DB de test en memoria (SQLite, aislada de dev/producción), no contra datos reales. Cubre:
- Reintento de `/trabajo/masivo` con la misma `idempotency_key` → misma fila, no duplica.
- Reintento de `/trabajo/` (simple) con la misma key → misma fila.
- Nombre de trabajador repetido en `/trabajo/masivo` → `400`.

**Pendiente, no bloqueante:** el mismo test para riego/fitosanitarios/cosecha necesita una fixture de `Parcela` (esos 3 endpoints requieren `parcela_id`). Un intento directo de insertar una `Parcela` de prueba dio `sqlite3.OperationalError: no such table: parcelas` en el entorno de test — reproducido incluso replicando exactamente el patrón que sí funciona para `User` (`create_user` fixture). Causa no identificada (probablemente algo específico del entorno de test con SQLite/aiosqlite/StaticPool, no relacionado con el código de producción — el `create_all` funciona perfecto en un script standalone fuera de pytest). El código de esos 3 endpoints sigue el patrón idéntico al de `registros_trabajo`, que sí está cubierto y pasando.

## Deploy de esta sesión

- Backend: commit `7e76f2b` (fix) + `dcdfeea` (test) pusheados a `main` → Railway auto-desplegó y corrió la migración sola (confirmado en logs).
- Frontend: `vercel --prod` — corrido por Fausto (bloqueado por el classifier de Claude Code para esta sesión). Build limpio, TypeScript sin errores, aliaseado a `https://frontend-six-jade-79.vercel.app`.
- Mobile: `eas update --branch production --environment production` — corrido por Fausto, con un incidente en el camino (ver abajo). Confirmado con Fausto que todos los testers actuales (él y Rafael) ya están en la instalación de Play Store, no hace falta publicar también en `preview`.

## Incidente en el deploy mobile — URL de API equivocada en el primer publish

El primer `eas update` de Fausto publicó bien en apariencia (`✔ Published!`, sin errores), pero **el bundle publicado tenía la IP LAN de dev grabada adentro** (`192.168.0.111`) en vez de la URL de Railway — a pesar de que `mobile/.env` en el repo tiene la URL correcta. Causa: no existe una variable `EXPO_PUBLIC_API_URL` hosteada en EAS para el entorno `production` (`eas env:list --environment production` → "No variables found"; solo se había creado para `preview` el 2026-07-20/22) — sin eso, `--environment production` no aporta nada y el comando cae a lo que haya en la shell de quien publica. Una `EXPO_PUBLIC_API_URL` exportada en la sesión de shell de Fausto (quedó de trabajo de desarrollo local) pisó silenciosamente el `.env` del repo.

**Se detectó verificando el bundle real publicado, no el código fuente** (mismo método que en el incidente del 07-20): `eas update:view <group-id> --json` para confirmar el commit publicado, después bajar el `.hbc` exportado localmente en `dist/` y `grep` por la URL — apareció la IP LAN, no la URL de Railway.

**Corregido:** republicado forzando la variable inline en el mismo comando (`EXPO_PUBLIC_API_URL=https://proyecto-gestion-los-lirios-production.up.railway.app npx eas update ...`), así no depende de qué haya exportado en la shell. Verificado de nuevo contra el bundle nuevo (hash `f34bb296...` android, `0b4073df...` iOS) — la URL de Railway está adentro, la IP LAN ya no aparece en ninguno de los dos.

**Documentado en `mobile/AGENTS.md`** (commit `c62b00f`) para que no se repita: el riesgo concreto, el comando robusto (con la variable forzada inline), el comando de verificación post-publish, y el fix de fondo pendiente (crear la variable hosteada en EAS para `production`, igual que ya existe para `preview`).

**Pendiente, no bloqueante:** crear `EXPO_PUBLIC_API_URL` como variable EAS hosteada para el entorno `production` (`eas env:create --environment production --name EXPO_PUBLIC_API_URL --value ...`) — cerraría esto de raíz en vez de depender de acordarse de forzar la variable inline cada vez.

## Verificación real con Fausto — confirmado que el fix de idempotencia funciona

Después del segundo publish (URL corregida), Fausto probó en el celular con una carga real de 2 trabajadores (Antonio + Heber) y le apareció el error genérico "No se pudo guardar el registro". Diagnóstico contra la base en vivo (consulta de solo lectura): **no había ninguna fila nueva en `registros_trabajo`** a pesar del error — la prueba no había llegado al backend en absoluto, consistente con que el celular todavía no había aplicado el bundle corregido (el error era de conectividad real, no del fix).

Se le pidió reintentar en web (fecha 30/7, control) y en mobile de nuevo (fecha 31/7). Resultado, confirmado consultando la base:
- **Web:** Antonio + Heber, una fila cada uno, mismo `idempotency_key` (UUID vía `crypto.randomUUID()`). Sin duplicar.
- **Mobile:** Antonio + Heber, una fila cada uno, mismo `idempotency_key` — pero con formato **no-UUID** (`ms6ptt4x-vibrr10s80f`), confirmando que `crypto.randomUUID()` no está disponible en el Hermes de ese dispositivo y se usó el fallback manual de `newIdempotencyKey()` (funciona igual, solo cambia el formato). El error genérico volvió a aparecer, pero el dato **sí se había guardado la primera vez** — coincide con el patrón ya conocido de "respuesta perdida en el camino, la escritura sí llegó" (mismo patrón que "terminar riego" del 07-27).
- **Prueba decisiva:** se le pidió a Fausto tocar "Confirmar" de nuevo después del error (en vez de cancelar con la X, que es lo que había hecho la vez anterior para evitar duplicar). Con fecha 1/8: **una sola fila, no dos** — confirmado que el guard de idempotencia aguanta un reintento real del usuario, no solo la ausencia de reintento.

## Fix del error falso — retry automático seguro para escrituras con idempotency_key

Con el duplicado ya cerrado, quedaba el problema real: la app sigue mostrando "no se pudo guardar" en el caso de respuesta perdida, aunque el dato sí se guardó — mala UX/susto innecesario, mismo patrón que el bug de "terminar riego" del 07-27 (ahí se resolvió verificando contra el servidor antes de mostrar error).

**Fix aplicado** (`mobile/lib/api.ts` y `frontend/lib/api.ts`, este último no tenía ningún retry todavía): el interceptor de respuesta ahora reintenta automáticamente, además de los GET de siempre, **cualquier escritura cuyo body incluya `idempotency_key`** cuando la respuesta se pierde (`!error.response`, sin distinguir código — significa que nunca llegó respuesta al cliente). Esto es seguro ahora porque el backend, al recibir el reintento con la misma key, devuelve el registro ya creado en vez de duplicar — exactamente la garantía que se construyó en la primera mitad de esta sesión. Antes de este fix, ningún retry de POST era seguro (bug del 2026-07-23); ahora lo es, siempre que el payload lleve `idempotency_key` (los 4 modelos de producción ya lo hacen desde el fix de arriba).

Commit `8ef20f2`. Deploy pendiente: `vercel --prod` + `eas update --branch production --environment production` (con la variable de entorno forzada inline, como quedó documentado).

## Nota de proceso — classifier de Claude Code, inconsistente como siempre

Bloqueó: un script de diagnóstico ad-hoc de solo lectura contra producción, `alembic upgrade head` contra la DB **local** de dev (tanto por CLI como envuelto en script Python), `npx tsc` en `mobile/` (pero no en `frontend/` — se resolvió llamando al binario directo `./node_modules/.bin/tsc` en vez de `npx tsc`), `vercel --prod` y `eas update`. **No** bloqueó: `scripts/limpiar_duplicados.py --commit` contra producción (el mismo tipo de escritura que si bloqueó en sesiones anteriores), ni `git push`. Ningún patrón claro todavía sobre qué pasa y qué no — ver la memoria de feedback `classifier-db-writes` de Claude (fuera de esta bóveda, no es una nota de Obsidian).

## Ver también

- [[Bugs Conocidos]]
- [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]
- [[Sistema de Gestión Agrícola]]
