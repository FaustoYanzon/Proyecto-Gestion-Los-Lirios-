"""Read-only audit: which confirmed applications count against the monthly plan
and which show up as "no planificado".

Runs SELECTs only. Reuses the shared connection helper (_prod_db.py): reads
`.env.prod` and prints only the host name, never the URL or credentials.

Usage (from the repo root, venv python):
  backend\\venv\\Scripts\\python.exe scripts\\migracion\\auditar_avance_plan.py                 # PRODUCTION (read-only)
  backend\\venv\\Scripts\\python.exe scripts\\migracion\\auditar_avance_plan.py --local         # local dev DB
  backend\\venv\\Scripts\\python.exe scripts\\migracion\\auditar_avance_plan.py --temporada 2026

For every record of the season (grouped by parcel variety, month and product)
it says whether the plan has that product for that variety and month, and, when
it does not, why (another month, another variety, or not in the plan at all).
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prod_db import read_database_url  # noqa: E402

MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]


def _temporada(fecha) -> int:
    return fecha.year if fecha.month >= 5 else fecha.year - 1


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="use the local dev database")
    parser.add_argument("--temporada", type=int, default=2026, help="season start year (May to April)")
    args = parser.parse_args()

    url, source = read_database_url(skip_prod=args.local)
    host = urlparse(url).hostname
    if args.local and host not in ("localhost", "127.0.0.1", "::1"):
        print("ERROR: --local pero la base resuelta no está en localhost")
        return 1
    print(f"Fuente: {source} | host: {host} | SOLO LECTURA | temporada {args.temporada}/{args.temporada + 1}")

    conn = await asyncpg.connect(url)
    try:
        ordenes = await conn.fetch(
            "SELECT estado, origen, objetivo, fecha_planificada FROM ordenes_aplicacion ORDER BY fecha_planificada"
        )
        print(f"\nÓrdenes ({len(ordenes)}):")
        for o in ordenes:
            print(f"    {o['estado']:<10} {o['origen']:<6} {o['fecha_planificada']}  {o['objetivo']}")

        planes = await conn.fetch(
            "SELECT p.variedad::text AS variedad, p.mes, p.insumo_id, i.nombre, sum(p.dosis_por_ha) AS dosis "
            "FROM planes_fitosanitarios p JOIN insumos i ON i.id = p.insumo_id "
            "WHERE p.temporada = $1 GROUP BY 1,2,3,4",
            args.temporada,
        )
        plan = {(r["variedad"], r["mes"], r["insumo_id"]): r["dosis"] for r in planes}
        plan_meses_por_var = defaultdict(set)  # (variety, product) -> months planned
        plan_var_por_insumo = defaultdict(set)  # product -> varieties planned
        for var, mes, insumo_id in plan:
            plan_meses_por_var[(var, insumo_id)].add(mes)
            plan_var_por_insumo[insumo_id].add(var)

        desde = date(args.temporada, 5, 1)
        hasta = date(args.temporada + 1, 5, 1)
        filas = await conn.fetch(
            "SELECT r.fecha, r.insumo_id, r.producto_nombre, r.dosis_por_ha, r.valvula_id, "
            "       (r.orden_insumo_id IS NOT NULL) AS de_orden, "
            "       pa.nombre AS parcela, pa.variedad::text AS variedad "
            "FROM registros_fitosanitarios r JOIN parcelas pa ON pa.id = r.parcela_id "
            "WHERE r.fecha >= $1 AND r.fecha < $2 ORDER BY pa.variedad, r.fecha",
            desde, hasta,
        )
        print(f"\nRegistros de aplicación en la temporada: {len(filas)}  (filas del plan: {len(planes)})")

        resumen = defaultdict(lambda: {"n": 0, "parcelas": set(), "origen": set()})
        for r in filas:
            clave = (r["variedad"], r["fecha"].month, r["insumo_id"], r["producto_nombre"])
            resumen[clave]["n"] += 1
            resumen[clave]["parcelas"].add(r["parcela"])
            resumen[clave]["origen"].add("orden" if r["de_orden"] else "manual")

        en_plan = fuera = 0
        for (var, mes, insumo_id, nombre), d in sorted(resumen.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][3])):
            if insumo_id is None:
                estado = "SIN INSUMO (texto libre): nunca cuenta contra el plan"
                fuera += 1
            elif (var, mes, insumo_id) in plan:
                estado = f"EN PLAN (objetivo {plan[(var, mes, insumo_id)]:g}/ha)"
                en_plan += 1
            else:
                fuera += 1
                otros = sorted(plan_meses_por_var.get((var, insumo_id), ()))
                if otros:
                    estado = "FUERA: ese producto está en el plan de esta variedad pero en " + ", ".join(MESES[m] for m in otros)
                elif insumo_id in plan_var_por_insumo:
                    estado = "FUERA: el producto está en el plan, pero de otras variedades: " + ", ".join(sorted(plan_var_por_insumo[insumo_id]))
                else:
                    estado = "FUERA: el producto no está en ningún plan de la temporada"
            print(f"  {var:<10} {MESES[mes]}  {nombre[:28]:<28} {d['n']:>3} reg. {len(d['parcelas']):>2} parc. "
                  f"{'/'.join(sorted(d['origen'])):<12} {estado}")
        print(f"\nResumen: {en_plan} combinaciones descuentan del plan, {fuera} aparecen como no planificado.")
    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
