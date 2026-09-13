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
