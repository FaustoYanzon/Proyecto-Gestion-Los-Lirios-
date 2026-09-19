# Migración de Excels históricos

Pre-cleaned CSVs + loader. Generated 2026-07-07 from:

| CSV | Fuente Excel | Filas | Control |
|---|---|---|---|
| `cosechas.csv` | BASE DE DATOS 2 (temporadas 24-25 y 25-26) | 591 | 4.850.838 kg |
| `ingresos.csv` | BD COBROS (ambas tablas) | 259 | ARS 1.217.115.173 + USD 6.000 |
| `egresos.csv` | SEGUIM 18 7 (25-26, agregado mensual) | 144 | ARS 649.478.319 |
| `presupuestos.csv` | PRESUP 25-26 + TOTAL ANUAL 26-27 | 370 | 25-26: 575,6M/685,8M · 26-27: 852,6M/711,3M |

## Cómo cargar

Usar el Python DEL VENV (el del sistema no tiene asyncpg):

```powershell
cd C:\claude-projects\los-lirios
C:\claude-projects\.venv\Scripts\python.exe scripts\migracion\migrate_excels.py            # DRY RUN
C:\claude-projects\.venv\Scripts\python.exe scripts\migracion\migrate_excels.py --commit   # inserta
```

## Mapeo de parcelas (definitivo, confirmado)

Números → `Parral N` / `Potrero N`; `SULTANINA`→Parral Sult.; `SY RG`/`SY-RG`/`RG-SY`→Parral SYR-RG;
`BN`→Parral Bond. Nuevo; `BV`→Parral Bond. Viejo. **Cobertura: 347/591 filas = 59% de los kg.**

Quedan con `parcela_id NULL` a propósito (asignarlas corrompería el kg/ha por parral):
`FLAME` (152 filas — el Excel no dice CUÁL de los 9 parrales flame), `PASERO`/`M PASERO` (2 paseros posibles),
`SUPERIOR` (finca Caucete, sin parcela en la app), `FIESTA`, `BONARDA`, `GALPON`, `351` y 10 celdas con fechas
en vez de nombre. Suman a kg totales y mix por destino; no a kg/ha. Si a futuro identificás el parral real de
alguna, se edita el registro en Producción → Cosecha.

El dry run lista los nombres de parcela del Excel que NO matchean contra `parcelas.nombre`.
Opciones: renombrar/crear las parcelas en Admin → Parcelas y volver a correr, o cargar igual
(las filas sin match quedan con `parcela_id NULL`: suman a kg totales pero no a kg/ha).

## Decisiones tomadas (revisables)

- **Ingresos desde BD COBROS**, egresos desde SEGUIM (acordado — evita duplicar).
- `ESTADO` FACT → `origen=oficial`, NR → `no_oficial`.
- `UEFECTIVO` es ARS efectivo (los montos son escala ARS); solo `EF U$` es USD.
- **Flujo 24-25 NO migrado**: sus hojas son forecast rodante de 3 meses, no libro anual.
- **Presupuesto 26-27 desde TOTAL ANUAL** (la hoja PRESUP del 26-27 es copia sin actualizar del 25-26).
- `finca` de ingresos/egresos = `media_agua` por defecto (el Excel no la registra) — ajustable después.
- Egresos mensuales agregados con fecha día 15 del mes, `fuente='migracion_excel'`.
- HIDR-RENTAS → clasificación `hidraulica`; PRODUCTORES (26-27) → `materia_prima/compra_uva_fresca`.
- 2 cosechas con fecha diciembre 2026 (futuro — filas Excel 310/311, posible typo de año): cargadas igual, revisar.
- Temporada derivada de la fecha (convención del sistema: mayo→abril), no de la columna TEMP del Excel.

---

## Jornales (mano de obra) — abril a julio 2026

Generado 2026-09-13 desde `C:\claude-projects\JORNALES 2026.xlsx` (24 hojas semanales,
formato manual: por cada semana, secciones por tarea con trabajador/cantidad/costo/
redondeo/a pagar, seguidas de un bloque de caja/tesorería aparte que **no** se migra).

Scripts:
- `migrate_jornales.py` — parsea el Excel y carga `RegistroTrabajo` (+ `Egreso`
  vinculado cuando corresponde). Dry run por defecto, `--commit` para insertar.
- `backfill_egresos_abril.py` — corrección posterior (ver más abajo). Idempotente,
  también dry run por defecto.
