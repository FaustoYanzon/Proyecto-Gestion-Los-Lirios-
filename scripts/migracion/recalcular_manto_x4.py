"""Recalculates `registros_riego` for the manto = 4x goteo rule (owner decision 2026-11-05).

For every `tipo = 'manto'` record:
  * mm_aplicados = round(duracion_horas * 1.6 * 4, 2). Records still running
    (duracion_horas NULL) keep mm_aplicados untouched.
  * Records with n_valvulas_manto NOT NULL (surface-based manto) also get
    n_valvulas_manto = max(1, ceil(round(superficie_ha, 4))) from their parcel,
    the same rule as RegistroRiego.valvulas_manto_de. Historical manto
    (n_valvulas_manto NULL) keeps counting valves from its `valvula` CSV.
Run AFTER corregir_parral_4_5.py so Parral 4/5 already have 2.0 ha.

Dry run by default: prints counts and 5 before/after examples (read-only).
`--apply` writes in a single transaction, each UPDATE guarded by the values
read, so it is idempotent; any unexpected row count raises and rolls back.

Reuses _prod_db.py: prints only the host name, never the URL or credentials.

Usage (from the repo root, venv python):
  backend/venv/Scripts/python.exe scripts/migracion/recalcular_manto_x4.py                 # DRY RUN, production
  backend/venv/Scripts/python.exe scripts/migracion/recalcular_manto_x4.py --local         # DRY RUN, local DB
  backend/venv/Scripts/python.exe scripts/migracion/recalcular_manto_x4.py --apply         # writes (asks SI)
"""
from __future__ import annotations

import argparse
import asyncio
import math
import sys
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prod_db import LOCAL_HOSTS, confirmar_apply, read_database_url  # noqa: E402

MM_POR_HORA = 1.6
FACTOR_MANTO = 4.0
N_EJEMPLOS = 5


@dataclass
class Cambio:
    id: str
    parcela: str
    duracion_horas: float | None
    mm_antes: float | None
    mm_despues: float | None
    n_antes: int | None
    n_despues: int | None

    @property
    def cambia(self) -> bool:
        return self.mm_antes != self.mm_despues or self.n_antes != self.n_despues


def valvulas_manto_de(superficie_ha: Decimal | float) -> int:
    """Mirror of RegistroRiego.valvulas_manto_de (round first: float noise must not bump the ceil)."""
    return max(1, math.ceil(round(float(superficie_ha), 4)))


def calcular(fila: asyncpg.Record) -> Cambio:
    mm_despues = fila["mm_aplicados"]
    if fila["duracion_horas"] is not None:
        mm_despues = round(fila["duracion_horas"] * MM_POR_HORA * FACTOR_MANTO, 2)

    n_despues = fila["n_valvulas_manto"]
    superficie = fila["superficie_ha"]
    # Only surface-based manto stores n; skip parcels without a usable surface.
    if n_despues is not None and superficie is not None and superficie > 0:
        n_despues = valvulas_manto_de(superficie)

    return Cambio(
        id=fila["id"], parcela=fila["parcela"], duracion_horas=fila["duracion_horas"],
        mm_antes=fila["mm_aplicados"], mm_despues=mm_despues,
        n_antes=fila["n_valvulas_manto"], n_despues=n_despues,
    )


def _litros(duracion: float | None, n: int | None) -> str:
    # Surface-based manto only; historical rows (n NULL) depend on the CSV, so show n/a.
    if duracion is None or n is None:
        return "n/a"
    return f"{duracion * 16000 * FACTOR_MANTO * n:,.0f}"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="use the local dev database")
    parser.add_argument("--apply", action="store_true", help="write the UPDATEs (default: dry run)")
    args = parser.parse_args()

    url, source = read_database_url(skip_prod=args.local)
    host = urlparse(url).hostname
    if args.local and host not in LOCAL_HOSTS:
        print("ERROR: --local pero la base resuelta no está en localhost")
        return 1
    print(f"Fuente: {source} | host: {host} | {'APPLY' if args.apply else 'DRY RUN (solo lectura)'}")

    conn = await asyncpg.connect(url)
    try:
        filas = await conn.fetch(
            "SELECT r.id, p.nombre AS parcela, p.superficie_ha, r.duracion_horas, "
            "r.mm_aplicados, r.n_valvulas_manto "
            "FROM registros_riego r JOIN parcelas p ON p.id = r.parcela_id "
            "WHERE r.tipo::text = $1 ORDER BY r.fecha, r.id",
            "manto",
        )
        cambios = [calcular(f) for f in filas]
        pendientes = [c for c in cambios if c.cambia]
        en_curso = sum(1 for c in cambios if c.duracion_horas is None)
        con_n = sum(1 for c in cambios if c.n_antes is not None)
        print(
            f"registros manto: {len(cambios)} | con n_valvulas_manto: {con_n} | "
            f"historicos (n NULL): {len(cambios) - con_n} | en curso (sin duracion): {en_curso}"
        )
        print(f"a modificar: {len(pendientes)} | sin cambios: {len(cambios) - len(pendientes)}")

        for c in pendientes[:N_EJEMPLOS]:
            print(
                f"  {c.id} {c.parcela:<14} h={c.duracion_horas} "
                f"mm {c.mm_antes} -> {c.mm_despues} | n {c.n_antes} -> {c.n_despues} | "
                f"litros {_litros(c.duracion_horas, c.n_antes)} -> {_litros(c.duracion_horas, c.n_despues)}"
            )

        if not pendientes:
            print("OK: nada que modificar.")
            return 0
        if not args.apply:
            print("\nDRY RUN: nada escrito. Revisar los ejemplos y correr con --apply.")
            return 0

        confirmar_apply(host, local=args.local)
        async with conn.transaction():
            for c in pendientes:
                # IS NOT DISTINCT FROM: guards on the values read, NULL-safe.
                resultado = await conn.execute(
                    "UPDATE registros_riego SET mm_aplicados = $1, n_valvulas_manto = $2, updated_at = now() "
                    "WHERE id = $3 AND tipo::text = $4 "
                    "AND mm_aplicados IS NOT DISTINCT FROM $5 "
                    "AND n_valvulas_manto IS NOT DISTINCT FROM $6",
                    c.mm_despues, c.n_despues, c.id, "manto", c.mm_antes, c.n_antes,
                )
                # Raising inside the transaction rolls everything back
                if resultado != "UPDATE 1":
                    raise RuntimeError(f"Filas afectadas inesperadas ({resultado}) en {c.id}; rollback.")
        print(f"Aplicado: {len(pendientes)} registros actualizados.")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
