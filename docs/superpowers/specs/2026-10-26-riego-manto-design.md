# Riego a manto por parcela — diseño

Fecha: 2026-10-26 · Estado: pendiente de revisión

## Objetivo

El registro de riego empieza preguntando **goteo o manto**.

- **Goteo**: sin cambios (cabezal → parcela → válvulas abiertas, con fertirriego opcional).
- **Manto**: se elige **un** parral o potrero completo. No hay cabezal, válvulas ni fertirriego.
  El resto del formulario (inicio, fin, responsable) es igual.

Aplica a mobile (Expo) y web (Next.js). Los riegos a manto ya cargados no se modifican.

## Regla de cálculo (manto nuevo)

La parcela se divide en cuadrantes de 1 ha con una válvula cada uno; la fracción
cuenta como un cuadrante más.

- `n_valvulas_manto = ceil(superficie_ha)`
- Cada válvula entrega 1/4 del caudal de goteo: `FACTOR_MANTO_SUPERFICIE = 0.25`.
- `litros = horas × 16 000 × 0.25 × n_valvulas_manto`
- `mm = horas × 1.6 × 0.25` (0.4 mm/h; no depende del tamaño)

| Parcela | Superficie | Válvulas | 2 h: litros | 2 h: mm |
|---|---|---|---|---|
| Parral 2 | 3.0 ha | 3 | 24 000 | 0.8 |
| Potrero 23 | 2.3 ha | 3 | 24 000 | 0.8 |
| Parral 4 | 2.85 ha | 3 | 24 000 | 0.8 |

## Datos previos

- **Potrero 23** figura con 23 ha en el seed y en la base; la superficie real es **2.3 ha**.
  Hay que corregirlo en prod antes de habilitar el manto (único potrero con error, confirmado
  por Fausto). Es una escritura en prod: script con backup, confirmado por Fausto.
- Los potreros no tienen filas en `valvulas`; el cálculo no depende de esa tabla.

## Modelo y migración

- `registros_riego.cabezal` y `registros_riego.valvula` pasan a `nullable=True`.
- Nueva columna `registros_riego.n_valvulas_manto` (`Integer`, nullable). Solo se llena en
  riegos a manto nuevos y guarda el cálculo del momento: si la superficie cambia después,
  el historial no se mueve.
- Migración nueva (no se editan las anteriores). Los registros existentes quedan con
  `n_valvulas_manto = NULL`.
- Factor de caudal por registro:
  - `tipo = manto` y `n_valvulas_manto IS NULL` (histórico): 0.4, `n_valvulas` desde el CSV de `valvula`.
  - `tipo = manto` y `n_valvulas_manto` no nulo: 0.25 y `n_valvulas = n_valvulas_manto`.
  - `tipo = goteo`: 1.0, sin cambios.
- Las consultas que usan `n_valvulas` del CSV (eficiencia hídrica en `produccion.py`) pasan a
  usar la misma regla que `RegistroRiego.litros_aplicados`, sin duplicarla.

## Backend

Endpoints: `POST /produccion/riego/iniciar` y `POST /produccion/riego/`; `PUT /produccion/riego/{id}`
revalida con la misma regla.

- Schemas: `cabezal` y `valvula` opcionales; validador de modelo:
  - `goteo`: `cabezal` y `valvula` obligatorios (422 si faltan).
  - `manto`: `fertilizante_nombre` y `fertilizante_dosis_lt_ha` rechazados (422).
- `manto`: la parcela debe ser parral o potrero con `superficie_ha` cargada (422 si no).
  Se calcula y guarda `n_valvulas_manto`; `cabezal` y `valvula` se guardan en `NULL`.
  Si un cliente viejo los manda, se ignoran (el cálculo siempre es el nuevo).
- Un solo riego a manto en curso por parcela (`fin IS NULL`): 409 si ya hay otro.
  Sin índice único nuevo; se valida en el endpoint bajo la misma transacción.
- `PUT`: cambiar `tipo` o `parcela_id` de un registro recalcula `n_valvulas_manto`;
  un histórico (NULL) editado a otra cosa conserva su regla vieja salvo que cambie de tipo.
- Respuestas: `cabezal`/`valvula` opcionales; `n_valvulas` y `litros_aplicados` siguen calculados.
- Carta de trazabilidad (HTML + PDF) y listados: cabezal/válvula `NULL` se muestran como "—"
  y el tipo como "Manto · N válvulas".
- Filtro `cabezal` en `GET /riego/`: sin cambios (los manto nuevos no aparecen al filtrar).

## Clientes

**Mobile** (`mobile/app/(tabs)/riego.tsx`): paso 0 "¿Goteo o manto?". Goteo continúa el
flujo actual. Manto muestra todos los parrales y potreros activos, se elige uno, y salta a
inicio/fin/responsable. Sin selector de fertirriego. Resumen: "Manto · N válvulas · X litros".
Se reutiliza el selector de tipo existente movido al primer paso. Sin cambios en
`app.json`/`eas.json` (OTA).

**Web**: `IniciarRiegoForm.tsx` y `RiegoForm.tsx` con el mismo primer paso; `RiegosEnCurso.tsx`,
`RiegoTable.tsx` y el timeline de trazabilidad muestran manto sin cabezal/válvula.
`frontend/lib/api/riego.ts` con tipos opcionales.

## Tests

- Cálculo: 3.0 → 3, 2.3 → 3, 2.85 → 3, 1.0 → 1; litros y mm del ejemplo.
- Histórico: un manto con `n_valvulas_manto NULL` conserva factor 0.4 y su CSV de válvulas.
- 422: goteo sin cabezal/válvula; manto con fertirriego; parcela sin superficie; parcela de otro tipo.
- 409: segundo manto en curso en la misma parcela.
- Cliente viejo: manto con `cabezal`/`valvula` se guarda con los valores nuevos.
- Eficiencia hídrica y carta de trazabilidad con registros mixtos.
- Mobile: `tsc`; web: lint + build.

## Despliegue

1. Corregir Potrero 23 en prod (script con backup, confirmación de Fausto).
2. Backend (Railway, aplica la migración). Es compatible con clientes viejos.
3. Web (`vercel --prod`).
4. OTA mobile (verificar fingerprint antes).
5. Probar en local con click real antes de cada paso.

## Fuera de alcance

- Recalcular los riegos a manto ya cargados.
- Alertas o metas de riego por tipo.
