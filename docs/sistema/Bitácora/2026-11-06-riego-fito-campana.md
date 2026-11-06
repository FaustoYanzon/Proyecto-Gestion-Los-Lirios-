---
fecha: 2026-11-06
tags: [sistema, bitacora, riego, fitosanitarios, campana, manto, deploy]
---

# Bitácora 2026-11-06: sesión riego, fito y ciclo de campaña (rama `feat/sesion-riego-fito-campana`)

Seis pedidos resueltos en la rama (HEAD `6873a09`). **Nada desplegado todavía**: el orden de producción está al final.

## Qué se hizo

### 1. Parral 4 norte / Parral 5 sur
- Cada parral tiene 2 ha y 2 válvulas: Parral 4 (norte) válvulas 41 y 42; Parral 5 (sur) válvulas 43 y 44. Se cargan como seed overrides.
- Script de datos: `scripts/migracion/corregir_parral_4_5.py` (dry-run por defecto, `--apply` para escribir).
- Las válvulas 43/44 pasan a Parral 5 vía override; la auditoría quedó consistente.

### 2. Ciclo de campaña unificado en `EstadoVariedadCampana`
- **Decisión:** `EstadoVariedadCampana` es la única fuente del estado de campaña por variedad.
- `GET /produccion/fenologia/estado-actual` ahora la lee.
- El modal de Documentación de la web hace un `POST /produccion/estado-campana/` por variedad.
- `DELETE /produccion/fenologia/overrides` borra solo filas de `EstadoVariedadCampana` de la campaña actual y **nunca** toca `CicloCampana`.
- POST y DELETE exigen gerencial o más. El encargado ya no puede confirmar el estado.
- `CicloCampana` queda solo para rendimiento (`rendimiento_kg_ha`). Las confirmaciones manuales viejas de `CicloCampana` dejan de afectar el estado.
- `GET /campana/estado-actual/` queda deprecado.
- Se quitó la alerta `sin-fenologia` de la campana.

### 3. Mapa
- Solo el modo de color «Cumplimiento riego». El mapa mobile nunca tuvo modo riego; su panel de parcela «RIEGO — CAMPAÑA» se mantiene.

### 4. Manto = 4x goteo
- `FACTOR_MANTO = 4.0`; se eliminó `FACTOR_MANTO_LEGACY`.
- La vista `vw_kpi_produccion_parcela` se recrea en la migración `7d2c5e9a41b8` (solo cuerpo de la vista).
- Script `scripts/migracion/recalcular_manto_x4.py`: recalcula `mm_aplicados` y `n_valvulas_manto` desde la superficie actual. Revisar el dry-run: cualquier cambio fuera de Parral 4/5 hay que entenderlo antes de `--apply`.
- **Efecto esperado:** mm y litros del manto histórico saltan ~10 a 16 veces.

### 5. Fito
- Plan Fitosanitario pasa a solo lectura estilo Metas, con botón «Editar plan».
- «Cumplimiento Fito» con filtro variedad → parcela. `/plan-fitosanitario/avance` gana `parcela_id`; solo se filtra el lado aplicado.

### 6. Planilla Cumplimiento Riego
- `GET /produccion/riego/planilla`: agrupa por `RegistroRiego.fecha`, campaña mayo→abril por defecto, tipo goteo/manto/ambos.
- Página `frontend/app/dashboard/produccion/cumplimiento-riego`, en Seguimiento.

## Docs
- `PROJECT_MAP.md` regenerado (16 modelos, 25 routers, 63 migraciones, 50 rutas frontend, 15 pantallas mobile).
- `Modelo de Datos.md` **no se regeneró**: esta rama no cambia tablas ni columnas (solo el cuerpo de una vista), y `generate_modelo_datos.py` resuelve la base por `scripts/migracion/.env.prod`, que apunta a producción.
- Ningún doc de `Decisiones/` ni `Bugs Conocidos.md` contradice estas decisiones. `Arquitectura.md` (línea sobre `app.core.fenologia`) todavía dice que `estado-actual` se alimenta del calendario viejo y de `CicloCampana`; queda desactualizada respecto del punto 2.

## Producción (ejecutado el 2026-11-06)
1. Backup `los_lirios_prod_20261106_0949.dump` (1,7 MB, con copia en OneDrive).
2. `corregir_parral_4_5.py --apply`: Parral 4 y 5 pasan de 2,85 a 2,0 ha (0 riegos en ambos) y se intercambiaron `parcelas.coordenadas` (estaban cruzadas: Parral 4 al sur). Verificado idempotente.
3. Merge del PR #1 a `main` (`39d9095`): deploy de Railway `28b6ce3a`, `alembic upgrade head` aplicó `7d2c5e9a41b8`.
4. `recalcular_manto_x4.py --apply`: 5 registros de manto actualizados (3 en curso sin duración se omiten; `n_valvulas_manto` no cambió en ninguno). Parral 8 queda en 2.028,8 mm por un riego de 317 h (dato original dudoso).
5. Vercel `--prod` desde `main` (el primer intento falló por una descarga intermitente de Google Fonts; el segundo salió bien). Alias `frontend-six-jade-79.vercel.app`.
6. EAS OTA en la rama `production` (Android e iOS, commit `39d9095`). No se pudo verificar el contenido del bundle publicado (el CDN responde 403 sin autenticación).

