---
tags: [sistema, sesion, migracion, mano-de-obra, jornales]
---

# 2026-09-15 — Migración de jornales históricos 2023-2025, limpieza de contaminación

Fausto había arrancado esta migración el 2026-09-14 (`JORNALES (1).xlsx`, 117 hojas
semanales 2023-2025) pero hizo `/clear` en la sesión pensando que había terminado. Esta
sesión arrancó reconstruyendo qué había quedado: dos scripts sin commitear
(`migrate_jornales_historicos.py`, `_audit_jornales_historicos.py`), sin README ni CSV
de auditoría, y sin verificar contra producción.

## Filas que no son jornales, coladas en la tabla de jornales

3 años de carga manual mezclan, en la misma tabla de jornales, gastos e imputaciones
que no son pago a un trabajador: `COMBUSTIBLE`/`HILO` (insumos anotados como si fueran
trabajador), `CAUCETE`/`MIMBRE (GAMBA, ZAPALLO)` (plata trasvasada a otra finca — Caucete
y Los Mimbres son dos de las tres fincas del proyecto), y días de la semana
(`LUNES`/`MARTES`/...) usados como pseudo-nombre en filas de "viajes al secadero"
agrupadas por día en vez de por trabajador. Se agregó `NOMBRES_EXCLUIDOS` al script para
excluirlas de la migración. Detalle completo, incluida la lista de casos límite que SÍ
quedan migrados como texto libre (Tejido, Limpieza Cebolla, Gamba, etc.), en
`scripts/migracion/README.md`.

## Contaminación de una corrida `--commit` previa

Al correr el dry-run "arreglado" de la temporada 23-24 para confirmar el fix, apareció
`Insertados: 0, 2796 saltados (ya existían)` — la corrida `--commit` original (sesión
2026-09-14, antes del filtro) **ya se había ejecutado contra producción**, con las filas
contaminadas adentro. Al revisar 24-25 se confirmó que esa temporada también se había
migrado ya, con 3 filas contaminadas propias (Caucete, Mimbre, Vines Madera).
`cleanup_contaminacion_jornales_hist.py --commit` borró las 18 filas contaminadas
(`registros_trabajo` + `egresos` vinculados, $328.500 en total) — verificado antes y
después contra la suma en base.

**Lección:** cuando una migración por script ya tiene `--commit` corrido, un dry-run
posterior con el script corregido no revela por sí solo si hay basura vieja todavía en
la base — el filtro nuevo simplemente deja de generar esas filas, no las busca en la
base para borrarlas. Hay que buscarlas explícitamente (por el `detalle` que deja la
migración) antes de dar por limpia una corrección tardía.

## Resultado final

3 temporadas, 5.845 filas, $186.388.120 ARS, verificado exacto contra producción en las
3 (`registros_trabajo` suma = calculado por el script, temporada por temporada). Detalle
completo en `scripts/migracion/README.md`.

## Selector de temporada

`CampanaSwitcher.tsx` generaba dinámicamente solo las últimas 3 campañas desde hoy — no
llegaba a 2023/2024, así que estos datos quedaban cargados pero invisibles en la UI.
Cambiado a un `PRIMER_ANIO_CAMPANA = 2023` fijo (crece solo con los años).

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[Arquitectura]]
