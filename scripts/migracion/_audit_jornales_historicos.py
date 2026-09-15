"""Auditoría (solo lectura) de un tramo de "JORNALES (1).xlsx" antes de migrar.

No escribe nada. Para cada hoja cuya fecha de SEMANA cae en [DESDE, HASTA]:
  - detecta el offset de columnas (name_col) buscando "DIAS O MELGAS"
  - separa sección de pagos (tareas) de sección de caja/tesorería (a partir
    de la 2da aparición de "SEMANA" en la hoja, igual que migrate_jornales.py)
  - junta líneas de tarea (nombre + cantidad numérica + costo numérico)
  - devuelve: nombres distintos, tareas distintas, distribución de precios,
    y total calculado vs. declarado (si la hoja lo declara) por semana.

Uso:
  python scripts\\migracion\\_audit_jornales_historicos.py --desde 2023-06-01 --hasta 2024-04-30
"""

from __future__ import annotations

import argparse
import re
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import openpyxl

_DATE_RE = re.compile(r"(\d{1,2})\D(\d{1,2})\D(\d{4})")


def parse_date_cell(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str):
        m = _DATE_RE.search(v)
        if m:
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                return date(y, mo, d)
            except ValueError:
                return None
    return None

EXCEL_PATH = Path(r"C:\claude-projects\JORNALES (1).xlsx")


def find_header(rows):
    for i, row in enumerate(rows[:6]):
        for j, cell in enumerate(row):
            if isinstance(cell, str) and "DIAS" in cell.upper() and "MELGA" in cell.upper():
                return i, j - 1
    return None, None


def find_semana_positions(rows):
    """Devuelve lista de (row_idx, col_idx_texto) donde aparece la palabra SEMANA."""
    out = []
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            if isinstance(cell, str) and cell.strip().upper() == "SEMANA":
                out.append((i, j))
    return out


def parse_sheet(sn, ws):
    rows = list(ws.iter_rows(values_only=True))
    header_idx, name_col = find_header(rows)
    if name_col is None:
        return None
    task_col = name_col - 1

    semana_positions = find_semana_positions(rows)
    if not semana_positions:
        return None
    first_semana_row, first_semana_col = semana_positions[0]
    semana_date = None
    row0 = rows[first_semana_row]
    for k in range(first_semana_col + 1, min(first_semana_col + 3, len(row0))):
        semana_date = parse_date_cell(row0[k])
        if semana_date is not None:
            break
    if semana_date is None:
        return None

    end_row = semana_positions[1][0] if len(semana_positions) > 1 else len(rows)

    declarado = None
    scan_width = name_col + 9
    for i in range(first_semana_row, end_row):
        row = rows[i][:scan_width]
        joined = " ".join(str(c).upper() for c in row if isinstance(c, str))
        if "TOTAL" in joined and "DINERO" in joined:
            nums = [c for c in row if isinstance(c, (int, float))]
            if nums:
                declarado = Decimal(str(nums[-1]))

    current_task = None
    last_name = None
    lines = []  # (task, name, cantidad, precio, subtotal, redondeo)
    for i in range(first_semana_row + 2, end_row):
        row = rows[i]
        t = row[task_col] if 0 <= task_col < len(row) else None
        nm = row[name_col] if name_col < len(row) else None
        cant = row[name_col + 1] if name_col + 1 < len(row) else None
        precio = row[name_col + 2] if name_col + 2 < len(row) else None
        subtotal = row[name_col + 3] if name_col + 3 < len(row) else None

        if isinstance(t, str) and t.strip() and nm is None and not isinstance(cant, (int, float)):
            current_task = t.strip().upper()
            continue
        if current_task is None:
            continue
        if isinstance(nm, str) and nm.strip():
            last_name = nm.strip().upper()
        if isinstance(cant, (int, float)) and isinstance(precio, (int, float)):
            sub = Decimal(str(subtotal)) if isinstance(subtotal, (int, float)) else Decimal(str(cant)) * Decimal(str(precio))
            lines.append((current_task, last_name, Decimal(str(cant)), Decimal(str(precio)), sub))

    return {
        "sheet": sn,
        "fecha": semana_date,
        "declarado": declarado,
        "lines": lines,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", required=True)
    ap.add_argument("--hasta", required=True)
    args = ap.parse_args()
    desde = date.fromisoformat(args.desde)
    hasta = date.fromisoformat(args.hasta)

    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    sheets = [s for s in wb.sheetnames if s != "Hoja1"]

    parsed = []
    unparsed = []
    for sn in sheets:
        r = parse_sheet(sn, wb[sn])
        if r is None:
            unparsed.append(sn)
            continue
        if desde <= r["fecha"] <= hasta:
            parsed.append(r)

    parsed.sort(key=lambda r: r["fecha"])

    print(f"Hojas en rango [{desde} .. {hasta}]: {len(parsed)}")
    if unparsed:
        print(f"AVISO: {len(unparsed)} hojas no se pudieron parsear (revisar a mano): {unparsed}")
    print()

    task_counter = Counter()
    name_counter = Counter()
    precios = []
    total_calc = Decimal("0")
    total_declarado = Decimal("0")
    diffs = []

    for r in parsed:
        semana_total = Decimal("0")
        for task, name, cant, precio, sub in r["lines"]:
            task_counter[task] += 1
            name_counter[name] += 1
            precios.append(precio)
            semana_total += sub
        total_calc += semana_total
        if r["declarado"] is not None:
            total_declarado += r["declarado"]
            diff = semana_total - r["declarado"]
            if abs(diff) > 1:
                diffs.append((r["sheet"], r["fecha"], semana_total, r["declarado"], diff))

    print(f"Fechas: {parsed[0]['fecha']} a {parsed[-1]['fecha']}")
    print(f"Total líneas de pago: {sum(task_counter.values())}")
    print(f"Total calculado (suma subtotal, SIN redondeo, columna aparte no incluida acá): {total_calc:,.0f}")
    print(f"Total declarado en las hojas que lo indican: {total_declarado:,.0f}")
    print(f"Semanas con diferencia > $1 entre calculado y declarado: {len(diffs)}")
    for s in diffs[:15]:
        print(f"  {s[0]:14s} {s[1]}  calc={s[2]:>12,.0f}  decl={s[3]:>12,.0f}  diff={s[4]:>12,.0f}")

    print(f"\n=== TAREAS DISTINTAS ({len(task_counter)}) ===")
    for k, v in task_counter.most_common():
        print(f"  {v:5d}  {k}")

    print(f"\n=== TRABAJADORES DISTINTOS ({len(name_counter)}) ===")
    for k, v in name_counter.most_common():
        print(f"  {v:5d}  {k}")

    precios_sorted = sorted(precios)
    if precios_sorted:
        n = len(precios_sorted)
        print(f"\n=== DISTRIBUCIÓN DE PRECIOS (columna COSTO, {n} líneas) ===")
        for pct in (0, 10, 25, 50, 75, 90, 100):
            idx = min(n - 1, int(n * pct / 100))
            print(f"  p{pct:<3d} = {precios_sorted[idx]:>10,.0f}")


if __name__ == "__main__":
    main()
