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

## Segunda tanda (misma fecha)
- **Depósitos en pestañas**: Fitosanitarios | Insumos | Paseros | Bodega | Alfalfa, una visible a la vez (`TabsBar` compartido). «− Egreso» solo en Insumos varios; la pestaña Alfalfa tiene un botón para abrir su pantalla.
- **Egreso de insumos varios** (backend + app): ver `Decisiones/2026-11-18-egreso-insumos-destino-libre.md`. El modal `MovimientoInsumoModal` hace ingreso y egreso, con clave de idempotencia atada al contenido.
- **Inicio**: acciones rápidas «Ingreso de insumos» / «Egreso de insumos» para encargado o superior.
- **Cosecha en pestañas**: Uva (despachos e ingresos al pasero) | Pasa (levantar, lotes, entrega) | Alfalfa (`AlfalfaPanel`, el mismo contenido de la pantalla Alfalfa).
- **Mapa**: los polígonos no se veían porque la base local tenía `coordenadas` en JSON null; se cargaron desde el KML solo en local. Sin cambio de código.
- **Verificación**: backend 767 tests pasan; `tsc` limpio. Falta la prueba en el iPhone.
- **Orden de publicación**: backup → push → verificar migración en Railway → OTA único (alfalfa, paseros, depósitos, egreso, pestañas).
