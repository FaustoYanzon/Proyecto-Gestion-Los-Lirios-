# 2026-11-18 — Mobile: Depósitos

**Qué se hizo.** Pantalla «Depósitos» en el menú lateral de la app (debajo de Maquinaria), solo para encargado o superior. Cinco tarjetas de stock: Fitosanitarios, Insumos varios, Paseros, Bodega (pasa) y Alfalfa, cada una con carga propia (si una falla muestra «No disponible»). Fitosanitarios e Insumos varios tienen «+ Ingreso»: modal con insumo, cantidad, fecha y observaciones, con paso de confirmación.

**Sin backend nuevo.** Ingreso por `POST /insumos/{id}/movimientos` (tipo ingreso). Bodega sale de `GET /lotes-pasa/?con_saldo=true` (kg de saldo y lotes con saldo).

**Decisiones.**
- Opción A: el ingreso vive dentro de las tarjetas, no en pantalla aparte.
- Proveedor y N° de remito van dentro de `observacion` (los movimientos no tienen columnas propias; evita migración en producción).
- El tipo `riego` de `Insumo` no se muestra.
- El botón del menú se habilita por módulo (`puedeVerMaquinaria` / `puedeAltaProduccion`); hoy ambos son el mismo conjunto de roles.
- Ícono del menú: `capas` (ya existente en ambas plataformas) para no tocar el vocabulario de íconos.

**Riesgo aceptado.** `movimientos` no tiene `idempotency_key`: un doble envío que llegue dos veces al servidor sumaría dos veces. Mitigación en la app: `submittingRef`, botón deshabilitado y confirmación previa. Corrección: ajuste de gerencial.

**Pendiente (web y backend).** Detalle por depósito e historial de movimientos; columnas de proveedor/remito en los ingresos; `idempotency_key` para movimientos.

**Verificación.** `npx tsc --noEmit` limpio. Falta la prueba en el iPhone y el OTA.
