# Sesión 2026-11-05 — Parral 4/5, manto ×4, ciclo sincronizado, mapa, Fito, Cumplimiento Riego

Aprobado por Fausto en chat el 2026-11-05. Orden de ejecución fijo (1 → 6).

## 1. Parral 4 / Parral 5
- Superficie real: 2 ha cada uno (4 válvulas, 1 ha por válvula). Hoy 2.85 en `seed_parcelas.py` y `frontend/scripts/build-finca-map.mjs`.
- Parral 5 es el del sur, Parral 4 el del norte. Corregir nombres/geometría en el mapa (KML → GeoJSON). **No cambiar IDs de parcela** (los riegos existentes no se mueven).
- Revisar `scripts/seed_valvulas.py` / `auditoria_valvulas_geojson.py` (válvulas 41–48) tras el swap.
- Prod: UPDATE de superficie + consulta read-only previa para detectar riegos cargados contra el parral equivocado. Confirmar con Fausto antes de escribir.

## 2. Riego a manto = 4× goteo
- `RegistroRiego.FACTOR_MANTO = 4.0`; eliminar `FACTOR_MANTO_LEGACY` (0.4). mm = h × 1.6 × 4; litros = h × 16.000 × 4 × n_valvulas.
- Actualizar previews en web (`produccion/riego`) y mobile (`riego.tsx`), `core/labels.py`, `pdf_carta.py` si usan el factor.
- Vista `vw_kpi_produccion` (migración `c3f1a8d27e54`): nueva migración que la recrea con factor 4. No editar migraciones aplicadas.
- Migración de datos (script en `scripts/migracion/`, dry-run + backup): recalcular `mm_aplicados` de todo manto, y `n_valvulas_manto` de manto nuevo con `valvulas_manto_de(superficie)` (Parral 4/5 → 2). Histórico con `n_valvulas_manto` NULL: queda con n del CSV `valvula`, factor 4.
- Tests: factor, mm, litros, historico y nuevo.
- Efecto colateral: porcentajes vs objetivo 6M L/ha cambian.

## 3. Ciclo de campaña sincronizado
- Causa: mobile `estado-campana.tsx` escribe `POST /produccion/campana/` (CicloCampana, por parcela) y lee `/campana/estado-actual/`; web y mapa usan `EstadoVariedadCampana` (`/estado-campana/*`, base de `/fenologia/estado-actual`).
- Fix: mobile usa `GET /produccion/estado-campana/actual` y `POST /produccion/estado-campana/`; invalidar/refetch en index y mapa. `CicloCampana` queda solo para rendimiento.
- Overrides previos en `ciclos_campana` no se migran. Requiere OTA.

## 4. Mapa
- Quitar el modo "Riego" en `FincaMapInner.tsx` (web) y `mobile/app/(tabs)/mapa.tsx`; dejar "Cumplimiento riego".

## 5. Fito
- "Plan Fitosanitario" pasa a vista de solo lectura (estilo metas/presupuesto) con acceso a editar el plan. Supuesto: botón "Editar plan".
- "Cumplimiento" → "Cumplimiento Fito" con filtro de variedad y filtro dependiente de parral/potrero. `/plan-fitosanitario/avance` suma `variedad` y `parcela_id`.
- Actualizar `frontend/lib/navigation.ts` y el link en `ordenes-aplicacion`.

## 6. Cumplimiento Riego (Seguimiento)
- Nueva ruta `/dashboard/produccion/cumplimiento-riego`, grupo "Seguimiento" en `navigation.ts`.
- `GET /produccion/riego/planilla?desde&hasta&tipo=goteo|manto|ambos&parcela_id` → filas por parcela (parrales, potreros, SY/BN/BV…), columnas por mes; cada celda lista riegos con fecha de inicio, horas y mm. Rutas estáticas antes de `/{id}`. Decimal → string en API, `Number()` en front.
- UI: tabla estilo planilla de papel (filas alternadas), filtros tipo/rango/parcela. Depende del paso 2.

## Entrega
Deploy 1: backend + datos (pasos 1, 2) con confirmación. Deploy 2: web (Vercel manual) + OTA mobile (pasos 3–6). Verificación local con click real antes de cada commit. docs-sync al final.
