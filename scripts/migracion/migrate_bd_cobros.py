"""Migración de BD Cobros.xlsx -> tabla `ingresos`.

Carga los cobros históricos (uva de mesa, bodega, pasa, alfalfa, cebolla,
sandía, alquiler) desde la planilla `BD Cobros.xlsx` (tabla principal,
columnas A-M — la tablita separada en columnas N-Q, ~14 filas de JV/BRIX/
CAVAS, se descartó a propósito, no son cobros de este sistema).

Decisiones confirmadas con Fausto (sesión 2026-09-21):
- `fecha` = fecha real de cobro (columna FECHA del Excel), sin forzar la
  campaña de venta del kg. La temporada se deriva sola de esa fecha con la
  convención mayo->abril de todo el sistema (igual que vw_kpi_comprador, que
  ya separa kg entregado por temporada de cosecha vs $ cobrado por temporada
  de cobro como dos ejes distintos).
- `origen` (oficial/no_oficial) no está en el Excel -> se deriva de ESTADO
  (desde 2026-09-25 la columna `estado` ya no existe: era lo mismo que origen)
  (FACT->oficial, NR->no_oficial), mismo criterio que se usó en julio cuando
  origen era el único campo de este tipo.
- `finca` no está en el Excel -> 'media_agua' por defecto en las 300 filas
  (mismo criterio que ingresos/egresos de la migración de julio).
- Moneda: ninguna fila de la tabla principal está marcada en USD (a
  diferencia de la tablita N-Q descartada) -> todo ARS.
- 1 corrección puntual: fila 183 del Excel (PASA/VIZCAINO) tiene FECHA y
  F PAGO en 2026-12-18, encajada entre dos pagos de dic-2025 del mismo
  comprador -- typo de año, corregida a 2025-12-18 (mismo patrón de typo que
  ya apareció en la migración de Cosecha).

Mapeo de columnas Excel -> Ingreso (coincide 1 a 1 con el orden de columnas
de la planilla, la tabla `ingresos` se diseñó explícitamente para esto):
  DESTINO -> destino | COMPRADOR -> comprador | FECHA -> fecha
  EFE/CH/TR -> forma_pago | ESTADO -> estado | FORMA -> cuenta_destino
  BANCO -> banco | N° CHEQUE -> n_cheque | F PAGO -> f_pago
  MONTO -> monto | PAGO CHEQU -> uso_cheque | DETALLE -> descripcion
  (TEMPORADA del Excel se ignora -- año calendario informal, no la campaña
  del sistema)

Uso:
  cd C:\\claude-projects\\los-lirios
  C:\\claude-projects\\.venv\\Scripts\\python.exe scripts\\migracion\\migrate_bd_cobros.py            # DRY RUN
  C:\\claude-projects\\.venv\\Scripts\\python.exe scripts\\migracion\\migrate_bd_cobros.py --commit   # inserta
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import asyncpg
import openpyxl

HERE = Path(__file__).resolve().parent
EXCEL_PATH = Path(r"C:\claude-projects\BD Cobros.xlsx")
ENV_FILE = HERE.parent.parent / "backend" / ".env"
PROD_ENV_FILE = HERE / ".env.prod"  # opcional, gitignored -- ver README
FUENTE = "bd_cobros_import"
CHUNK_SIZE = 150

DESTINO_MAP = {
    "UVA DE MESA": "uva_mesa",
    "BODEGA": "bodega",
    "PASA": "pasa",
    "ALFALFA": "alfalfa",
    "CEBOLLA": "cebolla",
    "SANDIA": "sandia",
    "ALQUILER": "alquiler",
}

FORMA_PAGO_MAP = {
    "TRANSF": "transferencia",
    "CHEQUE": "cheque",
    "ECHEQUE": "echeque",
    "EFECTIVO": "efectivo",
    "UEFECTIVO": "efectivo",  # ARS efectivo (los montos están en escala ARS)
}

ESTADO_MAP = {
    "NR": "no_registrado",
    "FACT": "facturado",
}
ORIGEN_POR_ESTADO = {
    "facturado": "oficial",
    "no_registrado": "no_oficial",
}

# fila Excel (1-indexed, incluye header) -> (fecha corregida, f_pago corregido)
CORRECCIONES_FECHA = {
    183: (date(2025, 12, 18), date(2025, 12, 18)),
}


def _extract_database_url(text: str) -> str | None:
    for line in text.splitlines():
        if line.strip().startswith("DATABASE_URL"):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            return re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    return None


def read_database_url() -> str:
    if PROD_ENV_FILE.exists():
        url = _extract_database_url(PROD_ENV_FILE.read_text(encoding="utf-8"))
        if url:
            return url
    env_url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if env_url:
        return re.sub(r"^postgresql\+\w+://", "postgresql://", env_url)
    url = _extract_database_url(ENV_FILE.read_text(encoding="utf-8"))
    if url:
        return url
    raise RuntimeError(f"DATABASE_URL not found in {ENV_FILE}")


def to_decimal(v) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def to_str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def parse_rows() -> list[dict]:
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb["Hoja1"]
    out = []
    errores = []
    for r in range(2, ws.max_row + 1):
        vals = [ws.cell(row=r, column=c).value for c in range(1, 14)]
        if all(v is None for v in vals):
            continue
        (destino_raw, comprador, fecha, efe_raw, estado_raw, forma_raw, banco,
         ncheque, fpago, monto, pagoch, _temporada, detalle) = vals

        destino = DESTINO_MAP.get(str(destino_raw).strip().upper()) if destino_raw else None
        forma_pago = FORMA_PAGO_MAP.get(str(efe_raw).strip().upper()) if efe_raw else None
        estado = ESTADO_MAP.get(str(estado_raw).strip().upper()) if estado_raw else None

        if not destino or not forma_pago or not estado or not comprador or fecha is None or monto is None:
            errores.append((r, vals))
            continue

        if r in CORRECCIONES_FECHA:
            fecha, fpago = CORRECCIONES_FECHA[r]
        else:
            fecha = fecha.date() if isinstance(fecha, datetime) else fecha
            fpago = fpago.date() if isinstance(fpago, datetime) else fpago

        out.append({
            "excel_row": r,
            "fecha": fecha,
            "destino": destino,
            "comprador": to_str(comprador),
            "forma_pago": forma_pago,
            "estado": estado,
            "origen": ORIGEN_POR_ESTADO[estado],
            "cuenta_destino": to_str(forma_raw),
            "banco": to_str(banco),
            "n_cheque": to_str(ncheque),
            "f_pago": fpago,
            "uso_cheque": to_str(pagoch),
            "monto": to_decimal(monto),
            "descripcion": to_str(detalle),
        })

    if errores:
        print(f"ADVERTENCIA: {len(errores)} filas con datos incompletos, excluidas:")
        for r, vals in errores:
            print(f"  fila {r}: {vals}")

    return out


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()

    fuente_db = ".env.prod (producción)" if PROD_ENV_FILE.exists() else f"{ENV_FILE} (local/staging)"
    print(f"DATABASE_URL desde: {fuente_db}")

    rows = parse_rows()
    total_ars = sum(r["monto"] for r in rows)
    print(f"Filas a migrar: {len(rows)}  ·  total: ARS {total_ars:,.2f}")

    por_destino: dict[str, Decimal] = {}
    for r in rows:
        por_destino[r["destino"]] = por_destino.get(r["destino"], Decimal(0)) + r["monto"]
    print("Por destino:")
    for d, m in sorted(por_destino.items(), key=lambda kv: -kv[1]):
        print(f"  {d}: ARS {m:,.2f}")

    conn = await asyncpg.connect(read_database_url())
    try:
        ya_migradas = await conn.fetchval(
            "SELECT COUNT(*) FROM ingresos WHERE fuente = $1", FUENTE
        )
        print(f"Filas ya cargadas con fuente='{FUENTE}': {ya_migradas}")

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
        saltados = 0
        for i in range(0, len(rows), CHUNK_SIZE):
            chunk = rows[i:i + CHUNK_SIZE]
            async with conn.transaction():
                for r in chunk:
                    # Clave natural amplia: cheques/echeques de un mismo pago se
                    # cargan a veces en varias cuotas (mismo fecha/monto, distinto
                    # f_pago/uso_cheque), y hay transferencias del mismo monto por
                    # cuentas distintas (CAJA vs MP CAMILO) el mismo día -- todas
                    # son filas reales distintas, no duplicados.
                    existe = await conn.fetchval(
                        """SELECT 1 FROM ingresos
                           WHERE fuente = $1 AND fecha = $2 AND comprador = $3
                             AND monto = $4 AND forma_pago = $5::formapago
                             AND n_cheque IS NOT DISTINCT FROM $6
                             AND cuenta_destino IS NOT DISTINCT FROM $7
                             AND f_pago IS NOT DISTINCT FROM $8
                             AND uso_cheque IS NOT DISTINCT FROM $9
                           LIMIT 1""",
                        FUENTE, r["fecha"], r["comprador"], r["monto"],
                        r["forma_pago"], r["n_cheque"], r["cuenta_destino"],
                        r["f_pago"], r["uso_cheque"],
                    )
                    if existe:
                        saltados += 1
                        continue
                    await conn.execute(
                        """INSERT INTO ingresos
                           (id, fecha, destino, comprador, forma_pago,
                            cuenta_destino, banco, n_cheque, f_pago, uso_cheque,
                            monto, moneda, tipo_cambio, origen, finca, descripcion,
                            fuente, created_by, created_at, updated_at)
                           VALUES ($1,$2,$3::destinoingreso,$4,$5::formapago,
                                   $6,$7,$8,$9,$10,$11,'ars',
                                   NULL,$12::origenpago,'media_agua',$13,$14,$15,$16,$16)""",
                        str(uuid.uuid4()), r["fecha"], r["destino"], r["comprador"],
                        r["forma_pago"], r["cuenta_destino"], r["banco"],
                        r["n_cheque"], r["f_pago"], r["uso_cheque"], r["monto"],
                        r["origen"], r["descripcion"], FUENTE, created_by, now,
                    )
                    insertados += 1
            print(f"  ... {min(i + CHUNK_SIZE, len(rows))}/{len(rows)} procesados", flush=True)

        print(f"Insertados {insertados} ingresos ({saltados} ya existían, salteados).")

        check = await conn.fetchrow(
            "SELECT COUNT(*) AS n, COALESCE(SUM(monto),0) AS total FROM ingresos WHERE fuente = $1",
            FUENTE,
        )
        print(f"Verificación -- fuente='{FUENTE}': {check['n']} filas, ARS {check['total']:,.2f}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
