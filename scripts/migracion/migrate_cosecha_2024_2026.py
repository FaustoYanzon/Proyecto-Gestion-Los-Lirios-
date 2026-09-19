"""Migración de RegistroCosecha desde "Produccion.xlsx" (temporadas 2024/2025
y 2025/2026) -- reemplaza el intento anterior (migrate_excels.py::cosechas.csv,
591 filas) que Fausto borró el 2026-07-17 (ver scripts/borrar_migracion_excel.py)
porque "los números no cuadraban". Esta vez se corrigen los dos problemas que
muy probablemente causaron eso:

  1. Filas TERCEROS (uva comprada a otros productores para industria de pasa)
     se matcheaban por nombre de variedad contra parcelas propias (ej.
     "SULTANINA" -> Parral Sult.), inflando el kg/ha de un parral que nunca
     produjo esa uva. Ahora origen=tercero SIEMPRE queda con parcela_id NULL,
     usando las columnas nuevas `origen` + `proveedor_tercero` (ver migración
     de esquema a106b068b59a) en vez de mezclarlo con producción propia.
  2. La temporada se derivaba de la fecha (convención mayo->abril del
     sistema), lo que partía en dos la "cola" de venta de pasa que sigue
     hasta jul/ago (o incluso dic) después del corte de abril -- 286.960 kg
     terminaban en una temporada "2026" que no es una campaña real. Ahora se
     usa directamente TEMP del Excel - 1, que mantiene unida cada campaña tal
     como la registra la planilla.

Decisiones confirmadas con Fausto (sesión 2026-09-19):
  - temporada = TEMP del Excel - 1.
  - TERCEROS: se cargan con origen=tercero, parcela_id NULL siempre,
    proveedor_tercero = columna FINCA del Excel.
  - 2 filas (remito 70111845, Caucete/Superior) con fecha 23/12/2026 (futuro
    imposible): corregidas a 23/12/2025 (typo de año, ya señalado como
    sospechoso en la migración anterior y nunca corregido).
  - 3 filas con kg real pero sin fecha (2 Alfalfa semilla, 1 pasa Flame):
    se cargan con una fecha aleatoria (semilla fija, reproducible) dentro del
    rango real de fechas de su propia temporada.
  - ANULADO (2 filas, sin datos): excluidas.
  - 8 filas sin fecha Y sin kg (RETIRA BINES / TELA PRESTAMO -- préstamos o
    retiro de envases, no un evento de cosecha) + 1 fila con fecha pero sin
    ningún dato de peso (remito 8955, Parral 14, Aspirant, Bodega): excluidas
    -- no hay forma de inventar un kg_total.
  - 2 filas (remito 815039, Media Agua/BN/Bonarda) con CAJA/BIN cargado
    (550 y 512) pero KG TOTAL=0 y DESTINO vacío -- cosecha contada pero
    todavía sin cerrar (sin destino/comprador asignado). Excluidas -- no hay
    destino que inventar; Fausto las carga a mano cuando se definan.
    Total excluido: 11 de 609 filas activas -> se migran 598.
  - REMITO/CIU en 0 -> NULL (antes se guardaba el string "0" literal).

Uso (con el venv del backend, que tiene asyncpg + openpyxl):
  cd C:\\claude-projects\\los-lirios
  backend\\venv\\Scripts\\python.exe scripts\\migracion\\migrate_cosecha_2024_2026.py            # DRY RUN
  backend\\venv\\Scripts\\python.exe scripts\\migracion\\migrate_cosecha_2024_2026.py --commit   # inserta

Comportamiento:
  - Lee scripts/migracion/.env.prod si existe (producción); si no,
    backend/.env (local/staging). Igual convención que las migraciones
    anteriores -- ver README.md de esta carpeta.
  - Refuses to run if registros_cosecha no está vacía, salvo --force.
  - Inserta en tandas de 150 filas, cada una en su propia transacción (lección
    de migrate_jornales_historicos.py: una transacción gigante contra la
    conexión pública de Railway se corta a mitad de camino).
  - idempotency_key estable por fila de Excel -- un reintento salta lo ya
    cargado en vez de duplicar.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import asyncpg
import openpyxl

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # C:\claude-projects\los-lirios
ENV_FILE = ROOT / "backend" / ".env"
PROD_ENV_FILE = HERE / ".env.prod"
EXCEL_FILE = ROOT.parent / "Produccion.xlsx"  # C:\claude-projects\Produccion.xlsx

NAMESPACE = uuid.UUID("a1f3c9d2-7e4b-4a6a-9c1a-2f6b8e0d5c7a")

EXCEL_EPOCH = datetime(1899, 12, 30)


def excel_date(n: float) -> date:
    return (EXCEL_EPOCH + timedelta(days=n)).date()


def _extract_database_url(text: str) -> str | None:
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("DATABASE_URL") or s.startswith("DATABASE_PUBLIC_URL"):
            if "=" in s:
                url = s.split("=", 1)[1].strip().strip('"').strip("'")
                return re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    return None


def read_database_url() -> tuple[str, str]:
    if PROD_ENV_FILE.exists():
        url = _extract_database_url(PROD_ENV_FILE.read_text(encoding="utf-8"))
        if url:
            return url, ".env.prod (producción)"
    url = _extract_database_url(ENV_FILE.read_text(encoding="utf-8"))
    if url:
        return url, f"{ENV_FILE} (local/staging)"
    raise RuntimeError(f"DATABASE_URL not found in {ENV_FILE} ni en {PROD_ENV_FILE}")


# ── Parcela name -> app-parcela-name mapping (idéntica a migrate_excels.py,
# confirmada por Fausto 2026-07-07 -- el catálogo de 37 parcelas no cambió) ──
_PARRAL_NUMS = {"2", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "21"}
_POTRERO_NUMS = {"1", "3", "17", "22", "23", "24", "25", "26", "27", "28", "29"}
ALIAS: dict[str, str] = {
    "SULTANINA": "PARRAL SULT.",
    "SY RG": "PARRAL SYR-RG",
    "SY-RG": "PARRAL SYR-RG",
    "RG-SY": "PARRAL SYR-RG",
    "BN": "PARRAL BOND. NUEVO",
    "BV": "PARRAL BOND. VIEJO",
}


def norm(s) -> str:
    s = ("" if s is None else str(s)).strip().upper()
    return s[:-2] if s.endswith(".0") else s


def resolve_parcela_name(excel_value) -> str | None:
    n = norm(excel_value)
    if n in ALIAS:
        return ALIAS[n]
    if n in _PARRAL_NUMS:
        return f"PARRAL {n}"
    if n in _POTRERO_NUMS:
        return f"POTRERO {n}"
    return None


def txt(v) -> str | None:
    """None/0/'' -> None; todo lo demás -> str recortado."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and v == 0:
        return None
    s = str(v).strip()
    return s or None


