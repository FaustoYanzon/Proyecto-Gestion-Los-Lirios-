---
fecha: 2026-11-17
tags: [sistema, bitacora, produccion, pasa, alfalfa, anulacion, backend, web]
---

# Bitácora 2026-11-17: anulación de pasa y alfalfa

Rama `feat/anulacion`, **sin mergear ni desplegar**. Decisión: [[2026-11-17-anulacion-pasa-alfalfa]].

## Qué se construyó

- **Migración** `a2a2a2a00001` (down_revision `a1fa1fa00001`): columnas de anulación en `remitos` y `documentos_alfalfa`, `remito_lineas.anulada` e índice único parcial de bines recreado.
- **Servicio** `app/services/anulacion.py` y endpoints `POST /remitos/{id}/anular` y `POST /alfalfa/documentos/{id}/anular` (solo super_admin).
- **Consultas** de saldos, entregas, conciliación y stock de alfalfa excluyen anulados.
- **PDF** de remito y de alfalfa con marca «ANULADO».
- **Web**: botón y modal «Anular» en remitos y alfalfa; filas anuladas atenuadas.
- Fix: no se emite comprobante sobre un remito BOD anulado.

## Tests

4 archivos nuevos, 638 líneas: `test_anulacion_modelo.py`, `test_anulacion_remitos.py`, `test_anulacion_alfalfa.py`, `test_anulacion_pdf.py`.

## Pendientes

a. **Deploy no hecho**: backup `pg_dump` de prod, merge a `main` (Railway migra con `a2a2a2a00001`), `npx vercel --prod`. Sin OTA (no hay mobile). Confirmar con Fausto en cada paso.
b. **`Modelo de Datos.md` sin regenerar**: `generate_modelo_datos.py` lee producción (`.env.prod`); correrlo recién después de migrar prod.
c. Abiertos (a) a (e) de la decisión: cosecha duplicada al corregir un despacho, motivo visible en el link público, 409 engañoso al reenviar un despacho, deriva de kg en alfalfa, mobile.

## Docs generados

`PROJECT_MAP.md` regenerado.