- `jornales_abril_julio_2026.csv` — snapshot de auditoría de las 407 filas ya
  resueltas (parcela/tarea/unidad/monto finales), generado desde el propio script
  (`parse_workbook` + `build_registros`). El Excel original no vive en el repo.

### Cobertura

**15 semanas migradas: 01/04 al 09/07/2026** (407 filas, $31.730.000 ARS).
Las semanas del 16/07 en adelante NO se tocaron — ya estaban cargadas a mano en el
sistema (verificado contra producción el 2026-09-13 antes de migrar).

### Mapeo (confirmado con Fausto)

- **Nombres**: 54 variantes de escritura del Excel → 32 personas ya existentes en
  el catálogo + 12 nuevas (Beto, Carlos, David, Diego Flores, Emanuel, Gabriela,
  Leonel Flores, Manuel, Oscar Flores, Rocío, Romina, Vicente). Ver `NOMBRE_MAP`
  en `migrate_jornales.py` para el detalle fila por fila (ambigüedades como
  "Miguel" vs "Miguel Silva" u "Oscar" vs "Oscar Flores" se resolvieron con Fausto,
  no por heurística).
- **Tarea → parcela**: el número de parral viene del propio nombre de la sección
  del Excel ("PODA P6" = Parral 6). Ver `TAREA_RULES`. Casos particulares:
  - "Cosecha uva para vinificar" → 50 % Parral Bond. Nuevo / 50 % Parral Bond. Viejo.
  - Tareas de pasero (llenado de bolsones, mover pasa, levantar telas) → 1/3 en
    cada uno de los 3 paseros.
  - "Trabajo general", "Tractor cosecha y control", "Limpieza ramo", "Atada P"
    (sin número) → sin parcela asignada.
- **Unidad**: `precio_unitario < $2.000` → pieza (`plantas` para poda/atada/arreglo/
  sacar plantas, `cajas` para cosecha); `>= $2.000` → `dias`. Mismo criterio que ya
  usaba Fausto en el sistema para esas mismas semanas de julio en adelante.
- **monto_total = subtotal + redondeo** de cada línea puntual (no `cantidad × precio`
  a secas) — preserva los ajustes de redondeo manuales del Excel. Por eso el script
  inserta con SQL directo en vez de pasar por la API (el endpoint no permite pisar
  el monto calculado).
- **Chequeo cruzado**: el script compara, por semana, la suma de sus propias líneas
  contra el total que el propio Excel declaraba al pie de esa semana. 4 semanas
  difieren en montos chicos (entre $1.000 y $120.000) porque la suma manual de
  Fausto en esa celda no coincidía con sus propias líneas de arriba — confirmado
  fila por fila, no es un bug de parseo. Se migró el total calculado (auditable).

### Egresos: abril NO llevó Egreso en la primera corrida — corregido

`migrate_jornales.py` asumió que abril 2026 ya tenía un Egreso agregado mensual
(de la migración de arriba, `egresos.csv`) y por eso no generó Egreso individual
para esas 198 filas. Al revisar producción se confirmó que **esa migración de
Egresos históricos nunca se había corrido ahí** — abril quedó sin nada.
`backfill_egresos_abril.py` agrega el Egreso faltante (mismo criterio que mayo-
julio: `fuente='trabajo_diario'`, `referencia_id=<id del RegistroTrabajo>`) para
las filas de abril que no lo tengan — es seguro correrlo más de una vez.

### Verificación final (producción, 2026-09-13)

- `registros_trabajo`: 407 filas, suma $31.730.000.
- `egresos` con `fuente='trabajo_diario'` en el rango: 407 (209 de la carga
  original + 198 del backfill de abril), sumas coincidentes por mes.
- Capa "Costo" del mapa (`/dashboard/mapa`) verificada con datos reales end-to-end.

---

## Jornales (mano de obra) — históricos 2023-2025

Generado 2026-09-14/15 desde `C:\claude-projects\JORNALES (1).xlsx` (117 hojas
semanales, 09/06/2023 a 22/08/2025 — no vive en el repo). A diferencia de
`migrate_jornales.py` (formato estable, un solo layout), este Excel tiene dos
variantes de columnas, una sección de caja/tesorería por hoja que se excluye
(igual criterio: todo lo que está después de la 2ª aparición de "SEMANA" en la
hoja), y bastante ruido de tipeo de 3 años de carga manual.

