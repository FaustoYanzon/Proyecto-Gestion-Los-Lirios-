---
fecha: 2026-10-26
tags: [sistema, bitacora, produccion, fitosanitarios, ordenes-aplicacion, valvulas, deploy]
---

# Bitácora 2026-10-26: despliegue de fito por válvula

Despliegue de la confirmación de órdenes de aplicación válvula por válvula. Runbook: `docs/superpowers/plans/2026-10-23-fito-confirmacion-por-valvula-deploy.md`.

## Estado de partida

- El código ya estaba en `origin/main`, incluidas las migraciones `b5210a4d05af` y `33a3c708b565`.
- Railway ya había aplicado las migraciones: el log de arranque no muestra "Running upgrade" y el startup terminó OK. **El runbook del 10-23 decía "nada desplegado": quedó desactualizado.**
- La clave de Postgres se rotó. La nueva está en `backend/.env` (`DATABASE_PUBLIC_URL`). Con la vieja falla con `InvalidPasswordError`; eso también afecta a `generate_modelo_datos.py` y al backup de prod.

## Pasos ejecutados

1. **Dry-run de superficies en prod:** OK. 57 válvulas. Potrero 3 da 2,20 vs 2,20. Los desvíos restantes ya se habían aceptado el 10-23.
2. **Backups de prod antes de cargar:**
   - `C:\backups\los-lirios\los_lirios_prod_20261026_1211.dump` (+ copia en OneDrive).
   - `pg_backups\los_lirios_prod_20261026_121947_pre_superficie_valvulas.dump` (generado automáticamente por el script).
3. **`cargar_superficie_valvulas.py --db prod --aplicar`:** 57 válvulas actualizadas.
4. **Web:** `vercel --prod` en estado READY. Alias `frontend-six-jade-79.vercel.app`.
5. **Mobile:**
   - Android: fingerprint local igual al build versionCode 8 (id `b698e814-ef2c-4a0f-9dd3-344bcd074e69`, runtime `1ccf455d…`). OTA publicado en branch `production`, update group `f3baaed2-5e06-4fd4-b7cc-895c7d3dc526` (runtime `1ccf455d…`).
   - iOS: OTA con runtime `07054827…`. **Sin comparar** contra un build de TestFlight.
   - Builds Android 4, 5 y 6 (runtime `1.0.0`) no reciben OTA y no pueden confirmar parcelas con válvulas (409).

## Prueba

Fausto hizo la prueba real: todo funciona.

## Pendientes

- **iOS:** comparar el fingerprint contra el build de TestFlight.
- **Sin "deshacer"** para una válvula ya confirmada.
- **Push:** el push sale antes del commit.
- **Un token de push por usuario.**
- **Unidad de dosis en el repaso.**
- **Avisar a operarios con builds 5 y 6** que reinstalen (versionCode 8).
- **Commit `51ca1e4`** (chore claude) está solo en la rama `feat/fito-por-valvula`, no en `main`.
