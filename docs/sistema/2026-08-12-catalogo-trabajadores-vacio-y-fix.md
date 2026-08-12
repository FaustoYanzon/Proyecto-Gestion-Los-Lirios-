---
tags: [sistema, sesion, bug]
---

# 2026-08-12 — Catálogo de Trabajador vacío en producción: diagnóstico, backfill, maestro y auditoría

Cuarta tanda del día. Fausto reportó que el combobox de responsable (recién extendido a Riego/Fitosanitarios) no mostraba sugerencias ni para nombres ya cargados en Tareas.

## Diagnóstico

Con Claude in Chrome logueado como Fausto en producción, se probó el flujo real: escribir un nombre ya usado ("Orlando") no traía sugerencias. Se leyó `GET /trabajadores/` directo desde la consola del navegador (con el token real de la sesión, sin exponerlo) — **la tabla `trabajadores` estaba completamente vacía** (0 filas, activas o no), pese a que el combobox de Tareas está desplegado desde el 2026-08-05.

Se probó el flujo de creación real vía `POST /trabajadores/` (con el mismo token) — funcionó perfecto (201, `is_active: true`). Se creó una Tarea de prueba real en la UI ("ZZZ Test Diagnostico Claude") — el `trabajador_id` quedó vinculado correctamente. **Conclusión: el combobox funciona bien hoy.** El problema es que la tabla nunca se sembró: de 106 `registros_trabajo` en producción (16/07 al 12/08), solo el registro de prueba de hoy tenía `trabajador_id` no nulo — el resto (105), incluidos todos los del 05/08 y 06/08 (el mismo día que se lanzó la feature), tienen `trabajador_id = NULL`. La causa exacta de por qué falló la primera vez no se pudo determinar con certeza (posible ventana de deploy, o que nadie volvió a cargar una Tarea nueva entre el 06/08 y hoy para volver a ejercitar el flujo) — no es relevante para el fix, que es retroactivo.

Los datos de prueba (Trabajador + Tarea + Egreso vinculado) se borraron sin dejar rastro antes de seguir.

## Fix: backfill retroactivo

`scripts/backfill_trabajadores.py` (mismo patrón que `poblar_coordenadas_parcelas.py`: dry-run + `--commit`, backup `pg_dump` propio antes de escribir):
- Junta nombres únicos (case-insensitive, normalizando un punto final suelto tipo "Oscar Carrizo." vs "Oscar Carrizo") de `registros_trabajo.trabajador_nombre`, `registros_riego.responsable` y `registros_fitosanitarios.responsable` donde el `*_id` todavía es NULL.
- Crea un `Trabajador` por cada nombre nuevo (rol `obrero` por defecto, mismo default que el endpoint).
- Vincula (UPDATE) todos los registros existentes que matcheen.
- Dry-run: 28 nombres únicos → 28 Trabajador nuevos, 109 registros a vincular (105 tareas + 3 riegos + 1 fitosanitario). Casos ambiguos como "Oscar" vs "Oscar Carrizo" o "Lucas" vs "Lucas Mercado" se dejaron **sin fusionar** a propósito (no hay forma de saber con certeza si son la misma persona) — quedan como dos entradas del catálogo, fusionables a mano después desde el maestro si corresponde.
- Bloqueado por el classifier al intentar `--commit` (mismo patrón de siempre con escrituras a producción) — corrido por Fausto con `!` en el chat. **Resultado real:** 28 Trabajadores creados, 109 registros vinculados, backup `los_lirios_prod_20260812_175642_pre_backfill_trabajadores.dump` (94,785 bytes). Verificado con un dry-run posterior: 0 registros sin vincular en los 3 módulos.

## Maestro de Trabajadores (nuevo, Admin)

`/dashboard/admin/trabajadores` — mismo patrón que `admin/parcelas` (tabla + modal crear/editar, filtro activos/todos, desactivar es soft-delete con botón de reactivar). Sin cambios de backend: los endpoints de `trabajadores.py` (list/get/create/update/delete/historial) ya estaban completos desde el 08-05, solo nunca tuvieron una UI de administración — únicamente se usaban desde el combobox. Agregado al nav de Admin y al Command Palette.

## KPI "Trabajadores activos"

Tarjeta nueva en el dashboard de Mano de Obra (`GET /trabajadores/?is_active=true`, mismo query que ya usa el combobox — sin endpoint nuevo).

## Auditoría de integridad de datos (pedida por Fausto)

Pregunta: ¿hay otros casos donde datos capturados en la UI no terminan guardados/vinculados en la tabla correcta, como pasó con Trabajador? Se grepeó todo `app/models/*.py` buscando el patrón "columna de texto denormalizada + FK opcional hermana" (el patrón exacto que falló). **Resultado: es el único caso en todo el esquema** — `RegistroTrabajo.trabajador_id`, `RegistroRiego.responsable_id`, `RegistroFitosanitario.responsable_id` (los tres del mismo linaje, la extensión de hoy). Todo lo demás es:
- FKs obligatorias (`parcela_id` cuando es requerido, `created_by`, `user_id`) — Postgres rechaza el insert si faltan, no pueden quedar "en el aire" silenciosamente.
- Campos de texto libre por diseño, sin catálogo detrás (`comprador`, `cuadrilla`, `acarreo` en `RegistroCosecha`; `comprador` en Ingresos, decisión explícita de la sesión del 07-14) — no es que deberían estar vinculados y no lo están, simplemente nunca hubo una entidad catálogo para ellos.
- La cola offline de mobile (7 días de reintento, después queda `failed` — no se borra silenciosamente, es un límite ya documentado y revisado en sesiones previas).

No se encontró ningún otro gap del mismo tipo.

## Deploy

Commit `aaa2c33` (maestro + KPI + script), pusheado. `vercel --prod` corrido — pantalla y KPI en producción. **Pendiente que corra Fausto:** el `--commit` del backfill vía `!` en el chat.

## Ver también

- [[2026-08-12-combobox-responsable-riego-fito]]
- [[Sistema de Gestión Agrícola]]
