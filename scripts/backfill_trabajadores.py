"""Backfill del catalogo de Trabajador desde los nombres ya cargados.

El combobox de Trabajador (trabajador_id en registros_trabajo, responsable_id
en registros_riego/registros_fitosanitarios) esta desplegado desde el
2026-08-05, pero nunca se ejecuto con exito la primera vez que se uso -- la
tabla `trabajadores` quedo vacia y ningun registro historico quedo vinculado
(confirmado: 105 de 106 registros_trabajo con trabajador_id NULL al
2026-08-12, la unica excepcion es un registro de prueba). Este script cierra
ese gap retroactivamente: crea un Trabajador por cada nombre unico
(case-insensitive) que aparece en los 3 modulos y vincula los registros
existentes a el.

Usage (desde el venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  python scripts\\backfill_trabajadores.py             # DRY RUN (no escribe)
  python scripts\\backfill_trabajadores.py --commit    # aplica de verdad

Comportamiento:
  - Lee DATABASE_PUBLIC_URL de backend/.env (Postgres de produccion en Railway)
  - Junta nombres distintos (comparados case-insensitive, trim) de:
      registros_trabajo.trabajador_nombre  (donde trabajador_id IS NULL)
      registros_riego.responsable          (donde responsable_id IS NULL)
      registros_fitosanitarios.responsable (donde responsable_id IS NULL)
  - Para cada nombre: reusa un Trabajador ya existente con ese nombre
    (case-insensitive) si lo hay: si no, crea uno nuevo (rol='obrero', mismo
    default que POST /trabajadores/). La forma de escritura que se guarda es
    la variante de mayus/minus mas frecuente entre las filas con ese nombre.
  - Vincula (UPDATE ... SET trabajador_id/responsable_id) todas las filas de
    los 3 modulos que matcheen ese nombre y todavia no tengan el id seteado.
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
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import asyncpg

# La consola de Windows no siempre usa UTF-8 -- sin esto, nombres con
# tildes/ñ salen mangled en el reporte (aunque el valor real que se guarda
# en la base, leido de asyncpg, siempre es UTF-8 correcto).
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def normalizar(nombre: str) -> str:
    """Trim + saca un punto final suelto (typo comun: "Oscar Carrizo." vs
    "Oscar Carrizo" son la misma persona, no dos nombres distintos)."""
    n = nombre.strip()
    if n.endswith(".") and not n.endswith(".."):
        n = n[:-1].strip()
    return n

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


def run_pg_dump_backup(database_public_url: str) -> Path:
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_backfill_trabajadores.dump"
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
        # Nombres pendientes de vincular, por modulo.
        trabajo_rows = await conn.fetch(
            "SELECT id, trabajador_nombre AS nombre FROM registros_trabajo WHERE trabajador_id IS NULL"
        )
        riego_rows = await conn.fetch(
            "SELECT id, responsable AS nombre FROM registros_riego WHERE responsable_id IS NULL"
        )
        fito_rows = await conn.fetch(
            "SELECT id, responsable AS nombre FROM registros_fitosanitarios WHERE responsable_id IS NULL"
        )

        # Agrupar todas las variantes de mayus/minus por clave case-insensitive,
        # para elegir la grafia mas frecuente como nombre_completo del Trabajador.
        variantes: dict[str, Counter] = defaultdict(Counter)
        for row in [*trabajo_rows, *riego_rows, *fito_rows]:
            nombre = normalizar(row["nombre"] or "")
            if not nombre:
                continue
            variantes[nombre.lower()][nombre] += 1

        existentes = await conn.fetch("SELECT id, nombre_completo FROM trabajadores")
        existentes_by_key = {row["nombre_completo"].strip().lower(): row["id"] for row in existentes}

        nombres_nuevos = [k for k in variantes if k not in existentes_by_key]
        nombres_reusados = [k for k in variantes if k in existentes_by_key]

        print(f"registros_trabajo sin vincular: {len(trabajo_rows)}")
        print(f"registros_riego sin vincular: {len(riego_rows)}")
        print(f"registros_fitosanitarios sin vincular: {len(fito_rows)}")
        print(f"\nNombres unicos encontrados: {len(variantes)}")
        print(f"  Ya existen en trabajadores (se reusa el id): {len(nombres_reusados)}")
        print(f"  Nuevos (se crea un Trabajador): {len(nombres_nuevos)}")
        for key in sorted(nombres_nuevos):
            grafia = variantes[key].most_common(1)[0][0]
            print(f"    + {grafia}")

        if not args.commit:
            print("\nDRY RUN -- nada escrito. Ejecuta con --commit para aplicar.")
            return

        run_pg_dump_backup(database_public_url)

        creados = 0
        vinculados = 0
        async with conn.transaction():
            now = datetime.now(timezone.utc)
            id_by_key: dict[str, str] = dict(existentes_by_key)
            for key in nombres_nuevos:
                grafia = variantes[key].most_common(1)[0][0]
                nuevo_id = str(uuid.uuid4())
                await conn.execute(
                    """INSERT INTO trabajadores (id, nombre_completo, rol, is_active, created_at, updated_at)
                       VALUES ($1, $2, 'obrero', true, $3, $3)""",
                    nuevo_id, grafia, now,
                )
                id_by_key[key] = nuevo_id
                creados += 1

            for row in trabajo_rows:
                nombre = normalizar(row["nombre"] or "")
                if not nombre:
                    continue
                tid = id_by_key[nombre.lower()]
                await conn.execute(
                    "UPDATE registros_trabajo SET trabajador_id = $1 WHERE id = $2", tid, row["id"]
                )
                vinculados += 1
            for row in riego_rows:
                nombre = normalizar(row["nombre"] or "")
                if not nombre:
                    continue
                tid = id_by_key[nombre.lower()]
                await conn.execute(
                    "UPDATE registros_riego SET responsable_id = $1 WHERE id = $2", tid, row["id"]
                )
                vinculados += 1
            for row in fito_rows:
                nombre = normalizar(row["nombre"] or "")
                if not nombre:
                    continue
                tid = id_by_key[nombre.lower()]
                await conn.execute(
                    "UPDATE registros_fitosanitarios SET responsable_id = $1 WHERE id = $2", tid, row["id"]
                )
                vinculados += 1

        print(f"\nTrabajadores creados: {creados}. Registros vinculados: {vinculados}.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