Scripts:
- `migrate_jornales_historicos.py` — parsea el Excel y carga `RegistroTrabajo`
  (+ `Egreso` vinculado según `TEMPORADAS`). Dry run por defecto, `--commit`
  para insertar. Migra por temporada (`--temporada 23-24|24-25|25-aug25`).
- `_audit_jornales_historicos.py` — auditoría de solo lectura previa (no
  escribe nada), para revisar tareas/nombres/precios antes de mapear.
- `cleanup_contaminacion_jornales_hist.py` — borra `registros_trabajo` +
  `egresos` vinculados cuyo `trabajador_nombre` está en `NOMBRES_EXCLUIDOS`
  (ver más abajo). Se usó una vez para limpiar una corrida `--commit` previa
  hecha antes de que existiera el filtro. Dry run por defecto, `--commit` borra.
- `jornales_historicos_2023_2025.csv` — snapshot de auditoría de las 5.845
  filas finales (temporada/hoja/fila/parcela/trabajador/tarea/monto/detalle),
  generado reusando `parse_sheet` + `build_registros` del propio script de
  migración, sin tocar la base.

### Cobertura

**3 temporadas, 5.845 filas, $186.388.120 ARS**, verificado contra producción:

| Temporada | Rango | Filas | Total ARS | ¿Genera Egreso? |
|---|---|---|---|---|
| `23-24` | 09/06/2023 – 26/04/2024 (47 semanas) | 2.796 | 41.660.390 | Sí |
| `24-25` | 03/05/2024 – 30/04/2025 (53 semanas) | 2.649 | 114.718.730 | Sí |
| `25-aug25` | 09/05/2025 – 22/08/2025 (14 semanas) | 400 | 30.009.000 | No — ya había agregados mensuales cargados a mano desde mayo-2025 |

2 hojas excluidas por completo (`23-5-2025`, `30-5-2025`): datos internamente
inconsistentes ("A PAGAR" ambiguo entre filas de continuación, fila de SEMANA
en medio de la tabla) — confirmado con Fausto, no se migra nada de esas 2 semanas.

### Mapeo (confirmado con Fausto, sesión 2026-09-14/15)

- **Nombres**: variantes de escritura → catálogo existente + 18 trabajadores
  nuevos (Cristian, Tatita, Javier, Adrian, Alejandro, Bachi, Cocheche, Kevin,
  Leonardo, Luis, Lidia, Melisa, Milo, Hugo, Brian, Rodrigo, Ivan Molina, Ramón
  Olmos). Casos condicionales: OSCAR→Oscar Carrizo; JESUS→Jesús Ortiz si la
  tarea es de tractor, si no Jesús Videla; ORLANDO→50/50 Orlando Carrizo/Orlando
  Molina. Ver `NOMBRE_MAP` y `resolver_nombre()` para el detalle fila por fila.
- **Tareas nuevas** (fuera del catálogo fijo `CLASIFICACION_POR_TAREA`): Plantas
  Nuevas (reparto 1/5 entre Parral 13/14/15/16/21), Hollada (clasificación por
  estación calendario), Pasero (Secadero/Bolsones de Pasa, reparto 1/3 entre
  Pasero 1/2/3). Red Globe/Syrah (con o sin "Viejo") → siempre Parral SYR-RG,
  sin repartir entre Parral 6 y 9 (a diferencia de otras tareas de esa zona).
- **Unidad pieza/día**: mismo umbral $2.000 que `migrate_jornales.py`, pero acá
  el check de pieza SOLO aplica a Poda/Atada/Cosecha/Arreglo Parral/Sacar
  Plantas — cualquier otra tarea es siempre "dias" (evita que una tarea barata
  tipo Trabajo General se confunda con pieza).
- **Egresos**: por defecto `sueldos_personal/obreros`; "Arreglo Parral" y
  "Arreglo Riego" (p.ej. "Albañil", "Cañería") disparan
  `EGRESO_OVERRIDE_POR_TAREA` → `repuestos_reparacion` (mismo criterio que usa
  la app en producción, `backend/app/api/produccion.py`, no se inventó nada
  nuevo para la migración).

### `NOMBRES_EXCLUIDOS` — filas que NO son jornales, aunque estén en la tabla de jornales

El Excel de 3 años de carga manual mezcla, en la misma tabla de jornales, filas
que no son pago a un trabajador. Se excluyen de la migración por completo (no
generan `RegistroTrabajo` ni `Egreso` — si se quiere esa plata registrada, se
carga a mano como Egreso de Insumos/Combustible aparte):

