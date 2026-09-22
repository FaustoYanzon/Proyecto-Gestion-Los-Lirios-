"""Migración de jornales — hueco 29/08/2025 a 31/03/2026, desde "JORNALES 2.xlsx".

"JORNALES 2.xlsx" es el mismo archivo que "JORNALES (1).xlsx" (116 hojas
idénticas, ya migradas por migrate_jornales_historicos.py) más 30 hojas
semanales nuevas que cierran el hueco entre esa migración (terminaba
22/08/2025) y migrate_jornales.py (arranca 01/04/2026) -- confirmado
contra producción el 2026-09-21: 0 filas en `registros_trabajo` y 0 en
`egresos` clasificacion='obreros' en todo el rango.

No duplica código: reusa el parser/las reglas de nombre/tarea de
migrate_jornales_historicos.py tal cual (mismo formato de hoja, mismo
autor de la planilla) parcheando dos globals del módulo antes de llamar a
su main() -- EXCEL_PATH (apunta al archivo nuevo) y TEMPORADAS (rango del
hueco). Los nombres de hoja de las 30 semanas nuevas no se solapan con las
116 viejas, así que el filtro de fecha en main() ya excluye las hojas
repetidas sin necesidad de pasar una lista de hojas a mano -- y la clave
de idempotencia (NAMESPACE + nombre de hoja + fila) tampoco puede
colisionar con lo ya cargado.

`crea_egreso=True` para todo el rango (mismo criterio que 23-24/24-25):
no hay ningún Egreso agregado previo para jornales en este tramo, el
sistema ni existía todavía.

Uso:
  cd C:\\claude-projects\\los-lirios
  C:\\claude-projects\\.venv\\Scripts\\python.exe scripts\\migracion\\migrate_jornales_gap_sep25_mar26.py            # DRY RUN
  C:\\claude-projects\\.venv\\Scripts\\python.exe scripts\\migracion\\migrate_jornales_gap_sep25_mar26.py --commit   # inserta
"""

from __future__ import annotations

import asyncio
import sys
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.argv = [sys.argv[0], "--temporada", "gap-sep25-mar26"] + sys.argv[1:]

import migrate_jornales_historicos as mjh

mjh.EXCEL_PATH = Path(r"C:\claude-projects\JORNALES 2.xlsx")
mjh.TEMPORADAS = {
    "gap-sep25-mar26": {"desde": date(2025, 8, 29), "hasta": date(2026, 3, 31), "crea_egreso": True},
}

# ── Tareas nuevas (confirmado con Fausto, sesión 2026-09-21) ────────────────
# "Cosecha (para) Pasa/Vinificar" son variantes de destino de la misma
# Cosecha ya existente (mismo criterio que "COSECHA UVA FLAME"/"COSECHA UVA
# BONARDA" en la migración histórica: sin parcela, no se puede saber cuál).
# "Mover Pasa" es tarea nueva propia (no se reparte entre los 3 paseros como
# "Pasero" -- es una acción distinta, mismo criterio que "Amontonar Pasa"/
# "Levantar Pasa", que ya son tareas separadas de Pasero).
mjh.EXPLICIT_TAREA_RULES.update({
    "COSECHA UVA PARA PASA": ("Cosecha", "verano", mjh._SIN_PARCELA),
    "COSECHA UVA PASA": ("Cosecha", "verano", mjh._SIN_PARCELA),
    "COSECHA UVA PARA VINIFICAR": ("Cosecha", "verano", mjh._SIN_PARCELA),
    "COSECHA UVA VINIFICAR": ("Cosecha", "verano", mjh._SIN_PARCELA),
    "MOVERPASA Y VINES": ("Mover Pasa", "verano", mjh._SIN_PARCELA),
    "MOVER PASA MAS VINES LLENOS": ("Mover Pasa", "verano", mjh._SIN_PARCELA),
    "MOVER PASA PARA VINES LLENOS": ("Mover Pasa", "verano", mjh._SIN_PARCELA),
})

