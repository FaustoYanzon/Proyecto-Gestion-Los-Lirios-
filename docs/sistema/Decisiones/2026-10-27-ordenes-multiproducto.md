---
fecha: 2026-10-27
tags: [sistema, decision, produccion, fitosanitarios, ordenes-aplicacion, plan]
estado: implementada en rama, pendiente de deploy
---

# Decisión: órdenes multiproducto y multivariedad, con vínculo explícito al plan

Contexto en [[2026-10-27-ordenes-multiproducto]]. Spec: `docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md`.

## Problema

Una orden llevaba un solo producto y una sola variedad, y el cumplimiento del plan se calculaba con una heurística (la N-ésima aplicación cubre la N-ésima ronda). Aplicar dos productos juntos obligaba a crear órdenes separadas, y el plan no sabía qué registro cubría qué ronda.

## Decisión

- La orden tiene **líneas de producto** (`ordenes_aplicacion_insumos`); confirmar crea **un registro por línea**.
- Cada registro guarda su vínculo explícito con el plan (`plan_fitosanitario_id`) y con la orden (`orden_insumo_id`, `orden_parcela_id`, `orden_valvula_id`). El cumplimiento deja de ser heurístico y se mide por hectáreas.
- Las columnas de producto único se conservan como **shim** (NOT NULL, sincronizadas desde la primera línea) para clientes viejos, hasta una migración de limpieza.
- Deshacer, Eliminar y Reactivar actúan sobre la válvula (o parcela) completa.
- Redondeo de cantidades: half-even en el servidor, reproducido exacto en mobile.

## Consecuencias

- Reemplaza, para órdenes, la heurística de cumplimiento descrita en [[2026-09-08-fertilizantes-stock-fitosanitarios]]; los registros manuales anteriores se vinculan con `backfill_plan_registros.py`.
- Complementa [[2026-10-26-eliminar-vs-reactivar-aplicacion]]: Eliminar/Reactivar ahora operan sobre todos los registros hermanos.
- Quedan columnas shim y legacy por eliminar en un plan de limpieza posterior.
