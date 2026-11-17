---
fecha: 2026-11-17
tags: [sistema, bitacora, produccion, paseros, riego, manto, migracion, deploy]
---

# Bitácora 2026-11-17: paseros fuera de riego y riego a manto de 60 mm (PR #10 y PR #11)

Dos fases, cada una en su PR, desplegadas el mismo día. Specs: `docs/superpowers/specs/2026-11-16-paseros-en-mapa-design.md` y `docs/superpowers/specs/2026-11-17-riego-manto-60mm-design.md`. Planes: `docs/superpowers/plans/2026-11-16-paseros-en-mapa.md` y `docs/superpowers/plans/2026-11-17-riego-manto-60mm.md`. Decisión del manto: [[2026-11-17-riego-manto-60mm]]. Continúa [[2026-11-06-riego-fito-campana]] (ahí se fijó el manto como ×4 por tiempo, ahora reemplazado).

Estado al cierre: **ambas fases mergeadas a `main` (HEAD `25ab7f0`) y desplegadas.** Backend en Railway, web en Vercel, migración `c9b5b6bebbfd` aplicada en producción, OTA publicado.

## Qué se construyó

**Paso 1, paseros fuera de riego y fito (PR #10, merge `55c4acf`)**

- **Panel del pasero en el mapa (web).** Muestra tareas y costo laboral, y una tarjeta nueva «Uva fresca» con los kg por variedad (`components/map/UvaPaseroCard.tsx`, datos de `GET /pasero/stock`). La tarjeta solo la ven `encargado` y superiores; para el resto se oculta sin error (403).
- **Se ocultan** riego, fito, cabezal, cosecha, ciclo de campaña y fenología. Las acciones rápidas quedan en solo «+ Tarea».
- **Modos del mapa:** en «cumplimiento» y «fito» el pasero se pinta gris neutro.
- **Backend (defensa para clientes viejos):**
  - Riego por goteo (`POST /riego/`, `POST /riego/iniciar`) y `POST`/`PUT /fitosanitarios/` rechazan un pasero con 422.
  - `_resolve_parcelas_orden` rechaza paseros pedidos explícitamente (422) y los excluye de la ruta por variedad.
  - `plan_avance` y `plan_contraste` ignoran paseros.
  - Los registros históricos siguen listándose y se pueden editar sin cambiar de parcela.
- **Selectores web sin paseros:** riego, `NuevaOrdenAplicacion` (incluido `parcelasPorDefecto`) y plan fitosanitario.
- **Color de Red Globe:** cambiado a `#9f1239` para distinguirlo de Flame. Los colores de variedad pasaron a `components/map/varColors.ts`.

**Paso 2, riego a manto de 60 mm (PR #11, merge `25ab7f0`)**

- **Regla nueva:** cada riego a manto terminado vale `mm_riego_manto` (60) mm sobre la parcela completa, sin importar la duración. Litros = 60 × superficie_ha × 10.000.
- **Litros congelados por registro:** columna nueva `registros_riego.litros_manto`, calculada al terminar el riego (o al crearlo ya terminado). Un manto en curso cuenta 0. Editar después la superficie o el parámetro no reescribe el historial.
- **Cumplimiento:** un manto cuenta 60 / 38,4 = 1,56 riegos.
- **Parámetro editable:** `mm_riego_manto` en Documentación → Parámetros (`PATCH /alta-produccion/parametros`).
- **Migración `c9b5b6bebbfd`:**
  - Inserta el parámetro con `ON CONFLICT DO NOTHING`.
  - Agrega `litros_manto`.
  - Backfill de los mantos terminados con superficie: `litros_manto = 60 × ha × 10.000` y `mm_aplicados = 60`.
  - Recrea `vw_kpi_produccion_parcela`, que lee `litros_manto` para el manto.
- **Compatibilidad:** `n_valvulas_manto` y `FACTOR_MANTO` se conservan en la API. Un cliente viejo que manda `valvula` o factor en un manto nuevo lo ignora y el servidor calcula solo.
- **PUT:** un riego terminado ya no se puede reabrir (422 «Un riego terminado no se puede reabrir.»; antes era un 500). Tampoco se puede pisar el mm del manto.
- **Web:** `RiegoForm`, `IniciarRiegoForm`, `TipoRiegoSelector` (`MantoResumen`) y `RiegosEnCurso` muestran «60 mm · N ha · X litros». Un manto en curso no muestra litros.
- **Mobile:** resumen del manto y etiquetas en `riego.tsx` y `lib/types.ts`. Usa 60 mm fijos (`MM_RIEGO_MANTO_DEFAULT`), no lee el parámetro (ver desviaciones).

## Producción: procedimiento real

Hecho con Fausto, cada paso confirmado antes de ejecutarlo.

1. **Reporte de solo lectura** `scripts/migracion/reporte_manto_60mm.py`: 6 mantos terminados, todos con superficie, 0 sin superficie. Litros totales 170.239.773 → 14.676.000 (−91%). La cifra vieja estaba inflada por mantos dejados abiertos días: Parral 8 tenía un riego de 317 h = 60,8 M L.
2. **Backup** `pg_dump` `loslirios_prod_20261117_134644.dump` (1,7 MB) antes de tocar nada.
3. **Migración** con `scripts/migracion/_alembic_prod.py head`. Producción estaba en `07acdb0d401f`.
4. **Merge del PR #11** y deploy de Railway (17:09 UTC).
5. **Verificación posterior:**
   - 6 mantos con mm = 60 y `litros_manto` correcto.
   - 0 mantos terminados con superficie y sin `litros_manto` (chequeo de la ventana de deploy).
   - 4 mantos en curso.
   - 0 registros de goteo con `litros_manto`.
   - La vista responde bien: 34 filas.
6. **Web:** `vercel --prod`, alias `frontend-six-jade-79`.
7. **OTA** desde `main` `25ab7f0`.

## Decisiones tomadas

- **Paseros: bloqueo también en el backend**, no solo en la UI. El mobile actual y cualquier cliente viejo seguirían ofreciendo paseros; el 422 los frena igual.
- **Uva fresca = `uva_disponible_kg`** de `/pasero/stock` (ingresada menos consumida por la levantada), sumada por variedad. Es un supuesto de la spec que quedó tal cual.
- **Manto: 60 mm fijos y litros congelados por registro** (no calcular en vivo). Motivo y alternativas descartadas: [[2026-11-17-riego-manto-60mm]].
- **El PUT no reabre un riego terminado y no pisa el mm.** Antes el reabrir daba 500; ahora da 422 explícito.
- **Mobile sale por OTA sin esperar el build**, con 60 mm fijos. El servidor guarda el valor real del parámetro, así que el dato no depende de que el celular esté actualizado.

## Desviaciones respecto de spec y plan

**Paseros:**

- Los colores de variedad se movieron a `components/map/varColors.ts` (la spec pedía reusar `VAR_COLORS` del mapa).
- Red Globe cambió a `#9f1239` (no estaba en la spec) para distinguirlo de Flame (commit `114ee1f`).
- Durante el PR apareció un bug: editar un registro histórico de pasero sin cambiar de parcela daba 422. Corregido en `ad8636f`.
- **Consecuencia no prevista:** una orden vieja que ya incluye un pasero no se puede guardar hasta quitar el pasero de la orden.

**Manto:**

- **Mobile no lee el parámetro.** El plan decía «tomar del parámetro si el rol puede leerlo, si no 60»; quedó 60 fijo. Pendiente.
- **PUT:** el plan solo pedía recalcular al cambiar de parcela. Se agregó que no reabre un riego terminado (422) y que no pisa el mm.
- **Vista KPI:** la rama manto usa `COALESCE(litros_manto, 0)` sin mirar `duracion_horas`. Un manto terminado sin duración cuenta en la vista y no en los endpoints Python. Detectado en review, no corregido.
- **Orden de deploy:** el plan decía migración → merge → web → OTA → `Modelo de Datos.md`. Se cumplió hasta el OTA; `Modelo de Datos.md` quedó pendiente.
- **OTA:** la decisión de [[2026-11-16-camara-y-deuda-mobile]] ya contemplaba que un OTA desde `main` solo llega a los runtimes nuevos. Ver pendientes.

## Lecciones de operación

- **Railway corre `alembic upgrade head` al arrancar** (`backend/railway.json`). Hay una ventana corta en la que el código viejo corre sobre el esquema nuevo. Se mitigó con el chequeo idempotente de la verificación (paso 5).
- **Vercel falló dos veces con `next/font/google queries have exactly one entry`**, incluso con `--force`. CI y build local pasaban. Después el mismo código desplegado desde `main` pasó al primer intento: fue un problema transitorio de Vercel o de Google Fonts. Antes de tocar código, reintentar. En local el mismo error aparece si `frontend/.next` está viejo: borrarlo y rebuild. El dev server y un build comparten `.next`: nunca correr los dos a la vez.
- **Git Bash:** una ruta de Windows con barras invertidas dentro de un comando `!` pierde las barras. Usar barras normales (`/c/Users/...`).
- **Branch antes de un build:** se lanzó un build de EAS desde `main` por error. Antes de `eas build` o `eas submit`, correr `git branch --show-current` y revisar `gitCommitHash` con `eas build:view`.
- **PowerShell:** `set` no define variables de entorno; usar `$env:NODE_OPTIONS=...`.

## Qué NO está hecho o no está verificado

- **Click real en local (Playwright), hecho antes de publicar:** paseros (panel con uva por variedad, pasero sin ingresos, modos «Cumplimiento riego» y «Fitosanitarios» en gris, selector de órdenes sin pasero) y manto (formulario «60 mm · 2,94 ha · 1.764.000 L», manto de 2 h guardado como 60 mm y 1.764.000 L, cumplimiento con el manto histórico en 60 mm, parámetro en Documentación → Parámetros). No probado: selector de goteo y plan fitosanitario con click real (los cubren los tests), roles bajos en el panel del pasero y mobile en dispositivo.
- **Tests:** suite completa 634 passed (paseros) y 655 passed (manto) antes de publicar; CI de los PR #10 y #11 en verde. En producción: verificación de solo lectura posterior a la migración (ver paso 5 de Producción).
- **`Modelo de Datos.md` debe regenerarse** después de esta migración (columna `registros_riego.litros_manto` y parámetro `mm_riego_manto`). No se corrió `scripts/generate_modelo_datos.py` en esta sesión porque lee credenciales de producción; lo corre Fausto. Hasta entonces el archivo no muestra la columna nueva.
- **`PROJECT_MAP.md`:** se regeneró en el PR #11. No se volvió a generar en esta sesión.
- **Mobile lee 60 fijos.** Si Fausto cambia el parámetro, el preview del celular no se entera; el servidor sí guarda el valor vigente.
- **Binarios viejos.** Los runtimes `1ccf455d` (Android) y `07054827` (iOS) no reciben este OTA. En esos celulares el preview dice «válvulas × factor», aunque el servidor guarda bien el valor.
- **Mapa de paseros en mobile** pendiente (paso 5). Mobile todavía muestra a los paseros con riego y fito.
- **Paseros sin decisión escrita.** No hay entrada en `docs/sistema/Decisiones/` para «paseros fuera de riego y fito». Se sugiere crearla.

## Abiertos

- **Revisar los 4 mantos en curso de producción.** Pueden ser riegos olvidados. Al terminar cada uno suma 60 mm, que son 1,56 riegos de cumplimiento.
- **Regenerar `Modelo de Datos.md`** (Fausto, después de la migración).
- **Revisar qué binarios viejos siguen activos** en Play y TestFlight.
- **Mobile:** leer `mm_riego_manto` del parámetro; mapa de paseros; entregas de pasa y alfalfa (paso 5).
- **Vista KPI:** decidir si el manto sin duración debe contar o no, y alinear el COALESCE con los endpoints Python.
- **Orden vieja con pasero:** definir si se limpia la orden o se permite quitar el pasero sin error.

## Serie siguiente

3. **Alfalfa:** fardos de 20 kg, rollos de 300 kg, semilla en kg. Depósito Alfa. Pestaña nueva en Inventarios. Documentos de alta y de salida con número y PDF.
4. **Anulación** de pasa y alfalfa, solo `super_admin`.
5. **Mobile:** paseros en el mapa y entregas de pasa y alfalfa.

## Docs

- `docs/sistema/Bugs Conocidos.md`: revisión del 2026-11-17, resueltos del día y riesgos nuevos.
- `docs/sistema/Decisiones/2026-11-17-riego-manto-60mm.md`: decisión nueva. Marca como superada la regla ×4 de [[2026-11-06-riego-fito-campana]] y la fórmula de factor × válvulas de [[2026-10-26-riego-manto]].
- `docs/sistema/Arquitectura.md`: la fórmula del volumen aplicado ya no dice «×4 manto» sino los 60 mm congelados.
- `docs/superpowers/specs/` y `plans/`: paseros y manto marcados como implementados, con desviaciones. El spec de riego a manto de 2026-10-26 lleva un aviso de superado.
- `PROJECT_MAP.md`: regenerado en el PR #11 (no en esta sesión).
- `Modelo de Datos.md`: **no regenerado**, pendiente de Fausto.
