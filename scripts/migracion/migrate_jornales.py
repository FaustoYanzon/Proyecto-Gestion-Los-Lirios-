"""Migración de jornales históricos (mano de obra) desde "JORNALES 2026.xlsx".

Cubre las 15 semanas del 01/04 al 09/07/2026. Las semanas del 16/07 en
adelante NO se tocan -- ya están cargadas en el sistema (verificado contra
producción el 2026-09-13: fechas 2026-07-16 a 2026-09-09 ya existen).

Uso (con el venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  C:\\claude-projects\\los-lirios\\backend\\venv\\Scripts\\python.exe scripts\\migracion\\migrate_jornales.py            # DRY RUN
  C:\\claude-projects\\los-lirios\\backend\\venv\\Scripts\\python.exe scripts\\migracion\\migrate_jornales.py --commit   # inserta

Decisiones confirmadas con Fausto (sesión 2026-09-13):
  - NOMBRE_MAP: 54 variantes de escritura -> 32 personas del catálogo real +
    12 personas nuevas (NUEVOS_TRABAJADORES), creadas antes de migrar.
  - TAREA_RULES: sección del Excel -> tarea real de la app + parcela(s).
    El número de parral viene del propio nombre de la sección ("PODA P6" =
    Parral 6). "Cosecha uva para vinificar" se reparte 50/50 entre Parral
    Bond. Nuevo y Parral Bond. Viejo. Las tareas de pasero (llenado de
    bolsones, mover pasa, levantar telas) se reparten en tercios entre los
    3 paseros.
  - Unidad: precio_unitario < $2000 = pieza (plantas, o cajas para Cosecha),
    >= $2000 = día. Mismo criterio que ya usa Fausto en el sistema (poda a
    $ chico = por planta, a $ grande = por día).
  - monto_total = subtotal + redondeo de esa línea puntual (no cantidad *
    precio a secas) -- preserva los ajustes de redondeo que hacía Fausto al
    pagar. Por eso el script inserta con SQL directo en vez de pasar por la
    API (el endpoint no permite pisar el monto calculado).
  - Abril 2026 (4 semanas, ~$13,5M) NO genera Egreso vinculado: ya existe un
    egreso agregado mensual para abril 2026 (~$24,4M "sueldos_personal /
    obreros") de la migración anterior de Excels
    (scripts/migracion/egresos.csv). Crear egresos acá lo duplicaría.
  - Mayo-Julio 2026 (11 semanas) SÍ generan Egreso vinculado
    (fuente='trabajo_diario', referencia_id=registro.id, igual que crea la
    API normalmente) -- no hay agregado previo para esos meses, y así queda
    editable/borrable desde la UI como cualquier RegistroTrabajo cargado a
    mano.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import asyncpg
import openpyxl

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent.parent / "backend" / ".env"
EXCEL_PATH = Path(r"C:\claude-projects\JORNALES 2026.xlsx")
NAMESPACE = uuid.UUID("d9a1a7d0-1a2b-4c3d-8e5f-6a7b8c9d0e1f")  # fijo, para keys deterministicas

SHEETS_ABRIL = ["142026", "1042026", "1742026", "2442026"]
SHEETS_MAYO_JULIO = [
    "152026", "852026", "1152026 VAC", "2252026", "2952026",
    "562026", "1262026", "1862026", "2462026", "272026", "972026",
]
SHEETS_OBJETIVO = SHEETS_ABRIL + SHEETS_MAYO_JULIO
EXCLUDE_TOKENS = {"SEMANA", "INGRESO", "SALDO"}


# ── Nombres: 54 variantes del Excel -> nombre real del catálogo ─────────────
NOMBRE_MAP: dict[str, str] = {
    "ANGELA": "Angela", "ANTONIO": "Antonio Peña", "BETO": "Beto", "CARLOS": "Carlos",
    "CELESTE": "Celeste", "DAVID": "David", "DIEGO": "Diego", "DIEGO CARRIZO": "Diego",
    "DIEGO FLORES": "Diego Flores", "ELIAS": "Elias", "EMANUEL": "Emanuel",
    "FRANCO": "Franco Videla", "FRANCO V": "Franco Videla", "GABRIELA": "Gabriela",
    "GOLLO": "Gollo", "HEBER": "Heber", "JAVIER": "Javier",
    "JESUS ORTIZ": "Jesús Ortiz", "JESUS VIDELA": "Jesús Videla", "JESUS V": "Jesús Videla",
    "JUAN": "Juan Silva", "JUAN SILVA": "Juan Silva", "LAUTARO": "Lautaro",
    "LEONEL FLORES": "Leonel Flores", "LUCAS": "Lucas Mercado", "MANUEL": "Manuel",
    "MARCO": "Marcos", "MARCOS": "Marcos", "MATIAS": "Matías", "MATIAS M": "Matías",
    "MAURICIO": "Mauricio", "MIGUEL": "Miguel Silva", "MIGUEL SILVA": "Miguel Silva",
    "MILO": "Milo", "ORLANDO": "Orlando Molina", "ORLANDO M": "Orlando Molina",
    "ORLANDO MOLINA": "Orlando Molina", "ORLANDO CARRIZO": "Orlando Carrizo",
    "ORLANDO C": "Orlando Carrizo", "OSCAR": "Oscar Carrizo", "OSCAR CARRIZO": "Oscar Carrizo",
    "OSCAR C": "Oscar Carrizo", "OSCAR FLORES": "Oscar Flores", "PANCHO": "Pancho",
    "PEÑA": "Antonio Peña", "RAMON": "Ramón Silva", "RAMON SILVA": "Ramón Silva",
    "ROCIO": "Rocío", "ROMINA": "Romina", "RUBEN": "Rubén", "SANTANA": "Santana",
    "SEBASTIAN": "Sebastián", "SERGIO": "Sergio", "VICENTE": "Vicente",
}

NUEVOS_TRABAJADORES = [
    "Beto", "Carlos", "David", "Diego Flores", "Emanuel", "Gabriela",
    "Leonel Flores", "Manuel", "Oscar Flores", "Rocío", "Romina", "Vicente",
]


# ── Tareas: sección del Excel -> (tarea app, clasificación, [(parcela, fracción)]) ──
def _p(nombre: str, frac: float = 1.0) -> list[tuple[str | None, float]]:
    return [(nombre, frac)]


_SIN_PARCELA: list[tuple[str | None, float]] = [(None, 1.0)]
_PASEROS = [("Pasero 1", 1 / 3), ("Pasero 2", 1 / 3), ("Pasero 3", 1 / 3)]
_BOND = [("Parral Bond. Nuevo", 0.5), ("Parral Bond. Viejo", 0.5)]

TAREA_RULES: dict[str, tuple[str, str, list[tuple[str | None, float]]]] = {
    "TRABAJO GENERAL": ("Jornal Comun", "general", _SIN_PARCELA),
    **{f"PODA P{n}": ("Poda", "invierno", _p(f"Parral {n}"))
       for n in (2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 16, 21)},
    "PODA BN": ("Poda", "invierno", _p("Parral Bond. Nuevo")),
    "PODA PBN": ("Poda", "invierno", _p("Parral Bond. Nuevo")),
    "PODA BV": ("Poda", "invierno", _p("Parral Bond. Viejo")),
    "PODA PBV": ("Poda", "invierno", _p("Parral Bond. Viejo")),
    **{f"ATADA P{n}": ("Atada", "invierno", _p(f"Parral {n}"))
       for n in (6, 9, 10, 11, 13, 15, 21)},
    "ATADA P": ("Atada", "invierno", _SIN_PARCELA),
    "ARREGLO P6": ("Arreglo Parral", "general", _p("Parral 6")),
    "ARREGLO P10": ("Arreglo Parral", "general", _p("Parral 10")),
    "ARREGLO PARRAL 7": ("Arreglo Parral", "general", _p("Parral 7")),
    "SACAR PLANTAS 6": ("Sacar Plantas", "general", _p("Parral 6")),
    "COSECHA P2": ("Cosecha", "verano", _p("Parral 2")),
    "COSECHA RED GLOBE": ("Cosecha", "verano", _p("Parral 6")),
    "COSECHA UVA PARA VINIFICAR": ("Cosecha", "verano", _BOND),
    "COSCEHA UVA PARA VINIFICAR": ("Cosecha", "verano", _BOND),
    "TRACTOR COSECHA Y CONTROL": ("Tractor Cosecha", "verano", _SIN_PARCELA),
    "LLENADA DE BOLSONES Y VINES": ("Pasero", "verano", _PASEROS),
    "MOVER PASA": ("Pasero", "verano", _PASEROS),
    "MOVER PASA Y LLENAR BOLSONES": ("Pasero", "verano", _PASEROS),
    "LEVANTAR TELAS": ("Pasero", "verano", _PASEROS),
    "LIMPIEZA RAMO": ("Limpieza Ramo", "general", _SIN_PARCELA),
}

PIEZA_UNIDAD_POR_TAREA = {
    "Poda": "plantas", "Atada": "plantas", "Arreglo Parral": "plantas",
    "Sacar Plantas": "plantas", "Cosecha": "cajas",
}
UMBRAL_PIEZA = Decimal("2000")


def det_unidad(tarea: str, precio: Decimal) -> str:
    if precio < UMBRAL_PIEZA:
        return PIEZA_UNIDAD_POR_TAREA.get(tarea, "plantas")
    return "dias"


def read_database_url() -> str:
    # Preferí las variables de entorno que inyecta `railway run --service
    # Postgres` -- DATABASE_PUBLIC_URL (host proxy, alcanzable desde afuera)
    # antes que DATABASE_URL (host interno, solo resoluble dentro de Railway)
    # -- por sobre el .env local (que siempre apunta a localhost).
    import os
    env_url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if env_url:
        return re.sub(r"^postgresql\+\w+://", "postgresql://", env_url)
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("DATABASE_URL"):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            return re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    raise RuntimeError(f"DATABASE_URL not found in {ENV_FILE}")


def to_dec(v) -> Decimal:
    return Decimal(str(v))


def round2(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class RawLine:
    __slots__ = ("sheet", "row_idx", "tarea_raw", "nombre_raw", "cantidad", "precio", "subtotal", "redondeo")

    def __init__(self, sheet, row_idx, tarea_raw, nombre_raw, cantidad, precio, subtotal, redondeo):
        self.sheet = sheet
        self.row_idx = row_idx
        self.tarea_raw = tarea_raw
        self.nombre_raw = nombre_raw
        self.cantidad = cantidad
        self.precio = precio
        self.subtotal = subtotal
        self.redondeo = redondeo


def parse_workbook() -> tuple[dict[str, date], dict[str, list[RawLine]], dict[str, Decimal]]:
    """Devuelve (fecha_por_hoja, líneas_por_hoja, total_declarado_por_hoja)."""
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    fechas: dict[str, date] = {}
    lineas: dict[str, list[RawLine]] = {}
    totales_declarados: dict[str, Decimal] = {}

    for sheet in SHEETS_OBJETIVO:
        ws = wb[sheet]
        current_task: str | None = None
        last_name: str | None = None
        in_section_b = False
        rows_out: list[RawLine] = []
        semana_date: date | None = None
        declarado: Decimal | None = None

        for row_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
            a, b, c, d, e, f, g = row[0], row[1], row[2], row[3], row[4], row[5], row[6]

            if a == "SEMANA":
                if semana_date is None and isinstance(b, datetime):
                    semana_date = b.date()
                elif current_task is not None:
                    in_section_b = True
                continue
            if in_section_b:
                continue

            if isinstance(a, str) and a.strip().upper() not in EXCLUDE_TOKENS:
                current_task = a.strip().upper()
                continue
            if current_task is None:
                continue

            # Fila de cierre de sección/semana: "TOTAL DE DINERO" en la col G,
            # con el gran total de la semana en la col I.
            # Tolerante a un typo real en la hoja "152026" ("TOTAL DED DINERO").
            if isinstance(g, str) and "TOTAL" in g.upper() and "DINERO" in g.upper():
                if isinstance(row[8], (int, float)):
                    declarado = to_dec(row[8])
                in_section_b = True
                continue

            if isinstance(b, str) and b.strip():
                last_name = b.strip().upper()

            if isinstance(c, (int, float)) and isinstance(d, (int, float)):
                subtotal = to_dec(e) if isinstance(e, (int, float)) else to_dec(c) * to_dec(d)
                redondeo = to_dec(f) if isinstance(f, (int, float)) else Decimal("0")
                rows_out.append(RawLine(
                    sheet=sheet, row_idx=row_idx, tarea_raw=current_task,
                    nombre_raw=last_name, cantidad=to_dec(c), precio=to_dec(d),
                    subtotal=subtotal, redondeo=redondeo,
                ))

        if semana_date is None:
            raise RuntimeError(f"Hoja {sheet!r}: no encontré fecha de SEMANA")
        fechas[sheet] = semana_date
        lineas[sheet] = rows_out
        totales_declarados[sheet] = declarado if declarado is not None else Decimal("0")

    return fechas, lineas, totales_declarados


class Registro:
    __slots__ = (
        "sheet", "row_idx", "split_idx", "fecha", "parcela_nombre", "trabajador_nombre",
        "tarea", "clasificacion", "cantidad", "unidad_medida", "precio_unitario",
        "monto_total", "detalle", "crea_egreso",
    )


def build_registros(fechas, lineas) -> tuple[list[Registro], list[str]]:
    registros: list[Registro] = []
    problemas: list[str] = []

    for sheet, raw_rows in lineas.items():
        fecha = fechas[sheet]
        crea_egreso = sheet not in SHEETS_ABRIL
        for raw in raw_rows:
            if raw.nombre_raw not in NOMBRE_MAP:
                problemas.append(f"{sheet} fila {raw.row_idx}: trabajador sin mapear {raw.nombre_raw!r}")
                continue
            if raw.tarea_raw not in TAREA_RULES:
                problemas.append(f"{sheet} fila {raw.row_idx}: tarea sin mapear {raw.tarea_raw!r}")
                continue

            nombre = NOMBRE_MAP[raw.nombre_raw]
            tarea, clasificacion, parcelas = TAREA_RULES[raw.tarea_raw]
            unidad = det_unidad(tarea, raw.precio)
            monto_linea = raw.subtotal + raw.redondeo

            for split_idx, (parcela_nombre, frac) in enumerate(parcelas):
                r = Registro()
                r.sheet, r.row_idx, r.split_idx = sheet, raw.row_idx, split_idx
                r.fecha = fecha
                r.parcela_nombre = parcela_nombre
                r.trabajador_nombre = nombre
                r.tarea = tarea
                r.clasificacion = clasificacion
                r.cantidad = round2(raw.cantidad * to_dec(frac))
                r.unidad_medida = unidad
                r.precio_unitario = raw.precio
                r.monto_total = round2(monto_linea * to_dec(frac))
                r.detalle = f"Migración JORNALES 2026.xlsx · hoja {sheet} · fila {raw.row_idx}"
                if len(parcelas) > 1:
                    r.detalle += f" · reparto {split_idx + 1}/{len(parcelas)}"
                r.crea_egreso = crea_egreso
                registros.append(r)

    return registros, problemas


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    args = parser.parse_args()

    fechas, lineas, declarados = parse_workbook()
    registros, problemas = build_registros(fechas, lineas)

    if problemas:
        print("PROBLEMAS DE MAPEO (no se migran esas filas hasta corregir):")
        for p in problemas:
            print(f"  - {p}")
        print()

    # ── Resumen por semana, con chequeo contra el total declarado en el Excel ──
    print("── Resumen por semana ──")
    por_semana: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for r in registros:
        por_semana[r.sheet] += r.monto_total
    total_general = Decimal("0")
    for sheet in SHEETS_OBJETIVO:
        calculado = por_semana[sheet]
        declarado = declarados[sheet]
        diff = calculado - declarado
        flag = "  ⚠ DIFIERE" if abs(diff) > 1 else ""
        print(f"  {sheet:14s} {fechas[sheet]}  calculado={calculado:>12,.0f}  declarado={declarado:>12,.0f}{flag}")
        total_general += calculado
    print(f"\nTOTAL GENERAL A MIGRAR: {total_general:,.0f} ARS  ({len(registros)} filas)")

    print("\n── Resumen por tarea ──")
    por_tarea: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    n_por_tarea: dict[str, int] = defaultdict(int)
    for r in registros:
        por_tarea[r.tarea] += r.monto_total
        n_por_tarea[r.tarea] += 1
    for tarea, monto in sorted(por_tarea.items(), key=lambda x: -x[1]):
        print(f"  {tarea:20s} {monto:>12,.0f}  ({n_por_tarea[tarea]} filas)")

    abril_rows = [r for r in registros if r.sheet in SHEETS_ABRIL]
    mayo_julio_rows = [r for r in registros if r.sheet in SHEETS_MAYO_JULIO]
    print(f"\nAbril (SIN egreso vinculado -- ya migrado en agregado mensual): "
          f"{sum((r.monto_total for r in abril_rows), Decimal('0')):,.0f} ARS, {len(abril_rows)} filas")
    print(f"Mayo-Julio (CON egreso vinculado, fuente=trabajo_diario): "
          f"{sum((r.monto_total for r in mayo_julio_rows), Decimal('0')):,.0f} ARS, {len(mayo_julio_rows)} filas")

    conn = await asyncpg.connect(read_database_url())
    try:
        parcelas_db = {r["nombre"]: r["id"] for r in await conn.fetch("SELECT id, nombre FROM parcelas")}
        trabajadores_db = {
            r["nombre_completo"]: r["id"]
            for r in await conn.fetch("SELECT id, nombre_completo FROM trabajadores WHERE is_active = true")
        }
        admin = await conn.fetchrow(
            "SELECT id, username FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1"
        )
        if admin is None:
            sys.exit("ERROR: no super_admin user found")
        created_by = admin["id"]
        print(f"\ncreated_by: {admin['username']}")

        faltan_parcelas = {r.parcela_nombre for r in registros if r.parcela_nombre and r.parcela_nombre not in parcelas_db}
        if faltan_parcelas:
            msg = f"parcelas no encontradas en la base: {sorted(faltan_parcelas)}"
            if args.commit:
                sys.exit(f"ERROR: {msg}")
            print(f"AVISO (dry run, esta base puede no tener el catálogo completo): {msg}")

        faltan_trabajadores = sorted({r.trabajador_nombre for r in registros} - set(trabajadores_db) - set(NUEVOS_TRABAJADORES))
        if faltan_trabajadores:
            msg = f"trabajadores no encontrados y no están en NUEVOS_TRABAJADORES: {faltan_trabajadores}"
            if args.commit:
                sys.exit(f"ERROR: {msg}")
            print(f"AVISO (dry run, esta base puede no tener el catálogo completo): {msg}")

        nuevos_a_crear = [n for n in NUEVOS_TRABAJADORES if n not in trabajadores_db]
        print(f"Trabajadores nuevos a crear: {nuevos_a_crear or '(ninguno, ya existen)'}")

        existentes = await conn.fetch(
            "SELECT idempotency_key FROM registros_trabajo WHERE idempotency_key IS NOT NULL"
        )
        existentes_keys = {r["idempotency_key"] for r in existentes}

        if not args.commit:
            print("\nDRY RUN — nada insertado. Ejecutá con --commit para cargar.")
            return

        now = datetime.now(timezone.utc)
        async with conn.transaction():
            for nombre in nuevos_a_crear:
                tid = str(uuid.uuid4())
                await conn.execute(
                    """INSERT INTO trabajadores (id, nombre_completo, rol, is_active, created_at, updated_at)
                       VALUES ($1, $2, 'obrero', true, $3, $3)""",
                    tid, nombre, now,
                )
                trabajadores_db[nombre] = tid

            insertados = 0
            saltados_dup = 0
            for r in registros:
                key = str(uuid.uuid5(NAMESPACE, f"jornales2026:{r.sheet}:{r.row_idx}:{r.split_idx}"))
                if key in existentes_keys:
                    saltados_dup += 1
                    continue
                reg_id = str(uuid.uuid4())
                parcela_id = parcelas_db.get(r.parcela_nombre) if r.parcela_nombre else None
                trabajador_id = trabajadores_db[r.trabajador_nombre]
                await conn.execute(
                    """INSERT INTO registros_trabajo
                       (id, fecha, parcela_id, trabajador_nombre, trabajador_id, clasificacion,
                        tarea, cantidad, unidad_medida, precio_unitario, monto_total, detalle,
                        idempotency_key, created_by, created_at, updated_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)""",
                    reg_id, r.fecha, parcela_id, r.trabajador_nombre, trabajador_id, r.clasificacion,
                    r.tarea, r.cantidad, r.unidad_medida, r.precio_unitario, r.monto_total, r.detalle,
                    key, created_by, now,
                )
                insertados += 1

                if r.crea_egreso:
                    parts = [r.tarea, r.trabajador_nombre]
                    if r.parcela_nombre:
                        parts.append(r.parcela_nombre)
                    await conn.execute(
                        """INSERT INTO egresos
                           (id, fecha, tipo, clasificacion, descripcion, monto, moneda, origen,
                            finca, forma_pago, parcela_id, fuente, referencia_id, created_by,
                            created_at, updated_at)
                           VALUES ($1,$2,'sueldos_personal','obreros',$3,$4,'ars','no_oficial',
                                   'media_agua','efectivo',$5,'trabajo_diario',$6,$7,$8,$8)""",
                        str(uuid.uuid4()), r.fecha, " | ".join(parts)[:500], r.monto_total,
                        parcela_id, reg_id, created_by, now,
                    )

        print(f"\nInsertados: {insertados} registros_trabajo, {saltados_dup} saltados (ya existían).")

        total_db = await conn.fetchval(
            "SELECT COALESCE(SUM(monto_total), 0) FROM registros_trabajo WHERE fecha BETWEEN '2026-04-01' AND '2026-07-10'"
        )
        print(f"Verificación -- suma en DB para el rango migrado: {total_db:,.0f} ARS "
              f"(calculado antes de insertar: {total_general:,.0f})")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
