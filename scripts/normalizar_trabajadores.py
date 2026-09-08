"""Fusion de Trabajador duplicados + backfill de registros huerfanos.

Contexto: el combobox de Trabajador (Tareas/Riego/Fitosanitarios) creaba un
Trabajador nuevo en silencio cada vez que el nombre tipeado no matcheaba
*exactamente* contra el catalogo -- 14 nombres reales quedaron con 2-3 filas
duplicadas en `trabajadores` (may/min, con/sin tilde, o repetido) y 14 filas
de registros_trabajo/registros_riego quedaron sin trabajador_id/responsable_id
porque el texto tenia un typo o estaba abreviado. El mapeo de abajo fue
armado a mano contra produccion (conteos de uso por variante + contexto de
fecha/tarea para los 2 casos abreviados) y confirmado con Fausto antes de
escribir este script -- no se auto-detecta nada por similitud, para no
fusionar a ciegas dos personas distintas.

Usage (desde el venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  python scripts\\normalizar_trabajadores.py             # DRY RUN (no escribe)
  python scripts\\normalizar_trabajadores.py --commit    # aplica de verdad

Comportamiento (ver plan completo: C:\\Users\\faust\\.claude\\plans\\flickering-percolating-raven.md):
  - Lee DATABASE_PUBLIC_URL de backend/.env (Postgres de produccion en Railway).
  - Verifica que cada id hardcodeado abajo siga existiendo con el conteo de
    uso esperado antes de tocar nada -- si algo cambio desde que se armo este
    mapeo, aborta sin escribir en vez de asumir que sigue valiendo.
  - Por cada cluster: renombra el canonico si hace falta (tilde correcta),
    re-apunta los registros de los duplicados al canonico (id + texto
    denormalizado), empareja el texto denormalizado de filas que ya
    apuntaban al canonico pero con la grafia vieja, y borra los duplicados.
  - Backfill de los registros huerfanos (trabajador_id/responsable_id NULL)
    por texto exacto tal cual quedo cargado.
  - Borra las 3 filas "ZZZ..." de pruebas viejas (inactivas, 0 uso).
  - --commit siempre saca su propio backup con pg_dump antes de escribir, y
    aborta sin escribir nada si el dump falla o queda sospechosamente chico.
    Todo el resto corre en una sola transaccion: si el DELETE final falla
    porque quedo alguna referencia sin re-apuntar, se revierte todo.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import asyncpg

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = ROOT / "backend" / ".env"
BACKUP_DIR = ROOT / "pg_backups"

# ─── Clusters de duplicados (canonico + duplicados a fusionar y borrar) ─────
# canonical_id ya existe en produccion; canonical_name es la grafia final
# (puede coincidir con la que ya tiene, o corregir la tilde).

CLUSTERS: list[dict] = [
    {"canonical_id": "35f42e16-7062-4ac2-a8eb-2282eb9e7e76", "canonical_name": "Celeste",
     "expected_canonical_usage": 3, "duplicates": [("d3248110-58d9-4ba8-b5d0-02773165d7be", 1)]},
    {"canonical_id": "55c2db82-80fe-4de6-bf15-03478c7353dd", "canonical_name": "Franco Videla",
     "expected_canonical_usage": 7, "duplicates": [("d39437f0-defc-4b99-adc0-d0d8e327a847", 2)]},
    {"canonical_id": "b0f8be10-a548-4e08-89f0-850a1b6644b4", "canonical_name": "Jesús Ortiz",
     "expected_canonical_usage": 7, "duplicates": [("d260a85b-ea3a-4713-b50c-8a1556027381", 3)]},
    {"canonical_id": "f1587eec-8b3c-4a44-8dfc-e18490f899b3", "canonical_name": "Jesús Videla",
     "expected_canonical_usage": 10, "duplicates": [
         ("681bb707-5c5c-4ec7-9923-361f88d7d098", 5),
         ("3a4ecf8c-0087-46df-a1ec-92b5a819273e", 0),
     ]},
    {"canonical_id": "ff34bae2-e413-46f9-adfe-942650af4a32", "canonical_name": "Juan Silva",
     "expected_canonical_usage": 6, "duplicates": [("5686a543-58f8-4bb9-b03b-97420efa5ff0", 2)]},
    {"canonical_id": "8427e551-5a19-4edc-b213-9b05f9589415", "canonical_name": "Lucas Mercado",
     "expected_canonical_usage": 7, "duplicates": [("e7cf63ca-e1f6-416f-b740-edd5ac47a881", 4)]},
    {"canonical_id": "116ab14f-3652-4072-b00e-e9da73285c37", "canonical_name": "Marcos",
     "expected_canonical_usage": 5, "duplicates": [("0ae4dafb-1325-4d77-a304-edf3899eaf83", 0)]},
    {"canonical_id": "06606893-3213-469a-8664-6ce384b0ea4b", "canonical_name": "Matías",
     "expected_canonical_usage": 1, "duplicates": [("68407120-5b17-41dd-87c2-956e4ad00327", 0)]},
    {"canonical_id": "1e63b9ab-7523-4522-88df-3503619746f1", "canonical_name": "Miguel Silva",
     "expected_canonical_usage": 12, "duplicates": [("5cbe4a58-568e-421f-8ab1-d0f7c5246e03", 1)]},
    {"canonical_id": "51c028b4-c231-4248-8256-c76743690795", "canonical_name": "Orlando Molina",
     "expected_canonical_usage": 12, "duplicates": [
         ("df92266e-f4f6-48e3-989f-df6e02cef3c9", 1),
         ("c1b5d644-c25a-4a44-ab5a-3c0371eb842e", 0),
     ]},
    {"canonical_id": "1c3e46c7-78e0-40a1-9343-793ba1383adf", "canonical_name": "Oscar Carrizo",
     "expected_canonical_usage": 9, "duplicates": [("babf9069-553f-456f-be22-76b7159a30bc", 2)]},
    {"canonical_id": "d2fe1281-c25e-4eed-ad5f-d969077858bc", "canonical_name": "Ramón Silva",
     "expected_canonical_usage": 6, "duplicates": [
         ("9b6e894a-eb13-4d31-8e25-7fe03e122628", 2),
         ("cfa357bb-4412-41a0-88fd-50fabcff2a90", 1),
     ]},
    {"canonical_id": "82aef480-d6cc-4b87-b902-421e1b60bb6a", "canonical_name": "Rubén",
     "expected_canonical_usage": 10, "duplicates": [("990ecc1c-dec5-4618-afb8-6ac22301b1b2", 0)]},
    {"canonical_id": "9419d42b-9784-42cd-871b-a81e45ed34f6", "canonical_name": "Sebastián",
     "expected_canonical_usage": 8, "duplicates": [
         ("575134e4-8ab9-41ee-a463-3916bdc36cb6", 3),
         ("d28f9e41-8dc6-4fb7-a43e-5f9cad5c2321", 0),
     ]},
]

# Cruft de pruebas de sesiones anteriores -- inactivas, 0 uso, se borran sueltas.
ZZZ_IDS = [
    "92e1ea3a-addd-4e53-b5c7-2001bb8ebf3a",  # ZZZ Diagnostico Claude Borrar
    "3779d9f6-02e3-4d29-824d-e59c458e8845",  # ZZZ Test Diagnostico Claude
    "0539254d-01ce-4550-9ce1-67ac7ec52c8c",  # ZZZ Test Mapa Claude
]

# Backfill de filas huerfanas por texto exacto -> canonico. Los 2 casos
# abreviados (Orlando M./M:, Jesus V) se confirmaron por contexto (mismo dia,
# misma tarea, entre filas del nombre completo) -- ver plan.
ORPHAN_TRABAJO: dict[str, str] = {
    "Celeste": "35f42e16-7062-4ac2-a8eb-2282eb9e7e76",
    "Jesús Ortiz.": "b0f8be10-a548-4e08-89f0-850a1b6644b4",
    "Jesús V": "f1587eec-8b3c-4a44-8dfc-e18490f899b3",
    "Marcos.": "116ab14f-3652-4072-b00e-e9da73285c37",
    "Matías": "06606893-3213-469a-8664-6ce384b0ea4b",
    "Miguel Silva.": "1e63b9ab-7523-4522-88df-3503619746f1",
    "Orlando M.": "51c028b4-c231-4248-8256-c76743690795",
    "Orlando M:": "51c028b4-c231-4248-8256-c76743690795",
    "Ramón Silva.": "d2fe1281-c25e-4eed-ad5f-d969077858bc",
    "Rubén": "82aef480-d6cc-4b87-b902-421e1b60bb6a",
    "Sebastián": "9419d42b-9784-42cd-871b-a81e45ed34f6",
    "Lautaro": "eff13077-38c8-48cf-9a95-175218d85f19",
}
ORPHAN_RIEGO: dict[str, str] = {
    "Fausto": "02419e6a-08cb-4dab-9c8c-81c7cdead139",
}


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
    outfile = BACKUP_DIR / f"los_lirios_prod_{ts}_pre_normalizar_trabajadores.dump"
    result = subprocess.run(
        ["pg_dump", "-Fc", database_public_url, "-f", str(outfile)],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not outfile.exists() or outfile.stat().st_size < 10_000:
        print(result.stderr, file=sys.stderr)
        sys.exit("ERROR: pg_dump fallo o el archivo quedo sospechosamente chico -- no se escribe nada.")
    print(f"\nBackup OK: {outfile} ({outfile.stat().st_size:,} bytes)")
    return outfile


async def usage_count(conn: asyncpg.Connection, trabajador_id: str) -> int:
    row = await conn.fetchrow(
        """SELECT
             (SELECT count(*) FROM registros_trabajo WHERE trabajador_id = $1) AS tareas,
             (SELECT count(*) FROM registros_riego WHERE responsable_id = $1) AS riegos,
             (SELECT count(*) FROM registros_fitosanitarios WHERE responsable_id = $1) AS fitos
        """,
        trabajador_id,
    )
    return row["tareas"] + row["riegos"] + row["fitos"]


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    args = parser.parse_args()

    database_public_url = read_env_var("DATABASE_PUBLIC_URL")
    conn = await asyncpg.connect(asyncpg_url(database_public_url))
    try:
        # ── Verificacion previa: todo lo hardcodeado sigue existiendo tal
        # como se lo confirmo contra produccion antes de escribir este script.
        problemas: list[str] = []
        all_ids = {c["canonical_id"] for c in CLUSTERS} | {
            d for c in CLUSTERS for d, _ in c["duplicates"]
        } | set(ZZZ_IDS) | set(ORPHAN_TRABAJO.values()) | set(ORPHAN_RIEGO.values())
        existentes = {
            row["id"]: row["nombre_completo"]
            for row in await conn.fetch(
                f"SELECT id, nombre_completo FROM trabajadores WHERE id = ANY($1::text[])", list(all_ids)
            )
        }
        for tid in all_ids:
            if tid not in existentes:
                problemas.append(f"  - id {tid} ya no existe en trabajadores")

        for cluster in CLUSTERS:
            cid = cluster["canonical_id"]
            if cid in existentes:
                actual = await usage_count(conn, cid)
                if actual != cluster["expected_canonical_usage"]:
                    problemas.append(
                        f"  - {cluster['canonical_name']} ({cid}): uso esperado "
                        f"{cluster['expected_canonical_usage']}, uso real {actual} "
                        f"(¿se cargo algo nuevo desde que se armo el mapeo?)"
                    )
            for dup_id, expected_usage in cluster["duplicates"]:
                if dup_id in existentes:
                    actual = await usage_count(conn, dup_id)
                    if actual != expected_usage:
                        problemas.append(
                            f"  - duplicado de {cluster['canonical_name']} ({dup_id}): uso esperado "
                            f"{expected_usage}, uso real {actual}"
                        )

        if problemas:
            print("ABORTADO -- los datos de produccion cambiaron desde que se armo este mapeo:")
            print("\n".join(problemas))
            sys.exit(1)

        # ── Reporte del plan ─────────────────────────────────────────────
        print("=== Fusion de duplicados ===")
        total_dups = 0
        for cluster in CLUSTERS:
            cid = cluster["canonical_id"]
            nombre_actual = existentes[cid]
            rename_note = f" (renombrar de '{nombre_actual}')" if nombre_actual != cluster["canonical_name"] else ""
            print(f"\n{cluster['canonical_name']}{rename_note} [{cid}] queda como canonico")
            for dup_id, usage in cluster["duplicates"]:
                print(f"  <- fusiona y borra {dup_id} ({existentes[dup_id]!r}, {usage} registros)")
                total_dups += 1

        print(f"\n=== Limpieza de pruebas viejas ({len(ZZZ_IDS)} filas) ===")
        for zid in ZZZ_IDS:
            print(f"  - borra {zid} ({existentes[zid]!r})")

        print(f"\n=== Backfill de huerfanos (registros_trabajo, {len(ORPHAN_TRABAJO)} textos) ===")
        for texto, cid in ORPHAN_TRABAJO.items():
            print(f"  '{texto}' -> {cluster_name_by_id(cid, existentes)}")
        print(f"\n=== Backfill de huerfanos (registros_riego, {len(ORPHAN_RIEGO)} textos) ===")
        for texto, cid in ORPHAN_RIEGO.items():
            print(f"  '{texto}' -> {cluster_name_by_id(cid, existentes)}")

        print(f"\nTotal duplicados a borrar: {total_dups + len(ZZZ_IDS)}")
        print(f"trabajadores antes: {len(await conn.fetch('SELECT id FROM trabajadores'))}")
        print(f"trabajadores despues (esperado): "
              f"{len(await conn.fetch('SELECT id FROM trabajadores')) - total_dups - len(ZZZ_IDS)}")

        if not args.commit:
            print("\nDRY RUN -- nada escrito. Ejecuta con --commit para aplicar.")
            return

        run_pg_dump_backup(database_public_url)

        movidos = 0
        async with conn.transaction():
            # 1) Renombrar canonicos que necesitan corregir tilde.
            for cluster in CLUSTERS:
                if existentes[cluster["canonical_id"]] != cluster["canonical_name"]:
                    await conn.execute(
                        "UPDATE trabajadores SET nombre_completo = $1 WHERE id = $2",
                        cluster["canonical_name"], cluster["canonical_id"],
                    )

            # 2) Re-apuntar registros de los duplicados al canonico.
            for cluster in CLUSTERS:
                cid, cname = cluster["canonical_id"], cluster["canonical_name"]
                dup_ids = [d for d, _ in cluster["duplicates"]]
                if not dup_ids:
                    continue
                r1 = await conn.execute(
                    "UPDATE registros_trabajo SET trabajador_id = $1, trabajador_nombre = $2 "
                    "WHERE trabajador_id = ANY($3::text[])",
                    cid, cname, dup_ids,
                )
                r2 = await conn.execute(
                    "UPDATE registros_riego SET responsable_id = $1, responsable = $2 "
                    "WHERE responsable_id = ANY($3::text[])",
                    cid, cname, dup_ids,
                )
                r3 = await conn.execute(
                    "UPDATE registros_fitosanitarios SET responsable_id = $1, responsable = $2 "
                    "WHERE responsable_id = ANY($3::text[])",
                    cid, cname, dup_ids,
                )
                movidos += sum(int(r.split()[-1]) for r in (r1, r2, r3))

                # 3) Emparejar texto denormalizado de filas que ya apuntaban al
                # canonico pero con una grafia vieja (may/min o sin tilde).
                await conn.execute(
                    "UPDATE registros_trabajo SET trabajador_nombre = $1 "
                    "WHERE trabajador_id = $2 AND trabajador_nombre <> $1",
                    cname, cid,
                )
                await conn.execute(
                    "UPDATE registros_riego SET responsable = $1 "
                    "WHERE responsable_id = $2 AND responsable <> $1",
                    cname, cid,
                )
                await conn.execute(
                    "UPDATE registros_fitosanitarios SET responsable = $1 "
                    "WHERE responsable_id = $2 AND responsable <> $1",
                    cname, cid,
                )

            # 4) Backfill de huerfanos.
            for texto, cid in ORPHAN_TRABAJO.items():
                cname = cluster_name_by_id(cid, existentes)
                r = await conn.execute(
                    "UPDATE registros_trabajo SET trabajador_id = $1, trabajador_nombre = $2 "
                    "WHERE trabajador_id IS NULL AND trabajador_nombre = $3",
                    cid, cname, texto,
                )
                movidos += int(r.split()[-1])
            for texto, cid in ORPHAN_RIEGO.items():
                cname = cluster_name_by_id(cid, existentes)
                r = await conn.execute(
                    "UPDATE registros_riego SET responsable_id = $1, responsable = $2 "
                    "WHERE responsable_id IS NULL AND responsable = $3",
                    cid, cname, texto,
                )
                movidos += int(r.split()[-1])

            # 5) Borrar duplicados y cruft de pruebas -- si quedo alguna
            # referencia sin re-apuntar, esto falla por la FK y se revierte todo.
            borrar_ids = [d for c in CLUSTERS for d, _ in c["duplicates"]] + ZZZ_IDS
            await conn.execute("DELETE FROM trabajadores WHERE id = ANY($1::text[])", borrar_ids)

        restantes = await conn.fetch("SELECT id FROM trabajadores")
        huerfanos_trabajo = await conn.fetchval(
            "SELECT count(*) FROM registros_trabajo WHERE trabajador_id IS NULL"
        )
        huerfanos_riego = await conn.fetchval(
            "SELECT count(*) FROM registros_riego WHERE responsable_id IS NULL"
        )
        print(f"\nOK. Registros re-apuntados/backfilleados: {movidos}. "
              f"Trabajadores borrados: {len(borrar_ids)}. Trabajadores restantes: {len(restantes)}.")
        print(f"Huerfanos restantes -- tareas: {huerfanos_trabajo}, riego: {huerfanos_riego}")
    finally:
        await conn.close()


def cluster_name_by_id(cid: str, existentes: dict[str, str]) -> str:
    for c in CLUSTERS:
        if c["canonical_id"] == cid:
            return c["canonical_name"]
    return existentes[cid]


if __name__ == "__main__":
    asyncio.run(main())
