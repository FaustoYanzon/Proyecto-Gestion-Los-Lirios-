"""Backfill del maestro de precios por tarea desde las tareas ya cargadas.

El maestro de precios (tabla precios_tarea, agregado 2026-08-25) arranca
vacio -- este script lo completa retroactivamente usando el precio_unitario
que ya tiene cada registros_trabajo historico, para no obligar a Fausto a
retipear a mano lo que ya se cargo.

Usage (desde el venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  python scripts\\backfill_precios_tarea.py             # DRY RUN (no escribe)
  python scripts\\backfill_precios_tarea.py --commit    # aplica de verdad

Comportamiento:
  - Lee DATABASE_PUBLIC_URL de backend/.env (Postgres de produccion en Railway)
  - Agrupa registros_trabajo por (temporada derivada de fecha [mayo->abril,
    mismo criterio que RegistroCosecha], tarea, parcela_id, unidad_medida).
    parcela_id NULL agrupa igual -- se convierte en la regla "general" de esa
    tarea, exactamente como la usa el fallback de buscarPrecio() en la app.
  - Para cada grupo, usa el precio del registro MAS RECIENTE (por fecha,
    desempatando por created_at) -- asume que el ultimo precio cargado es
    el vigente. Grupos con mas de un precio_unitario distinto se listan
    aparte con su historial completo, para que se puedan revisar antes de
    confirmar -- no se adivina cual es "el correcto" sin mostrarlo.
  - Si ya existe una fila en precios_tarea para esa combinacion exacta
    (alguien ya la cargo a mano desde la pantalla), el grupo se salta -- este
    script nunca pisa un precio ya puesto ahi.
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
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import asyncpg

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"


def read_env_var(key: str) -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} not found in {ENV_FILE}")


def asyncpg_url(url: str) -> str:
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def temporada_de_fecha(fecha) -> int:
    return fecha.year if fecha.month >= 5 else fecha.year - 1


# Confirmado con Fausto (2026-08-25): un solo registro de "Jornal Comun" en
# Parral 11 quedó cargado a $575.000/día -- 24x el resto de Jornal Comun
# (24.000-30.000/día en los demás parrales). Es un error de tipeo, no un
# precio real -- se excluye del backfill en vez de crear una regla mala.
EXCLUIR_PARCELA_NOMBRE = {
    ("Jornal Comun", "Parral 11"),
}


def run_pg_dump_backup(database_public_url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_backfill_precios_tarea.dump"
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
        rows = await conn.fetch(
            """SELECT rt.fecha, rt.tarea, rt.parcela_id, p.nombre AS parcela_nombre,
                      rt.unidad_medida, rt.precio_unitario, rt.created_at
               FROM registros_trabajo rt
               LEFT JOIN parcelas p ON p.id = rt.parcela_id
               ORDER BY rt.fecha ASC, rt.created_at ASC"""
        )

        grupos: dict[tuple, list] = defaultdict(list)
        for r in rows:
            key = (
                temporada_de_fecha(r["fecha"]), r["tarea"], r["parcela_id"], r["unidad_medida"],
            )
            grupos[key].append(r)

        existentes = await conn.fetch(
            "SELECT temporada, tarea, parcela_id, unidad_medida FROM precios_tarea"
        )
        existentes_keys = {
            (e["temporada"], e["tarea"], e["parcela_id"], e["unidad_medida"]) for e in existentes
        }

        a_crear = []
        con_variacion = []
        excluidos = []
        ya_existian = 0
        for key, filas in grupos.items():
            if key in existentes_keys:
                ya_existian += 1
                continue
            ultimo = filas[-1]  # ya viene ordenado por fecha, created_at asc
            if (key[1], ultimo["parcela_nombre"]) in EXCLUIR_PARCELA_NOMBRE:
                excluidos.append((key, ultimo["parcela_nombre"]))
                continue
            precios = {f["precio_unitario"] for f in filas}
            a_crear.append((key, ultimo["precio_unitario"], ultimo["parcela_nombre"], len(filas)))
            if len(precios) > 1:
                con_variacion.append((key, ultimo["parcela_nombre"], filas))

        temporada, tarea, parcela_id, unidad = 0, 1, 2, 3  # índices del key, legibilidad

        print(f"Combinaciones tarea/parcela/unidad/temporada encontradas: {len(grupos)}")
        print(f"  Ya tenían un precio cargado en el maestro (se saltean): {ya_existian}")
        print(f"  Excluidas a mano (confirmado con Fausto que es un error de tipeo): {len(excluidos)}")
        for key, parcela_nombre in excluidos:
            print(f"    - {key[1]} · {parcela_nombre}")
        print(f"  Se van a crear: {len(a_crear)}")
        print(f"\n=== {len(con_variacion)} de esas combinaciones tuvieron más de un precio distinto ===")
        print("(se usa el más reciente -- revisar si alguno de estos saltos es un error de tipeo)\n")
        for key, parcela_nombre, filas in con_variacion:
            print(f"  {key[tarea]} · {parcela_nombre or 'General'} · {key[unidad]} · temporada {key[temporada]}")
            for f in filas:
                print(f"      {f['fecha']}  ${f['precio_unitario']:>12,.2f}")
            print(f"      -> se usa el último: ${filas[-1]['precio_unitario']:,.2f}")

        print(f"\n=== Vista previa completa de las {len(a_crear)} filas a crear ===")
        for key, precio, parcela_nombre, n in sorted(a_crear, key=lambda x: (x[0][tarea], parcela_nombre or "")):
            print(f"  {key[tarea]:<20} {(parcela_nombre or 'General'):<15} {key[unidad]:<10} ${precio:>12,.2f}  ({n} registro{'s' if n != 1 else ''})")

        if not args.commit:
            print("\nDRY RUN -- nada escrito. Ejecuta con --commit para aplicar.")
            return

        admin = await conn.fetchrow(
            "SELECT id FROM users WHERE role = 'super_admin' ORDER BY created_at ASC LIMIT 1"
        )
        if admin is None:
            sys.exit("ERROR: no se encontró ningún usuario super_admin para asignar como created_by.")

        run_pg_dump_backup(database_public_url)

        creados = 0
        async with conn.transaction():
            now = datetime.now(timezone.utc)
            for key, precio, _parcela_nombre, _n in a_crear:
                await conn.execute(
                    """INSERT INTO precios_tarea
                         (id, temporada, tarea, parcela_id, unidad_medida, precio_unitario,
                          created_by, created_at, updated_at)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)""",
                    str(uuid.uuid4()), key[temporada], key[tarea], key[parcela_id], key[unidad],
                    precio, admin["id"], now,
                )
                creados += 1

        print(f"\nPrecios creados: {creados}.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
