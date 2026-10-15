---
fecha: 2026-10-15
tags: [sistema, bitacora, produccion, pasa, remitos, mobile]
---

# Bitácora 2026-10-15: entrega de pasa por bines (depósito → comprador), web y mobile

Continúa [[2026-10-13-levantada-de-pasa]] y [[2026-10-15-fase-4-remitos-bin-incompleto-y-backup]].

## Decisión (Fausto, 2026-10-15)

- La entrega a un comprador se arma **solo por bines / bolsones**: el peso del remito es la suma de los pesos reales ya cargados, **nadie tipea kg**. No hay kg libres.
- Un bin sale **una sola vez** (garantizado por un índice único parcial en la base, no solo por el endpoint).
- Mismo modelo en **web y mobile**. En prod no había ninguna entrega de pasa cargada, así que no hubo historia que migrar.

## Implementación

- Migración `9d3a6f1b2c85`: `remito_lineas.bin_id` (FK a `bines_pasa`, único donde no es nulo). Probada sobre una copia de prod (upgrade, downgrade, upgrade).
- `POST /remitos/` (`entrega_pasa`): cada línea es `{bin_id}`; el backend valida lote cerrado, bin no entregado y sin repetidos, toma `kg = bin.kg_real`, descuenta `Lote.saldo_kg` bajo lock del lote y rechaza todo el remito si algún bin ya salió (409 con la tarja). Líneas con `lote_id`, `cosecha_id` o kg libres dan 422.
- `GET /lotes-pasa/{id}`: cada bin trae `entregado` y `remito_numero`. Las líneas de remito traen `tarja`; el PDF del remito PAS lista la tarja de cada bin.
- Web: el modal "Nueva entrega de pasa" elige comprador y lote, lista los bines con casillero (con "Todo el lote"), muestra los ya entregados deshabilitados con su remito y calcula el total solo.
- Mobile: pantalla `alta-produccion/entrega` (acceso "Entregar pasa a un comprador" en la pestaña Cosecha) y `EntregaModal`: lotes cerrados con saldo → comprador + bines tildables → remito PAS → "Imprimir remito" (link firmado de 5 min).

## Pruebas

- Backend: 230 tests OK (4 tests de entrega reescritos por bines + casos de bin repetido, lote abierto y líneas inválidas).
- Web y mobile: `tsc` sin errores; lint web sin errores.
- Local contra copia de prod: lote de 3 bines → entrega de 2 → remito PAS-000001 de 206,5 kg con las dos tarjas, saldo del lote 73,75, el mismo bin otra vez devuelve 409, y el PDF lista las tarjas. **La pantalla mobile no se probó en un dispositivo ni en el simulador**: solo compila y usa el mismo endpoint probado en web.

## Pendiente

- Probar la pantalla mobile en un celular (después del OTA).
- Pesaje en destino, MI vs EXPO, conciliación remito vs comprobante de bodega.
- Anulación de remitos/entregas: no existe a propósito (como el resto de los remitos).