def num(v) -> float | None:
    if v is None or v == "":
        return None
    return float(v)


CULTIVO_MAP = {
    "ALFALFA": "alfalfa",
    "CHACRA": "chacra",
    "IND PASA": "ind_pasa",
    "VID": "vid",
}

DESTINO_MAP = {
    "MI": "mercado_interno",
    "BODEGA": "bodega",
    "EXPO": "exportacion",
    "PASAS": "pasas",
    "RAMA_PASA": "rama_pasa",
    "SEMILLA": "semilla",
    "DESC": "desc",
    "FARDO": "fardo",
}

# Remito de las 2 filas con fecha 23/12/2026 (imposible, hoy es 2026-09-19) --
# corregidas a 23/12/2025, un año antes, que encaja en el rango real
# dic-2025/ago-2026 de esa misma temporada (TEMP=2026). Confirmado con Fausto.
REMITO_FECHA_TYPO = 70111845
FECHA_TYPO_CORREGIDA = date(2025, 12, 23)

RANDOM_SEED = 20260919  # reproducible: misma fecha para las 3 filas sin fecha en cualquier corrida


class Fila:
    __slots__ = (
        "r", "temporada", "semana", "fecha", "fecha_asignada_al_azar",
        "fecha_corregida_typo", "origen", "propio", "proveedor_tercero",
        "parcela_excel_value", "cultivo", "variedad", "n_remito", "n_ciu",
        "destino", "comprador", "cuadrilla", "acarreo", "cantidad_envases",
        "peso_unitario_kg", "bruto_kg", "tara_kg", "kg_total", "finca_raw",
        "actividad_raw",
    )


