# Riego a manto: 60 mm fijos por riego — diseño

Fecha: 2026-11-17 · Estado: **implementado y desplegado** (2026-11-17, PR #11, merge `25ab7f0`; migración `c9b5b6bebbfd` en producción) · Tamaño: proyecto mediano (backend + migración con recálculo de datos + web + mobile por OTA). Paso 2 de la serie paseros → **manto** → alfalfa → anulación de pasa → mobile.

Decisión registrada en `docs/sistema/Decisiones/2026-11-17-riego-manto-60mm.md`. Desviaciones respecto de este diseño al final del documento.

## Intención
El ingeniero considera que un riego a manto entrega **60 mm a la parcela completa, sin importar el tiempo**. Hoy el manto se calcula como `horas × 1,6 mm × 4` por válvula, es decir, depende del tiempo. Debe pasar a un valor fijo por riego.

## Decisiones de Fausto (no re-litigar)
- Cada riego a manto = **60 mm sobre toda la parcela**, sin importar la duración.
- El cumplimiento lo muestra como **60 / 38,4 = 1,56 riegos** (litros reales sobre la parcela, igual que el goteo).
- Se **recalculan también los registros viejos** de manto. Backup `pg_dump` de producción antes de migrar (se corre junto con Fausto).
- El valor de 60 mm es un **parámetro editable** (`parametros_produccion`, como `tara_carro`), editable desde Documentación → Parámetros.
- El manto **suma recién al terminar**; mientras está en curso no cuenta.
- `n_valvulas_manto` **se deja como está** (sin usarse para los litros): no hay cambio destructivo.

## Goals
- Litros y mm del manto independientes del tiempo: `litros = mm_riego_manto × superficie_ha × 10 000`, `mm_aplicados = mm_riego_manto`.
- Todos los reportes que usan litros (cumplimiento de riego, panel del mapa, planilla, estado de campaña, trazabilidad, carta PDF, KPIs `vw_kpi_produccion_parcela`) quedan coherentes con la regla nueva.
- Web y mobile muestran el cálculo nuevo en el formulario («60 mm · N ha · X litros») en lugar de «válvulas × factor».

## Non-goals
- Goteo: no cambia.
- Cambiar el estándar de 38,4 mm por riego ni los riegos esperados por estado de campaña.
- Borrar `n_valvulas_manto` o `FACTOR_MANTO` de la API: se conservan por compatibilidad con clientes viejos.

## Constraints
- La Postgres local no está sincronizada con producción: cualquier número se verifica contra producción **en solo lectura** (script en archivo) antes de migrar.
- Migraciones ya aplicadas no se editan: cambio en migración nueva. La vista `vw_kpi_produccion_parcela` se recrea (patrón de `7d2c5e9a41b8`, copiando helpers: las migraciones no importan módulos de la app).
- Escritura en producción (migración, recálculo): confirmación explícita de Fausto en cada paso. Producción vía `scripts/migracion/_alembic_prod.py`.

## Approaches
1. **Congelar los litros en el registro (elegida):** columna nueva `registros_riego.litros_manto` (Float, NULL). Se calcula al terminar el riego (o al crearlo ya terminado) con la superficie y el parámetro vigentes; `litros_de` y la vista SQL leen esa columna. Trade-off: una columna más y un backfill, pero un cambio posterior de superficie o de parámetro **no reescribe el historial**, que es el criterio que ya usa el sistema (`n_valvulas_manto` congelado).
2. Calcular siempre en vivo desde la superficie de la parcela y el parámetro: sin columna nueva, pero editar la superficie o los 60 mm reescribiría todo el historial, y los puntos que hoy leen filas crudas (vista SQL, `litros_de_registro`) necesitarían un JOIN a `parcelas`. Descartada.
3. Reutilizar `n_valvulas_manto` como número de «válvulas de 60 mm»: no representa fracciones de hectárea (2,3 ha ≠ 3 válvulas). Descartada.

## Diseño
### Modelo y datos
- Parámetro `mm_riego_manto` (default `60`) en `parametros_produccion`; se agrega a `Parametros`/`ParametrosResponse`/`ParametrosUpdate` (`services` y `schemas/alta_produccion.py`) y a la pantalla Documentación → Parámetros.
- Columna `registros_riego.litros_manto` (Float, nullable).
- `RegistroRiego.litros_de(horas, tipo, valvula, n_valvulas_manto, litros_manto=None)`: manto → `litros_manto or 0.0` (0 mientras está en curso o sin superficie); goteo sin cambios. Los 3 llamadores de `cumplimiento_riego.litros_de_registro` (`api/produccion.py` ~l.312, 1071, 1857) pasan el valor nuevo.
- Congelado: al crear un manto con `fin`, y en `POST /riego/{id}/terminar`: `litros_manto = mm × superficie × 10 000` y `mm_aplicados = mm`. En `PUT`, solo se recalcula si cambia la parcela (la edición de otros campos no toca el valor).
- `recalcular_mm` / `__init__` de `RegistroRiego`: el manto ya no multiplica por horas.

### Migración (nueva, encima de `head`)
1. Inserta `mm_riego_manto = 60` en `parametros_produccion` (si no existe).
2. Agrega `litros_manto`.
3. **Backfill:** para cada manto con `fin` no nulo y parcela con superficie > 0: `litros_manto = 60 × superficie_ha × 10 000` y `mm_aplicados = 60`. Los que tengan parcela sin superficie quedan en NULL (0 litros) y se listan en el reporte previo.
4. Recrea `vw_kpi_produccion_parcela`: la rama manto usa `COALESCE(litros_manto, 0)`; el goteo queda igual. `downgrade` restaura la expresión anterior de `7d2c5e9a41b8`.

### Clientes
- Web: `RiegoForm`, `IniciarRiegoForm`, `TipoRiegoSelector` (`MantoResumen`) y `lib/api/riego.ts` dejan de calcular «válvulas × factor» para el manto y muestran «60 mm · N ha · X litros» (valor leído del parámetro; si no está disponible, 60).
- Mobile (OTA con el fingerprint actual): `lib/types.ts` (`calcRiegoTotales`, `FACTOR_MANTO_SUPERFICIE`, `valvulasManto`) y `app/(tabs)/riego.tsx` (resumen y etiquetas). Hasta que llegue el OTA, el celular muestra el preview viejo, pero el servidor guarda el valor correcto.

### Verificación y despliegue
- Tests: se actualizan los casos de `test_riego_manto.py` y de cumplimiento que asumían ×4; casos nuevos: 60 mm independientes del tiempo, superficie 2,3 ha, manto en curso = 0, edición de superficie posterior no reescribe, backfill, parcela sin superficie, vista SQL.
- Antes de migrar en producción: script de **solo lectura** en archivo (cantidad de mantos, cuántos sin superficie, litros antes/después por parcela), `pg_dump` con Fausto, migración con `_alembic_prod.py` (confirmación explícita), verificación posterior contra el panel del mapa.
- Orden: backend (Railway, push a `main`) → web (Vercel manual) → OTA mobile → regenerar `Modelo de Datos.md` (lee producción; después de migrar).

## A cargo del builder
Textos exactos de los formularios, nombres de las columnas de reporte del script de solo lectura, estructura de los tests nuevos.

## Riesgos
- El recálculo cambia números que Fausto ya vio (manto ×4 del 5/11): comunicarlo y mostrar el antes/después por parcela.
- Parcelas con manto histórico y sin superficie cargada: quedarían en 0 litros hasta cargar la superficie (el script lo lista antes).
- Ventana entre migrar el backend y publicar el OTA: el preview del celular es el viejo; no afecta los datos.

## Estado final y desviaciones

**Estado:** implementado y desplegado el 2026-11-17 (PR #11, merge `25ab7f0`). Migración `c9b5b6bebbfd` aplicada en producción con `scripts/migracion/_alembic_prod.py` antes del merge, con `pg_dump` previo. Web en Vercel (`frontend-six-jade-79`). OTA desde `main`.

**Desviaciones respecto de este diseño:**

- **Mobile no lee el parámetro.** Muestra 60 mm fijos (`MM_RIEGO_MANTO_DEFAULT`), no el valor de `mm_riego_manto`. La spec pedía leerlo si el rol puede. Pendiente.
- **OTA solo a runtimes nuevos.** Un OTA desde `main` llega a `bc733f64` (Android) y `10cc6f4a` (iOS). Los binarios en `1ccf455d` / `07054827` conservan el preview viejo («válvulas × factor»); el servidor guarda bien.
- **PUT más estricto de lo especificado.** Un riego terminado no se reabre (422 «Un riego terminado no se puede reabrir.», antes 500) y el PUT no pisa el mm del manto. No estaba en la spec.
- **Vista KPI sin filtro de duración.** `vw_kpi_produccion_parcela` usa `COALESCE(litros_manto, 0)` para el manto sin mirar `duracion_horas`. Los endpoints Python no lo cuentan. Follow-up pendiente.
- **Orden de despliegue.** Migración en prod antes del merge (no en el arranque de Railway). `Modelo de Datos.md` quedó pendiente: lo regenera Fausto.
- **Reporte de solo lectura.** `scripts/migracion/reporte_manto_60mm.py` se corrió contra producción antes de migrar: 6 mantos terminados, todos con superficie. Litros 170.239.773 → 14.676.000.
