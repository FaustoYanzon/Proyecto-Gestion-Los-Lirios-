"""Backfill de RegistroFitosanitario.plan_fitosanitario_id para los registros
históricos cargados a mano (sin orden de aplicación) de una temporada.

Motivo: el cumplimiento del plan pasó a medirse por hectáreas desde el vínculo
explícito registro -> fila del plan (spec 2026-10-27-ordenes-multiproducto-plan,
"Migración + backfill", paso 4). Los registros manuales anteriores no tienen
ese vínculo; este script les aplica UNA sola vez la heurística vieja (la
N-ésima aplicación de un insumo en una parcela cubre la N-ésima ronda del plan
de su variedad). Reglas completas en backend/app/services/plan_backfill.py.

Solo toca registros de la temporada (1/5/T .. 30/4/T+1) con insumo, sin orden
(orden_parcela_id NULL) y sin plan_fitosanitario_id. Idempotente: una segunda
corrida no asigna nada nuevo. `--apply` escribe todo en UNA transacción (son
cientos de UPDATE de una fila): si la conexión se corta no queda nada a medias
y el reintento parte de cero. Igual, el servicio reconstruye un grupo del mismo
día que haya quedado partido (ver plan_backfill.py) y el UPDATE re-chequea ambas
columnas en NULL. Contra una base que no es localhost, `--apply` muestra el host
y pide escribir `SI` antes de tocar nada.

Reversión: los registros manuales nunca reciben plan_fitosanitario_id por la
app, así que los vinculados por este backfill son exactamente
`orden_parcela_id IS NULL AND plan_fitosanitario_id IS NOT NULL` en la ventana.

Uso:
  cd C:\\claude-projects\\los-lirios
  <venv>\\python.exe scripts\\migracion\\backfill_plan_registros.py --temporada 2026 --local   # DRY RUN local
  <venv>\\python.exe scripts\\migracion\\backfill_plan_registros.py --temporada 2026           # DRY RUN (.env.prod si existe)
  <venv>\\python.exe scripts\\migracion\\backfill_plan_registros.py --temporada 2026 --apply   # escribe
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import asyncpg

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ENV_FILE = ROOT / "backend" / ".env"
PROD_ENV_FILE = HERE / ".env.prod"  # opcional, gitignored -- ver README
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

# The pure assignment logic lives in the backend so its tests can import it.
sys.path.insert(0, str(ROOT / "backend"))
from app.services.plan_backfill import (  # noqa: E402
    MOTIVOS_OMISION,
    PlanRow,
    RegistroRow,
    analizar_backfill,
)


def _extract_database_url(text: str) -> str | None:
    for line in text.splitlines():
        if line.strip().startswith("DATABASE_URL"):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            return re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    return None


def read_database_url(skip_prod: bool) -> tuple[str, str]:
    """(url, source label). Same order as the other scripts: .env.prod, env vars,
    backend/.env. `skip_prod` drops the .env.prod step (dry runs against local)."""
    if not skip_prod and PROD_ENV_FILE.exists():
        url = _extract_database_url(PROD_ENV_FILE.read_text(encoding="utf-8"))
        if url:
            return url, ".env.prod (producción)"
    env_url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if env_url:
        return re.sub(r"^postgresql\+\w+://", "postgresql://", env_url), "variable de entorno"
    url = _extract_database_url(ENV_FILE.read_text(encoding="utf-8"))
    if url:
        return url, f"{ENV_FILE} (local/staging)"
    raise RuntimeError(f"DATABASE_URL not found in {ENV_FILE}")


def confirmar_apply(host: str | None, *, local: bool, leer: Callable[[str], str] = input) -> None:
    """Gate before the first write. With --local the host was already checked to
    be localhost, so no prompt; otherwise show only the hostname (never the URL
    or credentials) and require the literal answer `SI`. Anything else, or no
    stdin, exits with code 1."""
    if local:
        return
    print(f"\n--apply contra el host: {host}")
    try:
        respuesta = leer("Escribí SI para escribir en esa base: ")
    except EOFError:
        respuesta = ""
    if respuesta.strip() != "SI":
        print("Abortado: no se escribió nada.")
        sys.exit(1)


async def _load(conn: asyncpg.Connection, temporada: int, desde: date, hasta: date):
    plan_rows = await conn.fetch(
        """SELECT pf.id, pf.temporada, pf.variedad::text AS variedad, pf.insumo_id,
                  pf.numero_aplicacion, i.nombre AS insumo_nombre
           FROM planes_fitosanitarios pf JOIN insumos i ON i.id = pf.insumo_id
           WHERE pf.temporada = $1""",
        temporada,
    )
    parcela_rows = await conn.fetch(
        "SELECT id, nombre, variedad::text AS variedad FROM parcelas"
    )
    # Every record of the window, linked ones included: they mark taken rounds.
    registro_rows = await conn.fetch(
        """SELECT id, fecha, parcela_id, insumo_id, plan_fitosanitario_id, orden_parcela_id,
                  valvula_id, orden_valvula_id
           FROM registros_fitosanitarios
           WHERE fecha BETWEEN $1 AND $2""",
        desde, hasta,
    )
    return plan_rows, parcela_rows, registro_rows


def _print_summary(plan_rows, parcela_rows, registro_rows, resultado) -> None:
    nombre_parcela = {p["id"]: p["nombre"] for p in parcela_rows}
    plan_por_id = {p["id"]: p for p in plan_rows}
    registro_por_id = {r["id"]: r for r in registro_rows}

    print(f"Filas del plan: {len(plan_rows)}  ·  registros en la ventana: {len(registro_rows)}")
    print(f"A asignar: {len(resultado.asignaciones)}")

    por_plan: dict[str, list[str]] = defaultdict(list)
    for registro_id, plan_id in resultado.asignaciones.items():
        por_plan[plan_id].append(registro_id)
    if por_plan:
        print("\nPor fila del plan (variedad · ronda · insumo -> registros / parcelas):")
        for plan_id in sorted(
            por_plan,
            key=lambda pid: (plan_por_id[pid]["variedad"], plan_por_id[pid]["numero_aplicacion"],
                             plan_por_id[pid]["insumo_nombre"]),
        ):
            plan = plan_por_id[plan_id]
            parcelas = sorted({nombre_parcela.get(registro_por_id[r]["parcela_id"], "?")
                               for r in por_plan[plan_id]})
            print(f"  {plan['variedad']:<10} · #{plan['numero_aplicacion']:<2} · "
                  f"{plan['insumo_nombre']:<30} -> {len(por_plan[plan_id])} reg / "
                  f"{len(parcelas)} parc: {', '.join(parcelas)}")

    # Same-day candidates merged into one application (see plan_backfill docstring).
    grupos = Counter(
        (registro_por_id[r]["parcela_id"], registro_por_id[r]["insumo_id"], registro_por_id[r]["fecha"])
        for r in resultado.asignaciones
    )
    fusionados = sum(n for n in grupos.values() if n > 1)
    print(f"\nRegistros del mismo día/parcela/insumo tratados como una aplicación: {fusionados}")
    con_valvula = sum(
        1 for r in resultado.asignaciones
        if registro_por_id[r]["valvula_id"] and not registro_por_id[r]["orden_valvula_id"]
    )
    print(f"Asignados con valvula_id sin orden (tratados como parcela entera): {con_valvula}")

    print("\nNo asignados, por motivo:")
    for motivo in MOTIVOS_OMISION:
        print(f"  {motivo:<24} {len(resultado.omitidos[motivo])}")
    for motivo in ("sin_variedad", "sin_plan", "duplicado_de_vinculado", "excede_rondas"):
        ids = resultado.omitidos[motivo]
        if ids:
            detalle = Counter(nombre_parcela.get(registro_por_id[r]["parcela_id"], "?") for r in ids)
            print(f"  detalle {motivo}: " + ", ".join(f"{k} ({v})" for k, v in sorted(detalle.items())))

    # Explicit links win over dates: worth a manual look (plan_backfill docstring).
    print(f"\nParcelas con un candidato anterior a una ronda ya tomada: {len(resultado.fuera_de_orden)}")
    nombre_insumo = {p["insumo_id"]: p["insumo_nombre"] for p in plan_rows}
    for parcela_id, insumo_id in resultado.fuera_de_orden:
        print(f"  {nombre_parcela.get(parcela_id, '?')} · {nombre_insumo.get(insumo_id, insumo_id)}")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--temporada", type=int, required=True, help="año de inicio (mayo) de la campaña")
    parser.add_argument("--apply", action="store_true", help="escribe; sin él es dry-run")
    parser.add_argument("--local", action="store_true",
                        help="ignora .env.prod y exige una base en localhost")
    args = parser.parse_args()
    # Windows consoles/pipes default to cp1252 and garble the accents.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    url, fuente = read_database_url(skip_prod=args.local)
    print(f"DATABASE_URL desde: {fuente}")
    if args.local and urlparse(url).hostname not in LOCAL_HOSTS:
        sys.exit("ERROR: --local pero la base resuelta no está en localhost")

    desde, hasta = date(args.temporada, 5, 1), date(args.temporada + 1, 4, 30)
    print(f"Temporada {args.temporada}: {desde} .. {hasta}")

    conn = await asyncpg.connect(url)
    try:
        plan_rows, parcela_rows, registro_rows = await _load(conn, args.temporada, desde, hasta)
        if not plan_rows:
            sys.exit(f"No hay plan cargado para la temporada {args.temporada}: nada que hacer.")

        parcelas_por_variedad: dict[str, list[str]] = defaultdict(list)
        for p in parcela_rows:
            if p["variedad"] is not None:
                parcelas_por_variedad[p["variedad"]].append(p["id"])
        resultado = analizar_backfill(
            [PlanRow(id=p["id"], temporada=p["temporada"], variedad=p["variedad"],
                     insumo_id=p["insumo_id"], numero_aplicacion=p["numero_aplicacion"])
             for p in plan_rows],
            dict(parcelas_por_variedad),
            [RegistroRow(id=r["id"], fecha=r["fecha"], parcela_id=r["parcela_id"],
                         insumo_id=r["insumo_id"], plan_fitosanitario_id=r["plan_fitosanitario_id"],
                         orden_parcela_id=r["orden_parcela_id"])
             for r in registro_rows],
        )
        _print_summary(plan_rows, parcela_rows, registro_rows, resultado)

        if not args.apply:
            print("\nDRY RUN -- nada escrito. Ejecutá con --apply para vincular.")
            return

        confirmar_apply(urlparse(url).hostname, local=args.local)

        pares = sorted(resultado.asignaciones.items())
        now = datetime.now(timezone.utc)
        actualizados = 0
        # Single transaction: all-or-nothing. Chunked commits could leave a
        # same-day group half linked if the connection dropped in between.
        async with conn.transaction():
            for registro_id, plan_id in pares:
                status = await conn.execute(
                    """UPDATE registros_fitosanitarios
                       SET plan_fitosanitario_id = $1, updated_at = $3
                       WHERE id = $2 AND plan_fitosanitario_id IS NULL
                         AND orden_parcela_id IS NULL""",
                    plan_id, registro_id, now,
                )
                actualizados += int(status.split()[-1])
            if actualizados != len(pares):
                # Someone changed the rows since the load: roll back, re-run.
                raise RuntimeError(
                    f"Actualizados {actualizados} de {len(pares)}: los datos cambiaron "
                    "desde la carga; transacción revertida, volvé a correr el dry-run."
                )
        print(f"Actualizados: {actualizados} de {len(pares)}")

        vinculados = await conn.fetchval(
            """SELECT COUNT(*) FROM registros_fitosanitarios rf
               JOIN planes_fitosanitarios pf ON pf.id = rf.plan_fitosanitario_id
               WHERE rf.fecha BETWEEN $1 AND $2 AND rf.orden_parcela_id IS NULL
                 AND pf.temporada = $3""",
            desde, hasta, args.temporada,
        )
        print(f"Verificación -- registros manuales vinculados al plan {args.temporada}: {vinculados}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
