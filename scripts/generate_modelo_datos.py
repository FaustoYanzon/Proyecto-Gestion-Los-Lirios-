"""Genera docs/sistema/Modelo de Datos.md desde el esquema real de Postgres.

No es un documento a mano: introspecciona information_schema/pg_catalog en
vivo (tablas, columnas, PKs, FKs, enums, vistas) y regenera el archivo
completo. Corre esto después de cualquier migración de Alembic para que la
doc nunca quede desactualizada -- reemplaza por completo el contenido
generado (no edites "Modelo de Datos.md" a mano, los cambios se pierden en
la próxima corrida).

Uso:
  cd C:\\claude-projects\\los-lirios
  C:\\claude-projects\\.venv\\Scripts\\python.exe scripts\\generate_modelo_datos.py
"""

from __future__ import annotations

import asyncio
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent / "migracion"))

import asyncpg
from migrate_jornales_historicos import read_database_url  # reusa la misma resolución de DATABASE_URL

OUT_PATH = Path(r"C:\Boveda Los Lirios\01 - Sistema\Modelo de Datos.md")

# Agrupación por dominio -- a mano, porque el nombre de tabla solo no alcanza
# para inferir el área de negocio. Actualizar cuando se agregue una tabla
# nueva (el script avisa si encuentra una tabla sin clasificar).
DOMINIOS: dict[str, list[str]] = {
    "Núcleo (usuarios, trabajadores, parcelas)": [
        "users", "trabajadores", "parcelas", "valvulas",
    ],
    "Producción de campo": [
        "registros_trabajo", "registros_riego", "registros_cosecha",
        "precios_tarea", "metas_produccion", "ciclos_campana",
        "estados_variedad_campana", "analisis_calidad",
    ],
    "Fitosanitarios, insumos y órdenes de aplicación": [
        "insumos", "registros_fitosanitarios", "planes_fitosanitarios",
        "ordenes_aplicacion", "ordenes_aplicacion_parcelas",
        "movimientos_stock", "fotos_registros_fitosanitarios",
    ],
    "Finanzas": [
        "ingresos", "egresos", "presupuestos",
        "comprobantes_arca_importados", "lotes_importacion_arca",
    ],
    "WhatsApp y notificaciones": [
        "mensajes_whatsapp_pendientes", "telefonos_usuarios_whatsapp",
        "push_tokens", "alertas_descartadas",
    ],
    "Clima y termógrafo": [
        "clima_cache", "lecturas_termografo", "lotes_importacion_termografo",
    ],
    "Trazabilidad pública": [
        "enlaces_publicos_trazabilidad", "fotos_parcela",
    ],
    "Sistema (Alembic)": [
        "alembic_version",
    ],
}

VISTAS_DESC = {
    "vw_flujo_mensual_real": "Ingresos y egresos agregados por temporada/mes/tipo/moneda -- alimenta Flujo Anual.",
    "vw_kpi_comprador": "kg entregados (por temporada de cosecha) vs. $ cobrado (por temporada de cobro) por comprador -- dos ejes que no siempre coinciden en la misma temporada.",
    "vw_kpi_iva": "IVA débito/crédito desde comprobantes ARCA importados.",
    "vw_kpi_mo_mensual": "Costo de mano de obra agregado por mes.",
    "vw_kpi_mo_parcela": "Costo de mano de obra por parcela (temporada completa).",
    "vw_kpi_mo_parcela_mes": "Costo de mano de obra por parcela y mes.",
    "vw_kpi_produccion_parcela": "kg cosechados por parcela.",
    "vw_kpi_produccion_variedad": "kg cosechados por variedad de uva.",
    "vw_presupuesto_vs_real": "Presupuesto vs. ejecutado real, por temporada/mes/concepto/moneda.",
}