- **Insumos/gastos anotados como si fueran trabajador**: `COMBUSTIBLE`, `HILO`.
- **Plata trasvasada a otra finca**: `CAUCETE`, `MIMBRE (GAMBA, ZAPALLO)` —
  Caucete y Los Mimbres son dos de las tres fincas del proyecto (ver Fincas en
  `CLAUDE.md`), no personas.
- **Días de la semana como pseudo-nombre**: `LUNES`/`MARTES`/`MIERCOLES`/
  `JUEVES`/`VIERNES`/`SABADO`/`DOMINGO` — filas de "viajes al secadero"
  agrupadas por día (con reparto por "CANT DE PERSONAS") en vez de por
  trabajador nombrado. Mismo problema que la tarea `"VIAJES"` bare, que
  además queda sin mapear a propósito en `EXPLICIT_TAREA_RULES` (layout propio
  que no vale la pena modelar para unas pocas filas).
- `VINES MADERA` (material, sin impacto en plata).

Casos límite que SÍ quedan migrados como texto libre (plata real, jornal real,
pero sin persona identificada en la hoja original — no crean trabajador nuevo,
`trabajador_id` queda `NULL`): `Tejido`, `Limpieza Cebolla`, `Sembrada Zapallo`,
`Encintado Zapallo` (el nombre de la tarea quedó repetido en la columna de
nombre), y `Gamba` (confirmado con Fausto: es apodo de un trabajador real).

### Contaminación de una corrida `--commit` previa — limpiada

La primera corrida `--commit` de `23-24` (sesión 2026-09-14, antes de que
existiera `NOMBRES_EXCLUIDOS`) insertó 15 filas contaminadas; al revisar
`24-25` se encontraron 3 más (esa temporada también se había corrido ya).
`cleanup_contaminacion_jornales_hist.py --commit` borró las 18 (`registros_
trabajo` + `egresos` vinculados, $328.500 en total) el 2026-09-15, verificado
antes y después contra la suma en base. Las corridas posteriores de
`migrate_jornales_historicos.py --commit` ya no las reinsertan (excluidas por
nombre antes de generar el registro).

### Diferencias calculado vs. declarado sin investigar (aceptado por Fausto)

Quedan semanas sueltas con diferencia entre la suma de líneas y el total que la
propia hoja declara al pie (probable error de tipeo original, no de parseo —
menos del 2% de la plata semanal en todos los casos): `28-07-23` (+$5.000),
`04-08-2023` (+$31.900), `8-03-2024` (-$24.000), `22-03-2024` (+$23.200),
`21-06-2024` (-$100), `17-01-2025` (-$24.000), `4-7-2025` (-$20.000),
`25-7-2025` (-$5.000), `8-8-2025` (-$20.000). Decisión: se dejan así, no se
migró ningún ajuste manual para forzar el cuadre.

### Selector de temporada (frontend)

`frontend/components/CampanaSwitcher.tsx` generaba dinámicamente solo las
últimas 3 campañas desde la fecha de hoy — no llegaba a 2023/2024. Se cambió a
un `PRIMER_ANIO_CAMPANA = 2023` fijo, generando todas las campañas desde esa
hasta la actual (crece solo con los años, no hace falta tocarlo de nuevo la
próxima vez que se migre historia vieja).

### La primera corrida `--commit` fue contra una base de prueba, no producción

El `backend/.env` local apunta a propósito a una copia/staging de la base (para
poder probar sin arriesgar producción). Las corridas `--commit` del
2026-09-14/15 (y la limpieza de contaminación) fueron contra esa copia — nunca
tocaron producción, pero tampoco se veían en la app real. Se agregó
`scripts/migracion/.env.prod` (gitignored por el patrón `.env.*` ya existente,
nunca se commitea) como override explícito: si existe, `read_database_url()`
lo usa antes que `DATABASE_URL`/`DATABASE_PUBLIC_URL` de la shell o
`backend/.env`. La URL pública se consigue en Railway → servicio Postgres →
"Connect" (la que NO dice `railway.internal`, esa es solo alcanzable desde
adentro de la red de Railway). El script imprime de qué fuente sacó la URL
(`.env.prod (producción)` o `backend/.env (local/staging)`) sin exponer el
valor. Migración real a producción corrida el 2026-09-15, mismos totales
verificados que contra la copia de staging.

