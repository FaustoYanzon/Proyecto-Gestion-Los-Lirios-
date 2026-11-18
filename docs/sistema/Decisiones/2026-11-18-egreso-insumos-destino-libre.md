# Egreso manual de insumos varios con destino libre

Fecha: 2026-11-18 · Estado: implementado, sin desplegar.

## Decisión
- Nuevo tipo de movimiento `egreso` en `movimientos_stock` para la **salida manual** de insumos varios (combustible, aceite, etc.). Los fitosanitarios siguen saliendo solo por aplicación (422 si se intenta egreso manual).
- El egreso lleva `destino` obligatorio, **texto libre** (máquina, tractor o parcela). Se guarda así hasta cargar todos los insumos; después se clasifica por máquina o parcela (queda como pendiente, posible FK).
- El stock **puede quedar negativo**, igual que el egreso por aplicación; la app avisa antes de confirmar.
- Lo carga encargado o superior. `require_encargado_up` admite regador (heredado), por eso el endpoint rechaza el egreso del regador con 403. El ingreso por API sigue admitiendo regador; la app lo limita con `puedeAltaProduccion`.
- `idempotency_key` opcional (String 64, índice único parcial) en ingreso y egreso: un reintento con la misma clave devuelve el movimiento original (200) sin tocar el stock. Cierra el riesgo de duplicado aceptado en la primera versión de Depósitos.

## Migración
`b3e9a1d4c7f2`: `ALTER TYPE tipomovimientostock ADD VALUE 'egreso'` (irreversible en Postgres), columnas `destino` e `idempotency_key`, índice `uq_movimientos_stock_idempotency_key`. Orden de salida: backup, push (Railway migra), verificar, y recién después el OTA.

## Pendiente
Clasificar destinos por máquina/parcela; detalle e historial de movimientos en web; regenerar `Modelo de Datos.md` después de migrar producción (el generador lee la base de producción).
