---
tags: [sistema, sesion, feature, produccion, pasa, cosecha, remitos]
---

# 2026-10-07 — Alta de Producción FASE 1 (backend) en producción

Pedido de Fausto: dar de alta los kilos de producción con una serie de documentos, siguiendo la spec "Sistema de Alta de Producción" del 5-oct (cosecha → pasero → lote de pasa → depósito → comprador). Decisiones y reglas completas en [[2026-10-07-alta-de-produccion-fase-1]] (carpeta Decisiones).

## Qué se hizo

- Se leyó la spec, se mapeó contra lo existente y se hicieron 8 preguntas antes de tocar código (cosecha existente se extiende, origen unificado con `Productor`, reemplaza el placeholder de Producto Terminado, solo kilos, 4:1 contra el total por variedad, solo backend).
- Backend: 11 tablas nuevas + `registros_cosecha.productor_id`; servicios `mermas.py` y `alta_produccion.py`; routers `maestros_produccion`, `pasero`, `lotes_pasa`, `remitos`; `/produccion/cosecha/` acepta `productor_id`.
- `code-reviewer` encontró 15 puntos; se corrigieron los de concurrencia (índice único parcial de lote abierto, locks de pasero y cosecha, 409 en vez de 500), rango de kg (`Numeric(14,2)`) y backfill (solo `origen=tercero`, sin tildes). Migración corregida **antes** de aplicarla.
- Tests: 183 verdes (32 nuevos en `test_alta_produccion.py`).

## Deploy

1. Backup (`backup_postgres.ps1`) → `current` = `e44e14c0a72b` → `head` = `a7c3e91d5b20` en producción.
2. Verificación de solo lectura: 11 tablas, índice parcial, 161/161 cosechas de terceros enlazadas a 20 productores.
3. Commit `816a3cd` + push → Railway desplegó (endpoints 401 sin login).
4. Prueba en producción con datos `ZZ-PRUEBA`/`PRUEBA-ALTA-PROD` en Pasero 3 (variedad `otro`): ingreso 1.540,5 kg (teórico 1.620, merma 79,50), lote, bines de 350 y 35 kg, rechazo de 40 kg (máx. 35,12), entregas 100 + 285 kg, rechazos por exceso de saldo. Todo según lo esperado. Datos borrados después; producción quedó como antes.
5. `generate_modelo_datos.py` corrido contra producción; se agregó el dominio "Alta de producción" a su lista.

## Lecciones

- La conexión `mcp__postgres` apunta a la base **local**, no a producción. Para leer prod: script corrido con `!` (usa `.env.prod`).
- En `!` (Git Bash) las rutas de Windows necesitan `/`; ojo con el directorio de trabajo (`backend/` vs raíz).
- Probar en prod sin pasar credenciales: sesión logueada en Claude in Chrome y `fetch` desde la página.
- Los avisos `LF → CRLF` de git en Windows son normales.

## Pendiente / próximo paso

- **FASE 2:** pantallas web (y después mobile): maestros (productores, compradores, depósitos), alta de cosecha con productor, ingreso al pasero (báscula, merma), lotes (abrir, bines, cerrar), remitos (entrega de pasa, salida fresco/bodega, comprobante INV), tablero de stock por pasero/lote/depósito. Solo kilos.
- **Decisiones para la reunión:** tope de bines por lote (hoy sin valor), bin a medio llenar, conciliación remito propio vs. INV.
- **Productores a revisar a mano:** `SANCHEZ` / `SANCHEZ F` / `MARCELO SANCHEZ`, `HIDALGO` / `HIDALGO R`.
- Sin probar en prod: salidas fresco/bodega y comprobante INV (cubiertas por tests).
- Sin anulación/borrado de remitos, por diseño.
- FASE 3: raqueo y trazabilidad espacial por productor externo.
