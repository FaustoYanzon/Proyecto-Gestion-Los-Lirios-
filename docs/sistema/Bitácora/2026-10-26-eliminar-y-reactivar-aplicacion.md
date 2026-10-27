---
fecha: 2026-10-26
tags: [sistema, bitacora, produccion, fitosanitarios, ordenes-aplicacion, valvulas, auditoria]
---

# Bitácora 2026-10-26: Eliminar y Reactivar una aplicación fitosanitaria

Separa dos acciones que hacía un solo botón. Decisión registrada en [[2026-10-26-eliminar-vs-reactivar-aplicacion]]. Rama `feat/eliminar-reactivar-aplicacion`, pendiente de push y deploy a la fecha de esta nota.

## Origen

El 2026-10-26 Fausto borró un registro de "Aplicaciones realizadas" escribiendo ELIMINAR (la confirmación agregada en `6f14493`) y la parcela volvió a pendiente, porque Eliminar hacía dos cosas a la vez: quitar el registro y devolver la parcela a la orden. Quería que Eliminar saque la aplicación del sistema, y que un botón aparte (Reactivar) la devuelva a pendiente.

## Implementación

- **Backend** (`4e61562`):
  - `DELETE /produccion/fitosanitarios/{id}` (gerencial o superior) ahora **quita** la aplicación:
    - Manual: igual que antes.
    - Nacida de una orden a nivel parcela: devuelve el stock, borra registro y fotos, la parcela **sale** de la orden. Si la orden queda sin parcelas se borra (también si `origen=plan`); si no, se recalcula su estado.
    - Nacida de una válvula (antes 409): sale la fila de la válvula; la parcela sale si no le quedan válvulas; si no, se recalculan estados; la orden se borra si queda vacía.
  - Nuevo `POST /produccion/fitosanitarios/{id}/reactivar` (super_admin, gerencial, encargado de la misma finca). Orden de errores: 403 de finca antes que 409; 404 si el registro ya no existe; 409 si no viene de una orden.
    - Nacida de parcela: comportamiento viejo de Eliminar (stock de vuelta, registro borrado, parcela pendiente, orden recalculada).
    - Nacida de válvula: exactamente "Deshacer". La lógica compartida es `deshacer_fila_valvula` en el módulo nuevo `backend/app/services/aplicaciones.py`, que usa también el endpoint de deshacer.
  - `RegistroFitosanitarioResponse` suma `orden_id` (`column_property` con subquery correlacionada). Sin migración.
  - La orden se bloquea `FOR UPDATE`. Hay logs de auditoría para eliminar y reactivar (usuario, registro, orden, qué salió de la orden).
- **Web** (`9a93fbc`):
  - Botón "Reactivar" (RotateCcw) en Aplicaciones realizadas, solo en filas con `orden_id` y para super_admin, gerencial y encargado.
  - Eliminar mantiene el ELIMINAR tipeado, con texto nuevo: explica que la parcela o válvula sale de la orden y que la orden se borra si era la última.
  - Ambas acciones refrescan órdenes, A revisar, fitosanitarios, alertas e insumos. Un 404 en reactivar se trata como hecho.

## Pruebas

- **Backend:** pytest 347 passed. Archivo nuevo `tests/test_eliminar_reactivar_aplicacion.py`; adaptados `test_ordenes_aplicacion.py` y `test_orden_valvulas.py`; los tests de deshacer quedaron sin cambios.

## Deploy

- Sin migración.
- **La web debe salir junto con el backend o inmediatamente después.** La web vieja llama a DELETE esperando "volver a pendiente" y ahora sacaría la parcela de la orden. Orden recomendado: push (Railway) y enseguida `npx vercel --prod`.
- Mobile no llama a este DELETE: no hace falta OTA.
- Avisar a los operadores con la pestaña vieja abierta que recarguen.

## Pendientes

- **Datos de prod anteriores:** las órdenes de Parral 2/11/15 (giberélico del 23/10 y azufre del 24/09) están pendientes porque sus registros se borraron el 2026-10-25. Hay que reconfirmarlas en la app.
- Sin assertion de fotos en los caminos de Eliminar manual y nacido de parcela.
- Eliminar puede borrar una orden de origen plan (decisión registrada).
- Un doble Reactivar responde 404.
- El lock de la orden no está probado en SQLite.
- El texto del prompt de Eliminar menciona Reactivar también en filas manuales (cosmético).
- El comentario de cabecera de `AplicacionesRealizadas` omite que el encargado puede reactivar.
