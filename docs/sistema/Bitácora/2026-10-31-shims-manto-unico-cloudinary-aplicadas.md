---
fecha: 2026-10-31
tags: [sistema, bitacora, produccion, fitosanitarios, ordenes-aplicacion, riego, cloudinary, deploy]
---

# Bitácora 2026-10-31: limpieza de shims, manto único, borrado en Cloudinary y vista Aplicadas

Sesión de cierre de varios frentes, todos en prod desde `main` (merge `1297edc`). Backend en Railway, web en Vercel (proyecto `frontend`). Sin cambios de app pendientes de deploy, salvo el OTA de mobile descrito abajo.

## Qué se deployó

1. **Limpieza de shims (`chore/limpiar-shims`, 2026-10-30).**
   - Migración `506076f9ed21` aplicada en prod. Se borraron las columnas legacy `plan_fitosanitario_id` (en `ordenes_aplicacion` y `registros_fitosanitarios`) y `numero_aplicacion` (en `ordenes_aplicacion_insumos`).
   - Se eliminó `POST /ordenes-aplicacion/desde-plan`.
   - Las columnas shim de la orden (`insumo_id`, `dosis_por_ha`, `dias_carencia`, `dias_reingreso`, `variedad`, `origen`) **se mantienen**, porque los builds viejos de mobile las leen. Las órdenes nuevas se graban con `origen='extra'`.
2. **Limpieza menor (2026-10-30/31).**
   - Se quitaron el servicio, el test y el script de `plan_duplicados`, que no tenían uso.
   - Se quitó de mobile el bloque de diagnóstico `ErrorUtils.setGlobalHandler`. El cambio necesita OTA y todavía no se publicó.
   - `scripts/backup_postgres.ps1` reintenta errores de red transitorios (5 intentos, 60 s cada uno).
3. **Riego a manto con un solo manto en curso por parcela (`fix/riego-manto-indice-unico`, 2026-10-31).**
   - Migración `822f93f13a0d`: índice único parcial `ux_registros_riego_manto_en_curso`.
   - Antes de migrar se corrió `scripts/migracion/pregate_riego_manto_unico.py`. Prod tenía 2 mantos en curso y ningún duplicado por parcela, así que el índice entró limpio.
   - `iniciar_riego` responde 409 ante un segundo manto en curso de la misma parcela.
4. **Borrado de archivos en Cloudinary (`feat/cloudinary-borrado`, 2026-10-31).**
   - Al borrar una foto de parcela, una foto de orden, un informe de análisis o una aplicación que tenga fotos, el archivo también se destruye en Cloudinary, después del commit.
   - Es best effort: un fallo de Cloudinary no revierte el borrado en la base.
   - Solo actúa sobre la cuenta propia y sobre los prefijos `fotos_parcela/`, `fotos_ordenes_aplicacion/` e `informes_analisis/`.
   - **No limpia huérfanos preexistentes.** Un barrido de solo reporte queda como follow-up opcional.
5. **Vista "Aplicadas" en Órdenes de Aplicación (web).**
   - La banda de carencia gigante se reemplazó por un chip por parcela, con los días que faltan hasta la `fecha_habilitacion_cosecha` más lejana. Al hacer click se ven los productos que limitan.
   - La lista es un árbol colapsable orden > parcela > válvula. Las válvulas aparecen primero las confirmadas más recientes.
   - Reactivar y Eliminar actúan por válvula, con las mismas confirmaciones de antes.
   - La pestaña sigue el selector de campaña (mayo → abril) y trae todos los registros paginados de a 1000.
   - Backend: `RegistroFitosanitarioResponse` expone `orden_valvula_id`, y `GET /produccion/fitosanitarios/` ordena con un desempate determinístico por id.
   - "Hoy" ahora es la fecha local y no la UTC.
   - Archivos: se borró `FitosanitariosTable.tsx`; nuevos `lib/fitosanitariosAgrupar.ts`, `components/produccion/AplicacionesAgrupadas.tsx` y `components/produccion/CarenciaParrales.tsx`. Sin migración.

## Decisiones

- **Producto Terminado queda solo para pasa.** La empresa no produce mosto y la uva fresca no necesita control de stock. Se descartó extender Producto Terminado a otros tipos.
- **Shims de la orden: se conservan hasta confirmar que no quedan builds viejos.** Quitarlos antes rompe a los operarios con la app sin actualizar. Se decidió dejarlos y fijar `origen='extra'` para las órdenes nuevas.
- **Cloudinary: borrado best effort y acotado a prefijos propios.** Un error de red no debe bloquear el borrado de un registro, y no se toca nada fuera de nuestros prefijos.

## Incidente: proyecto Vercel duplicado

`npx vercel --prod` se ejecutó desde la raíz del repo en vez de `frontend/`. Creó y desplegó un proyecto Vercel `los-lirios` solo con backend, sin variables de entorno y sin datos expuestos. Se borró el mismo día. La web se desplegó bien desde `frontend/`.

**Regla:** siempre `cd /c/claude-projects/los-lirios/frontend && npx vercel --prod`.

## Abierto

- **Plan vs aplicado (punto 7):** hay discrepancias entre el plan fitosanitario y lo aplicado en Mancozeb, Super folpan y Karathane. Está con el ingeniero; no se tocó la data.
- **Chequeo de builds viejos antes de quitar los shims:** revisar Play Console y TestFlight para ver qué versiones de la app siguen instaladas.
- **OTA de mobile:** publicar la quita del handler de diagnóstico. Primero `npx eas-cli fingerprint:compare` contra el build instalado y después `eas update` en `production`.
- **`docs/sistema/Modelo de Datos.md`:** regenerar. Lo corre Fausto, porque el script lee la base de producción.
- **Cuentas de usuario para operarios** (pendiente de siempre).
- **Testers:** Play (12 testers en prueba cerrada) e iOS (TestFlight).
- **Huérfanos en Cloudinary:** barrido de solo reporte, si Fausto lo quiere.
