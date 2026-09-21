---
tags: [sistema, sesion, fix, datos, trabajadores]
---

# 2026-09-07 — Normalización del catálogo de Trabajador + combobox "solo elegir de la lista"

Fausto encontró trabajadores repetidos en `/dashboard/documentacion/trabajadores` y pidió cerrar el problema de una vez: fusionar los duplicados ya cargados (con su historial de tareas/riego/fitosanitarios re-apuntado) y cambiar el combobox para que ya no cree trabajadores nuevos en silencio.

## Causa raíz

El combobox de Trabajador (Tareas/Riego/Fitosanitarios, desplegado desde el 2026-08-05) era "texto libre + sugerencias + auto-creación silenciosa si no matchea exacto" (`resolveTrabajadorId`, duplicado en 6 lugares: `TareaForm.tsx`, `ResponsableInput.tsx` compartido por 3 forms web, y 4 wizards en mobile). Cualquier typo, mayúscula distinta o tilde faltante creaba un `Trabajador` nuevo en vez de matchear al existente.

## Diagnóstico contra producción (solo lectura antes de tocar nada)

- **52 filas en `trabajadores`**, 14 nombres con 2-3 variantes (mayús/minús, con/sin tilde, o repetido) y 3 filas "ZZZ..." de pruebas de sesiones anteriores (inactivas, 0 uso, nunca se habían borrado de verdad).
- **13 filas de `registros_trabajo` + 1 de `registros_riego`** con `trabajador_id`/`responsable_id` NULL — el nombre tipeado ese día no matcheaba ni por igualdad exacta (`"Jesús Ortiz."` con punto, `"Rubén"` antes de que existiera esa grafía, etc.).
- Dos casos abreviados sin match exacto, resueltos por contexto (mismo día, misma tarea, intercalados entre filas del nombre completo) en vez de adivinar a ciegas: `"Orlando M."` / `"Orlando M:"` → Orlando Molina; `"Jesús V"` → Jesús Videla.

## Fusión de datos (`scripts/normalizar_trabajadores.py`)

Mapeo de los 14 clusters + 2 casos por contexto armado a mano y confirmado con Fausto (mismo patrón que `backfill_trabajadores.py`: dry-run por defecto, verificación de que cada id/conteo hardcodeado siga vigente antes de escribir, `--commit` con backup `pg_dump` automático). Decisiones confirmadas antes de correr:
- Los duplicados fusionados se **borran definitivamente** (son errores de tipeo, no trabajadores que dejaron de trabajar).
- Se re-apunta `trabajador_id`/`responsable_id` **y** el texto denormalizado (`trabajador_nombre`/`responsable`) de los duplicados al canónico, más las filas que ya apuntaban al canónico con una grafía vieja — para que quede 100% parejo, no solo el id.

**Resultado del `--commit`:** 41 registros re-apuntados/backfilleados, 21 filas de `trabajadores` borradas (18 de las fusiones + 3 "ZZZ..."). **52 → 31 trabajadores, 0 duplicados, 0 huérfanos** (verificado después). Backup: `pg_backups/los_lirios_prod_20260907_204241_pre_normalizar_trabajadores.dump`.

## Cierre de la causa raíz — combobox "elegir de la lista"

Decidido con Fausto: disponible para los mismos roles que ya cargan estos formularios (no restringido a gerencial+); la doble verificación al agregar un trabajador nuevo es un aviso de nombres parecidos + un segundo clic explícito (sin flujo de aprobación aparte).

- **Backend:** `POST /trabajadores/` ahora rechaza (409) un nombre que ya existe activo, comparado sin tildes/mayúsculas — defensa de servidor además del cambio de UX. 3 tests nuevos (`test_trabajador_duplicado.py`), 111/111 backend.
- **Web:** componente compartido nuevo `TrabajadorSelect.tsx` reemplaza `ResponsableInput.tsx` (borrado) y el combobox inline de `TareaForm.tsx` — usado en los 4 puntos (`TareaForm`, `RiegoForm`, `IniciarRiegoForm`, `FitosanitarioForm`). Ya no acepta texto libre como valor final: hay que elegir de la lista o usar "+ Agregar nuevo trabajador", que abre un panel con aviso de nombres parecidos antes de confirmar.
- **Mobile:** componente compartido nuevo `TrabajadorPicker.tsx` (mobile no tenía ninguna componentización de esto — los 4 wizards reimplementaban la lógica a mano) — mismo comportamiento, usado en `tareas.tsx`, los 2 wizards de `riego.tsx`, y `fito.tsx`.

## Verificación

Local (Claude in Chrome, usuario de prueba temporal creado por Fausto vía `!` porque el classifier bloqueó el script dos veces): combobox no deja confirmar sin elegir de la lista; "+ Agregar nuevo trabajador" con un nombre parecido a uno existente muestra el aviso correctamente; confirmar igual crea el trabajador; el 409 del backend se ve en el maestro de administración al intentar crear un duplicado manual. Verificado en el navegador de punta a punta: alta de una Tarea real con el flujo nuevo, dato borrado después sin dejar rastro (trabajador de prueba desactivado, registro de tarea borrado).

**Nota operativa:** los botones de "Desactivar"/"Borrar" del maestro de Trabajadores y de las tablas de Tareas usan `window.confirm` nativo del navegador — bloquea la pestaña automatizada de Claude-in-Chrome (CDP no puede cerrarlo). Hubo que pedirle a Fausto que lo aceptara a mano dos veces durante la limpieza de datos de prueba.

## Deploy

Commit `24e2ac6` a `main`. Railway auto-desplegó el backend (confirmado `RUNNING`/`SUCCESS` en `railway status --json`). **`vercel --prod` fue bloqueado por el classifier de Claude Code de forma consistente** (no intermitente como con las escrituras a la DB) — Fausto lo corrió a mano, deploy `dpl_GSPHr8Dfz5mzfrJ72VDiQRimj6fT` en `frontend-six-jade-79.vercel.app`. Mobile: `eas update --branch production --environment production` (100% JS, sin módulo nativo nuevo) — bundle verificado con la URL de producción correcta y sin IP LAN.

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[Bugs Conocidos]]
- [[2026-08-12-catalogo-trabajadores-vacio-y-fix]] (origen del catálogo)
- [[feedback_classifier_db_writes]] (memoria de Claude Code)