def parse_excel() -> list[Fila]:
    wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
    ws = wb["Hoja1"]
    headers = [ws.cell(row=1, column=c).value for c in range(1, 22)]

    # Rango real de fechas por TEMP (excluyendo la fila typo), para asignar
    # una fecha aleatoria a las filas que no tienen ninguna.
    rango_por_temp: dict[int, tuple[date, date]] = {}
    raw_rows = []
    for r in range(2, ws.max_row + 1):
        row = {h: ws.cell(row=r, column=c).value for c, h in enumerate(headers, start=1)}
        row["_r"] = r
        raw_rows.append(row)

    for temp in {row["TEMP"] for row in raw_rows if row["TEMP"] is not None}:
        fechas = [
            excel_date(row["FECHA"]) for row in raw_rows
            if row["TEMP"] == temp and isinstance(row["FECHA"], (int, float))
            and row["REMITO"] != REMITO_FECHA_TYPO
        ]
        if fechas:
            rango_por_temp[temp] = (min(fechas), max(fechas))

    rng = random.Random(RANDOM_SEED)
    filas: list[Fila] = []
    excluidas_sin_datos = 0

    for row in raw_rows:
        if row["ORIGEN"] == "ANULADO":
            continue

        fecha_raw = row["FECHA"]
        kg = row["KG TOTAL"]

        if fecha_raw is None and kg is None:
            excluidas_sin_datos += 1
            continue
        if kg is None:
            excluidas_sin_datos += 1
            continue
        if row["DESTINO"] is None:
            # Cosecha contada (CAJA/BIN) pero sin cerrar: sin destino/comprador
            # asignado todavía. No hay destino que inventar -- se excluye.
            excluidas_sin_datos += 1
            continue

        fecha_asignada = False
        fecha_corregida = False
        if fecha_raw is None:
            desde, hasta = rango_por_temp[row["TEMP"]]
            dias = (hasta - desde).days
            fecha = desde + timedelta(days=rng.randint(0, dias))
            fecha_asignada = True
        else:
            fecha = excel_date(fecha_raw)
            if row["REMITO"] == REMITO_FECHA_TYPO:
                fecha = FECHA_TYPO_CORREGIDA
                fecha_corregida = True

        f = Fila()
        f.r = row["_r"]
        f.temporada = int(row["TEMP"]) - 1
        f.semana = int(row["SEMANA"]) if row["SEMANA"] not in (None, "") else None
        f.fecha = fecha
        f.fecha_asignada_al_azar = fecha_asignada
        f.fecha_corregida_typo = fecha_corregida
        f.propio = row["ORIGEN"] == "LOS LIRIOS"
        f.origen = "propio" if f.propio else "tercero"
        f.proveedor_tercero = None if f.propio else txt(row["FINCA"])
        f.parcela_excel_value = row["PARRAL/POTRERO"]
        f.cultivo = CULTIVO_MAP.get(re.sub(r"\s+", " ", norm(row["CULTIVO"])), None)
        f.variedad = txt(row["VARIEDAD"])
        f.n_remito = txt(row["REMITO"])
        f.n_ciu = txt(row["CIU"])
        destino_key = norm(row["DESTINO"]).replace(" ", "_")
        f.destino = DESTINO_MAP.get(destino_key)
        f.comprador = txt(row["COMPRADOR"])
        f.cuadrilla = txt(row["CUADRILLA"])
        f.acarreo = txt(row["ACARREO"])
        f.cantidad_envases = num(row["CAJA/BIN"])
        f.peso_unitario_kg = num(row["PESO UN"])
        f.bruto_kg = num(row["BRUTO"])
        f.tara_kg = num(row["TARA"])
        f.kg_total = float(kg)
        f.finca_raw = txt(row["FINCA"])
        f.actividad_raw = txt(row["ACTIVIDAD"])
        filas.append(f)

    print(f"Filas activas en Excel (sin ANULADO): {len(raw_rows) - sum(1 for r in raw_rows if r['ORIGEN']=='ANULADO')}")
    print(f"Excluidas por falta de fecha+kg o de kg solamente: {excluidas_sin_datos}")
    print(f"A migrar: {len(filas)}")
    return filas