**Inserts en tandas, no una transacción gigante:** sobre la conexión pública de
Railway, una única transacción con ~2.800-5.500 INSERTs seguidos se cortaba a
mitad de camino (`asyncpg.exceptions.ConnectionDoesNotExistError`) y perdía
todo el progreso sin commitear nada. Se cambió a tandas de 150 filas, cada una
en su propia transacción — un corte solo pierde la tanda en curso, y el
reintento salta lo ya commiteado por `idempotency_key` (rápido, no repite todo
desde cero).

### Bug encontrado (no es de esta migración, pero esta migración lo expuso): `limit=1000` en Flujo Anual

`frontend/lib/api/flujo.ts` (`getFlujoAnual`/`getFlujoDesglose`) trae TODOS los
egresos/ingresos de la campaña de una sola vez y agrega en el cliente, con
`limit=1000` hardcodeado — y el backend (`backend/app/api/finanzas.py`,
`list_egresos`/`list_ingresos`) tenía el mismo tope como máximo permitido
(`le=1000`). Hasta esta migración ninguna campaña había superado 1000 egresos;
la 23-24 sola tiene ~2.800. Como el query ordena por fecha descendente, se
veían solo los meses más recientes (dic-abr) y faltaban jun-nov enteros —
detectado en vivo con Claude in Chrome al confirmar la migración en el Flujo
Anual de producción. Fix: `limit` subido a 10.000 en ambos lados (frontend y
tope del backend). Sigue siendo un fetch-and-aggregate client-side, no
agregación server-side — si el volumen de una sola campaña llega a superar
10.000 movimientos algún día, hay que revisar de nuevo (o migrar a
`getFlujoMensual`/`/finanzas/flujo-anual/`, que si agrega server-side, pero no
tiene desglose por tipo/cliente todavía).

---

## Cosecha histórica 2024/2025 y 2025/2026 (reintento) — `migrate_cosecha_2024_2026.py`

Generado 2026-09-19 desde `C:\claude-projects\Produccion.xlsx` (611 filas, hoja
única). Reemplaza el intento de julio (`cosechas.csv` arriba, 591 filas) que
Fausto borró el 2026-07-17 porque "los números no cuadraban" (ver
`borrar_migracion_excel.py`) — sin bug de código identificado en ese momento,
solo una decisión de datos para reanalizar y recargar después. Esta vez se
identificaron y corrigieron dos problemas concretos del script anterior:

1. **Terceros matcheados a parcelas propias por nombre de variedad.** El
   script de julio resolvía `parcela_id` solo por el nombre en la columna
   PARRAL/POTRERO (ej. "SULTANINA" → Parral Sult.), sin mirar el `ORIGEN`.
   Uva **comprada a terceros** para industria de pasa (166 filas, FINCA=nombre
   del productor tercero) quedaba mezclada con el rendimiento del parral
   propio del mismo nombre. Ahora `RegistroCosecha` tiene columnas nuevas
   `origen` (`propio`/`tercero`) y `proveedor_tercero` (migración de esquema
   `a106b068b59a`) — origen=tercero **siempre** carga con `parcela_id NULL`,
   sin excepción, y el KPI `dashboard_costo_por_kg` (`finanzas.py`) ahora
   filtra `origen=propio` para no diluir el costo real con kilos comprados.
   El formulario de Cosecha en la app ya tiene el campo Origen/Proveedor para
   que esto se cargue directo ahí las próximas temporadas.
2. **Temporada derivada de la fecha partía en dos una misma campaña.** La
   convención mayo→abril del sistema separaba la "cola" de venta de pasa que
   sigue hasta jul/ago (o dic) en una temporada "2026" que no es una campaña
   real (286.960 kg mal ubicados). Ahora `temporada = TEMP del Excel - 1`,
   que mantiene unida cada campaña tal como la registra la planilla.

### Cobertura

**598 de 609 filas activas** (2 ANULADO excluidas de entrada), limpio en
2 temporadas — sin la temporada fantasma que daba el método anterior:

| Temporada | Filas | Kg |
|---|---|---|
| 2024 (campaña 2024/2025) | 299 | 2.307.137 |
| 2025 (campaña 2025/2026) | 299 | 2.555.211 |

Por origen: 437 filas propias (313 matchean a una de las 37 parcelas
existentes = 71%; el resto suma a kg totales, no a kg/ha, mismo criterio que
julio) + 161 filas de terceros (proveedor_tercero=FINCA del Excel,
parcela_id NULL siempre).

