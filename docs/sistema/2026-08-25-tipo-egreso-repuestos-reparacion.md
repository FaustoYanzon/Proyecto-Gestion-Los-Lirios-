---
tags: [sistema, sesion]
---

# 2026-08-25 — Nuevo tipo de egreso "Repuestos y Reparación"

Fausto notó que Repuestos y Reparaciones vivía mezclado dentro de Insumos Varios (`ClasificacionEgreso.rep_repuestos_vehiculos`/`rep_repuestos_infraestructura`, bajo `TipoEgreso.insumos_varios`) — conceptualmente incorrecto desde lo financiero: mantenimiento de activos existentes (gasto recurrente) no es lo mismo que un insumo genérico. Pidió modo plan formal, con una revisión mía de toda la taxonomía de ~31 clasificaciones por si había algo más para ajustar (no encontré nada más — el resto ya está razonablemente separado; sí quedó anotado que "Inversión → Riego" (capex, poner algo nuevo) y el "Riego" nuevo de Repuestos y Reparación (opex, arreglar lo que ya está) son conceptos distintos a propósito, van a convivir).

## Cambio

Tipo nuevo `repuestos_reparacion` ("Repuestos y Reparación"): Infraestructura, Vehículos, Maquinaria, Riego, Parral, Otros. Insumos Varios gana Herramientas e Indumentaria (Combustibles/Otros quedan exactamente igual, sin renombrar — Fausto lo pidió así explícitamente para no generar ninguna migración de datos innecesaria en esos dos).

Los dos valores de clasificación que ya existían (`rep_repuestos_vehiculos`, `rep_repuestos_infraestructura`) **no cambian de nombre** — solo se reclasifican al tipo nuevo. Confirmado explorando el repo entero antes de tocar nada: `frontend/lib/api/egresos.ts` es la única fuente de verdad del lado frontend (dashboard de Finanzas, Presupuesto Anual, Flujo Anual + desglose por tipo, tabla de Egresos, panel de clasificación ARCA — los ~12 archivos que referencian estos enums ya derivaban dinámicamente de ahí, ninguno tenía una lista fija propia), así que el cambio quedó acotado a un solo archivo por capa.

## Reclasificación de datos históricos — dos migraciones, no una

La primera versión (una sola migración: `ALTER TYPE ... ADD VALUE` + el `UPDATE` de reclasificación en el mismo archivo) rompió al correrla local: **Postgres no deja usar un valor de enum recién agregado hasta que esté comprometido (committed)**, y el `env.py` de Alembic de este proyecto corre toda la tanda de migraciones pendientes en una sola transacción por defecto (`transaction_per_migration` no estaba seteado). Como Railway corre `alembic upgrade head` de un solo comando en cada deploy (`backend/railway.json`), el mismo error iba a pasar en producción.

**Fix real, no específico de este cambio — mejora general:** se agregó `transaction_per_migration=True` en `backend/app/core/migrations/env.py`. Ahora cada migración commitea por separado. Con eso, dos migraciones en cadena (A: altas de enum vía `op.execute("ALTER TYPE ... ADD VALUE IF NOT EXISTS ...")`, mismo patrón que ya se había usado en `c1d3f7a9e2b4_redesign_ingresos_bd_cobros.py`; B: `UPDATE egresos SET tipo = 'repuestos_reparacion' WHERE tipo = 'insumos_varios' AND clasificacion IN (...)`) corrieron limpias, primero local y después en producción.

## Verificación

Local, contra datos reales migrados de Excel (no solo tests sintéticos): las 6 sub-clasificaciones nuevas aparecen bien en el form de Nuevo Egreso, las filas históricas con Repuestos Vehículos/Infraestructura se vieron reclasificadas solas de Insumos Varios a Repuestos y Reparación en la tabla de Egresos, y "Repuestos y Reparación" apareció como fila nueva (en $0, sin presupuesto cargado todavía) en Presupuesto Anual — confirma que ninguna pantalla necesitó tocarse aparte de `egresos.ts`. Sin errores de consola.

En producción, después de deployar: 0 filas quedaron mal clasificadas bajo `insumos_varios` (consulta de verificación de solo lectura) — resultó que producción todavía no tenía ningún egreso cargado bajo Repuestos Vehículos/Infraestructura, así que no había nada real para migrar ahí; el tipo nuevo queda listo para usar desde ahora.

## Deploy

Commit único (`3f0a7f9`), autorizado por Fausto para pushear/deployar sin pedir confirmación de nuevo. Railway corrió las 2 migraciones solas. `vercel --prod` corrido. Sin cambios de mobile (Egresos no existe en la app mobile).

## Ver también

- [[2026-08-24-documentacion-selectores-finca-campana-ctrlk]] (sesión inmediatamente anterior, mismo día de trabajo continuado)
- [[Sistema de Gestión Agrícola]]
