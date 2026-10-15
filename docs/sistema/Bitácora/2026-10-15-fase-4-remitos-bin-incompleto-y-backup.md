---
fecha: 2026-10-15
tags: [sistema, bitacora, produccion, remitos, pasa, backup]
---

# Bitácora 2026-10-15: fase 4 del despacho, bin incompleto, productores y backup

Continúa [[2026-10-10-despacho-de-cosecha]] (fase 4) y [[2026-10-13-levantada-de-pasa]].

## Hecho (sin commitear ni deployar al cierre)

- **Fase 4: se retira el alta manual de remitos FRE/BOD.** `POST /remitos/` solo acepta `entrega_pasa`; `salida_fresco`, `salida_bodega` y `traslado_pasero` devuelven 422 y apuntan a `POST /produccion/cosecha/despacho`. Se eliminó el código de cosecha que quedó muerto en `create_remito`. Los remitos viejos se siguen viendo e imprimiendo.
- **Comprobante de bodega (INV)**: se mantiene. Es el pesaje en destino que entrega la bodega al llegar el camión; se carga **cuando llega** (el remito BOD nace sin él). La pantalla Remitos muestra "Pendiente" + "Cargar cuando llegue".
- **Fresco**: el único documento propio es el FRE que sale del despacho al retirar un camión/chasis con cajones.
- **Bin incompleto**: un bin con menos del 80 % del peso teórico (`UMBRAL_BIN_INCOMPLETO` en `lotes_pasa.py`; 280 kg con 350 de nominal) exige observaciones (422 en el backend; en web y mobile el campo pasa a obligatorio y el botón se bloquea). Un bin de 280 kg o más no pide nada.
- **Productores**: `scripts/fusionar_productores.py` mueve las 2 cosechas de `HIDALGO` a `HIDALGO R` (Raúl) y borra `HIDALGO`. Los 3 SANCHEZ (`MARCELO SANCHEZ`, `SANCHEZ`, `SANCHEZ F`) quedan como están por decisión de Fausto. Aborta si los ids o los conteos de uso cambiaron; sobre prod saca `pg_dump` antes.
- **Backup**: la tarea `LosLirios-PG-Backup` terminaba con `0xC000013A` (proceso matado) y dejaba dumps de 0 bytes; la tarea tenía "no correr/parar con batería" en una notebook. Se desactivaron esas dos opciones, se activó "solo con red", el script ahora borra los dumps de 0 bytes al fallar y loguea el error real de `pg_dump`.

## Pruebas

- Backend: 230 tests OK (tests de remitos reescritos para armar FRE/BOD vía despacho; test nuevo del bin incompleto; test de bloqueo del alta manual).
- Web (`tsc` + lint, 0 errores) y mobile (`tsc --stack-size=8000`) OK.
- Local contra una **copia de prod** (`los_lirios_prod_copy`, dump de 2026-10-14): el script de productores (20 → 19, HIDALGO R con 4 cosechas, segunda corrida aborta), pantalla Remitos y formulario de levantada con el bin de 200 kg bloqueado hasta aclarar.
- Prod ya estaba en la migración `7c4e1a9d3b62`: las dos migraciones del 13/10 corrieron bien en prod. Esta tanda **no tiene migración**.

## Pendiente

- Commit + push (backend, Railway) → `vercel --prod` (web) → OTA mobile `eas update --branch production --environment production`.
- Correr `fusionar_productores.py` sobre prod (dry-run primero).
- Entrega depósito → comprador desde mobile (peso del lote y del bin/bolsón; hoy solo web).
- Pesaje en destino, MI vs EXPO, conciliación remito vs INV, confirmar `tara_carro` real (se deja en 400).
