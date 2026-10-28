---
fecha: 2026-10-28
tags: [sistema, bitacora, produccion, fitosanitarios, plan]
---

# Bitácora 2026-10-28: plan mensual por hectárea y avance por fecha

Rediseño pedido tras probar con el ingeniero el flujo por rondas. Decisión: [[2026-10-28-plan-mensual-avance]]. Rama `feat/plan-mensual-avance`, **sin push ni deploy** a la fecha de esta nota.

## Qué cambió

- **Backend:** `services/plan_avance.py` (avance por variedad/mes/producto/parcela, ponderado por superficie de válvula) y `services/plan_contraste.py`. Endpoints `GET /plan-fitosanitario/avance`, `POST /plan-fitosanitario/contraste`; `necesidad-stock` reescrito. Fuera: `cumplimiento`, `rondas-pendientes`, `plan_cobertura`, `plan_vinculo`, `plan_backfill`.
- **Órdenes:** ya no se vinculan al plan; `/desde-plan` es alias de `POST /`; `lineas[].numero_aplicacion` se acepta e ignora.
- **Migración:** `a4d7c19e3b52` agrega el índice único del plan. `POST /plan-fitosanitario/` acepta sin `numero_aplicacion` (lo asigna) y da 409 si el producto ya está en ese mes y variedad.
- **Web:** formulario de orden vacío con contraste por línea y panel "Pendiente del plan"; banner de faltantes en órdenes; matriz de cumplimiento con detalle por parcela; pestaña Plan agrupada por mes con el avance al lado de cada dosis.
- **Mobile:** sin cambios, sin OTA.

## Verificado

455→456 tests backend, `tsc`/eslint/build web, `tsc` mobile. Click-through local: orden vacía, "Agregar" del pendiente, excede, fuera del plan / orden mixta, banner, matriz y detalle, estados verde/rojo/azul/no planificado confirmados por API, y alta/duplicado/edición/baja en la pestaña Plan. No probado: prod, ni usuarios sin permiso de gerencia.

## Checklist de deploy

1. Pregate en prod (solo lectura, con OK de Fausto): `scripts/migracion/pregate_ordenes_multiproducto.py`; el índice único exige 0 duplicados en el plan (ya se limpiaron 17 el 2026-10-27).
2. Merge a `main` y push: Railway corre la migración `a4d7c19e3b52`. Con CI verde.
3. `npx vercel --prod` desde `frontend/` apenas el backend esté vivo. Hay una ventana de minutos en la que la web vieja llama endpoints removidos (`cumplimiento`, `rondas-pendientes`): aceptado.
4. Verificar `/plan-fitosanitario/avance` en prod (401 sin token = existe) y repetir lo esencial del click-through.
5. Regenerar `Modelo de Datos.md` (lee prod) después de migrar.

## Pendientes

- Limpiar columnas shim/legacy y `numero_aplicacion` de órdenes y registros.
- El editar de una fila del plan no revalida que el producto no quede duplicado en el mes destino (solo lo ataja el índice por ronda).
