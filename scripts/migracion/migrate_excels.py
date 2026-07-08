"""Load historical Excel data (pre-cleaned CSVs) into the Los Lirios database.

CSVs in this directory were generated from:
  - cosechas.csv      <- PRODUCCION KG, VENTAS.xlsx :: BASE DE DATOS 2 (591 rows)
  - ingresos.csv      <- PRODUCCION KG, VENTAS.xlsx :: BD COBROS (259 rows)
  - egresos.csv       <- FLUJO ANUAL 25-26.xlsx :: SEGUIM 18 7 (monthly aggregates)
  - presupuestos.csv  <- PRESUP 25-26 + TOTAL ANUAL 26-27

Usage (from backend venv, which has asyncpg installed):
  cd C:\\claude-projects\\los-lirios
  python scripts\\migracion\\migrate_excels.py            # DRY RUN (no writes)
  python scripts\\migracion\\migrate_excels.py --commit   # actually insert

Behaviour:
  - Reads DATABASE_URL from backend/.env
  - Matches cosecha parcela names against parcelas.nombre (normalized);
    unmatched rows load with parcela_id NULL and keep the original name
    in observaciones (they count in kg totals but not in kg/ha views)
  - created_by = first super_admin user
  - Refuses to run against non-empty tables unless --force
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import re
import sys
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import asyncpg

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent.parent / "backend" / ".env"


def read_database_url() -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("DATABASE_URL"):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            # asyncpg.connect wants plain postgresql:// (no SQLAlchemy driver tag)
            return re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    raise RuntimeError(f"DATABASE_URL not found in {ENV_FILE}")


def norm(s: str) -> str:
    s = (s or "").strip().upper()
    return s[:-2] if s.endswith(".0") else s


# ── Definitive Excel-name -> app-parcela-name mapping (confirmed by Fausto) ──
# Numbers map to Parral N / Potrero N according to the seeded parcela set.
_PARRAL_NUMS = {"2", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "21"}
_POTRERO_NUMS = {"1", "3", "17", "22", "23", "24", "25", "26", "27", "28", "29"}
ALIAS: dict[str, str] = {
    "SULTANINA": "Parral Sult.",
    "SY RG": "Parral SYR-RG",
    "SY-RG": "Parral SYR-RG",
    "RG-SY": "Parral SYR-RG",
    "BN": "Parral Bond. Nuevo",
    "BV": "Parral Bond. Viejo",
}
# Deliberately unmapped (would corrupt per-parcel kg/ha if force-assigned):
#   FLAME (9 parrales flame distintos), FIESTA (2), BONARDA (2), PASERO /
#   M PASERO (2 paseros), SUPERIOR (finca Caucete, sin parcela), GALPON,
#   '351', celdas con fechas. Quedan parcela_id NULL con el nombre original
#   en observaciones: cuentan en kg totales, no en kg/ha.


# DestinoCosecha is the only enum whose Postgres labels (member names) differ
# from the API values; the DB stores the names, so map CSV values -> names.
DESTINO_DB = {
    "MI": "mercado_interno",
    "BODEGA": "bodega",
    "EXPO": "exportacion",
    "PASAS": "pasas",
    "RAMA_PASA": "rama_pasa",
    "SEMILLA": "semilla",
    "DESC": "desc",
    "FARDO": "fardo",
}


def resolve_parcela_name(excel_name: str) -> str | None:
    n = norm(excel_name)
    if n in ALIAS:
        return ALIAS[n].upper()
    if n in _PARRAL_NUMS:
        return f"PARRAL {n}"
    if n in _POTRERO_NUMS:
        return f"POTRERO {n}"
    return None


def load_csv(name: str) -> list[dict[str, str]]:
    with open(HERE / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def now() -> datetime:
    return datetime.now(timezone.utc)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    parser.add_argument("--force", action="store_true", help="allow loading into non-empty tables")
    args = parser.parse_args()

    conn = await asyncpg.connect(read_database_url())
    try:
        # ── Preconditions ────────────────────────────────────────────────────
        admin = await conn.fetchrow(
            "SELECT id, email FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1"
        )
        if admin is None:
            sys.exit("ERROR: no super_admin user found — run seed first")
        created_by = admin["id"]
        print(f"created_by: {admin['email']}")

        for table in ("registros_cosecha", "ingresos", "egresos", "presupuestos"):
            n = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
            print(f"  {table}: {n} filas existentes")
            if n > 0 and not args.force:
                sys.exit(f"ERROR: {table} no está vacía — corré reset_datos_prueba.sql o usá --force")

        # ── Parcela name -> id map ───────────────────────────────────────────
        parcelas = {norm(r["nombre"]): r["id"] for r in await conn.fetch("SELECT id, nombre FROM parcelas")}
        print(f"parcelas en DB: {len(parcelas)} -> {sorted(parcelas.keys())}")

        cosechas = load_csv("cosechas.csv")
        ingresos = load_csv("ingresos.csv")
        egresos = load_csv("egresos.csv")
        presupuestos = load_csv("presupuestos.csv")

        def parcela_id_for(c: dict[str, str]) -> str | None:
            resolved = resolve_parcela_name(c["parcela_nombre"])
            return parcelas.get(resolved) if resolved else None

        matched = sum(1 for c in cosechas if parcela_id_for(c) is not None)
        unmatched_names = sorted({norm(c["parcela_nombre"]) for c in cosechas
                                  if parcela_id_for(c) is None})
        print(f"\ncosechas: {len(cosechas)} filas · {matched} matchean parcela · "
              f"{len(cosechas) - matched} sin parcela (quedan con parcela_id NULL)")
        print(f"nombres sin matchear: {unmatched_names}")
        print(f"ingresos: {len(ingresos)} · egresos: {len(egresos)} · presupuestos: {len(presupuestos)}")

        if not args.commit:
            print("\nDRY RUN — nada insertado. Ejecutá con --commit para cargar.")
            return

        # ── Insert everything in one transaction ─────────────────────────────
        async with conn.transaction():
            for c in cosechas:
                await conn.execute(
                    """INSERT INTO registros_cosecha
                       (id, temporada, semana, fecha, parcela_id, cultivo, variedad,
                        n_remito, n_ciu, destino, comprador, cuadrilla, acarreo,
                        tipo_envase, cantidad_envases, peso_unitario_kg, bruto_kg,
                        tara_kg, kg_total, observaciones, created_by, created_at, updated_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)""",
                    str(uuid.uuid4()), int(c["temporada"]),
                    int(c["semana"]) if c["semana"] else None,
                    date.fromisoformat(c["fecha"]),
                    parcela_id_for(c),
                    c["cultivo"], c["variedad"] or None,
                    c["n_remito"] or None, c["n_ciu"] or None,
                    DESTINO_DB[c["destino"]], c["comprador"] or None, c["cuadrilla"] or None,
                    c["acarreo"] or None, "caja",
                    float(c["cantidad_envases"]) if c["cantidad_envases"] else None,
                    float(c["peso_unitario_kg"]) if c["peso_unitario_kg"] else None,
                    float(c["bruto_kg"]) if c["bruto_kg"] else None,
                    float(c["tara_kg"]) if c["tara_kg"] else None,
                    float(c["kg_total"]), c["observaciones"],
                    created_by, now(), now(),
                )
            for i in ingresos:
                await conn.execute(
                    """INSERT INTO ingresos
                       (id, fecha, cliente, producto, monto, moneda, origen, finca,
                        forma_pago, descripcion, created_by, created_at, updated_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                    str(uuid.uuid4()), date.fromisoformat(i["fecha"]), i["cliente"],
                    i["producto"], float(i["monto"]), i["moneda"], i["origen"],
                    i["finca"], i["forma_pago"], i["descripcion"],
                    created_by, now(), now(),
                )
            for e in egresos:
                await conn.execute(
                    """INSERT INTO egresos
                       (id, fecha, tipo, clasificacion, descripcion, monto, moneda,
                        origen, finca, forma_pago, fuente, created_by, created_at, updated_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)""",
                    str(uuid.uuid4()), date.fromisoformat(e["fecha"]), e["tipo"],
                    e["clasificacion"], e["descripcion"], float(e["monto"]), e["moneda"],
                    e["origen"], e["finca"], e["forma_pago"], "migracion_excel",
                    created_by, now(), now(),
                )
            for p in presupuestos:
                await conn.execute(
                    """INSERT INTO presupuestos
                       (id, temporada, mes, concepto, tipo, clasificacion, cliente,
                        monto, moneda, notas, created_by, created_at, updated_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                    str(uuid.uuid4()), int(p["temporada"]), int(p["mes"]), p["concepto"],
                    p["tipo"] or None, p["clasificacion"] or None, p["cliente"] or None,
                    float(p["monto"]), p["moneda"], "migracion_excel",
                    created_by, now(), now(),
                )

        # ── Post-load verification ───────────────────────────────────────────
        print("\nCargado. Verificación:")
        kg = await conn.fetchval("SELECT ROUND(SUM(kg_total)) FROM registros_cosecha")
        print(f"  kg_total cosechas: {kg:,.0f} (esperado 4.850.838)")
        ing = await conn.fetchval("SELECT ROUND(SUM(monto)) FROM ingresos WHERE moneda='ars'")
        print(f"  ingresos ARS: {ing:,.0f} (esperado 1.217.115.173)")
        egr = await conn.fetchval("SELECT ROUND(SUM(monto)) FROM egresos")
        print(f"  egresos ARS: {egr:,.0f} (esperado 649.478.319)")
        pre = await conn.fetchval("SELECT COUNT(*) FROM presupuestos")
        print(f"  presupuestos: {pre} líneas (esperado 370)")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
