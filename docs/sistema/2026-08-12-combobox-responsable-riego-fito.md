---
tags: [sistema, sesion]
---

# 2026-08-12 — Combobox de Trabajador extendido a Riego y Fitosanitarios

Tercera tanda del día. Fausto pidió confirmar el estado de la "unificación de
nombres" (el combobox de Trabajador) — no era un caso de "mobile sí, web no"
como se sospechaba: el combobox de Tareas (2026-08-05) ya estaba 100%
unificado entre mobile y web. El gap real, descubierto al revisar el código
de las 4 plataformas × 2 módulos, era otro: el campo `responsable` de **Riego**
y **Fitosanitarios** seguía siendo texto libre en ambas plataformas por
igual, sin `trabajador_id`, sin sugerencias, sin protección contra
duplicados tipo "Juan Perez" vs "juan perez".

## Decisión

Extender el mismo patrón (sugerencias contra el catálogo + auto-creación si
no matchea + dedupe case-insensitive) a Riego (crear e iniciar) y
Fitosanitarios, mobile y web por igual.

## Implementado

**Backend:** columna `responsable_id` (FK nullable a `trabajadores.id`) en
`RegistroRiego` y `RegistroFitosanitario` — mismo patrón que
`RegistroTrabajo.trabajador_id`. Migración aditiva `32b5a004492a`. Helper
`_resolve_responsable_nombre` en `produccion.py` (valida el id, sincroniza
`responsable` con el nombre real del Trabajador vinculado) usado en
`create_riego`, `iniciar_riego` y `create_fitosanitario` — los endpoints de
`update` no necesitaron cambios de lógica porque ya aceptaban cualquier
campo del schema sin resolución server-side (mismo comportamiento que
`update_trabajo` desde siempre). 3 tests nuevos
(`test_produccion_responsable.py`): sincronización de nombre al vincular,
404 si el id no existe, mismo caso para fitosanitarios. 47/47 tests backend
pasando.

**Web:** componente nuevo `ResponsableInput.tsx` (dropdown de sugerencias) +
helper compartido `resolveTrabajadorId` en `lib/api/trabajadores.ts`,
aplicados a `RiegoForm.tsx`, `IniciarRiegoForm.tsx` y
`FitosanitarioForm.tsx`. `TareaForm.tsx` no se tocó (ya tenía su propia
implementación funcionando, sin necesidad de migrar a la versión
compartida).

**Mobile:** mismo patrón de sugerencias que ya tenía `tareas.tsx`, agregado
a `riego.tsx` (los dos flujos: crear con inicio/fin, e iniciar sin fin
todavía) y a `fito.tsx`. Cada wizard carga su propio catálogo de
`trabajadoresDb` (mismo patrón de cache de `tareas.tsx`,
`CACHE_TTL.trabajadores`).

**Verificación:** `tsc --noEmit` limpio en frontend y mobile, sin errores
nuevos.

## Deploy

Migración corrida sola en Railway (confirmado en logs). `vercel --prod`
corrido. `eas update --branch production --environment production` (cambio
100% JS/UI, ningún módulo nativo — no hizo falta `eas build`) — verificado
bajando el bundle real y confirmando la URL de Railway adentro, sin IP LAN
(mismo procedimiento de `mobile/AGENTS.md`). Commits `fb552db` (docs) y
`a39ede0` (feature), ambos en `main`.

## Ver también

- [[2026-08-12-importacion-comprobantes-arca-iva]]
- [[Sistema de Gestión Agrícola]]
