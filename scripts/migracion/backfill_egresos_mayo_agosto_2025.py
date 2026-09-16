"""Backfill de Egresos faltantes para las tareas de mayo-agosto 2025 migradas por
migrate_jornales_historicos.py (temporada 25-aug25).

Motivo: la migración asumió que esos meses ya tenían un Egreso agregado mensual
cargado a mano en el sistema (por eso `crea_egreso=False` para esa temporada) y
por eso NO generó Egreso para esas 400 filas. Al verificar en el Flujo Anual de
producción (2026-09-15) se confirmó que esa asunción era incorrecta -- mayo-
agosto 2025 no tiene NINGÚN Egreso en `media_agua`, mismo problema que abril
2026 tuvo con la migración anterior (ver `backfill_egresos_abril.py`).

Este script agrega el Egreso vinculado (mismo criterio que el resto de la
migración: fuente='trabajo_diario', referencia_id=<id del RegistroTrabajo>,
EGRESO_OVERRIDE_POR_TAREA para Arreglo Parral/Arreglo Riego, sueldos_personal/
obreros para el resto) para cada fila de mayo-agosto 2025 que todavía no lo
tenga. Idempotente: solo toca registros sin Egreso vinculado, seguro de correr
más de una vez. Commits en tandas de 150 (ver README, sección sobre la
conexión pública de Railway).

Uso:
  cd C:\\claude-projects\\los-lirios
  <venv>\\python.exe scripts\\migracion\\backfill_egresos_mayo_agosto_2025.py            # DRY RUN
  <venv>\\python.exe scripts\\migracion\\backfill_egresos_mayo_agosto_2025.py --commit   # inserta
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from migrate_jornales_historicos import (
    EGRESO_OVERRIDE_POR_TAREA,
    ENV_FILE,
    PROD_ENV_FILE,
    read_database_url,
)

CHUNK_SIZE = 150


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()

    fuente_db = ".env.prod (producción)" if PROD_ENV_FILE.exists() else f"{ENV_FILE} (local/staging)"
    print(f"DATABASE_URL desde: {fuente_db}")

    conn = await asyncpg.connect(read_database_url())
    try:
        rows = await conn.fetch(
            """
            SELECT rt.id, rt.fecha, rt.tarea, rt.trabajador_nombre, rt.monto_total,
                   rt.parcela_id, p.nombre AS parcela_nombre
            FROM registros_trabajo rt
            LEFT JOIN parcelas p ON p.id = rt.parcela_id
            WHERE rt.fecha BETWEEN '2025-05-01' AND '2025-08-31'
              AND rt.detalle LIKE 'Migración JORNALES (1).xlsx%'
              AND NOT EXISTS (
                  SELECT 1 FROM egresos e
                  WHERE e.fuente = 'trabajo_diario' AND e.referencia_id = rt.id
              )
            ORDER BY rt.fecha
            """
        )
        total = sum(r["monto_total"] for r in rows)
        print(f"Filas de mayo-agosto 2025 sin Egreso vinculado: {len(rows)}  ·  total: {total:,.0f} ARS")

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
        insertados = 0
        for i in range(0, len(rows), CHUNK_SIZE):
            chunk = rows[i:i + CHUNK_SIZE]
            async with conn.transaction():
                for r in chunk:
                    tipo, clasif_egreso = EGRESO_OVERRIDE_POR_TAREA.get(
                        r["tarea"], ("sueldos_personal", "obreros")
                    )
                    parts = [r["tarea"], r["trabajador_nombre"]]
                    if r["parcela_nombre"]:
                        parts.append(r["parcela_nombre"])
                    await conn.execute(
                        """INSERT INTO egresos
                           (id, fecha, tipo, clasificacion, descripcion, monto, moneda, origen,
                            finca, forma_pago, parcela_id, fuente, referencia_id, created_by,
                            created_at, updated_at)
                           VALUES ($1,$2,$3,$4,$5,$6,'ars','no_oficial',
                                   'media_agua','efectivo',$7,'trabajo_diario',$8,$9,$10,$10)""",
                        str(uuid.uuid4()), r["fecha"], tipo, clasif_egreso, " | ".join(parts)[:500],
                        r["monto_total"], r["parcela_id"], r["id"], created_by, now,
                    )
                    insertados += 1
            print(f"  ... {min(i + CHUNK_SIZE, len(rows))}/{len(rows)} insertados", flush=True)

        print(f"Insertados {insertados} egresos.")

        check = await conn.fetchval(
            "SELECT COALESCE(SUM(monto),0) FROM egresos WHERE fecha BETWEEN '2025-05-01' AND '2025-08-31' AND fuente='trabajo_diario'"
        )
        print(f"Verificación -- suma egresos trabajo_diario mayo-agosto 2025: {check:,.0f} ARS")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