**11 filas excluidas** (sin dato real que migrar):
- 8 sin fecha y sin kg: `RETIRA BINES` / `TELA PRESTAMO R SARMIENTO` —
  préstamo/retiro de envases, no un evento de cosecha.
- 1 con fecha pero sin ningún dato de peso (remito 8955, Parral 14, Aspirant,
  destino Bodega) — Fausto no cargó el peso todavía.
- 2 con CAJA/BIN contado (550 y 512, remito 815039, Media Agua/BN/Bonarda)
  pero KG TOTAL=0 y sin destino/comprador — cosecha contada, sin cerrar.

### Correcciones puntuales (confirmadas con Fausto)

- 2 filas (remito 70111845, Caucete/Superior) con fecha 23/12/2026 — futuro
  imposible (hoy 2026-09-19), ya señalado como "posible typo" en julio y
  nunca corregido. Corregidas a **23/12/2025** (un año antes, encaja en el
  rango real dic-2025/ago-2026 de esa misma temporada).
- 3 filas con kg real pero sin fecha en el Excel (2 Alfalfa semilla ~1.850 kg,
  1 pasa Flame 2.520 kg) — cargadas con una **fecha aleatoria reproducible**
  (semilla fija `RANDOM_SEED=20260919`) dentro del rango real de fechas de su
  propia temporada, a pedido de Fausto ("cargalos dentro de la temporada que
  corresponde y poneles una fecha al azar en ese rango"). Quedan marcadas en
  `observaciones`.
- REMITO/CIU en 0 → NULL (antes se guardaba el string "0" literal).

### Mapeo de parcelas

Igual que `migrate_excels.py` de julio (catálogo de 37 parcelas sin cambios):
números → `Parral N`/`Potrero N`; SULTANINA→Parral Sult.; SY RG/SY-RG/RG-SY→
Parral SYR-RG; BN→Parral Bond. Nuevo; BV→Parral Bond. Viejo. Sin matchear a
propósito (quedan `parcela_id NULL`, suman a kg totales no a kg/ha): FLAME
(9 parrales posibles), PASERO/M PASERO (3 paseros posibles), SUPERIOR (finca
Caucete, sin parcela en la app), GALPON, y dos códigos numéricos raros
(`45781`, `46146`) que parecen fechas de Excel mal tipeadas pero corresponden
a variedades ya ambiguas (Alfalfa GL, Fiesta) — mismo tratamiento que si
dijeran el nombre de la variedad directamente.

### Verificación (producción, 2026-09-19)

- Migración de esquema `a106b068b59a` aplicada antes de cargar datos.
- `registros_cosecha`: 598 filas, 4.862.348 kg — exacto contra lo calculado
  por el propio script antes de insertar.
- 0 filas `origen=tercero` con `parcela_id` no nulo (chequeo explícito
  post-carga).
- Probado primero en `backend/.env` (staging) con un insert/lectura de ida y
  vuelta antes de tocar producción; sin browser disponible en la sesión para
  click-through visual del formulario nuevo.

---

### Backfill: mayo-agosto 2025 tampoco tenía Egreso vinculado

Mismo problema que tuvo abril 2026 en la migración anterior (ver
`backfill_egresos_abril.py`, arriba). La temporada `25-aug25` se migró con
`crea_egreso=False` asumiendo que esos meses ya tenían un Egreso agregado
cargado a mano — Fausto lo notó al ver el Flujo Anual de la campaña 2025/2026
en cero para mayo-agosto pese a que los `registros_trabajo` sí estaban.
Verificado: 0 egresos en `media_agua` para ese rango. La asunción era
incorrecta, igual que con abril 2026.

`backfill_egresos_mayo_agosto_2025.py` agrega el Egreso vinculado para las 400
filas de esa temporada que no lo tenían (mismo criterio que el resto:
`fuente='trabajo_diario'`, `EGRESO_OVERRIDE_POR_TAREA` para Arreglo Parral/
Arreglo Riego, `sueldos_personal/obreros` para el resto). Corrido contra
producción el 2026-09-16: 400 egresos insertados, $30.009.000 ARS, verificado
exacto contra el Flujo Anual en el navegador.

**Lección para la próxima migración con este patrón:** no asumir que un rango
ya tiene Egreso agregado cargado a mano solo porque "es reciente" o "debería
estar" — verificar con una consulta antes de decidir `crea_egreso=False`, no
después.
