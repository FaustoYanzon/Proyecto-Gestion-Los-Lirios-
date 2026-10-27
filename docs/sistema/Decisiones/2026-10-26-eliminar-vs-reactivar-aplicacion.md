---
fecha: 2026-10-26
tags: [sistema, decision, produccion, fitosanitarios, ordenes-aplicacion]
estado: implementada
---

# Decisión: Eliminar saca la aplicación del sistema; Reactivar la deja pendiente

Contexto en [[2026-10-26-eliminar-y-reactivar-aplicacion]]. Complementa [[2026-10-26-deshacer-valvula-y-mercado]], que bloqueaba con 409 el borrado de registros nacidos de válvula.

## Problema

Eliminar un registro de "Aplicaciones realizadas" hacía dos cosas: borrar el registro y devolver la parcela a pendiente en su orden. Fausto borró uno esperando que desapareciera y la parcela volvió a pendiente.

## Decisión

- **Eliminar** quita la aplicación del sistema y de la orden. La parcela (o la válvula) sale de la orden. Una orden que queda sin parcelas se borra, incluso si es de origen plan.
- **Reactivar** es la única forma de dejar la aplicación pendiente: devuelve el stock, borra el registro y vuelve la parcela a pendiente. En registros nacidos de válvula equivale a "Deshacer".
- Los registros nacidos de válvula **se pueden eliminar** (antes 409).

## Consecuencias

- Reemplaza el 409 "deshacela desde la válvula" de [[2026-10-26-deshacer-valvula-y-mercado]] para `DELETE`.
- Eliminar una orden de plan puede dejar el plan de la temporada sin esa orden; se aceptó a cambio de no dejar órdenes vacías.
- La web vieja es incompatible con el backend nuevo: deploy conjunto.
