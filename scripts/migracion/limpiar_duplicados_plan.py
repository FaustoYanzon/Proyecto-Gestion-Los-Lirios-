"""Cleanup of duplicated plan rows (same temporada + variedad + ronda + insumo).

Dry-run by default: prints, for every duplicated group, which row would be kept and
which would be deleted, and lists the groups that need a manual look. Writes only
with `--apply`, in ONE transaction, after typing SI (unless --local).

Why it exists: the multi-product orders feature links every applied registro to
exactly one plan row per (variedad, ronda, insumo). A second identical row can
never be covered, so its round card would stay pending forever. Rows referenced
by an order are never deleted. Only groups whose rows are identical in
(mes, objetivo, dosis_por_ha) are cleaned; the rest are reported untouched.

Usage (from the repo root):
  backend/venv/Scripts/python.exe scripts/migracion/limpiar_duplicados_plan.py            # PROD dry-run
  backend/venv/Scripts/python.exe scripts/migracion/limpiar_duplicados_plan.py --apply    # PROD write (asks SI)
  backend/venv/Scripts/python.exe scripts/migracion/limpiar_duplicados_plan.py --local    # local dev DB
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent / "backend"))

from backfill_plan_registros import confirmar_apply, read_database_url  # noqa: E402
from app.services.plan_duplicados import FilaPlan, planear_limpieza  # noqa: E402

LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="escribe; sin él es dry-run")
    parser.add_argument("--local", action="store_true", help="ignora .env.prod y exige localhost")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    url, fuente = read_database_url(skip_prod=args.local)
    host = urlparse(url).hostname
    print(f"Fuente: {fuente} | host: {host} | {'APPLY' if args.apply else 'DRY-RUN'}")
    if args.local and host not in LOCAL_HOSTS:
        print("ERROR: --local pero la base resuelta no está en localhost")
        return 1

    conn = await asyncpg.connect(url)
    try:
        filas_db = await conn.fetch(
            "SELECT p.id, p.temporada, p.variedad::text AS variedad, p.numero_aplicacion, p.insumo_id, "
            "p.mes, p.objetivo, p.dosis_por_ha, p.created_at, i.nombre AS insumo "
            "FROM planes_fitosanitarios p JOIN insumos i ON i.id = p.insumo_id"
        )
        nombres = {r["insumo_id"]: r["insumo"] for r in await conn.fetch(
            "SELECT id AS insumo_id, nombre AS insumo FROM insumos")}
        referenciadas = {
            r["plan_fitosanitario_id"] for r in await conn.fetch(
                "SELECT DISTINCT plan_fitosanitario_id FROM ordenes_aplicacion "
                "WHERE plan_fitosanitario_id IS NOT NULL")
        }
        filas = [FilaPlan(id=r["id"], temporada=r["temporada"], variedad=r["variedad"],
                          numero_aplicacion=r["numero_aplicacion"], insumo_id=r["insumo_id"],
                          mes=r["mes"], objetivo=r["objetivo"], dosis_por_ha=r["dosis_por_ha"],
                          created_at=r["created_at"]) for r in filas_db]
        plan = planear_limpieza(filas, referenciadas)
        por_id = {f.id: f for f in filas}

        print(f"\nFilas del plan: {len(filas)} | grupos a limpiar: {len(plan.limpiar)} | "
              f"filas a borrar: {len(plan.ids_a_borrar)} | grupos a revisar a mano: {len(plan.revisar)}")
        for g in plan.limpiar:
            t, var, ronda, ins = g.clave
            k = por_id[g.conservar]
            print(f"  [{t}] {var} ronda {ronda} · {nombres.get(ins, ins[:8])}: "
                  f"mes {k.mes} · {k.dosis_por_ha} /ha · \"{k.objetivo}\" -> conservar {g.conservar[:8]}, "
                  f"borrar {', '.join(i[:8] for i in g.borrar)}")
        for clave, miembros, motivo in plan.revisar:
            t, var, ronda, ins = clave
            print(f"  REVISAR [{t}] {var} ronda {ronda} · {nombres.get(ins, ins[:8])} ({motivo}):")
            for f in miembros:
                print(f"      {f.id[:8]} mes {f.mes} · {f.dosis_por_ha} /ha · \"{f.objetivo}\" · {f.created_at:%Y-%m-%d %H:%M}")

        if not args.apply:
            print("\nDry-run: no se escribió nada. Para borrar, repetí con --apply.")
            return 0
        if not plan.ids_a_borrar:
            print("\nNada para borrar.")
            return 0

        confirmar_apply(host, local=args.local)
        ids = plan.ids_a_borrar
        async with conn.transaction():
            borradas = await conn.execute("DELETE FROM planes_fitosanitarios WHERE id = ANY($1::text[])", ids)
            n = int(borradas.split()[-1])
            if n != len(ids):
                raise RuntimeError(f"Se esperaban {len(ids)} borrados y fueron {n}: transacción revertida")
        print(f"\nBorradas {n} filas duplicadas.")
    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