async def fetch_schema(conn: asyncpg.Connection) -> dict:
    tables = [r["table_name"] for r in await conn.fetch(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
    )]
    views = [r["table_name"] for r in await conn.fetch(
        "SELECT table_name FROM information_schema.views WHERE table_schema='public' ORDER BY table_name"
    )]
    cols = await conn.fetch(
        "SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, "
        "       c.column_default, c.character_maximum_length, c.numeric_precision, c.numeric_scale "
        "FROM information_schema.columns c "
        "JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema='public' "
        "WHERE c.table_schema='public' AND t.table_type='BASE TABLE' "
        "ORDER BY c.table_name, c.ordinal_position"
    )
    pks = await conn.fetch(
        "SELECT tc.table_name, kcu.column_name "
        "FROM information_schema.table_constraints tc "
        "JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name "
        "WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'"
    )
    fks = await conn.fetch(
        "SELECT tc.table_name AS from_table, kcu.column_name AS from_col, "
        "       ccu.table_name AS to_table, ccu.column_name AS to_col "
        "FROM information_schema.table_constraints tc "
        "JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name "
        "JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name "
        "WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' ORDER BY from_table"
    )
    enums = await conn.fetch(
        "SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels "
        "FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid GROUP BY t.typname ORDER BY t.typname"
    )
    indexes = await conn.fetch(
        "SELECT tablename, indexname, indexdef FROM pg_indexes "
        "WHERE schemaname='public' AND indexname NOT LIKE '%_pkey' ORDER BY tablename, indexname"
    )
    return {
        "tables": tables, "views": views, "cols": cols, "pks": pks,
        "fks": fks, "enums": enums, "indexes": indexes,
    }


def pk_set(pks) -> set[tuple[str, str]]:
    return {(r["table_name"], r["column_name"]) for r in pks}


def short_type(c) -> str:
    if c["udt_name"] and not c["udt_name"].startswith(("int", "varchar", "text", "bool", "date", "timestamp", "numeric", "uuid")):
        return c["udt_name"]  # enum u otro tipo definido por usuario
    if c["data_type"] == "character varying":
        n = c["character_maximum_length"]
        return f"varchar({n})" if n else "varchar"
    if c["data_type"] == "numeric":
        p, s = c["numeric_precision"], c["numeric_scale"]
        return f"numeric({p},{s})" if p else "numeric"
    if c["data_type"] == "timestamp with time zone":
        return "timestamptz"
    return c["data_type"]


def mermaid_id(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)


def build_mermaid(dominio_tablas: list[str], cols_by_table: dict, pkset: set, fks: list) -> str:
    lines = ["```mermaid", "erDiagram"]
    tablas_set = set(dominio_tablas)
    rels_vistas = set()
    for fk in fks:
        if fk["from_table"] in tablas_set:
            a, b = mermaid_id(fk["to_table"]), mermaid_id(fk["from_table"])
            label = fk["from_col"]
            key = (a, b, label)
            if key in rels_vistas:
                continue
            rels_vistas.add(key)
            lines.append(f'    {a} ||--o{{ {b} : "{label}"')
    for t in dominio_tablas:
        lines.append(f"    {mermaid_id(t)} {{")
        for c in cols_by_table[t]:
            tname = short_type(c).replace(" ", "_")
            cname = c["column_name"]
            tags = []
            if (t, cname) in pkset:
                tags.append("PK")
            if any(fk["from_table"] == t and fk["from_col"] == cname for fk in fks):
                tags.append("FK")
            tagstr = " " + ",".join(tags) if tags else ""
            lines.append(f"        {tname} {cname}{tagstr}")
        lines.append("    }")
    lines.append("```")
    return "\n".join(lines)


def build_overview_mermaid(dominios: dict, fks: list) -> str:
    lines = ["```mermaid", "erDiagram"]
    table_to_dominio = {t: d for d, ts in dominios.items() for t in ts}
    seen = set()
    for fk in fks:
        a, b = fk["to_table"], fk["from_table"]
        if a == b:
            continue
        key = (a, b)
        if key in seen:
            continue
        seen.add(key)
        lines.append(f'    {mermaid_id(a)} ||--o{{ {mermaid_id(b)} : ""')
    lines.append("```")
    return "\n".join(lines)


