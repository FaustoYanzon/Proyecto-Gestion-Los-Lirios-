---
tags: [sistema, sesion, feature, produccion, pasa, lotes, bines, mobile, frontend, ota]
---

# 2026-10-13 — Deploy del despacho, ajustes mobile y levantada de pasa

Continúa [[2026-10-11-despacho-de-cosecha]]. Decisión de la levantada: [[2026-10-13-levantada-de-pasa]].

## Qué se hizo

### Deploy del despacho (commits `07f5d77`..`754f1e3`)
- Push + Railway (migración `079038232ad0` aplicada) + Vercel `--prod`. Verificado en producción solo lectura con Claude in Chrome: Ingreso al pasero (2 pestañas), Producto Terminado, Documentación (Ubicaciones, Parámetros) y modal de despacho.
- Despacho completo probado en local: propio → Pasero 1, 2 carros, 3.400 kg báscula → 2.600 kg de uva (tara 400 × 2), remito TRA, PDF 200, ingreso al pasero.

### Ajustes mobile del despacho (probados por Fausto en iPhone)
- Formulario **por pasos** con el `Wizard` compartido (De+Para en un solo paso → Peso → [Transporte] → Confirmar).
- Parral, productor, pasero, ubicación, bodega/comprador y variedad como **desplegable anclado al casillero** (`SelectField`; la hoja inferior la tapaban los bordes del iPhone).
- Al pasero la uva entra **de a 1 carro**: peso real del carro + tara y kg de uva en casillas de solo lectura; "Otro carro" repite origen y destino.
- "Comprador" → "Uva en fresco". Saqué "Ingreso al pasero" de Inicio; todo Alta de producción se abre desde Cosecha. Ícono de Cosecha: racimo de uva.
- **Bug:** un comprador creado en la web no aparecía en mobile (la pestaña quedaba montada con la lista cargada una vez). Ahora los maestros se recargan al abrir el formulario.
- OTA mobile publicado tres veces (iOS/Android, mismos runtimes).

### Levantada de pasa (backend + web + mobile)
- Migración `5b2f8c1d7a44`: `bines_pasa.tarja` (backfill, NOT NULL, único por lote) y depósito único asignado a lotes sin depósito.
- Tope de bines por lote por defecto = 10; depósito único "Depósito bodega" asignado al abrir el lote; tarja `2026-FLA-C1-N01-B03` generada al agregar el bin.
- Web: pantalla **Levantada** (sub-nav Pasa); Lotes de pasa muestra tarja y ya no pide depósito.
- Mobile: pantalla **Levantar pasa** por pasos, acceso destacado en Cosecha; el detalle del lote lleva a ella en lugar del form viejo.

### Rediseño de la levantada (14/10)
- Web y mobile: Lotes de pasa con pestañas Abiertos/Cerrados/Todos; Levantada muestra solo lotes abiertos y abre la ventana del lote para agregar bines (con observaciones) e imprimir la tarja de cada uno; lote cerrado → hoja del lote.
- Backend: migración `7c4e1a9d3b62` (observaciones por bin), PDFs de tarja (A5 apaisado, dos lados) y de hoja del lote (A4), con links firmados para mobile. Tests: 229 verdes.
- Probado en local con Chrome: bin con observación y tarja (PDF 200); el sistema bloquea el peso si excede la uva disponible del pasero.

### Ajustes a los PDF (tras probarlos Fausto en producción)
- La tarja ahora incluye el **peso (kg)** del bin.
- Hoja del lote: la columna de observaciones se salía de la hoja y la tabla se cortaba en 4 páginas; las observaciones pasan a una fila de ancho completo bajo cada bin y la columna N° se unió a la de tarja. Verificado dibujado en Chrome (pdf.js sobre un servidor local de muestras): 1 página, observaciones largas y palabras sin espacios contenidas.

## Verificación
- pytest 228 verdes (4 tests nuevos: tarja correlativa, lote mixto y cierre al bin 10, depósito único, default 10); `tsc` mobile exit 0; lint web 0 errores y build OK.
- Migración aplicada en la base local (backfill: `2026-FLA-C1-N01-B01`, depósito asignado). **Falta probarla en una copia de prod antes de pushear.**
- Web local con Chrome: abrir lote Flame C1 → levantar bin de 340 kg desde Pasero 1 → tarja `2026-FLA-C1-N02-B01`, lote 1 de 10, uva disponible 3.700 → 2.340 kg.

## Estado al cierre de la sesión (14/10)
- En producción: backend (migraciones `5b2f8c1d7a44` y `7c4e1a9d3b62`), web (Vercel) y OTA mobile de la levantada rediseñada. Los ajustes de PDF (peso en tarja, hoja del lote) quedan commiteados y **pendientes de push + deploy de Railway** (solo backend: no cambia web ni mobile).

## Pendiente
- Imprimir tarja (PDF / etiqueta); entregas depósito → comprador desde mobile.
- Crear la segunda bodega/comprador de prueba en producción (`ZZ-PRUEBA Bodega`).
- Fase 4 del despacho (retirar remitos manuales FRE/BOD) y decisiones abiertas de la reunión (pesaje en destino, MI vs EXPO, conciliación remito vs INV, productores duplicados).
