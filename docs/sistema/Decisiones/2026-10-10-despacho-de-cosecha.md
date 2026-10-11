---
fecha: 2026-10-10
tags: [sistema, decision, produccion, cosecha, remitos, pasero]
estado: en-desarrollo
---

# Decisión: Despacho de cosecha (formulario único De → Para)

Reemplaza el formulario de alta de cosecha (web y mobile). Un solo formulario sirve para los tres destinos de la uva; según el "Para" se da de alta además un remito o el ingreso al pasero. Continúa [[2026-10-07-alta-de-produccion-fase-1]].

## Decisiones tomadas con Fausto (2026-10-10)

- **De:** parral propio (define origen y variedad) o productor tercero. **Para:** bodega (ej. Cegupa), comprador (uva de mesa, ej. Carrascosa) o pasero.
- **Siempre** se guarda el `RegistroCosecha` (parral, mapa, análisis posterior).
- **Tercero solo va a pasero.**
- **Remito:** bodega → `BOD-`, comprador → `FRE-`, pasero → `TRA-` (traslado a pasero, tipo nuevo). Es un **comprobante interno de entrega** (no fiscal), con N° de remito, CUIT y domicilio de la empresa, solo kilos. Se imprime en PDF desde web y mobile.
- **Destino de la cosecha:** bodega → `BODEGA`; comprador → `MI` provisorio (distinguir mercado interno / exportación queda en stand-by; la uva de mesa se reconoce por la variedad Red Globe); pasero → `RAMA_PASA` (se unifica `PASAS` en `RAMA_PASA` para altas nuevas).
- **Peso:** se pesa al salir del parral (`kg_total` = `kg_real` del ingreso al pasero). El pesaje en destino (bodega/comprador/pasero) se registra después; **cómo se maneja está pendiente** (hoy existe `ComprobanteBodega` solo para bodega).
- **Remitos manuales de fresco y bodega:** se reemplazan por este formulario.
- **Pasero, carro incompleto:** tilde en el formulario; fichas estimadas por peso (kg ÷ kg por ficha). No se calcula merma en ese caso.
- **Offline:** se quiere poder cargar sin señal; el verano se instala Starlink. Cosecha mobile mantiene la cola con idempotencia; el ingreso al pasero sigue pidiendo conexión por ahora.
- Se **descarta** `parcela_origen_id` en el ingreso al pasero: el parral vive en la cosecha, y el ingreso se enlaza por `cosecha_id`.

## Plan

F1 backend (endpoint transaccional `POST /produccion/cosecha/despacho`, `TRA`, `comprador_id`, PDF + link firmado) · F2 web · F3 mobile (OTA) · F4 retirar los remitos manuales FRE/BOD.
