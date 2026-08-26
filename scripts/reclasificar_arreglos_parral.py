"""Reclasifica los 3 registros historicos de "Tejido" que en realidad eran
arreglos de parral (Parral 6, Parral 10, Parral 11), y limpia el maestro de
precios de las filas que el backfill del 2026-08-25 les creo por error.

Contexto: hasta ahora toda Tarea generaba un Egreso hardcodeado como Sueldos
Personal/Obreros (ver backend/app/api/produccion.py, _build_egreso_for_trabajo).
Fausto confirmo que 3 registros de "Tejido" no eran mantenimiento rutinario
sino un arreglo mayor de parral (gasto de inversion) cargado por conveniencia
como si fuera una Tarea:
  Parral 6  -> $2.500.000
  Parral 10 -> $2.000.000
  Parral 11 -> $885.000
Ahora existe la tarea "Arreglo Parral" (clasificada como
repuestos_reparacion/rep_repuestos_parral en vez de sueldos_personal/obreros).
Este script mueve esos 3 registros hacia la tarea nueva -- tanto el
RegistroTrabajo como su Egreso vinculado -- y borra las 3 filas de
precios_tarea (tarea="Tejido") que el backfill anterior habia creado para
esos parrales, para que un Tejido comun futuro no autocomplete esos montos.

Usage (desde el venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  python scripts\\reclasificar_arreglos_parral.py             # DRY RUN (no escribe)
  python scripts\\reclasificar_arreglos_parral.py --commit    # aplica de verdad

Comportamiento:
  - Lee DATABASE_PUBLIC_URL de backend/.env (Postgres de produccion en Railway)
  - Filtra por (tarea='Tejido', parcela, precio_unitario) exacto -- no "todo
    Tejido de esa parcela" -- para no tocar tejidos normales que puedan
    coexistir en el mismo parral.
  - --commit siempre saca su propio backup con pg_dump antes de escribir, y
    aborta sin escribir nada si el dump falla o queda sospechosamente chico.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import re
import subprocess
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import asyncpg

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"

# (nombre de parcela, precio_unitario confirmado con Fausto el 2026-08-25)
OBJETIVOS = [
    ("Parral 6", Decimal("2500000.00")),
    ("Parral 10", Decimal("2000000.00")),
    ("Parral 11", Decimal("885000.00")),
]


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def run_pg_dump_backup(database_public_url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_reclasificar_arreglos_parral.dump"
    result = subprocess.run(
        ["pg_dump", "-Fc", database_public_url, "-f", str(outfile)],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not outfile.exists() or outfile.stat().st_size < 10_000:
        print(result.stderr, file=sys.stderr)
        sys.exit("ERROR: pg_dump fallo o el archivo quedo sospechosamente chico -- no se escribe nada.")
    print(f"\nBackup OK: {outfile} ({outfile.stat().st_size:,} bytes)")
    return outfile


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    args = parser.parse_args()

    database_public_url = read_env_var("DATABASE_PUBLIC_URL")
    conn = await asyncpg.connect(asyncpg_url(database_public_url))
    try:
        registros = []
        for parcela_nombre, precio in OBJETIVOS:
            rows = await conn.fetch(
                """SELECT rt.id, rt.fecha, rt.trabajador_nombre, rt.precio_unitario,
                          rt.parcela_id, p.nombre AS parcela_nombre
                     FROM registros_trabajo rt
                     JOIN parcelas p ON p.id = rt.parcela_id
                    WHERE rt.tarea = 'Tejido' AND p.nombre = $1 AND rt.precio_unitario = $2""",
                parcela_nombre, precio,
            )
            registros.extend(rows)

        print(f"Registros de 'Tejido' a reclasificar como 'Arreglo Parral': {len(registros)}")
        for r in registros:
            print(f"  {r['fecha']}  {r['parcela_nombre']:<12} {r['trabajador_nombre']:<25} ${r['precio_unitario']:>12,.2f}  (id={r['id']})")

        precios_a_borrar = await conn.fetch(
            """SELECT pt.id, pt.temporada, p.nombre AS parcela_nombre, pt.precio_unitario
                 FROM precios_tarea pt
                 JOIN parcelas p ON p.id = pt.parcela_id
                WHERE pt.tarea = 'Tejido' AND p.nombre = ANY($1::text[])""",
            [nombre for nombre, _ in OBJETIVOS],
        )
        print(f"\nFilas del maestro de precios ('Tejido') a borrar: {len(precios_a_borrar)}")
        for p in precios_a_borrar:
            print(f"  temporada {p['temporada']}  {p['parcela_nombre']:<12} ${p['precio_unitario']:>12,.2f}  (id={p['id']})")

        if not args.commit:
            print("\nDRY RUN -- nada escrito. Ejecuta con --commit para aplicar.")
            return

        if not registros and not precios_a_borrar:
            print("\nNada para hacer -- no se encontro ningun registro/precio objetivo.")
            return

        run_pg_dump_backup(database_public_url)

        async with conn.transaction():
            for r in registros:
                await conn.execute(
                    "UPDATE registros_trabajo SET tarea = 'Arreglo Parral' WHERE id = $1",
                    r["id"],
                )
                descripcion = f"Arreglo Parral | {r['trabajador_nombre']} | {r['parcela_nombre']}"[:500]
                result = await conn.execute(
                    """UPDATE egresos
                          SET tipo = 'repuestos_reparacion',
                              clasificacion = 'rep_repuestos_parral',
                              descripcion = $2
                        WHERE fuente = 'trabajo_diario' AND referencia_id = $1""",
                    r["id"], descripcion,
                )
                print(f"  registro {r['id']}: tarea -> 'Arreglo Parral', egreso: {result}")

            for p in precios_a_borrar:
                await conn.execute("DELETE FROM precios_tarea WHERE id = $1", p["id"])

        print(f"\nReclasificados: {len(registros)} registros. Precios borrados: {len(precios_a_borrar)}.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
