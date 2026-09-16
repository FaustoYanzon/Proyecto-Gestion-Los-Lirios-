"""Limpieza de registros contaminados insertados por una corrida --commit anterior
de migrate_jornales_historicos.py, ANTES de que se agregara el filtro NOMBRES_EXCLUIDOS
(sesión 2026-09-15).

Esa corrida anterior migró como si fueran jornales reales: "Combustible" (gasto de
combustible anotado en la planilla de jornales), "Hilo" (insumo de atado), y los
"días de la semana" (Viernes/Lunes/Martes/Miercoles) de la hoja 8-03-2024 bajo la
tarea "VIAJES SECADERO POR DIA" (el monto del grupo completo repartido 1/3 entre
Pasero 1/2/3, atribuido a un "trabajador" que en realidad es el día, no una persona).

Identifica por: detalle LIKE '%JORNALES (1).xlsx%' AND trabajador_nombre (sin acentos,
mayúsculas) en la misma lista NOMBRES_EXCLUIDOS del script de migración. Borra primero
los Egresos vinculados (fuente='trabajo_diario', referencia_id = registro.id) y después
los registros_trabajo.

Uso (con el venv del backend):
  C:\\claude-projects\\los-lirios\\backend\\venv\\Scripts\\python.exe scripts\\migracion\\cleanup_contaminacion_jornales_hist.py            # DRY RUN
  C:\\claude-projects\\los-lirios\\backend\\venv\\Scripts\\python.exe scripts\\migracion\\cleanup_contaminacion_jornales_hist.py --commit   # borra
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from migrate_jornales_historicos import NOMBRES_EXCLUIDOS, PROD_ENV_FILE, ENV_FILE, read_database_url


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()

    fuente_db = ".env.prod (producción)" if PROD_ENV_FILE.exists() else f"{ENV_FILE} (local/staging)"
    print(f"DATABASE_URL desde: {fuente_db}")
    conn = await asyncpg.connect(read_database_url())
    try:
        nombres = sorted(NOMBRES_EXCLUIDOS)
        registros = await conn.fetch(
            """SELECT id, fecha, tarea, trabajador_nombre, monto_total, detalle
               FROM registros_trabajo
               WHERE detalle LIKE '%JORNALES (1).xlsx%'
                 AND UPPER(trabajador_nombre) = ANY($1::text[])
               ORDER BY fecha, tarea""",
            nombres,
        )
        if not registros:
            print("No se encontraron registros contaminados. Nada para limpiar.")
            return

        reg_ids = [r["id"] for r in registros]
        egresos = await conn.fetch(
            """SELECT id, fecha, tipo, clasificacion, descripcion, monto
               FROM egresos
               WHERE fuente = 'trabajo_diario' AND referencia_id = ANY($1::text[])""",
            reg_ids,
        )

        print(f"registros_trabajo contaminados encontrados: {len(registros)}")
        total_reg = sum(r["monto_total"] for r in registros)
        for r in registros:
            print(f"  {r['fecha']} | {r['tarea']:20s} | {r['trabajador_nombre']:12s} | {r['monto_total']:>10} | {r['detalle']}")
        print(f"  TOTAL monto_total: {total_reg:,.0f} ARS\n")

        print(f"egresos vinculados encontrados: {len(egresos)}")
        total_egr = sum(e["monto"] for e in egresos)
        for e in egresos:
            print(f"  {e['fecha']} | {e['tipo']:20s} | {e['clasificacion']:15s} | {e['monto']:>10} | {e['descripcion']}")
        print(f"  TOTAL monto: {total_egr:,.0f} ARS\n")

        if not args.commit:
            print("DRY RUN — nada borrado. Ejecutá con --commit para borrar.")
            return

        async with conn.transaction():
            egr_ids = [e["id"] for e in egresos]
            if egr_ids:
                await conn.execute("DELETE FROM egresos WHERE id = ANY($1::text[])", egr_ids)
            await conn.execute("DELETE FROM registros_trabajo WHERE id = ANY($1::text[])", reg_ids)

        print(f"Borrados: {len(registros)} registros_trabajo, {len(egresos)} egresos.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
