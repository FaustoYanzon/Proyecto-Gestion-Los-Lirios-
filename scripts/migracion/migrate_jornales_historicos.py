"""Migración de jornales históricos (mano de obra) desde "JORNALES (1).xlsx".

A diferencia de migrate_jornales.py (que migró abril-julio 2026 desde
"JORNALES 2026.xlsx", formato estable), este Excel cubre 117 hojas semanales
de 09/06/2023 a 22/08/2025 con dos variantes de layout de columnas y una
sección de caja/tesorería por hoja que hay que excluir. Se migra por
temporada (TEMPORADAS abajo) para poder revisar cada tramo por separado.

Decisiones confirmadas con Fausto (sesión 2026-09-14), temporada 23-24:
  - Nombres: OSCAR (sin apellido) -> Oscar Carrizo. JESUS (sin apellido) ->
    Jesús Ortiz si la tarea es de tractor, sino Jesús Videla. ORLANDO (sin
    apellido) -> 50/50 Orlando Carrizo / Orlando Molina. IVAN, IVAN CASTRO,
    IVAN MOLINA -> una sola persona "Ivan Molina" (se crea). RAMON OLMOS,
    RAMON OL, RAMON O -> una sola persona "Ramón Olmos" (se crea, distinta
    de Ramón Silva). Frecuentes sin catálogo (Cristian, Tatita, Javier,
    Adrian, Alejandro, Bachi, Cocheche, Kevin, Leonardo, Luis, Lidia, Melisa,
    Milo, Hugo, Brian, Rodrigo) -> se crean como trabajador nuevo (obrero,
    activo). Todo lo demás sin mapear -> texto libre, sin crear trabajador
    (trabajador_id NULL) -- son apariciones sueltas (<10 veces), probable
    personal de temporada que no volvió; no ensucian el combobox.
  - Tareas: Red Globe = Parral 6 y Parral 9 (confirmado) -> "Descole PRV" y
    "Cosecha Red Globe" se reparten 50/50 entre ambos. "Raleo y Descole P6"
    se reparte 50/50 entre Raleo P6 y Descole P6. "Plantas Nuevas" (+ variantes
    "Brote Plantas Nuevas/Grandes") es una tarea NUEVA (fuera del catálogo
    fijo CLASIFICACION_POR_TAREA), clasificación primavera, repartida 1/5
    entre Parral 13/14/15/16/21. "Hollada" es tarea nueva, clasificación
    derivada de la fecha (estaciones calendario: verano dic-feb, otoño
    mar-may, invierno jun-ago, primavera sep-nov). "Secadero" (+ variantes)
    y "Bolsones de Pasa" (+ variantes) -> tarea Pasero, repartida 1/3 entre
    Pasero 1/2/3. "Ramo Acequia" (+ variantes) -> Limpieza Acequia. "Otros
    Trabajos" (+ variantes de tipeo) -> Jornal Comun general. "Albañil" ->
    Arreglo Parral general (dispara EGRESO_OVERRIDE_POR_TAREA: el Egreso
    generado es repuestos_reparacion/rep_repuestos_parral, no sueldos).
    "Adelanto" -> Jornal Comun general. "Tractoristas"/"Tractorista" (sin
    más calificación) -> Tractor Comun; "Cosecha Tractor" -> Tractor Cosecha.
  - Unidad pieza/día: el umbral de $2000 (igual que la migración 2026) separa
    bien piezas de días en esta temporada (p80 pieza=$1.650, mínimo día
    dentro de una sección de poda/atada/cosecha/arreglo = $3.960) -- pero
    a diferencia del script 2026, acá el check de pieza SOLO se aplica a
    tareas Poda/Atada/Cosecha/Arreglo Parral/Sacar Plantas; cualquier otra
    tarea es siempre "dias" sin mirar el precio (evita que una tarea barata
    tipo Trabajo General a $40/día se confunda con pieza).
  - Egresos: temporada 23-24 no tiene ningún agregado previo cargado (0 filas
    en `egresos` con clasificacion='obreros' antes de mayo-2025) -> TODAS las
    filas generan Egreso vinculado (fuente='trabajo_diario', igual que
    mayo-julio 2026), salvo las etiquetadas con EGRESO_OVERRIDE_POR_TAREA
    (Arreglo Parral/Arreglo Riego -> repuestos_reparacion, no sueldos).

Uso (con el venv del backend, que tiene asyncpg):
  cd C:\\claude-projects\\los-lirios
  C:\\claude-projects\\los-lirios\\backend\\venv\\Scripts\\python.exe scripts\\migracion\\migrate_jornales_historicos.py --temporada 23-24            # DRY RUN
  C:\\claude-projects\\los-lirios\\backend\\venv\\Scripts\\python.exe scripts\\migracion\\migrate_jornales_historicos.py --temporada 23-24 --commit   # inserta
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import uuid

sys.stdout.reconfigure(encoding="utf-8")
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import asyncpg
import openpyxl

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent.parent / "backend" / ".env"
EXCEL_PATH = Path(r"C:\claude-projects\JORNALES (1).xlsx")
NAMESPACE = uuid.UUID("f3a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c")  # fijo, distinto del de migrate_jornales.py

TEMPORADAS = {
    "23-24": {"desde": date(2023, 6, 1), "hasta": date(2024, 4, 30), "crea_egreso": True},
    "24-25": {"desde": date(2024, 5, 1), "hasta": date(2025, 4, 30), "crea_egreso": True},
    "25-aug25": {"desde": date(2025, 5, 1), "hasta": date(2025, 8, 31), "crea_egreso": False},
}

UMBRAL_PIEZA = Decimal("2000")
TAREAS_PIEZA = {"Poda", "Atada", "Cosecha", "Arreglo Parral", "Sacar Plantas"}
PIEZA_UNIDAD_POR_TAREA = {
    "Poda": "plantas", "Atada": "plantas", "Arreglo Parral": "plantas",
    "Sacar Plantas": "plantas", "Cosecha": "cajas",
}

_DATE_RE = re.compile(r"(\d{1,2})\D(\d{1,2})\D(\d{4})")


def parse_date_cell(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str):
        m = _DATE_RE.search(v)
        if m:
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                return date(y, mo, d)
            except ValueError:
                return None
    return None


def estacion_por_mes(d: date) -> str:
    if d.month in (12, 1, 2):
        return "verano"
    if d.month in (3, 4, 5):
        return "otono"
    if d.month in (6, 7, 8):
        return "invierno"
    return "primavera"  # 9,10,11


# ── Nombres ──────────────────────────────────────────────────────────────────
# Variante del Excel (MAYUSCULA, recortada) -> nombre real del catálogo o de
# un trabajador nuevo a crear. Bare OSCAR / JESUS / ORLANDO se manejan aparte
# (condicional / reparto), NO van acá.
NOMBRE_MAP: dict[str, str] = {
    # ya en el catálogo (incl. typos de una letra)
    "JUAN": "Juan Silva", "JUAN SILVA": "Juan Silva",
    "GOLLO": "Gollo",
    "SERGIO": "Sergio",
    "MIGUEL": "Miguel Silva", "MIGUEL SILVA": "Miguel Silva",
    "MAURICIO": "Mauricio", "MURICIO": "Mauricio", "MARUICIO": "Mauricio", "MAURICIPO": "Mauricio", "MAURICION": "Mauricio",
    "RAMON": "Ramón Silva", "RAMON SILVA": "Ramón Silva",
    "SEBASTIAN": "Sebastián", "SEBSATIAN": "Sebastián",
    "CARLOS": "Carlos", "CARLLOS": "Carlos",
    "DIEGO": "Diego", "DEIGO": "Diego", "DIEGFO": "Diego",
    "MARCOS": "Marcos", "MARCO": "Marcos",
    "PE\ufffdA": "Antonio Peña", "PE\ufffd\ufffd": "Antonio Peña", "PEÑA": "Antonio Peña", "PENA": "Antonio Peña", "RAM\ufffdN": "Ramón Silva",
    "HEVER": "Heber", "HEBER": "Heber",
    "HEBER ": "Heber",
    "JESUS VIDELA": "Jesús Videla", "JESUS V": "Jesús Videla", "JESUS VI": "Jesús Videla",
    "JESUS ORTIZ": "Jesús Ortiz", "JESUS O": "Jesús Ortiz",
    "PANCHO": "Pancho", "PANCHJO": "Pancho",
    "ROMINA": "Romina",
    "ANGELA": "Angela",
    "ROCIO": "Rocío",
    "ORLANDO M": "Orlando Molina", "ORLANDO MOLINA": "Orlando Molina", "ORLANO MOLINA": "Orlando Molina",
    "ORLANDO C": "Orlando Carrizo", "ORLANDO CARRIZO": "Orlando Carrizo", "ORLANDO CARRIZP": "Orlando Carrizo", "ORNLANDO": "Orlando Carrizo",
    "OSCAR CARRIZO": "Oscar Carrizo", "OSCAR C": "Oscar Carrizo", "ORSCAR": "Oscar Carrizo",
    "FRANCO": "Franco Videla",
    "EMANUEL": "Emanuel",
    "GABRIELA": "Gabriela",
    "BETO": "Beto",
    "LUCAS": "Lucas Mercado",
    # frecuentes sin catálogo -> se crean (confirmado con Fausto)
    "CRISTIAN": "Cristian", "CRISITAN": "Cristian", "GRISTIAN": "Cristian", "CRISTIAN DIAZ": "Cristian", "CRISTIAN CUAD": "Cristian",
    "TATITA": "Tatita",
    "JAVIER": "Javier", "JAVIER ROJAS": "Javier",
    "ADRIAN": "Adrian",
    "ALEJANDRO": "Alejandro",
    "BACHI": "Bachi", "BACHI ": "Bachi",
    "COCHECHE": "Cocheche",
    "KEVIN": "Kevin",
    "LEONARDO": "Leonardo",
    "LUIS": "Luis", "LUIS FUERTE": "Luis", "LUIS FUER": "Luis",
    "LIDIA": "Lidia",
    "MELISA": "Melisa",
    "MILO": "Milo",
    "HUGO": "Hugo",
    "BRIAN": "Brian", "BRAIAN": "Brian",
    "RODRIGO": "Rodrigo", "RODIRGO": "Rodrigo",
    # fusiones confirmadas
    "IVAN": "Ivan Molina", "IVAN CASTRO": "Ivan Molina", "IVAN MOLINA": "Ivan Molina",
    "RAMON OLMOS": "Ramón Olmos", "RAMON OL": "Ramón Olmos", "RAMON O": "Ramón Olmos",
}

# Personas nuevas a crear (no confundir con NUEVOS_TRABAJADORES de migrate_jornales.py)
NUEVOS_TRABAJADORES = [
    "Cristian", "Tatita", "Javier", "Adrian", "Alejandro", "Bachi", "Cocheche",
    "Kevin", "Leonardo", "Luis", "Lidia", "Melisa", "Milo", "Hugo", "Brian",
    "Rodrigo", "Ivan Molina", "Ramón Olmos",
]

TRACTOR_TASK_PREFIXES = ("TRACTORISTA",)  # para la regla condicional de JESUS

# Nombres que aparecen en la columna de trabajador pero NO son personas: gastos de
# insumos/combustible que alguien anotó en la misma tabla que los jornales (p.ej.
# "COMBUSTIBLE" $24.000 en 04-08-2023, "HILO" $20.000 en 11-08-2023), y días de la
# semana usados como pseudo-nombre en filas de "viajes al secadero" agrupadas por
# día en vez de por trabajador (mismo problema que la tarea "VIAJES", ver abajo).
# Confirmado con Fausto (sesión 2026-09-15): se excluyen de la migración igual que
# VIAJES -- no se migra esa plata; si se quiere registrada, se carga a mano como
# Egreso de Insumos/Combustible aparte.
NOMBRES_EXCLUIDOS = {
    "COMBUSTIBLE", "HILO", "MIMBRE", "MIMBRES",
    "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO",
    # "Caucete" y "Mimbre (Gamba, Zapallo)": Caucete y Los Mimbres son dos de las
    # tres fincas del proyecto (ver Fincas en CLAUDE.md) -- estas filas son plata
    # trasvasada/asignada a otra finca, no un jornal (confirmado con Fausto,
    # sesión 2026-09-15). "Vines Madera": material, no persona.
    "CAUCETE", "MIMBRE (GAMBA, ZAPALLO)", "VINES MADERA",
}


def resolver_nombre(nombre_raw: str, tarea_raw: str) -> str | None:
    """Devuelve el nombre real, o None si no hay mapeo (-> texto libre)."""
    solo_letras = re.sub(r"[^A-Z]", "", nombre_raw.upper())
    if solo_letras in ("PENA", "PEA", "PE"):  # cubre mojibake de "PEÑA" (encoding roto en el Excel)
        return "Antonio Peña"
    if nombre_raw == "OSCAR":
        return "Oscar Carrizo"
    if nombre_raw == "JESUS":
        es_tractor = any(tarea_raw.startswith(p) for p in TRACTOR_TASK_PREFIXES) or "TRACTOR" in tarea_raw
        return "Jesús Ortiz" if es_tractor else "Jesús Videla"
    if nombre_raw == "ORLANDO":
        return None  # se resuelve con reparto especial en build_registros, no acá
    return NOMBRE_MAP.get(nombre_raw)


# ── Tareas ───────────────────────────────────────────────────────────────────
def _p(nombre: str, frac: float = 1.0) -> list[tuple[str | None, float]]:
    return [(nombre, frac)]


_SIN_PARCELA: list[tuple[str | None, float]] = [(None, 1.0)]
_PASEROS = [("Pasero 1", 1 / 3), ("Pasero 2", 1 / 3), ("Pasero 3", 1 / 3)]
# Confirmado con Fausto (sesión 2026-09-14): toda mención de Red Globe/RV/Syrah
# (con o sin apellido "Viejo") es Parral SYR-RG, sin repartir entre Parral 6 y 9.
_RED_GLOBE = _p("Parral SYR-RG")
_PLANTAS_NUEVAS_PARC = [(f"Parral {n}", 1 / 5) for n in (13, 14, 15, 16, 21)]

PARCELA_ALIASES = {
    "BN": "Parral Bond. Nuevo", "PBN": "Parral Bond. Nuevo", "BONARDANUEVO": "Parral Bond. Nuevo",
    "BV": "Parral Bond. Viejo", "PBV": "Parral Bond. Viejo", "BONARDAVIEJO": "Parral Bond. Viejo",
    "SULTANINA": "Parral Sult.", "SULT": "Parral Sult.", "PSULTANINA": "Parral Sult.",
    "SYRAH": "Parral SYR-RG", "SYR": "Parral SYR-RG", "PSYRAH": "Parral SYR-RG",
    "SIRAH": "Parral SYR-RG", "PSIRAH": "Parral SYR-RG",  # typo recurrente de "SYRAH"
}

PREFIX_RULES: list[tuple[str, str, str]] = [
    ("PODA", "Poda", "invierno"),
    ("PODO", "Poda", "invierno"),  # typo recurrente de "PODA"
    ("ATADA", "Atada", "invierno"),
    ("RALEO", "Raleo", "primavera"),
    ("BROTE", "Brote", "primavera"),
    ("BREOTE", "Brote", "primavera"),  # typo
    ("DESCOLE", "Descole", "primavera"),
    ("ZANJEO", "Zanjeo", "general"),
    ("POLAINAS", "Polainas", "primavera"),
    ("POLAIINAS", "Polainas", "primavera"),  # typo
    ("TEJIDO", "Tejido", "invierno"),
    ("ANCHADA", "Anchada", "general"),
    ("COSECHA", "Cosecha", "verano"),
]

# Etiquetas irregulares / especiales (match exacto tras normalizar espacios)
EXPLICIT_TAREA_RULES: dict[str, tuple[str, str, list[tuple[str | None, float]]]] = {
    "TRABAJO GENERAL": ("Jornal Comun", "general", _SIN_PARCELA),
    "TRABAJO OTROS": ("Jornal Comun", "general", _SIN_PARCELA),
    "OTROS": ("Jornal Comun", "general", _SIN_PARCELA),
    "OTROS TRABAJOS": ("Jornal Comun", "general", _SIN_PARCELA),
    "OTRO TRABAJOS": ("Jornal Comun", "general", _SIN_PARCELA),
    "TRABAJOS OTROS": ("Jornal Comun", "general", _SIN_PARCELA),
    "ADELANTO": ("Jornal Comun", "general", _SIN_PARCELA),
    "ALBAÑIL": ("Arreglo Parral", "general", _SIN_PARCELA),
    "ALBA\ufffdIL": ("Arreglo Parral", "general", _SIN_PARCELA),
    "TRACTORISTAS": ("Tractor Comun", "general", _SIN_PARCELA),
    "TRACTORISTA": ("Tractor Comun", "general", _SIN_PARCELA),
    "COSECHA": ("Cosecha", "verano", _SIN_PARCELA),
    "COSECHA TRACTOR": ("Tractor Cosecha", "verano", _SIN_PARCELA),
    "TRACTOR COSECHA Y CONTROL": ("Tractor Cosecha", "verano", _SIN_PARCELA),
    "CONTROL COSECHA": ("Control Cosecha", "verano", _SIN_PARCELA),
    "COSECHA RED GLOBE": ("Cosecha", "verano", _RED_GLOBE),
    "COSECHA UVA FLAME": ("Cosecha", "verano", _SIN_PARCELA),
    "COSECHA PARRAL 4 Y 5": ("Cosecha", "verano", [("Parral 4", 0.5), ("Parral 5", 0.5)]),
    "CASECHA (SECADERO)": ("Pasero", "verano", _PASEROS),
    # "VIAJES SECADERO POR DIA" (transporte al secadero, agrupado por día de la
    # semana con reparto por "CANT DE PERSONAS", no por trabajador nombrado) queda
    # SIN mapear a propósito -- mismo criterio que la tarea "VIAJES" bare: layout
    # propio que no vale la pena modelar, se excluye de la migración (ver también
    # NOMBRES_EXCLUIDOS, que cubre el caso por si el nombre del día se cuela bajo
    # otra tarea).
    "SECADERO": ("Pasero", "verano", _PASEROS),
    "BOLSONES DE PASA": ("Pasero", "verano", _PASEROS),
    "BOLSONES DE PASAS": ("Pasero", "verano", _PASEROS),
    "BOLSONES PASA": ("Pasero", "verano", _PASEROS),
    "AMONTONAR Y DESPARRAMAR PASA": ("Amontonar Pasa", "verano", _SIN_PARCELA),
    "MURONES": ("Murones", "otono", _SIN_PARCELA),
    "RALEO Y DESCOLE P6": ("__RALEO_DESCOLE_P6__", "primavera", _SIN_PARCELA),  # sentinel, ver build_registros
    "DESCOLE PRV": ("Descole", "primavera", _RED_GLOBE),
    "ANCHADA DE BASURA BV Y P2": ("Anchada", "general", [("Parral Bond. Viejo", 0.5), ("Parral 2", 0.5)]),
    "ANCHADA": ("Anchada", "general", _SIN_PARCELA),
    "PODO BONARDA VIEJO": ("Poda", "invierno", _p("Parral Bond. Viejo")),
    "PLANTAS NUEVAS": ("Plantas Nuevas", "primavera", _PLANTAS_NUEVAS_PARC),
    "PANTAS NUEVAS": ("Plantas Nuevas", "primavera", _PLANTAS_NUEVAS_PARC),
    "BROTE PLANTAS NUEVAS": ("Plantas Nuevas", "primavera", _PLANTAS_NUEVAS_PARC),
    "BROTES PLANTAS NUEVAS": ("Plantas Nuevas", "primavera", _PLANTAS_NUEVAS_PARC),
    "BROTES DE PLANTAS NUEVAS": ("Plantas Nuevas", "primavera", _PLANTAS_NUEVAS_PARC),
    "BROTE PLANTAS GRANDES": ("Plantas Nuevas", "primavera", _PLANTAS_NUEVAS_PARC),
    "BROTES PLANTAS GRANDES": ("Plantas Nuevas", "primavera", _PLANTAS_NUEVAS_PARC),
    "HOLLADA P21": ("Hollada", "__POR_FECHA__", _p("Parral 21")),
    "GRAMPAS P15": ("Arreglo Parral", "general", _p("Parral 15")),
    "MANGUERA P21": ("Arreglo Riego", "general", _p("Parral 21")),
    "RALEO RV": ("Raleo", "primavera", _RED_GLOBE),
    "P SYRAH": ("Poda", "invierno", _p("Parral SYR-RG")),
    "P RED GLOBE VIEJO": ("Poda", "invierno", _p("Parral SYR-RG")),
    "PASERO": ("Pasero", "verano", _PASEROS),
    "COSECHA UVA BONARDA": ("Cosecha", "verano", _SIN_PARCELA),
    "COSECHA FINCA UVA BONARDA": ("Cosecha", "verano", _SIN_PARCELA),
    "AMONTONAR PASA MAS BOLSONES DE PASA": ("Amontonar Pasa", "verano", _SIN_PARCELA),
    "OTROS TRABAJOS (ANCHADA)": ("Anchada", "general", _SIN_PARCELA),
    "COSECHA FINCA UVA FLAME": ("Cosecha", "verano", _SIN_PARCELA),
    "COSECHA FINCA P SIRAH": ("Cosecha", "verano", _p("Parral SYR-RG")),
    "COSECHA FINCA UVA SIRAH": ("Cosecha", "verano", _p("Parral SYR-RG")),
    "OTROS TRABJOS": ("Jornal Comun", "general", _SIN_PARCELA),
    "OTROS TRABAJO": ("Jornal Comun", "general", _SIN_PARCELA),
    "BOSLONES DE PASA": ("Pasero", "verano", _PASEROS),
    "BOLSONES PASAS": ("Pasero", "verano", _PASEROS),
    "LLENADA DE BOLSONES TELAS": ("Pasero", "verano", _PASEROS),
    "TELAS DE PASA": ("Pasero", "verano", _PASEROS),
    "LEVANTAR PASA": ("Levantar Pasa", "verano", _SIN_PARCELA),
    "AMONTONAR PASA": ("Amontonar Pasa", "verano", _SIN_PARCELA),
    "AMONTONAR PASA MAS VINES": ("Amontonar Pasa", "verano", _SIN_PARCELA),
    "AMONTONAR PASA BOLSONES": ("Amontonar Pasa", "verano", _SIN_PARCELA),
    "AMONTONAR Y LEVANTAR PASA": ("Amontonar Pasa", "verano", _SIN_PARCELA),
    "TRACTOR COSECHA": ("Tractor Cosecha", "verano", _SIN_PARCELA),
    "CONTROL DE COSECHA": ("Control Cosecha", "verano", _SIN_PARCELA),
    "BROTE DE PLANTAS NUEVAS": ("Plantas Nuevas", "primavera", _PLANTAS_NUEVAS_PARC),
    "TRABAJO TEJIDO PBV": ("Tejido", "invierno", _p("Parral Bond. Viejo")),
    "COSECHA UVA RED GLOBE": ("Cosecha", "verano", _RED_GLOBE),
    "CAÑERIA": ("Arreglo Riego", "general", _SIN_PARCELA),
    "CA�ERIA": ("Arreglo Riego", "general", _SIN_PARCELA),
    "DIAS CAÑERIAS": ("Arreglo Riego", "general", _SIN_PARCELA),
    "DIAS CA�ERIAS": ("Arreglo Riego", "general", _SIN_PARCELA),
    "TRABAJO BROTE PVN": ("Brote", "primavera", _p("Parral Bond. Nuevo")),
    # "VIAJES" (transporte al secadero, registrado por día de la semana en vez de por
    # trabajador) usa un layout de columnas propio que no vale la pena modelar para
    # unas pocas filas -- queda fuera de la migración (problema reportado).
}


def parse_task_label(raw: str) -> tuple[str, str, list[tuple[str | None, float]]] | None:
    norm = re.sub(r"\s+", " ", raw.strip().upper())
    if norm in EXPLICIT_TAREA_RULES:
        return EXPLICIT_TAREA_RULES[norm]
    if "ACEQUIA" in norm or "PUNTEADA" in norm or "RAMO FINCA" in norm:
        return ("Limpieza Acequia", "general", _SIN_PARCELA)
    norm_sin_acentos = re.sub(r"[^A-Z]", "", norm.replace("Ñ", "N"))
    if "CANERIA" in norm_sin_acentos or "CAERIA" in norm_sin_acentos:
        return ("Arreglo Riego", "general", _SIN_PARCELA)
    for prefix, tarea, clasif in PREFIX_RULES:
        if norm.startswith(prefix):
            suffix = norm[len(prefix):].strip()
            if not suffix:
                return (tarea, clasif, _SIN_PARCELA)
            if "RAMO" in suffix:
                # "Ramo" (de acequia), no un número de parral -- p.ej. "Zanjeo Ramo Nº1".
                return (tarea, clasif, _SIN_PARCELA)
            # "P6" / "P 6" / "6" / "BN" / "SULTANINA" / "P SULTANINA" -> parcela
            letters_only = re.sub(r"[^A-Z]", "", suffix)
            if letters_only in ("RV", "PRV"):  # Red Globe (Viejo): Parral SYR-RG
                return (tarea, clasif, _RED_GLOBE)
            alias = PARCELA_ALIASES.get(letters_only)
            if alias:
                return (tarea, clasif, _p(alias))
            numeros = re.findall(r"\d+", suffix)
            if len(numeros) >= 2:
                # p.ej. "PODA P10 Y P11" -> reparto por igual entre ambos parrales.
                vistos = list(dict.fromkeys(int(n) for n in numeros))
                frac = 1 / len(vistos)
                return (tarea, clasif, [(f"Parral {n}", frac) for n in vistos])
            digits = re.sub(r"[^0-9]", "", suffix)
            if digits:
                return (tarea, clasif, _p(f"Parral {int(digits)}"))
            return None  # sufijo no reconocido -> problema
    return None


def det_unidad(tarea: str, precio: Decimal) -> str:
    if tarea in TAREAS_PIEZA and precio < UMBRAL_PIEZA:
        return PIEZA_UNIDAD_POR_TAREA.get(tarea, "plantas")
    return "dias"


# ── Egresos: igual que produccion.py EGRESO_OVERRIDE_POR_TAREA ──────────────
EGRESO_OVERRIDE_POR_TAREA = {
    "Arreglo Parral": ("repuestos_reparacion", "rep_repuestos_parral"),
    "Arreglo Riego": ("repuestos_reparacion", "rep_repuestos_riego"),
}


def read_database_url() -> str:
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
    __slots__ = ("sheet", "row_idx", "tarea_raw", "nombre_raw", "cantidad", "precio", "subtotal", "redondeo", "fecha", "unidad_forzada")

    def __init__(self, sheet, row_idx, tarea_raw, nombre_raw, cantidad, precio, subtotal, redondeo, fecha, unidad_forzada=None):
        self.sheet, self.row_idx = sheet, row_idx
        self.tarea_raw, self.nombre_raw = tarea_raw, nombre_raw
        self.cantidad, self.precio, self.subtotal, self.redondeo = cantidad, precio, subtotal, redondeo
        self.fecha = fecha
        self.unidad_forzada = unidad_forzada


def find_header(rows) -> tuple[int | None, int | None]:
    for i, row in enumerate(rows[:6]):
        for j, cell in enumerate(row):
            if isinstance(cell, str) and "DIAS" in cell.upper() and "MELGA" in cell.upper():
                return i, j - 1
    return None, None


def find_semana_positions(rows):
    out = []
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            if isinstance(cell, str) and cell.strip().upper() == "SEMANA":
                out.append((i, j))
    return out


def parse_sheet(sn: str, ws) -> tuple[date, list[RawLine], Decimal | None] | None:
    rows = list(ws.iter_rows(values_only=True))
    _, name_col = find_header(rows)
    if name_col is None:
        return None
    task_col = name_col - 1

    positions = find_semana_positions(rows)
    if not positions:
        return None
    first_row, first_col = positions[0]
    semana_date = None
    row0 = rows[first_row]
    for k in range(first_col + 1, min(first_col + 3, len(row0))):
        semana_date = parse_date_cell(row0[k])
        if semana_date is not None:
            break
    if semana_date is None:
        # Alguna celda de SEMANA tiene texto mal tipeado (p.ej. "28S/2/2025") que no
        # matchea el regex de fecha -- el nombre de la hoja es la fecha real, confiable.
        semana_date = parse_date_cell(sn)
    if semana_date is None:
        return None
    end_row = positions[1][0] if len(positions) > 1 else len(rows)

    declarado = None
    scan_width = name_col + 9
    for i in range(first_row, end_row):
        row = rows[i][:scan_width]
        joined = " ".join(str(c).upper() for c in row if isinstance(c, str))
        if "TOTAL" in joined and "DINERO" in joined:
            nums = [c for c in row if isinstance(c, (int, float))]
            if nums:
                # El PRIMER "TOTAL DE DINERO" es el cierre real de la semana de jornales;
                # algunas hojas tienen un bloque aparte "RESUMEN MIMBRES" (materiales, no
                # mano de obra) más abajo con su propio "TOTAL DE DINERO" que hay que ignorar.
                # Tomamos el PRIMER número de esa fila (a veces hay un segundo número
                # suelto en una columna más a la derecha que no es el total).
                declarado = to_dec(nums[0])
                break

    current_task = None
    last_name = None
    vin_mode = False  # hojas "COSECHA" con columnas especiales tipo VIN CHICO/VIN GRANDE/ASIS
    vin_asis_offset = None  # columna (relativa a name_col) de "ASIS", para saber hasta dónde sumar cajas
    multi_mode = False  # hojas "RALEO" con columnas por categoría (P6/RV/ASIST) + fila de tarifas
    multi_sub_offset = None  # offset de "SUBTOTAL" (límite de columnas-categoría)
    multi_total_offset = None  # offset de "TOTAL DE DINERO" (total real por trabajador)
    out: list[RawLine] = []

    # Buffer del grupo de filas del trabajador actual (una fila con nombre + posibles
    # filas de continuación sin nombre). "A PAGAR" de la primera fila es la fuente de
    # verdad del TOTAL del grupo -- algunas semanas tienen valores de "redondeo" por
    # línea que no son ajustes reales (ver migrate_jornales_historicos README/commit),
    # así que la corrección real se calcula como a_pagar - suma(subtotales) y se aplica
    # entera a la primera fila, en vez de confiar en cada "redondeo" individual.
    pending: list[tuple] = []  # (row_idx, task, name, cantidad, precio, subtotal, redondeo_original)
    pending_a_pagar: Decimal | None = None

    def flush_pending():
        nonlocal pending, pending_a_pagar
        if not pending:
            return
        if pending_a_pagar is not None:
            total_sub = sum((p[5] for p in pending), Decimal("0"))
            correccion = pending_a_pagar - total_sub
            for idx, (row_idx, task, name, cantidad, precio, sub, _red_orig) in enumerate(pending):
                red = correccion if idx == 0 else Decimal("0")
                out.append(RawLine(sn, row_idx, task, name, cantidad, precio, sub, red, semana_date))
        else:
            # Sin "A PAGAR" de referencia para el grupo: se usa el redondeo propio de
            # cada fila (comportamiento de respaldo), con la misma salvaguarda de antes.
            for (row_idx, task, name, cantidad, precio, sub, red_orig) in pending:
                red = red_orig if abs(red_orig) <= abs(sub) else Decimal("0")
                out.append(RawLine(sn, row_idx, task, name, cantidad, precio, sub, red, semana_date))
        pending = []
        pending_a_pagar = None

    for i in range(first_row + 2, end_row):
        row = rows[i]
        t = row[task_col] if 0 <= task_col < len(row) else None
        nm = row[name_col] if name_col < len(row) else None
        cant = row[name_col + 1] if name_col + 1 < len(row) else None
        precio = row[name_col + 2] if name_col + 2 < len(row) else None
        subtotal = row[name_col + 3] if name_col + 3 < len(row) else None
        redondeo = row[name_col + 4] if name_col + 4 < len(row) else None
        a_pagar = row[name_col + 5] if name_col + 5 < len(row) else None

        def escanear_submodo(row):
            nonlocal vin_mode, vin_asis_offset, multi_mode, multi_sub_offset, multi_total_offset
            encontrado = False
            for off in range(1, 8):
                v = row[name_col + off] if name_col + off < len(row) else None
                if not isinstance(v, str):
                    continue
                vu = v.upper()
                if "ASIST" in vu:
                    multi_mode = True
                    encontrado = True
                elif "VIN" in vu:
                    vin_mode = True
                    encontrado = True
                elif "ASIS" in vu:
                    vin_asis_offset = off
                    encontrado = True
                if "SUBTOTAL" in vu:
                    multi_sub_offset = off
                    encontrado = True
                if "TOTAL" in vu and "DINERO" in vu:
                    multi_total_offset = off
                    encontrado = True
            return encontrado

        if (
            isinstance(t, str) and t.strip() and isinstance(nm, str) and nm.strip()
            and t.strip().upper() == nm.strip().upper() and not isinstance(cant, (int, float))
        ):
            # El nombre de la tarea está duplicado en la columna de nombre (p.ej.
            # "TRABAJO GENERAL, TRABAJO GENERAL") -- hoja sin trabajadores nombrados
            # esa semana. Se trata como header normal; las filas sin nombre que siguen
            # quedan con "Sin Nombre" (no se pierde el monto).
            flush_pending()
            current_task = t.strip()
            last_name = "SIN NOMBRE"
            vin_mode = False
            vin_asis_offset = None
            multi_mode = False
            multi_sub_offset = None
            multi_total_offset = None
            escanear_submodo(row)
            continue
        if isinstance(t, str) and t.strip() and nm is None and not isinstance(cant, (int, float)):
            flush_pending()
            current_task = t.strip()
            vin_mode = False
            vin_asis_offset = None
            multi_mode = False
            multi_sub_offset = None
            multi_total_offset = None
            escanear_submodo(row)
            continue
        if (
            isinstance(t, str) and len(re.sub(r"[^A-Za-z0-9]", "", t)) > 1
            and isinstance(nm, str) and nm.strip() and isinstance(cant, (int, float))
        ):
            # Tarea nueva y primer trabajador vienen juntos en la misma fila (en vez de
            # la tarea en su propia fila aparte) -- arrancamos la tarea nueva y seguimos
            # procesando esta misma fila como línea de trabajador (sin "continue"). El
            # "." decorativo de algunas filas de continuación (un solo carácter) no
            # cuenta como tarea nueva.
            flush_pending()
            current_task = t.strip()
            vin_mode = False
            vin_asis_offset = None
            multi_mode = False
            multi_sub_offset = None
            multi_total_offset = None
        if (
            isinstance(t, str) and t.strip() and isinstance(nm, str) and nm.strip()
            and not isinstance(cant, (int, float))
        ):
            # Tarea Y nombre tienen texto a la vez, y la "cantidad" tampoco es numérica
            # -- no es un header normal ni una fila de trabajador (el "." decorativo de
            # algunas filas de continuación no cuenta, ahí cantidad SÍ es numérica),
            # sino un bloque aparte con su propio layout (p.ej. "CAUCETE / PLANTAS /
            # PRECIO"). Cerramos la sección actual para no contaminarla.
            flush_pending()
            current_task = None
            continue
        if nm is None:
            # Fila de sub-header (p.ej. "VIN CHICO"/"VIN GRANDE"/"ASIST") que viene en una
            # fila SEPARADA del nombre de la tarea -- no es línea de trabajador.
            if escanear_submodo(row):
                flush_pending()
                continue
            texto_resto = " ".join(str(c).upper() for c in row[name_col:] if isinstance(c, str))
            if "TOTAL" in texto_resto and "DINERO" in texto_resto:
                # fila de cierre de la semana (gran total) -- no es línea de trabajador,
                # aunque current_task/last_name hayan quedado con valores de antes.
                flush_pending()
                current_task = None
                continue
        if current_task is None:
            continue
        if isinstance(nm, str) and nm.strip():
            last_name = nm.strip().upper()
        if isinstance(a_pagar, (int, float)):
            # Un nuevo "A PAGAR" cierra el grupo anterior y abre uno nuevo -- el límite
            # del grupo lo marca "A PAGAR", no el nombre: a veces una segunda persona
            # aparece en su propia fila pero sin "A PAGAR" propio, compartiendo el total
            # de la fila anterior (p.ej. alguien que ayudó un día dentro de esa tarea);
            # y a veces una fila de continuación SIN nombre tiene su propio "A PAGAR"
            # (liquida su propia parte aparte, no la del trabajador de arriba).
            flush_pending()
            pending_a_pagar = to_dec(a_pagar)

        if multi_mode:
            # Columnas de categoría (p.ej. P6/RV/ASIST) con una fila de tarifas aparte;
            # usamos directamente el total de la fila (no reconstruimos por categoría
            # porque no hay forma confiable de repartir por parcela).
            fin = multi_sub_offset if multi_sub_offset is not None else 4
            tot_off = multi_total_offset if multi_total_offset is not None else 7
            total_val = row[name_col + tot_off] if name_col + tot_off < len(row) else None
            if isinstance(total_val, (int, float)):
                cajas = sum(
                    to_dec(row[name_col + off]) for off in range(1, fin)
                    if name_col + off < len(row) and isinstance(row[name_col + off], (int, float))
                )
                monto = to_dec(total_val)
                cajas = cajas if cajas > 0 else Decimal("1")
                precio_unit = round2(monto / cajas)
                out.append(RawLine(sn, i + 1, current_task, last_name, cajas, precio_unit, monto, Decimal("0"), semana_date))
            continue

        if vin_mode:
            # Las columnas entre nombre y "ASIS" son cajas (chico/grande, y a veces un
            # contador de "día común"), no cantidad x precio. El monto real ya viene
            # dado en la columna "A PAGAR" (siempre name_col+5, igual que el formato normal).
            if isinstance(a_pagar, (int, float)):
                fin = vin_asis_offset if vin_asis_offset is not None else 3
                cajas = sum(
                    to_dec(row[name_col + off]) for off in range(1, fin)
                    if name_col + off < len(row) and isinstance(row[name_col + off], (int, float))
                )
                monto = to_dec(a_pagar)
                cajas = cajas if cajas > 0 else Decimal("1")
                precio_unit = round2(monto / cajas)
                out.append(RawLine(sn, i + 1, current_task, last_name, cajas, precio_unit, monto, Decimal("0"), semana_date, unidad_forzada="cajas"))
            continue

        if isinstance(cant, (int, float)) and isinstance(precio, (int, float)):
            sub = to_dec(subtotal) if isinstance(subtotal, (int, float)) else to_dec(cant) * to_dec(precio)
            red_orig = to_dec(redondeo) if isinstance(redondeo, (int, float)) else Decimal("0")
            pending.append((i + 1, current_task, last_name, to_dec(cant), to_dec(precio), sub, red_orig))
        elif isinstance(precio, (int, float)) and isinstance(subtotal, (int, float)) and cant is None:
            # Ítem de tarea suelto, sin cantidad ni trabajador nombrado -- el nombre de
            # la fila (p.ej. "SEMBRADA ZAPALLO") es en realidad la descripción de la
            # tarea, con un monto fijo. Se registra con cantidad=1.
            red_orig = to_dec(redondeo) if isinstance(redondeo, (int, float)) else Decimal("0")
            pending.append((i + 1, current_task, last_name, Decimal("1"), to_dec(precio), to_dec(subtotal), red_orig))

    flush_pending()

    return semana_date, out, declarado


class Registro:
    __slots__ = (
        "sheet", "row_idx", "split_idx", "fecha", "parcela_nombre", "trabajador_nombre",
        "trabajador_vinculado", "tarea", "clasificacion", "cantidad", "unidad_medida",
        "precio_unitario", "monto_total", "detalle", "crea_egreso",
    )


def build_registros(lineas_por_hoja: dict[str, list[RawLine]], crea_egreso_default: bool) -> tuple[list[Registro], list[str]]:
    registros: list[Registro] = []
    problemas: list[str] = []

    for sheet, raw_rows in lineas_por_hoja.items():
        for raw in raw_rows:
            if raw.nombre_raw.strip().upper() in NOMBRES_EXCLUIDOS:
                problemas.append(
                    f"{sheet} fila {raw.row_idx}: nombre excluido (no es trabajador) {raw.nombre_raw!r}, "
                    f"tarea {raw.tarea_raw!r}, monto {raw.subtotal + raw.redondeo}"
                )
                continue
            tarea_info = parse_task_label(raw.tarea_raw)
            if tarea_info is None:
                problemas.append(f"{sheet} fila {raw.row_idx}: tarea sin mapear {raw.tarea_raw!r}")
                continue
            tarea, clasificacion, parcelas = tarea_info

            if tarea == "__RALEO_DESCOLE_P6__":
                sub_tareas = [("Raleo", "primavera", "Parral 6", 0.5), ("Descole", "primavera", "Parral 6", 0.5)]
            else:
                if clasificacion == "__POR_FECHA__":
                    clasificacion = estacion_por_mes(raw.fecha)
                sub_tareas = [(tarea, clasificacion, pn, frac) for pn, frac in parcelas]

            # nombre: casos especiales ORLANDO (reparto) vs resto (mapeo directo o texto libre)
            if raw.nombre_raw == "ORLANDO":
                personas = [("Orlando Carrizo", True, 0.5), ("Orlando Molina", True, 0.5)]
            else:
                resuelto = resolver_nombre(raw.nombre_raw, raw.tarea_raw)
                if resuelto is not None:
                    personas = [(resuelto, True, 1.0)]
                else:
                    nombre_libre = raw.nombre_raw.strip().title()
                    personas = [(nombre_libre, False, 1.0)]

            monto_linea = raw.subtotal + raw.redondeo

            split_idx = 0
            for (t2, clas2, parcela_nombre, frac_tarea) in sub_tareas:
                for (persona_nombre, vinculado, frac_persona) in personas:
                    frac = frac_tarea * frac_persona
                    r = Registro()
                    r.sheet, r.row_idx, r.split_idx = sheet, raw.row_idx, split_idx
                    r.fecha = raw.fecha
                    r.parcela_nombre = parcela_nombre
                    r.trabajador_nombre = persona_nombre
                    r.trabajador_vinculado = vinculado
                    r.tarea = t2
                    r.clasificacion = clas2
                    r.cantidad = round2(raw.cantidad * to_dec(frac))
                    r.unidad_medida = raw.unidad_forzada or det_unidad(t2, raw.precio)
                    r.precio_unitario = raw.precio
                    r.monto_total = round2(monto_linea * to_dec(frac))
                    detalle = f"Migración JORNALES (1).xlsx · hoja {sheet} · fila {raw.row_idx}"
                    if len(sub_tareas) * len(personas) > 1:
                        detalle += f" · reparto {split_idx + 1}/{len(sub_tareas) * len(personas)}"
                    r.detalle = detalle
                    r.crea_egreso = crea_egreso_default
                    registros.append(r)
                    split_idx += 1

    return registros, problemas


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--temporada", required=True, choices=list(TEMPORADAS))
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    cfg = TEMPORADAS[args.temporada]

    # Hojas con datos internamente inconsistentes (confirmado con Fausto 2026-09-14):
    # "23-5-2025" tiene "A PAGAR" repetido en filas de continuación de forma ambigua;
    # "30-5-2025" tiene una fila de SEMANA en medio de la tabla y datos desalineados.
    # Se omiten por completo -- no se migra nada de esas 2 semanas.
    SHEETS_EXCLUIDAS = {"23-5-2025", "30-5-2025"}

    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    sheets = [s for s in wb.sheetnames if s != "Hoja1" and s not in SHEETS_EXCLUIDAS]

    fechas: dict[str, date] = {}
    lineas: dict[str, list[RawLine]] = {}
    declarados: dict[str, Decimal] = {}
    no_parseadas: list[str] = []

    for sn in sheets:
        r = parse_sheet(sn, wb[sn])
        if r is None:
            no_parseadas.append(sn)
            continue
        fecha, raw_rows, declarado = r
        if not (cfg["desde"] <= fecha <= cfg["hasta"]):
            continue
        fechas[sn] = fecha
        lineas[sn] = raw_rows
        declarados[sn] = declarado if declarado is not None else Decimal("0")

    if no_parseadas:
        print(f"AVISO: {len(no_parseadas)} hojas no se pudieron parsear en TODO el archivo: {no_parseadas}")

    registros, problemas = build_registros(lineas, cfg["crea_egreso"])

    if problemas:
        print(f"PROBLEMAS DE MAPEO ({len(problemas)}, no se migran esas filas hasta corregir):")
        for p in problemas[:60]:
            print(f"  - {p}")
        if len(problemas) > 60:
            print(f"  ... y {len(problemas) - 60} más")
        print()

    print(f"── Temporada {args.temporada}: {fechas and min(fechas.values())} a {fechas and max(fechas.values())} ({len(fechas)} semanas) ──")
    por_semana: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for r in registros:
        por_semana[r.sheet] += r.monto_total
    total_general = Decimal("0")
    diffs = []
    for sn in sorted(fechas, key=lambda s: fechas[s]):
        calc = por_semana[sn]
        decl = declarados[sn]
        diff = calc - decl
        if decl and abs(diff) > 1:
            diffs.append((sn, fechas[sn], calc, decl, diff))
        total_general += calc
    print(f"TOTAL GENERAL A MIGRAR: {total_general:,.0f} ARS  ({len(registros)} filas)")
    print(f"Semanas con diferencia > $1 vs. declarado: {len(diffs)}")
    for s in diffs[:20]:
        print(f"  {s[0]:14s} {s[1]}  calc={s[2]:>12,.0f}  decl={s[3]:>12,.0f}  diff={s[4]:>12,.0f}")

    print("\n── Resumen por tarea ──")
    por_tarea: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    n_por_tarea: dict[str, int] = defaultdict(int)
    for r in registros:
        por_tarea[r.tarea] += r.monto_total
        n_por_tarea[r.tarea] += 1
    for tarea, monto in sorted(por_tarea.items(), key=lambda x: -x[1]):
        print(f"  {tarea:20s} {monto:>14,.0f}  ({n_por_tarea[tarea]} filas)")

    nombres_libres = sorted({r.trabajador_nombre for r in registros if not r.trabajador_vinculado})
    print(f"\nNombres sin vincular a catálogo (texto libre, {len(nombres_libres)} distintos): {nombres_libres}")

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
            print(f"AVISO: {msg}")

        vinculados_faltan = sorted({
            r.trabajador_nombre for r in registros if r.trabajador_vinculado
        } - set(trabajadores_db) - set(NUEVOS_TRABAJADORES))
        if vinculados_faltan:
            msg = f"nombres marcados como 'vinculados' pero no están en catálogo ni en NUEVOS_TRABAJADORES: {vinculados_faltan}"
            if args.commit:
                sys.exit(f"ERROR: {msg}")
            print(f"AVISO: {msg}")

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
                key = str(uuid.uuid5(NAMESPACE, f"jornales_hist:{r.sheet}:{r.row_idx}:{r.split_idx}"))
                if key in existentes_keys:
                    saltados_dup += 1
                    continue
                reg_id = str(uuid.uuid4())
                parcela_id = parcelas_db.get(r.parcela_nombre) if r.parcela_nombre else None
                trabajador_id = trabajadores_db.get(r.trabajador_nombre) if r.trabajador_vinculado else None
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
                    tipo, clasif_egreso = EGRESO_OVERRIDE_POR_TAREA.get(r.tarea, ("sueldos_personal", "obreros"))
                    parts = [r.tarea, r.trabajador_nombre]
                    if r.parcela_nombre:
                        parts.append(r.parcela_nombre)
                    await conn.execute(
                        """INSERT INTO egresos
                           (id, fecha, tipo, clasificacion, descripcion, monto, moneda, origen,
                            finca, forma_pago, parcela_id, fuente, referencia_id, created_by,
                            created_at, updated_at)
                           VALUES ($1,$2,$3,$4,$5,$6,'ars','no_oficial',
                                   'media_agua','efectivo',$7,'trabajo_diario',$8,$9,$10,$10)""",
                        str(uuid.uuid4()), r.fecha, tipo, clasif_egreso, " | ".join(parts)[:500], r.monto_total,
                        parcela_id, reg_id, created_by, now,
                    )

        print(f"\nInsertados: {insertados} registros_trabajo, {saltados_dup} saltados (ya existían).")

        total_db = await conn.fetchval(
            "SELECT COALESCE(SUM(monto_total), 0) FROM registros_trabajo WHERE fecha BETWEEN $1 AND $2",
            cfg["desde"], cfg["hasta"],
        )
        print(f"Verificación -- suma en DB para el rango migrado: {total_db:,.0f} ARS "
              f"(calculado antes de insertar: {total_general:,.0f})")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
