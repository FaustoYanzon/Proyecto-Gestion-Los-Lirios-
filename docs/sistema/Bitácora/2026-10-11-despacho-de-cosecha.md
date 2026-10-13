---
tags: [sistema, sesion, feature, produccion, cosecha, remitos, pasero, frontend, mobile]
---

# 2026-10-11 — Despacho de cosecha (De → Para) + reorganización de Alta de Producción

Implementa la decisión [[2026-10-10-despacho-de-cosecha]]: un formulario único reemplaza el alta de cosecha en web y mobile. Continúa [[2026-10-08-alta-produccion-fase-2]].

## Qué se hizo

### F1 backend (`3fa0e0d`, migración `440f0e507ad5`)
- `POST /produccion/cosecha/despacho`: crea cosecha + remito (bodega / comprador / pasero) + ingreso al pasero en una transacción, idempotente.
- Remito nuevo `TRA-` (traslado a pasero); `pasero_id` y `comprador_id` nullable con CHECK por tipo.
- PDF del remito con link firmado de 5 min.
- Despacho y remitos restringidos a `encargado` o superior (regador → 403).

### F2 web
- Modal de despacho, listado de cosecha y remitos.

### F3 mobile (`07f5d77`)
- Formulario único en la pestaña Cosecha; tercero solo a pasero; carro incompleto estima fichas.
- `idempotency_key` por apertura del modal; imprimir remito con link firmado.
- Pestaña Cosecha oculta a regador/obrero.
- Ingreso al pasero: parral de origen y formulario rediseñado.

### Peso por carros (`8010ecf`)
- Parámetro `tara_carro` (400 kg provisorio): `kg = peso en báscula − tara × carros`.
- Propio → pasero se informa con carros + peso en báscula (`kg_total` explícito se rechaza con 422).
- Chasis: bruto/tara, sin cantidad ni peso unitario; otros envases: cantidad × peso unitario.
- "Comprador" pasa a llamarse "Uva en fresco"; transporte y observaciones colapsable y opcional.

### Reorganización web (`2585d1c`, migración `079038232ad0`)
- Ingreso al pasero: sin formulario manual (el ingreso nace del despacho); 2 pestañas: Ingresos / Stock de uva por variedad.
- Se elimina la pantalla Stock; su contenido pasa a **Producto Terminado** (solo lectura: cargado, entregado, disponible por lote y por depósito).
- Productores, Compradores, Ubicaciones y Parámetros pasan a **Documentación**; se elimina la pantalla Depósitos.
- Migración de datos: depósitos fijos (Pasero 1-3 y Depósito bodega), solo inserta los que faltan; no toca los existentes; `downgrade` no hace nada a propósito.

## Verificación previa al deploy
- pytest 225 verdes · `tsc` mobile exit 0 · lint web 0 errores · `npm run build` OK · `alembic upgrade head` local en `079038232ad0`.

## Pendiente
- **F4:** retirar los remitos manuales FRE/BOD (hoy conviven con el despacho).
- Pesaje en destino (kg recibidos) y MI vs EXPO: sin definir.
- Probar en iPhone real (cierre de lote, modales encadenados, despacho mobile).
- `tara_carro` (400 kg) es provisorio: confirmar el valor real con Fausto.
- Decisiones abiertas de la reunión: `tope_bines_lote`, bin a medio llenar, conciliación remito propio vs INV; productores duplicados del backfill (SANCHEZ, HIDALGO).
- OTA mobile del despacho: verificar si ya se publicó (fingerprint sin cambios esperado).
