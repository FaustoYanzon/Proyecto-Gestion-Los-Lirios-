"""Backfill de Egresos faltantes para las tareas de abril 2026 migradas por
migrate_jornales.py.

Motivo: migrate_jornales.py asumió que ya existía un Egreso agregado mensual
para abril 2026 (de la migración histórica anterior, scripts/migracion/
egresos.csv) y por eso NO generó Egreso para esas 198 filas. Al revisar
producción se confirmó que esa migración de Egresos históricos nunca se
corrió ahí -- abril 2026 no tenía ningún Egreso. Este script agrega el
Egreso vinculado (mismo criterio que mayo-julio: fuente='trabajo_diario',
referencia_id=<id del RegistroTrabajo>) para cada fila de abril que todavía
no lo tenga. Idempotente: solo toca registros sin Egreso vinculado, seguro
de correr más de una vez.

Uso:
  cd C:\\claude-projects\\los-lirios
  <venv>\\python.exe scripts\\migracion\\backfill_egresos_abril.py            # DRY RUN
  <venv>\\python.exe scripts\\migracion\\backfill_egresos_abril.py --commit   # inserta
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import asyncpg

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent.parent / "backend" / ".env"


def read_database_url() -> str:
    env_url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if env_url:
        return re.sub(r"^postgresql\+\w+://", "postgresql://", env_url)
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("DATABASE_URL"):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            return re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    raise RuntimeError(f"DATABASE_URL not found in {ENV_FILE}")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()

    conn = await asyncpg.connect(read_database_url())
    try:
        rows = await conn.fetch(
            """
            SELECT rt.id, rt.fecha, rt.tarea, rt.trabajador_nombre, rt.monto_total,
                   rt.parcela_id, p.nombre AS parcela_nombre
            FROM registros_trabajo rt
            LEFT JOIN parcelas p ON p.id = rt.parcela_id
            WHERE rt.fecha BETWEEN '2026-04-01' AND '2026-04-30'
              AND rt.detalle LIKE 'Migración JORNALES 2026.xlsx%'
              AND NOT EXISTS (
                  SELECT 1 FROM egresos e
                  WHERE e.fuente = 'trabajo_diario' AND e.referencia_id = rt.id
              )
            ORDER BY rt.fecha
            """
        )
        total = sum(r["monto_total"] for r in rows)
        print(f"Filas de abril sin Egreso vinculado: {len(rows)}  ·  total: {total:,.0f} ARS")

        if not args.commit:
            print("DRY RUN -- nada insertado. Ejecutá con --commit para cargar.")
            return

        admin = await conn.fetchrow(
            "SELECT id, username FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1"
        )
        if admin is None:
            sys.exit("ERROR: no super_admin user found")
        created_by = admin["id"]
        print(f"created_by: {admin['username']}")

        now = datetime.now(timezone.utc)
        async with conn.transaction():
            for r in rows:
                parts = [r["tarea"], r["trabajador_nombre"]]
                if r["parcela_nombre"]:
                    parts.append(r["parcela_nombre"])
                await conn.execute(
                    """INSERT INTO egresos
                       (id, fecha, tipo, clasificacion, descripcion, monto, moneda, origen,
                        finca, forma_pago, parcela_id, fuente, referencia_id, created_by,
                        created_at, updated_at)
                       VALUES ($1,$2,'sueldos_personal','obreros',$3,$4,'ars','no_oficial',
                               'media_agua','efectivo',$5,'trabajo_diario',$6,$7,$8,$8)""",
                    str(uuid.uuid4()), r["fecha"], " | ".join(parts)[:500], r["monto_total"],
                    r["parcela_id"], r["id"], created_by, now,
                )
        print(f"Insertados {len(rows)} egresos.")

        check = await conn.fetchval(
            "SELECT COALESCE(SUM(monto),0) FROM egresos WHERE fecha BETWEEN '2026-04-01' AND '2026-04-30' AND fuente='trabajo_diario'"
        )
        print(f"Verificación -- suma egresos trabajo_diario en abril: {check:,.0f} ARS")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
