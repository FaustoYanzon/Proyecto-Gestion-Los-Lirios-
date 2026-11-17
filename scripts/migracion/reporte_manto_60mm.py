"""Read-only report for the manto = 60 mm per riego change (migration c9b5b6bebbfd).

Per season and parcela it prints: finished manto records, litres under the current
rule (4x goteo: hours * 16 000 * 4 * valves) vs litres under the new rule
(mm * superficie_ha * 10 000 per finished manto), plus the finished manto records
whose parcela has no usable superficie (they will count 0 litres after migrating).

Runs SELECTs only, inside a read-only transaction on a read-only session; it aborts if
the server does not confirm read-only mode. Reuses the shared connection helper
(_prod_db.py): prints only the host name, never the URL or credentials.
Season = May -> April (a date in May-Dec belongs to its own year, Jan-Apr to the
previous one).

Usage (from the repo root, venv python):
  backend/venv/Scripts/python.exe scripts/migracion/reporte_manto_60mm.py            # PRODUCTION
  backend/venv/Scripts/python.exe scripts/migracion/reporte_manto_60mm.py --local    # local dev DB
  ... --mm 60                                                                        # mm per riego
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prod_db import LOCAL_HOSTS, read_database_url  # noqa: E402

LITROS_POR_MM_HA = 10_000
LITROS_H_VALVULA = 16_000
FACTOR_MANTO_ACTUAL = 4

# Same valve count as RegistroRiego.contar_valvulas: n_valvulas_manto, else the CSV (empty = 1).
_N_VALVULAS = (
    "COALESCE(r.n_valvulas_manto, GREATEST(COALESCE("
    "array_length(string_to_array(NULLIF(r.valvula, ''), ','), 1), 1), 1))"
)
_TEMPORADA = (
    "CASE WHEN EXTRACT(MONTH FROM r.fecha) >= 5 THEN EXTRACT(YEAR FROM r.fecha)::int "
    "ELSE EXTRACT(YEAR FROM r.fecha)::int - 1 END"
)

SQL_POR_PARCELA = f"""
    SELECT {_TEMPORADA} AS temporada,
           p.nombre AS parcela,
           p.superficie_ha,
           count(*) AS n_mantos,
           COALESCE(SUM(r.duracion_horas * {LITROS_H_VALVULA} * {FACTOR_MANTO_ACTUAL} * {_N_VALVULAS}), 0)
               AS litros_actuales,
           CASE WHEN p.superficie_ha > 0
                THEN count(*) * $1::numeric * p.superficie_ha * {LITROS_POR_MM_HA}
                ELSE 0 END AS litros_nuevos
    FROM registros_riego r
    JOIN parcelas p ON p.id = r.parcela_id
    WHERE r.tipo::text = 'manto' AND r.fin IS NOT NULL
    GROUP BY 1, p.nombre, p.superficie_ha
    ORDER BY 1, p.nombre
"""

SQL_SIN_SUPERFICIE = f"""
    SELECT r.id, p.nombre AS parcela, r.fecha, r.duracion_horas,
           COALESCE(r.duracion_horas * {LITROS_H_VALVULA} * {FACTOR_MANTO_ACTUAL} * {_N_VALVULAS}, 0)
               AS litros_actuales
    FROM registros_riego r
    JOIN parcelas p ON p.id = r.parcela_id
    WHERE r.tipo::text = 'manto' AND r.fin IS NOT NULL
      AND (p.superficie_ha IS NULL OR p.superficie_ha <= 0)
    ORDER BY p.nombre, r.fecha
"""


def _fmt(valor: object) -> str:
    return f"{float(valor):>14,.0f}".replace(",", ".")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="use the local dev database")
    parser.add_argument("--mm", type=float, default=60.0, help="mm per manto riego (default 60)")
    args = parser.parse_args()

    url, source = read_database_url(skip_prod=args.local)
    host = urlparse(url).hostname
    if args.local and host not in LOCAL_HOSTS:
        print("ERROR: --local pero la base resuelta no está en localhost")
        return 1
    print(f"Fuente: {source} | host: {host} | SOLO LECTURA | mm por riego: {args.mm:g}")

    # Read-only at session level; any write attempt would fail on the server.
    conn = await asyncpg.connect(url, server_settings={"default_transaction_read_only": "on"})
    try:
        async with conn.transaction(readonly=True):
            modo = await conn.fetchval("SHOW transaction_read_only")
            if modo != "on":
                print("ABORTADO: no se pudo abrir la conexión en modo solo lectura.")
                return 1
            filas = await conn.fetch(SQL_POR_PARCELA, Decimal(str(args.mm)))
            sin_sup = await conn.fetch(SQL_SIN_SUPERFICIE)
            en_curso = await conn.fetchval(
                "SELECT count(*) FROM registros_riego WHERE tipo::text = 'manto' AND fin IS NULL"
            )
    finally:
        await conn.close()

    print(f"\nMantos en curso hoy (no cuentan hasta terminar): {en_curso}")
    print("\nMantos terminados por temporada y parcela (litros actuales = regla x4; nuevos = mm x ha):")
    print(f"{'temp':<6}{'parcela':<26}{'ha':>6}{'mantos':>8}{'litros actuales':>17}{'litros nuevos':>16}{'diferencia':>16}")
    tot_n = 0
    tot_act = 0.0
    tot_new = 0.0
    for f in filas:
        act, new = float(f["litros_actuales"]), float(f["litros_nuevos"])
        ha = "-" if f["superficie_ha"] is None else f"{f['superficie_ha']:.2f}"
        print(
            f"{f['temporada']:<6}{f['parcela']:<26}{ha:>6}{f['n_mantos']:>8}"
            f"{_fmt(act):>17}{_fmt(new):>16}{_fmt(new - act):>16}"
        )
        tot_n += f["n_mantos"]
        tot_act += act
        tot_new += new
    print(f"{'TOTAL':<38}{tot_n:>8}{_fmt(tot_act):>17}{_fmt(tot_new):>16}{_fmt(tot_new - tot_act):>16}")

    print(f"\nMantos terminados en parcelas SIN superficie (quedan en 0 litros): {len(sin_sup)}")
    for s in sin_sup:
        horas = "-" if s["duracion_horas"] is None else f"{s['duracion_horas']:.1f} h"
        print(f"    {s['fecha']}  {s['parcela']:<24} {horas:>8}  litros actuales {_fmt(s['litros_actuales']).strip()}  id={s['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
