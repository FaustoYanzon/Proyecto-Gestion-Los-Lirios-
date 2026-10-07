---
fecha: 2026-10-07
tags: [sistema, decision, produccion, cosecha, pasa]
estado: implementada-en-local
---

# Decisión: Alta de Producción FASE 1 (backend)

Especificación original: "Los Lirios — Sistema de Alta de Producción" (5-oct-2026, Fausto). Cubre la cadena de la fruta parral → pasero → lote de pasa → depósito → comprador, con remitos como documentos de movimiento. **FASE 1 = solo backend.** Pantallas web/mobile son FASE 2; trazabilidad espacial por productor externo (raqueo) es FASE 3.

## Decisiones tomadas con Fausto

- **Cosecha existente se extiende, no se reemplaza.** `RegistroCosecha` sigue siendo el alta de kilos (con su histórico, KPIs y vistas). Se le agrega `productor_id` (nullable). No hay migración destructiva.
- **Origen unificado.** `OrigenCosecha` (propio/tercero) + nueva entidad `Productor` (propio/externo). La migración crea un `Productor` externo por cada `proveedor_tercero` distinto y enlaza los registros históricos; el texto original se conserva en `proveedor_tercero`.
- **Reemplaza el placeholder de "Producto Terminado".** El saldo de `Lote` y el `Deposito` definen cómo se lleva el stock de pasa. Uva fresca y mosto siguen sin definir.
- **Solo kilos, sin precios** en remitos.
- **Descuento 4:1 contra el total por variedad del pasero** (no por `UbicacionPasero`) hasta que se implemente el raqueo (FASE 3).
- **Kilos en `Numeric`/`Decimal`** en las tablas nuevas; `RegistroCosecha.kg_total` queda `Float` para no romper vistas SQL.
- **Defaults provisorios de la sección 7 de la spec** (a revisar en la próxima reunión): lote por bines; tope de bines configurable y **sin valor por defecto**; bin a medio llenar se pesa igual al cerrar; `ComprobanteBodega` 1:1 con el remito de salida a bodega, con diferencia de kg calculada.
- Ingreso al pasero **no se genera solo** desde una cosecha con destino pasas: es un paso aparte (con báscula) que se vincula opcionalmente con `cosecha_id`.
- `Comprador` es entidad nueva sin backfill (el texto libre `RegistroCosecha.comprador` queda como está).

## Reglas implementadas

- Kg teórico por carro = 90 fichas × 18 kg = 1.620 kg. Merma de ingreso = teórico − báscula (negativa si la báscula pesó de más).
- Un lote = una variedad; **un solo lote abierto por variedad+calidad** (lotes en paralelo entre variedades). Identificado por temporada + variedad + calidad + número correlativo.
- Cada bin descuenta `kg × ratio` de uva del pasero; se rechaza levantar más pasa que `uva_disponible / ratio`.
- El lote se cierra solo al llegar al tope de bines (si hay tope) o a mano; no se cierra sin bines. Solo se entrega pasa de lotes cerrados.
- Entregas parciales: `Lote.saldo_kg` baja con cada línea de remito; no se entrega más que el saldo (se suman las líneas repetidas del mismo lote).
- Salidas fresco/bodega descuentan del `RegistroCosecha` (destino MI/EXPO para fresco, BODEGA para bodega) hasta agotar sus kg.
- Remito sin número informado → correlativo por tipo (`FRE-`, `BOD-`, `PAS-`).

## Endurecimiento tras la revisión (antes de aplicar la migración)

- **Concurrencia.** Índice único parcial `uq_lote_pasa_abierto` (variedad, calidad) `WHERE estado='abierto'`; la levantada bloquea la fila del pasero y la salida de fresco/bodega bloquea la cosecha, ambos en orden determinístico. Choques de unicidad (lote, número de remito, comprobante, ubicación) devuelven 409, no 500.
- **Rango de kg.** Los schemas limitan a `Numeric(14,2)` (parámetros a `(14,4)`): fuera de rango Postgres daría 500 y SQLite no lo detecta.
- **Backfill de productores.** Solo registros con `origen=tercero`, agrupados sin tildes ni mayúsculas (misma normalización que la API).
- **Ingreso con `cosecha_id`.** Solo acepta cosechas con destino PASAS/RAMA_PASA.
- `pasa_maxima` redondea hacia abajo. `PUT /parametros` pasó a `PATCH` (actualización parcial).
- **A propósito:** no hay anulación de remitos ni borrado (el saldo del lote solo baja). `productor_id` y `proveedor_tercero` pueden divergir en cosechas editadas: el texto es respaldo histórico, manda `productor_id`.

## Parámetros (tabla `parametros_produccion`, `GET/PUT /alta-produccion/parametros`)

`kg_por_ficha` 18 · `fichas_por_carro` 90 · `ratio_uva_pasa` 4 · `kg_nominal_bin` 350 · `tope_bines_lote` (sin valor).

## Superficie de API

`/alta-produccion/{productores,compradores,depositos,parametros}` · `/pasero/{ingresos,ubicaciones,stock}` · `/lotes-pasa` (+ `/{id}/bines`, `/{id}/cerrar`) · `/remitos` (+ `/{id}/comprobante-bodega`). Cosecha: `/produccion/cosecha/` acepta `productor_id`.

## Pendiente

- Aplicar migración `a7c3e91d5b20` en producción (confirmar con Fausto; `scripts/migracion/_alembic_prod.py`), después correr `scripts/generate_modelo_datos.py` (introspecciona la base real).
- Sin anulación/borrado de remitos ni edición de bines en FASE 1.
- Puntos abiertos de la spec (sección 7) para la próxima reunión.