# ── Nombres (confirmado con Fausto, sesión 2026-09-21) ───────────────────────
# Celeste/Elias/Rubén/Luis ya están en el catálogo con otra ortografía
# (sin acento, o abreviatura "Luis F" -- mismo patrón que "LUIS FUERTE" en la
# migración histórica). Isidro y "Marcelo"/"Marcelo Diaz" son gente nueva:
# Marcelo y Marcelo Diaz aparecen en semanas consecutivas sin superponerse
# nunca (oct-nov 2025) -- confirmado que es la misma persona, fusionados en
# un solo trabajador. Walter, Luciano, Eduardo y "Peña Eduardo" quedan sin
# vincular (texto libre, sin crear trabajador ni fusionar con Antonio Peña)
# -- apariciones sueltas, mismo criterio que la migración histórica.
mjh.NOMBRE_MAP.update({
    "CELESTE": "Celeste",
    "ELIAS": "Elias",
    "RUBEN": "Rubén",
    "LUIS F": "Luis",
    "ISIDRO": "Isidro",
    "MARCELO": "Marcelo Diaz",
    "MARCELO DIAZ": "Marcelo Diaz",
    # Cuadrilla de cosecha (filas que solo aparecieron al mapear las tareas
    # nuevas de arriba) -- match exacto contra el catálogo, más las mismas
    # abreviaturas "Apellido" -> "Nombre Apellido" que ya usa el resto del
    # script (p.ej. "LUIS F" -> "Luis").
    "DAVID": "David",
    "DIEGO FLORES": "Diego Flores",
    "LEONEL FLORES": "Leonel Flores",
    "LEONEL F": "Leonel Flores",
    "OSCAR FLORES": "Oscar Flores",
    "OSCAR F": "Oscar Flores",
})
mjh.NUEVOS_TRABAJADORES.extend(["Isidro", "Marcelo Diaz"])

# ── Hoja "12-12-2025" sin encabezado (confirmado con Fausto) ────────────────
# A esta hoja le faltan las 3 filas de encabezado (SEMANA/subtítulos/tarea)
# que sí tiene el resto -- los datos de abajo (36 trabajadores, $2.640.000,
# mismo layout de columnas) están completos. Se reconstruyen las 3 filas
# faltantes (fecha real = nombre de la hoja, todo bajo "Trabajo General",
# igual que las semanas vecinas) y se reusa parse_sheet tal cual -- no se
# duplica lógica de parseo.
_parse_sheet_original = mjh.parse_sheet


def _parse_sheet_con_fix(sn, ws):
    if sn == "24-10-2025":
        # Typo de fecha en la celda SEMANA (dice 31/10/2025) -- el nombre de
        # hoja y la secuencia semanal (7 días después de 17-10, 7 antes de
        # 31-10) confirman que es la semana del 24/10 real, con datos de
        # trabajador propios y distintos de la hoja "31-10-2025" (que ya está
        # completa y consistente aparte). Confirmado con Fausto, 2026-09-21.
        r = _parse_sheet_original(sn, ws)
        if r is None:
            return None
        _fecha, raw_rows, declarado = r
        fecha_corregida = date(2025, 10, 24)
        for raw in raw_rows:
            raw.fecha = fecha_corregida
        return fecha_corregida, raw_rows, declarado
    if sn != "12-12-2025":
        return _parse_sheet_original(sn, ws)

    class _FakeWS:
        def __init__(self, rows):
            self._rows = rows

        def iter_rows(self, values_only=True):
            return iter(self._rows)

    rows = list(ws.iter_rows(values_only=True))
    header = ("SEMANA", date(2025, 12, 12)) + (None,) * 7
    subheader = (None, None, "DIAS O MELGAS", "COSTO", "SUBTOTAL", "REDONDEO", "A PAGAR", None, "TOTAL DE DINERO")
    tarea = ("TRABAJO GENERAL",) + (None,) * 8
    return _parse_sheet_original(sn, _FakeWS([header, subheader, tarea] + rows))


mjh.parse_sheet = _parse_sheet_con_fix

if __name__ == "__main__":
    asyncio.run(mjh.main())
