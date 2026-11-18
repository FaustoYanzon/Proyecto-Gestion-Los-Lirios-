---
fecha: 2026-11-17
tags: [sistema, decision, produccion, pasa, alfalfa, remitos, anulacion]
estado: implementada en rama feat/anulacion (sin mergear ni desplegar)
---

# Decisión: anulación de remitos de pasa y documentos de alfalfa

Reemplaza en parte la decisión de octubre de **no anular remitos** ([[2026-10-07-alta-de-produccion-fase-1]], [[2026-10-13-levantada-de-pasa]]). Spec: `docs/superpowers/specs/2026-11-17-anulacion-pasa-alfalfa-design.md`. Paso 4 de la serie paseros → manto → alfalfa → anulación → mobile.

## Decisión (Fausto, 2026-11-17)

Un remito o documento mal cargado se **marca como anulado**: no se borra ni se emite un contra-documento. Solo **super_admin**, con motivo obligatorio (5 a 500 caracteres). La anulación devuelve los saldos y el stock a su valor previo.

## Qué se puede anular

- `entrega_pasa`: repone `lote.saldo_kg` (el lote sigue cerrado) y libera los bines.
- `salida_fresco`: el saldo de cosecha vuelve porque se calcula sumando líneas no anuladas.
- `salida_bodega`: igual que fresco, siempre que no tenga comprobante de bodega.
- Documento de alfalfa, salida: devuelve stock; siempre permitido.
- Documento de alfalfa, alta: permitido solo si ningún producto (unidades o kg) queda en negativo al excluirla.

## Qué no se puede anular, y por qué

- `traslado_pasero`: va atado a un ingreso al pasero (409).
- `salida_bodega` con `comprobante_bodega`: ya tiene un comprobante emitido (409).
- Alta de alfalfa que dejaría stock negativo porque hay salidas que dependen de ella (409 con producto y saldo).
- Fuera de alcance: bines, ingresos al pasero y cierre de lote.
- Tampoco: editar, desanular, anulación parcial de líneas.

## Cómo

- **Marca blanda**: `anulado_at`, `anulado_by`, `motivo_anulacion` en `remitos` y `documentos_alfalfa`; check de que los tres son todos NULL o todos NOT NULL. Migración `a2a2a2a00001` (down_revision `a1fa1fa00001`).
- **Líneas**: `remito_lineas.anulada`; el índice único parcial `uq_remito_linea_bin` pasa a `WHERE bin_id IS NOT NULL AND NOT anulada`. El bin se puede volver a entregar y la línea conserva su bin para auditoría.
- **Exclusión**: saldos de cosecha, listados por cosecha, entregas de lotes, conciliación de bodega y stock de alfalfa no cuentan anulados.
- **Numeración**: los anulados siguen contando (`count+1`), sin huecos ni reutilización.
- **Servicio** `app/services/anulacion.py`; endpoints `POST /remitos/{id}/anular` y `POST /alfalfa/documentos/{id}/anular` con `require_super_admin`. Doble anulación: 409.
- **PDF**: marca «ANULADO» con fecha y motivo; el PDF sigue abriéndose.
- **Web**: botón «Anular» solo super_admin en remitos y alfalfa, con modal de motivo; filas anuladas atenuadas con etiqueta.

## Abiertos / decisiones pendientes

a. **Corregir un despacho equivocado genera dos cosechas.** Tras anular un FRE/BOD el saldo de la cosecha vuelve, pero `PUT`/`DELETE` de esa cosecha siguen dando 409 (el guard cuenta líneas anuladas, como pide la spec) y `/cosecha/despacho` crea una cosecha NUEVA. Opción: que `_vinculos_cosecha` (`api/produccion.py`, ~2209-2295) ignore las líneas anuladas solo para PUT/DELETE.
b. **El link público firmado del PDF del remito muestra el motivo interno** de la anulación. Opción: mostrar públicamente solo «ANULADO el <fecha>».
c. **Reenviar un despacho cuyo FRE/BOD fue anulado** devuelve un 409 engañoso («alta de cosecha sin despacho»), en `services/despacho_cosecha.py` (~137-150).
d. **Deriva de kg en alfalfa** si cambian `kg_fardo`/`kg_rollo` (viene de la decisión de alfalfa, ver [[2026-11-17-alfalfa-inventario]]).
e. **Mobile (paso 5)** no forma parte de esto.

Deploy y regeneración de `Modelo de Datos.md` pendientes: ver [[2026-11-17-anulacion-pasa-alfalfa]] en la Bitácora.
