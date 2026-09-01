---
tags: [sistema, sesion]
---

# 2026-09-01 — ARCA: clasificar comprobantes por el neto sin IVA (no el Imp. Total)

Sesión corta de análisis + cambio puntual sobre la [[2026-08-12-importacion-comprobantes-arca-iva|importación de comprobantes ARCA]]. Fausto va a empezar a importar y clasificar los comprobantes recibidos mes a mes de todo 2026 y preguntó si la lógica de importación/clasificación maneja bien los distintos tipos de documento (Factura A/B/C, Tique A/B/C, notas de crédito/débito) con el signo correcto.

## Análisis del alcance previo

Se revisó el CSV real de enero 2026 (`C:\claude-projects\Comprobantes arca\...recibidos...`) y el código. Estado antes del cambio:

- El parser lee bien el CSV real (columnas, fechas ISO, dedupe por clave natural mes a mes). Sin problemas ahí.
- **Signo**: única regla `signo = -1 if es_nota_credito else +1` (catálogo oficial AFIP en `arca_import.py`). Notas de débito → positivas (suman gasto), notas de crédito → negativas. Correcto.
- **Monto**: `Egreso.monto = imp_total * signo` — o sea el **Imp. Total con IVA incluido**. Esa era una vista de caja, no de costo.

## Decisiones tomadas con Fausto

- **Es responsable inscripto** y toma crédito fiscal **solo de las Facturas A**.
- → El monto del Egreso/Ingreso pasa a ser el **neto sin IVA**: `monto = (imp_total - total_iva) * signo`, en `clasificar_comprobante_egreso` **y** `clasificar_comprobante_ingreso`. Motivo: el IVA discriminado no es costo/ingreso propio (se recupera/paga) y ya se computa aparte en `resumen-iva` / `vw_kpi_iva`. Contarlo también dentro del Egreso lo duplicaba.
- Las **Facturas B/C** traen `total_iva = 0` en el CSV de ARCA, así que la misma fórmula las deja por el `imp_total` completo — que es su costo real (no se toma crédito). No hizo falta una rama aparte.
- **"Otros Tributos"** (percepciones IIBB, impuesto a combustibles, etc.) queda **dentro** del monto: está en `imp_total`, no en `total_iva`. Aceptado como aproximación razonable.
- El CSV de recibidos de Fausto **no trae Recibos ni Liquidaciones** → sin riesgo de doble conteo, sin cambios por eso.
- **NC que anula una factura entera**: se dejan los dos movimientos en el ledger neteando a 0, no se agrega un "anular la factura original".
- **Sin backfill**: se había arrancado de cero (datos de prueba borrados el 08-12), no hay Egresos `arca_csv` viejos que recalcular.

## Cambios

- `backend/app/api/arca.py`: `neto = imp_total - total_iva` en ambos endpoints de clasificación; `monto = neto * signo`. `vw_kpi_iva` no se toca (ya usa `total_iva` y ya netea NC).
- `frontend/components/finanzas/ComprobantesArcaPanel.tsx`: el modal de pendientes muestra el **neto que se va a registrar** como cifra principal (en negativo si es NC), y `Total … · IVA …` como línea de referencia debajo.
- `backend/tests/test_arca_import.py`: 3 asserts de monto actualizados al neto (Factura A `1.290.000,00`; NC A `-50.428,00`; venta A `36.569.320,00`).

## Verificación

- Suite backend completa: **98/98 pasando** (`venv` estaba desactualizado, faltaba `APScheduler==3.11.3` que ya estaba en `requirements.txt` — instalado para correr los tests).
- `tsc --noEmit` frontend: limpio.
- **No** se probó end-to-end en local con Claude in Chrome — Fausto pidió commitear y deployar directo por falta de tiempo, asumiendo el riesgo.

## Deploy

Commit `fda2474` pusheado a `main`. Railway auto-despliega el backend (sin migraciones nuevas). **Pendiente que haga Fausto:** `vercel --prod` para que el cambio del modal llegue al frontend de producción (Vercel no auto-despliega en este proyecto).

## Ver también

- [[2026-08-12-importacion-comprobantes-arca-iva]]
- [[Sistema de Gestión Agrícola]]