async def main() -> None:
    conn = await asyncpg.connect(read_database_url())
    try:
        schema = await fetch_schema(conn)
    finally:
        await conn.close()

    cols_by_table = defaultdict(list)
    for c in schema["cols"]:
        cols_by_table[c["table_name"]].append(c)
    pkset = pk_set(schema["pks"])

    clasificadas = {t for ts in DOMINIOS.values() for t in ts}
    sin_clasificar = [t for t in schema["tables"] if t not in clasificadas]
    if sin_clasificar:
        print(f"AVISO: tablas nuevas sin clasificar en DOMINIOS, agregar a mano: {sin_clasificar}")

    out = []
    out.append("---")
    out.append("tags: [sistema, modelo-datos]")
    out.append("---")
    out.append("")
    out.append("# Modelo de Datos")
    out.append("")
    out.append(f"> ⚠️ Generado automáticamente por `scripts/generate_modelo_datos.py` el {date.today().isoformat()} "
                f"desde el esquema real de producción. **No editar a mano** -- correr el script de nuevo después "
                f"de cualquier migración de Alembic.")
    out.append("")
    out.append(f"**{len(schema['tables'])} tablas** · **{len(schema['views'])} vistas** · "
                f"**{len(schema['enums'])} enums** · **{len(schema['fks'])} relaciones**")
    out.append("")
    out.append("## Panorama general")
    out.append("")
    out.append("Todas las relaciones (FK), sin columnas -- para ver cómo se conecta todo de un vistazo.")
    out.append("")
    out.append(build_overview_mermaid(DOMINIOS, schema["fks"]))
    out.append("")

    for dominio, tablas in DOMINIOS.items():
        tablas_presentes = [t for t in tablas if t in cols_by_table]
        if not tablas_presentes:
            continue
        out.append(f"## {dominio}")
        out.append("")
        out.append(build_mermaid(tablas_presentes, cols_by_table, pkset, schema["fks"]))
        out.append("")
        for t in tablas_presentes:
            out.append(f"### `{t}`")
            out.append("")
            out.append("| Columna | Tipo | Null | Clave |")
            out.append("|---|---|---|---|")
            for c in cols_by_table[t]:
                cname = c["column_name"]
                tags = []
                if (t, cname) in pkset:
                    tags.append("PK")
                fk_match = next((fk for fk in schema["fks"] if fk["from_table"] == t and fk["from_col"] == cname), None)
                if fk_match:
                    tags.append(f"FK → `{fk_match['to_table']}.{fk_match['to_col']}`")
                nullable = "" if c["is_nullable"] == "YES" else "NOT NULL"
                out.append(f"| `{cname}` | {short_type(c)} | {nullable} | {', '.join(tags)} |")
            out.append("")

    out.append("## Vistas")
    out.append("")
    out.append("| Vista | Propósito |")
    out.append("|---|---|")
    for v in schema["views"]:
        out.append(f"| `{v}` | {VISTAS_DESC.get(v, '(sin descripción -- agregar a VISTAS_DESC en el script)')} |")
    out.append("")

    out.append("## Enums")
    out.append("")
    out.append("| Enum | Valores |")
    out.append("|---|---|")
    for e in schema["enums"]:
        out.append(f"| `{e['typname']}` | {', '.join(e['labels'])} |")
    out.append("")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text("\n".join(out), encoding="utf-8")
    print(f"Escrito: {OUT_PATH}")
    print(f"{len(schema['tables'])} tablas, {len(schema['views'])} vistas, {len(schema['enums'])} enums, {len(schema['fks'])} FKs")


if __name__ == "__main__":
    asyncio.run(main())