## Hallazgos de la verificación local
- El mapa web dibuja los polígonos leyendo `frontend/public/Los Lirios 2026.kml` en vivo; mobile los dibuja desde `parcelas.coordenadas` (API). Regenerar `finca-map.ts` (landing) no mueve el mapa real. Se corrigieron los nombres en el KML y se intercambiaron las coordenadas en prod.
- La tarjeta de fenología del panel del mapa tenía "estimado automático" fijo; ahora usa `fuente`.

## Ajustes posteriores (PR #2, merge 06e0540)
- **Observaciones al confirmar el estado (mobile):** campo opcional, máx. 1000 caracteres, se guarda con `POST /produccion/estado-campana/`. El schema ahora tiene `max_length=1000`, así que un texto más largo devuelve 422.
- **Cumplimiento Fito:** los botones de variedad pasan a ser el filtro (se quitó el selector duplicado). El selector de parcela depende de la variedad activa y se resetea al cambiar de campaña o de pestaña. La consulta por parcela muestra estado de carga y de error.
- **Cumplimiento Riego:** toggle «Riegos | Cumplimiento» (este último usa `GET /produccion/riego/planilla/cumplimiento`). Se quitó el alternado de filas verde/celeste.

## Cumplimiento de riego por volumen (PR #3, merge b994422)

### Causa
`mm_aplicados` por registro es la lámina sobre la hectárea de **una** válvula. Sumarlo por parcela inflaba el cumplimiento: 4 válvulas × 24 h daban 400 %.

### Regla nueva
- Aplicado = Σ horas × 16.000 L/h × factor × válvulas.
- Esperado = riegos esperados × 38,4 mm × `superficie_ha` × 10.000 L.
- Lámina = litros / (ha × 10.000).
- Fórmula única en `RegistroRiego.litros_de`; el cálculo vive en `backend/app/core/cumplimiento_riego.py`.

### Dónde se aplica
- Planilla (`GET /produccion/riego/planilla`) en m³, con prorrateo mensual del calendario.
- `GET /estado-campana/cumplimiento-riego` devuelve `litros_aplicados` y `litros_esperados`; `mm_aplicados` es ahora la lámina.
- Paneles de parcela de web y mobile.
- Trazabilidad (ficha, público y PDF): `cumplimiento` es `null` y la fila se muestra neutra si la parcela no tiene superficie.
- Dashboard de eficiencia hídrica: `mm_aplicados_total` = lámina real.
- Tests nuevos: `backend/tests/test_cumplimiento_riego_volumetrico.py` y `test_riego_planilla_cumplimiento.py`.

### Chequeo de datos de producción
30 parcelas activas parral/potrero, todas con superficie. 32 riegos de goteo, todos con válvula.

### Despliegue
- Railway: deploy `ddb901cc`.
- Vercel: alias `frontend-six-jade-79.vercel.app`.
- EAS OTA, branch `production`: Android `4b7875bf-ee27-476f-9272-d5712a053495`, iOS `49a66be4-0bf6-42a2-8111-c7115db661e9`.

### Docs
- `PROJECT_MAP.md` regenerado: sin cambios de contenido (el generador no lista rutas de endpoints, `core/` ni tests; la página `cumplimiento-riego` ya figuraba).
- `Modelo de Datos.md` **no se regeneró**: no cambió ninguna tabla ni columna, y el generador apunta a producción por defecto.
- `Arquitectura.md` (línea de 1 riego estándar = 38,4 mm = 384.000 L/ha) es coherente con la regla nueva; no se tocó.

## Abiertos
- Probado en local: web (click real) y mobile (dispositivo). No probado: botón "Resetear a automático" y las pantallas internas de producción.
- Los puntos GeoJSON de las válvulas 43/44 caen dentro del polígono norte: faltan coordenadas reales.
- `generate_modelo_datos.py` apunta a prod por defecto; conviene un guard o un default local.
- Riego manto de 317 h en Parral 8: ≈60.000 m³ aplicados vs ≈1.000 m³ esperados. Probable error de carga, sin revisar.
- El % mensual de la planilla es inestable en invierno y en los primeros días del mes (esperado bajo por el prorrateo).
- El textarea de observaciones de la web no tiene `maxLength`.
- Test de la fórmula de litros casi tautológico: falta un test con valores absolutos (768000, 1024000, 1536000, 0, 21920). Falta también un test del resumen público sin superficie.
- La eficiencia hídrica sigue usando `lamina_mm(...) or 0.0` en parcelas sin superficie (debería ser `None`).
- No verificado en dispositivo: teclado con observaciones y panel de parcela mobile.
- Menores diferidos:
  - Borde de zona horaria del año de campaña (30/04 21:00 ART) entre el modal web y el servidor.
  - Semántica de la tercera tarjeta resumen del Plan Fitosanitario.
  - Algunos tests de casos borde.
  - Invalidar la query de cumplimiento del mapa al guardar el estado.
