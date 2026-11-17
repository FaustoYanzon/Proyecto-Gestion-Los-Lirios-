---
fecha: 2026-11-17
tags: [sistema, bitacora, inventarios, alfalfa, backend, web]
---

# Bitácora 2026-11-17: inventario de alfalfa

Rama `feat/alfalfa` (HEAD `5845f52`), **sin mergear ni desplegar**. Módulo de stock de alfalfa por altas y salidas, con PDF y página web.

## Qué se construyó

- **Parámetros** `kg_fardo` y `kg_rollo` (peso por unidad), editables.
- **Tablas** `documentos_alfalfa` y `documento_alfalfa_lineas`; modelos `DocumentoAlfalfa` y `DocumentoAlfalfaLinea` en `backend/app/models/alfalfa.py`. Migración `a1fa1fa00001_alfalfa_documentos`.
- **Depósito Alfa**: depósito propio donde vive el stock.
- **Numeración** `ALF-ALT-nnnnnn` (altas) y `ALF-SAL-nnnnnn` (salidas).
- **Stock derivado**: altas menos salidas, no se guarda como columna.
- **API `/alfalfa`** con guards por rol (encargado y arriba operan; anulación reservada a super_admin en el paso 4).
- **PDF** del documento.
- **Web**: página `/dashboard/inventarios/alfalfa` (modales de alta y salida), índice de Inventarios en `/dashboard/inventarios` y menú por rol; el encargado accede solo a Alfalfa.

## Decisiones

- **kg congelado al crear**: cada línea guarda los kg calculados con el parámetro vigente en ese momento, así un cambio posterior de `kg_fardo`/`kg_rollo` no reescribe documentos viejos.
- **Stock por unidades** (fardos y rollos), no por kg: la unidad física es lo que se cuenta en el campo.
- **La salida valida contra el stock total**, sin FIFO ni potrero de origen: no hay trazabilidad por lote de alfalfa y no se necesita para el uso actual.
- **`idempotency_key` con replay**: reintentar la misma salida devuelve el documento original, sin duplicar (también tras tomar el lock).

## Verificación

- pytest de alfalfa: 49 passed. Suite completa: 697 passed, antes de la tanda de fixes finales.
- lint y build del frontend OK.
- Click real en local: 10/10 con gerencial y con encargado.
- Migración up/down/up en Postgres local.

## Pendientes

a. **Deploy no hecho.** Backend por merge a `main` (Railway migra al arrancar con `a1fa1fa00001`). Web con `npx vercel --prod`. Sin OTA: no hay cambios mobile.
b. **Anulación** solo super_admin (paso 4) y **mobile** (paso 5).
c. **Decisión de Fausto, deriva de kg**: si cambia `kg_fardo`/`kg_rollo` entre un alta y una salida, los kg de la salida usan el parámetro vigente y una salida total puede dejar kg negativos (con unidades en 0). Alternativa: valorar la salida con el promedio kg/unidad del stock.
d. **Decisión de Fausto, permisos**: un encargado alcanza por URL los 7 endpoints de Insumos y Producto Terminado (ver [[2026-11-17-auditoria-permisos-inventarios]]) y Ctrl+K le muestra sub-ítems de Finanzas, Admin y Documentación.
e. **Test que pasa en vacío**: `test_integrity_error_ajeno_se_propaga` (`backend/tests/test_alfalfa_servicio.py:363-373`). Arreglo: crear el Depósito antes de monkeypatchear `flush`.
f. **Menores diferidos**: el listado web trunca en 200 documentos sin aviso; un potrero desactivado se ve como "–"; los tests del PDF no verifican contenido; usar `FOR NO KEY UPDATE` (`with_for_update(key_share=True)`) en lugar de `FOR UPDATE` en la salida.
g. **Base local**: quedaron usuarios QA desactivados (`qa_alfalfa_gerencial`, `qa_alfalfa_encargado`) y documentos `ALF-ALT-000001/2/3` y `ALF-SAL-000001/2`.

## Docs generados

`PROJECT_MAP.md` regenerado (modelos, router `/alfalfa`, migración, rutas web). `Modelo de Datos.md` **no** se regeneró: ver [[Bugs Conocidos]] (el generador lee producción, que aún no tiene las tablas de alfalfa). Regenerarlo después de migrar prod.
