---
fecha: 2026-10-28
tags: [sistema, decision, produccion, fitosanitarios, plan]
estado: implementada en rama, pendiente de deploy
---

# Decisión: plan fitosanitario mensual por hectárea, avance por fecha

Contexto en [[2026-10-28-plan-mensual-avance]]. Spec: `docs/superpowers/specs/2026-10-28-plan-mensual-avance-design.md`. Reemplaza el modelo de rondas de [[2026-10-27-ordenes-multiproducto]].

## Problema

El ingeniero rechazó el flujo por rondas y tarjetas: pensaba el plan como "cuánto de cada producto por hectárea de parral en cada mes", no como aplicaciones numeradas.

## Decisión

- El plan es una **dosis objetivo por hectárea** por (temporada, variedad, mes, producto). Filas del mismo producto y mes suman.
- Lo aplicado en el **mes calendario** (cualquier registro, venga de orden o manual) se descuenta del objetivo. Por parcela: sin aplicar o por debajo (rojo), ±5 % (verde), de más o fuera del plan (azul). No hay arrastre automático entre meses.
- **Se eliminan las rondas.** La orden nueva arranca vacía, no precarga del plan; el sistema avisa lo que falta (panel de pendientes, banner) y marca los productos fuera del plan ("Orden mixta").
- El contraste de una orden (`POST /contraste`) es de solo lectura; no bloquea ni exige motivo.
- La necesidad de stock cuenta solo meses abiertos; el exceso de una parcela no compensa a otra.

## Consecuencias

- Las columnas `plan_fitosanitario_id` y `numero_aplicacion` de órdenes/registros y los campos shim quedan sin escribir (null en respuestas), para limpiar en el plan de limpieza pendiente.
- `numero_aplicacion` del plan pasa a ser interno: opcional en el alta, lo asigna el backend; índice único `(temporada, variedad, numero_aplicacion, insumo_id)` más 409 si el producto ya está en ese mes.
- Mobile no cambia: no hay OTA.
