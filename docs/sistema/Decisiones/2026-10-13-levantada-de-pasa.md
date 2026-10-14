---
fecha: 2026-10-13
tags: [sistema, decision, produccion, pasa, lotes, bines, pasero]
estado: implementada
---

# Decisión: Levantada de pasa (pasero → bin con tarja → lote → depósito)

Segundo eslabón de la cadena de la pasa, después del ingreso de uva al pasero ([[2026-10-10-despacho-de-cosecha]]). Continúa [[2026-10-07-alta-de-produccion-fase-1]].

## Decisiones tomadas con Fausto (2026-10-13)

- **Levantada** = la pasa seca sale de Pasero 1, 2 o 3 en **bines / bolsones** que se suman al **lote abierto** de esa variedad y calidad.
- **Un lote = 10 bines** (`tope_bines_lote` = 10 por defecto; borrar el parámetro vuelve a 10). Se cierra solo al completarse. Un lote puede mezclar bines de distintos paseros.
- **Cada bin se pesa real** al levantarlo. El peso teórico es de referencia (350 kg, `kg_nominal_bin`); se muestra la diferencia.
- **La calidad (1 buena / 2 mala) se define en el lote**: el bin entra al lote de su calidad.
- **Depósito único**: no se elige. El lote queda en "Depósito bodega" (resuelto por nombre; lo crea la migración `079038232ad0`). Después la pasa sale del depósito a un comprador por remito PAS (ya existía).
- **Tarja generada por la app**, una por bin, formato `2026-FLA-C1-N01-B03` = temporada · 3 letras de variedad · calidad · N° de lote · N° de bin dentro del lote. Única por lote.
- **El lote se abre explícitamente antes** de levantar (la levantada no lo abre sola); en las pantallas hay un botón "Abrir lote" en el mismo paso.

## Implementación

- Migración `5b2f8c1d7a44`: `bines_pasa.tarja` (backfill de bines existentes por orden de levantada, NOT NULL, único por lote) y asignación del depósito único a lotes sin depósito.
- `POST /lotes-pasa/{id}/bines` genera la tarja bajo el lock del lote; `POST /lotes-pasa/` asigna el depósito único e ignora el que mande el cliente; `/cerrar` ya no pide depósito.
- Web: pantalla **Levantada** (sub-nav Pasa) con lote abierto n/10, pasero, peso real, teórico, diferencia, uva disponible y tarja resultante; Lotes de pasa muestra la tarja de cada bin y ya no tiene selectores de depósito.
- Mobile: pantalla **Levantar pasa** por pasos (qué pasa → pasero y peso → confirmar), accesible desde Cosecha; "Otro bin" repite lote y pasero. El form viejo "Agregar bin" del detalle del lote se reemplazó por un acceso a Levantar pasa.

## Rediseño (2026-10-14): lote primero, tarja y hoja imprimibles

Fausto pidió cambiar el flujo (web y mobile):
- **Lotes de pasa**: abrir y cerrar lotes con pestañas **Abiertos / Cerrados / Todos** (default Abiertos), igual en web y mobile.
- **Levantada**: lista **solo los lotes abiertos**; al elegir uno se abre su ventana para **agregar un bin/bolsón** (pasero, kg reales, **observaciones opcionales por bin**) y, a la derecha de cada bin, **Imprimir tarja**.
- **Tarja**: PDF de **media hoja A4 horizontal (A5 apaisado)**; los dos lados repiten Fecha, Variedad, Calidad, Lote, **Peso (kg)** y N° de bin (con el código de tarja y las observaciones), separados por una línea de doblez.
- **Hoja del lote**: al completarse (lote cerrado) se imprime una hoja A4 con los datos del lote y el listado de bines/bolsones (N° y tarja, fecha, pasero, kg, total y diferencia contra el teórico); las observaciones de cada bin van en una fila de ancho completo debajo, porque una columna angosta se salía de la hoja en xhtml2pdf.
- Backend: migración `7c4e1a9d3b62` (`bines_pasa.observaciones`), `GET /lotes-pasa/{id}/bines/{bin}/tarja-pdf`, `GET /lotes-pasa/{id}/pdf` (409 si el lote no está cerrado) y links firmados de 5 min para mobile (`POST .../tarja-pdf-link`, `.../pdf-link`, descarga `GET /lotes-pasa/descarga/{token}`).
- Componente compartido: `LoteDetalleModal` (web) y `LoteModal` (mobile), con modo `levantada` / `lotes`.

## Fuera de alcance / pendiente

- xhtml2pdf: las tablas con varias columnas de ancho fijo no respetan los anchos (la última columna se angosta y se sale); evitar columnas de texto libre en tablas de PDF, usar una fila de ancho completo.
- Edición o anulación de bines (no existe a propósito, como los remitos).
- Conciliación depósito → comprador y entregas desde mobile (siguen en la web).
- Sin offline: el backend valida la uva disponible del pasero en cada bin.
