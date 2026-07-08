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
