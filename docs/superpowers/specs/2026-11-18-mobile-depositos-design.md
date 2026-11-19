# Mobile: Depósitos (stock + ingreso de insumos) — diseño corto

Fecha: 2026-11-18 · Estado: aprobado e implementado en feat/mobile-depositos (sin desplegar) · Tamaño: cambio mediano (solo app Expo, por OTA; sin backend nuevo salvo que bodega lo exija, ver abajo).

## Intención
Fausto quiere una sola pantalla en el celular donde ver el stock de todos los depósitos y, para fitosanitarios e insumos varios, registrar el ingreso cuando llega mercadería. Lo cargan el encargado o el ingeniero.

## Goals
- Entrada «Depósitos» en el menú lateral, debajo de Maquinaria (`ModulosDrawer`).
- Cinco tarjetas de stock: Fitosanitarios, Insumos varios, Paseros, Bodega (bines de pasa) y Alfalfa.
- Botón «+ Ingreso» en las tarjetas de Fitosanitarios e Insumos varios, que abre un modal de ingreso.

## Non-goals
- Detalle por depósito, historial de movimientos y listados largos: v1 solo muestra tarjetas (decisión de Fausto). **Anotado como pendiente para web.**
- Ingreso de alfalfa, paseros o bodega desde esta pantalla (ya tienen sus flujos).
- Egresos y ajustes de insumos (el egreso nace de la aplicación; el ajuste es de gerencial hacia arriba, queda en web).
- Cola offline: igual que alfalfa, solo con conexión.

## Decisiones de Fausto (no re-litigar)
- Opción A: «+ Ingreso» dentro de las tarjetas de Fitosanitarios e Insumos varios.
- Quién carga: encargado o ingeniero, cuando llega el camión.
- Bodega = el stock que sale de las levantadas (lotes de pasa).
- En mobile alcanzan las tarjetas de stock.

## Approaches (dónde va el ingreso)
- **A. «+ Ingreso» en las tarjetas (elegida).** Mínimo de pantallas; un camión con varios productos repite el modal por producto.
- B. Pantalla de ingreso aparte con varios productos por camión. Descartada: no hay evidencia de que haga falta.
- C. Dentro de la pantalla de insumos existente. Descartada: mezcla dos lugares.

## Diseño
### Datos (todo existente)
- Fitosanitarios / Insumos varios: `GET /insumos/?is_active=true` (require_encargado_up), separados por `Insumo.tipo` (`fitosanitario` | `vario`; `riego` queda fuera, es mi supuesto). La tarjeta muestra cantidad de productos, y los productos con su `stock_actual` y `unidad` (lista corta, la más baja primero o por nombre, a definir por el builder).
- Paseros: `getStockPasero()` de `lib/altaProduccion.ts` (`GET /pasero/stock`), total y por variedad.
- Alfalfa: `getStockAlfalfa()` de `lib/alfalfa.ts`.
- Bodega (pasa): `GET /lotes-pasa/?con_saldo=true` (`getLotesPasa(undefined, true)`); la tarjeta muestra la suma de `saldo_kg` y la cantidad de lotes con saldo. No hay endpoint nuevo ni conteo de bines sueltos.

### Ingreso
- `POST /insumos/{id}/movimientos` con `tipo: "ingreso"` (existe; require_encargado_up). Campos del modal: insumo (del tipo de la tarjeta), cantidad (> 0, decimal como string), fecha (hoy por defecto, validada como en alfalfa), observaciones.
- **Mi decisión (a corregir si no te gusta):** `MovimientoStock` no tiene columnas de proveedor ni remito, solo `observacion`. En v1 no hay migración: el campo observaciones lleva la sugerencia «Proveedor y N° de remito». Columnas propias quedan para cuando se haga la versión web.
- Antes de guardar, línea de confirmación («Se suman X u a Y u de stock») y botón bloqueado mientras envía (`submittingRef`). El backend no tiene `idempotency_key` para movimientos: un doble toque que llegue dos veces al servidor sumaría dos veces. Mitigación: bloqueo del botón y una sola llamada; riesgo residual aceptado en v1, se corrige con un ajuste de gerencial.
- Errores del servidor se muestran dentro del modal. Tras guardar, se refresca la tarjeta.

### Permisos
- La entrada del menú y las tarjetas con stock solo para encargado o superior (`GET /insumos` ya lo exige). Para otros roles el drawer no muestra la entrada. Revisar cómo `ModulosButton` decide hoy (`puedeVerMaquinaria`): hay que pasar a una condición combinada de módulos, porque regador/obrero no deben ver Depósitos.
- Cada tarjeta que falle (403/red) muestra «No disponible» sin romper las demás (mismo criterio que el panel del pasero).

## A cargo del builder
Textos, estilos, nombres de componentes y pruebas; cómo calcular bodega; orden de la lista de productos.

## Verificación
- `npx tsc --noEmit`; prueba manual en el iPhone contra el backend local: las cinco tarjetas, ingreso de un fito y de un vario (stock sube, se refresca), cantidad inválida, modo avión, rol sin permiso sin la entrada en el menú.
- Si hay endpoint de bodega: pytest.
- Publicación: backend primero (solo si hubo endpoint nuevo), después OTA con las reglas de `mobile/AGENTS.md`. Cada paso con confirmación de Fausto. Se puede publicar junto con el OTA de alfalfa/paseros.

## Riesgos
- Duplicado por doble envío (ver arriba).
- Permisos del drawer: hoy el botón del menú solo existe para quien ve Maquinaria; regador no debe ganar acceso a Depósitos.
- `eas.json` y dependencias nativas no se tocan (OTA válido para los binarios actuales).

## Pendiente (web)
Detalle por depósito, historial de movimientos y columnas de proveedor/remito en los ingresos.
