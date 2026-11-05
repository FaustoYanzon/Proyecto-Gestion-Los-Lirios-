---
fecha: 2026-11-05
tags: [sistema, bitacora, pendientes, mobile, deploy]
---

# Bitácora 2026-11-05: cierre de pendientes de la sesión del 2026-10-31

Se revisan uno por uno los pendientes que dejó la bitácora del 2026-10-31. Cada punto se anota acá cuando queda resuelto.

## Resueltos

### 1. OTA de mobile: quita del handler global de diagnóstico
- Commit `16775b1` ya estaba en `main`; `tsc --noEmit` limpio.
- `fingerprint:compare` coincidió con los dos builds vigentes: Android #8 (`b698e814`, `1ccf455d…`) e iOS #6 (`e0daee50`, `07054827…`).
- Publicado en el branch `production` con `EXPO_PUBLIC_API_URL` explícita:
  - Android: update group `56529fd2-4b94-443b-bc1b-dc4c40cfe24b`.
  - iOS: update group `9bd9400d-9ab2-4e5c-918e-331a5e9022a3`.
- Verificación del bundle publicado: la URL de Railway de producción está grabada, no hay ninguna IP `192.168.x.x`, y el texto del diagnóstico ("mandale captura a Fausto") ya no está. `setGlobalHandler` sigue apareciendo una vez porque lo usa `react-native/Libraries/Core/setUpErrorHandling.js`, no nuestro código.
- Nota: `eas-cli update:view` no acepta `--non-interactive`.

### 2a. Chequeo de builds viejos antes de quitar los shims (solo lectura)
- **Play Console (Los Lirios SA):** Prueba cerrada (Alpha) y Prueba interna están en la versión 8 (1.0.0). Estadísticas por versión de la app (8 oct → 4 nov): solo aparece 1.0.0 (8), con 1 a 4 usuarios con la app instalada por día. No hay versiones anteriores en uso.
- **TestFlight:** el único tester es el grupo interno "Team (Expo)", con 1 tester (Fausto), que tiene instalada la 1.0.0 (6). Builds activos: 6 (85 instalaciones, vigente) y 4 (29 instalaciones, caduca en 26 días, sin testers que la usen hoy).
- **Conclusión:** no queda ningún build anterior al 8 (Android) / 6 (iOS) en uso, así que las columnas shim de la orden se pueden quitar. Limitación: las estadísticas de Play solo cubren instalaciones desde Play, no APKs externos; los builds de EAS son todos del perfil `production` de tienda.

### 2b. Requisitos para salir a producción en Play Store (panel de la app, 2026-11-05)
- Producción está inactiva. Para "Solicitar acceso a producción" Google exige una prueba cerrada con **al menos 12 verificadores que acepten participar, durante al menos 14 días**.
- Estado hoy: versión de prueba cerrada publicada (OK); **10 de 12** verificadores aceptaron; el botón de solicitar acceso está deshabilitado. Faltan 2 y después los 14 días corridos con 12 o más.
- App Store: TestFlight no tiene mínimo de testers y no es requisito para publicar. En App Store Connect la app figura "iOS 1.0 en preparación para el envío" y hay un aviso de contrato de licencia del Apple Developer Program por aceptar (lo tiene que aceptar el titular de la cuenta).

### 2c. Quitar las columnas shim de la orden (rama `chore/quitar-shims-orden`, sin deployar todavía)
- **Decisión:** se dropean de `ordenes_aplicacion` las 6 columnas legacy (`origen`, `variedad`, `insumo_id`, `dosis_por_ha`, `dias_carencia`, `dias_reingreso`), la FK `ordenes_aplicacion_insumo_id_fkey` y el enum `origenordenaplicacion`. Productos salen solo de `lineas`; variedades, de las parcelas de la orden. Se pierde el dato `origen` (plan vs extra) de las órdenes históricas, aceptado: el vínculo con el plan ya se había cortado.
- **Migración `0861ea1414eb`** (down_revision `822f93f13a0d`). Downgrade con backfill SQL (línea posicion=0, variedad de la parcela más grande, origen='extra'), **probado en la base local con 9 órdenes** (incluida una multivariedad): 0 columnas NULL y el shim igual a la línea 0. `alembic check` limpio.
- **Backend:** se eliminó `_sincronizar_shim`; la respuesta de la orden ya no trae los 8 campos shim; el filtro `?variedad=` usa solo las parcelas; `/a-revisar` omite órdenes sin líneas (logger.error) y su `variedad` puede ser `null`. El request con body viejo de un producto se sigue aceptando. pytest: 468 passed.
- **Web:** tipos y `page.tsx` sin fallback a shims; `ARevisarPanel` maneja `variedad` null. `tsc` y `npm run build` OK.
- **Mobile:** sin fallback a shims y sin insignia de `origen`. `tsc` OK. Requiere OTA antes del deploy del backend (el OTA publicado hoy todavía lee `orden.origen`).
- **Prueba local con click real (Chrome):** pendientes, aplicadas, A revisar y crear orden (POST 201) sin errores en consola.
- **Revisión (`code-reviewer`):** sin bloqueantes. Riesgo de deploy: Railway corre `alembic upgrade head && uvicorn` en el arranque (`backend/railway.json`), así que la migración se aplica sola al pushear y hay una ventana corta entre la migración y el contenedor nuevo.
- **Pregate de prod:** `scripts/migracion/pregate_quitar_shims_orden.py` (solo lectura; bloquea si hay órdenes sin líneas o falta la FK).

### 2d. Deploy de los shims: pasos previos al merge (2026-11-05)
- **Pregate prod:** OK. 3 órdenes, todas con línea, FK presente, `origen=extra` en las 3 (se pierde), 0 órdenes con shim distinto de la línea 0.
- **Backup prod:** `los_lirios_prod_20261105_1423.dump` (1.7 MB), copiado a OneDrive.
- **Fingerprint local = builds vigentes:** Android `1ccf455d…`, iOS `07054827…`.
- **OTA mobile sin campos legacy** (mensaje "quitar campos legacy de la orden"), publicado antes del merge porque el OTA anterior leía `orden.origen`:
  - iOS: update group `315fa304-e097-4371-9bc2-51ea19356021`.
  - Android: update group `ca2dfebf-c073-4261-9b35-a45de2a791dd`.
  - Bundle verificado: sin `ORIGEN_LABELS`/`origenBadge`/`orden.origen`, con la URL de prod y sin IP local.

### 2e. Deploy de los shims: hecho (2026-11-05)
- Commit `317bac9` + merge `031a17f` en `main`, push a `origin/main`. Railway deploy `0b5ca2ad…` SUCCESS: la migración `0861ea1414eb` corrió sin errores y uvicorn levantó.
- **Verificación directa en prod (solo lectura):** `alembic_version = 0861ea1414eb`, ninguna columna shim en `ordenes_aplicacion`, enum `origenordenaplicacion` inexistente, datos intactos (3 órdenes, 12 líneas).
- **Web:** `npx vercel --prod` READY, alias `frontend-six-jade-79.vercel.app`.
- `Modelo de Datos.md` regenerado desde prod: 36 → 35 enums, 90 → 89 relaciones.
- Sin verificar: click-through en la web de prod (la pestaña pidió login; lo inicia Fausto).

## Abiertos
- Click-through en prod de órdenes y A revisar (requiere sesión de Fausto).
- Huérfanos en Cloudinary, plan vs aplicado, cuentas de operarios, testers, Ingresos vs dashboard, Alta de Producción (ver bitácora del 2026-10-31 y memoria del proyecto).
