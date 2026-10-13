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

## Fuera de alcance / pendiente

- Imprimir la tarja (PDF / etiqueta): hoy se muestra en pantalla.
- Edición o anulación de bines (no existe a propósito, como los remitos).
- Conciliación depósito → comprador y entregas desde mobile (siguen en la web).
- Sin offline: el backend valida la uva disponible del pasero en cada bin.