def observaciones_de(f: Fila) -> str:
    partes = [f"Migración Excel fila {f.r}"]
    if f.propio:
        resolved = resolve_parcela_name(f.parcela_excel_value)
        if resolved is None:
            partes.append(f"PARCELA_ORIG={f.parcela_excel_value!r}")
    partes.append(f"FINCA_EXCEL={f.finca_raw}")
    if f.actividad_raw and f.actividad_raw != "CULTIVO":
        partes.append(f"ACTIVIDAD={f.actividad_raw}")
    if f.fecha_asignada_al_azar:
        partes.append("fecha no informada en el Excel -- asignada al azar dentro del rango de la temporada")
    if f.fecha_corregida_typo:
        partes.append("fecha corregida (Excel decía 23/12/2026, imposible -- probable typo de año)")
    return " · ".join(partes)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    parser.add_argument("--force", action="store_true", help="allow loading into non-empty registros_cosecha")
    args = parser.parse_args()

    if not EXCEL_FILE.exists():
        sys.exit(f"ERROR: no se encontró {EXCEL_FILE}")

    filas = parse_excel()

    sin_cultivo = [f for f in filas if f.cultivo is None]
    sin_destino = [f for f in filas if f.destino is None]
    if sin_cultivo or sin_destino:
        print(f"\nAVISO: {len(sin_cultivo)} filas sin cultivo mapeado, {len(sin_destino)} sin destino mapeado")
        for f in (sin_cultivo + sin_destino)[:10]:
            print(f"  fila {f.r}")
        sys.exit("ERROR: hay filas sin cultivo/destino mapeado -- revisar antes de continuar")

    url, fuente = read_database_url()
    print(f"\nDATABASE_URL desde: {fuente}")

    conn = await asyncpg.connect(url)
    try:
        n_existentes = await conn.fetchval("SELECT COUNT(*) FROM registros_cosecha")
        print(f"registros_cosecha actuales: {n_existentes}")
        if n_existentes > 0 and not args.force:
            sys.exit("ERROR: registros_cosecha no está vacía -- usá --force si es intencional")

        admin = await conn.fetchrow(
            "SELECT id, email FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1"
        )
        if admin is None:
            sys.exit("ERROR: no super_admin user found")
        created_by = admin["id"]
        print(f"created_by: {admin['email']}")

        parcelas_db = {norm(r["nombre"]): r["id"] for r in await conn.fetch("SELECT id, nombre FROM parcelas")}

        # ── Cobertura de matching de parcela (solo origen=propio) ──────────
        propias = [f for f in filas if f.propio]
        terceros = [f for f in filas if not f.propio]

        def parcela_id_de(f: Fila) -> str | None:
            if not f.propio:
                return None
            resolved = resolve_parcela_name(f.parcela_excel_value)
            return parcelas_db.get(resolved) if resolved else None

        matched = sum(1 for f in propias if parcela_id_de(f) is not None)
        sin_match = sorted({norm(f.parcela_excel_value) for f in propias if parcela_id_de(f) is None})

        print(f"\nOrigen propio: {len(propias)} filas · {matched} matchean parcela · {len(propias)-matched} sin parcela (quedan NULL)")
        print(f"  valores sin matchear: {sin_match}")
        print(f"Origen tercero: {len(terceros)} filas · siempre parcela_id NULL")

        kg_propio = sum(f.kg_total for f in propias)
        kg_tercero = sum(f.kg_total for f in terceros)
        por_temporada: dict[int, float] = {}
        for f in filas:
            por_temporada[f.temporada] = por_temporada.get(f.temporada, 0.0) + f.kg_total

        print(f"\nkg propio: {kg_propio:,.1f}")
        print(f"kg tercero: {kg_tercero:,.1f}")
        print(f"kg total: {kg_propio + kg_tercero:,.1f}")
        print(f"kg por temporada: { {k: round(v,1) for k,v in sorted(por_temporada.items())} }")

        fecha_al_azar = [f for f in filas if f.fecha_asignada_al_azar]
        print(f"\nFilas con fecha asignada al azar ({len(fecha_al_azar)}):")
        for f in fecha_al_azar:
            print(f"  fila {f.r}: temporada {f.temporada} -> fecha asignada {f.fecha}")

        typo = [f for f in filas if f.fecha_corregida_typo]
        print(f"\nFilas con fecha corregida por typo de año ({len(typo)}):")
        for f in typo:
            print(f"  fila {f.r}: fecha corregida a {f.fecha}")

        if not args.commit:
            print("\nDRY RUN -- nada insertado. Ejecutá con --commit para cargar.")
            return

        existentes_keys = {
            r["idempotency_key"]
            for r in await conn.fetch(
                "SELECT idempotency_key FROM registros_cosecha WHERE idempotency_key IS NOT NULL"
            )
        }

        now = datetime.now(timezone.utc)
        CHUNK_SIZE = 150
        pendientes = []
        for f in filas:
            key = str(uuid.uuid5(NAMESPACE, f"cosecha_excel_2024_2026:{f.r}"))
            if key not in existentes_keys:
                pendientes.append((f, key))

        saltadas = len(filas) - len(pendientes)
        print(f"\nInsertando {len(pendientes)} filas ({saltadas} ya cargadas, saltadas por idempotency_key)...")

        insertadas = 0
        for i in range(0, len(pendientes), CHUNK_SIZE):
            chunk = pendientes[i:i + CHUNK_SIZE]
            async with conn.transaction():
                for f, key in chunk:
                    await conn.execute(
                        """INSERT INTO registros_cosecha
                           (id, temporada, semana, fecha, parcela_id, cultivo, variedad,
                            origen, proveedor_tercero, n_remito, n_ciu, destino, comprador,
                            cuadrilla, acarreo, tipo_envase, cantidad_envases, peso_unitario_kg,
                            bruto_kg, tara_kg, kg_total, observaciones, idempotency_key,
                            created_by, created_at, updated_at)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'caja',
                                   $16,$17,$18,$19,$20,$21,$22,$23,$24,$24)""",
                        str(uuid.uuid4()), f.temporada, f.semana, f.fecha, parcela_id_de(f),
                        f.cultivo, f.variedad, f.origen, f.proveedor_tercero, f.n_remito, f.n_ciu,
                        f.destino, f.comprador, f.cuadrilla, f.acarreo,
                        f.cantidad_envases, f.peso_unitario_kg, f.bruto_kg, f.tara_kg, f.kg_total,
                        observaciones_de(f), key, created_by, now,
                    )
                    insertadas += 1
            print(f"  tanda {i//CHUNK_SIZE + 1}: {insertadas}/{len(pendientes)} insertadas")

        print("\nCargado. Verificación:")
        n = await conn.fetchval("SELECT COUNT(*) FROM registros_cosecha")
        kg = await conn.fetchval("SELECT ROUND(SUM(kg_total)) FROM registros_cosecha")
        print(f"  registros_cosecha: {n} filas, {kg:,.0f} kg (esperado {len(filas)} filas, {kg_propio+kg_tercero:,.0f} kg)")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
