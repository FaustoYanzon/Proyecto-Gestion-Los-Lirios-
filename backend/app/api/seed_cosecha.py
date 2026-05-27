"""
Seed script: import historical harvest records from BD_Produccion.xlsx
Usage:
    1. Copy BD Produccion.xlsx to backend/data/BD_Produccion.xlsx
    2. cd backend && python -m app.api.seed_cosecha
"""
import asyncio
import sys
from datetime import date
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("ERROR: openpyxl not installed. Run: pip install openpyxl")
    sys.exit(1)

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.parcela import Parcela
from app.models.produccion import CultivoCosecha, DestinoCosecha, RegistroCosecha, TipoEnvase
from app.models.user import User

EXCEL_PATH = Path(__file__).parent.parent.parent / "data" / "BD_Produccion.xlsx"

PARCEL_MAP: dict[str, str] = {
    "2": "Parral 2",
    "4": "Parral 4",
    "5": "Parral 5",
    "6": "Parral 6",
    "7": "Parral 7",
    "8": "Parral 8",
    "9": "Parral 9",
    "10": "Parral 10",
    "11": "Parral 11",
    "12": "Parral 12",
    "13": "Parral 13",
    "14": "Parral 14",
    "15": "Parral 15",
    "16": "Parral 16",
    "21": "Parral 21",
    "25": "Potrero 25",
    "BN": "Parral Bond. Nuevo",
    "BV": "Parral Bond. Viejo",
}

DESTINO_MAP: dict[str, DestinoCosecha] = {
    "MI": DestinoCosecha.mercado_interno,
    "BODEGA": DestinoCosecha.bodega,
    "EXPO": DestinoCosecha.exportacion,
    "PASAS": DestinoCosecha.pasas,
    "RAMA PASA": DestinoCosecha.rama_pasa,
    "SEMILLA": DestinoCosecha.semilla,
    "DESC": DestinoCosecha.desc,
    "FARDO": DestinoCosecha.fardo,
}

CULTIVO_MAP: dict[str, CultivoCosecha] = {
    "VID": CultivoCosecha.vid,
    "CHACRA": CultivoCosecha.chacra,
    "IND PASA": CultivoCosecha.ind_pasa,
    "ALFALFA": CultivoCosecha.alfalfa,
}


def _safe_float(val: object) -> float | None:
    if val is None:
        return None
    if isinstance(val, str):
        if val.startswith("="):
            return None
        try:
            return float(val.replace(",", "."))
        except ValueError:
            return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _safe_str(val: object) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _compute_kg_total(
    cantidad: float | None,
    peso_u: float | None,
    bruto: float | None,
    tara: float | None,
) -> float | None:
    if cantidad is not None and peso_u is not None and cantidad > 0 and peso_u > 0:
        return round(cantidad * peso_u, 2)
    if bruto is not None and tara is not None and bruto > tara:
        return round(bruto - tara, 2)
    return None


async def seed() -> None:
    if not EXCEL_PATH.exists():
        print(f"ERROR: Excel file not found at {EXCEL_PATH}")
        print("Copy 'BD Produccion.xlsx' to backend/data/BD_Produccion.xlsx and retry.")
        sys.exit(1)

    wb = openpyxl.load_workbook(str(EXCEL_PATH), data_only=True)
    ws = wb["BASE DE DATOS "]

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.role == "super_admin").limit(1))
        system_user = result.scalar_one_or_none()
        if system_user is None:
            print("ERROR: No super_admin user found. Run python -m app.core.seed first.")
            sys.exit(1)
        user_id = system_user.id

        all_parcelas = list((await session.execute(select(Parcela))).scalars().all())
        parcela_by_name: dict[str, str] = {p.nombre: p.id for p in all_parcelas}

        inserted = 0
        skipped_no_kg = 0
        skipped_no_date = 0
        errors = 0
        unmatched_parcelas: set[str] = set()

        for row in ws.iter_rows(min_row=2, values_only=True):
            # Column layout (0-based):
            # A=0 TEMP, B=1 ORIGEN, C=2 FINCA, D=3 ACTIVIDAD, E=4 CULTIVO,
            # F=5 PARRALES/POTREROS, G=6 VARIEDAD, H=7 FECHA, I=8 SEMANA,
            # J=9 REMITO, K=10 CIU, L=11 DESTINO, M=12 COMPRADOR, N=13 CUADRILLA,
            # O=14 ACARREO, P=15 CAJA/BIN, Q=16 PESO UN, R=17 BRUTO, S=18 TARA,
            # T=19 KG TOTAL

            raw_fecha = row[7]
            if raw_fecha is None:
                skipped_no_date += 1
                continue

            if hasattr(raw_fecha, "date"):
                fecha: date = raw_fecha.date()
            elif isinstance(raw_fecha, date):
                fecha = raw_fecha
            else:
                skipped_no_date += 1
                continue

            kg_raw = _safe_float(row[19])
            cantidad = _safe_float(row[15])
            peso_u = _safe_float(row[16])
            bruto = _safe_float(row[17])
            tara = _safe_float(row[18])

            if kg_raw is not None and kg_raw > 0:
                kg_total = round(kg_raw, 2)
            else:
                kg_total = _compute_kg_total(cantidad, peso_u, bruto, tara)

            if kg_total is None or kg_total <= 0:
                skipped_no_kg += 1
                continue

            parcel_raw = _safe_str(row[5])
            parcela_id: str | None = None
            if parcel_raw:
                parcela_nombre = PARCEL_MAP.get(str(parcel_raw).strip().upper())
                if parcela_nombre:
                    parcela_id = parcela_by_name.get(parcela_nombre)
                elif parcel_raw.upper() not in ("PASERO", "FLAME", "GALPON", "NO REGISTRADO", "SUPERIOR"):
                    unmatched_parcelas.add(str(parcel_raw))

            destino_raw = _safe_str(row[11])
            destino = DESTINO_MAP.get(destino_raw.upper() if destino_raw else "", None)
            if destino is None:
                destino = DestinoCosecha.mercado_interno

            cultivo_raw = _safe_str(row[4])
            cultivo = CULTIVO_MAP.get(cultivo_raw.upper() if cultivo_raw else "", CultivoCosecha.vid)

            if cultivo == CultivoCosecha.ind_pasa or destino == DestinoCosecha.pasas:
                tipo_envase = TipoEnvase.ficha
            elif bruto is not None and tara is not None:
                tipo_envase = TipoEnvase.chasis
            elif cantidad is not None and cantidad <= 3 and kg_total > 1000:
                tipo_envase = TipoEnvase.bin
            else:
                tipo_envase = TipoEnvase.caja

            temporada = fecha.year if fecha.month >= 5 else fecha.year - 1

            semana_raw = row[8]
            semana: int | None = None
            try:
                semana = int(semana_raw) if semana_raw is not None else None
            except (TypeError, ValueError):
                pass

            n_remito = _safe_str(row[9])
            if n_remito == "0":
                n_remito = None

            n_ciu_raw = _safe_float(row[10])
            n_ciu = str(int(n_ciu_raw)) if n_ciu_raw and n_ciu_raw != 0 else None

            variedad = _safe_str(row[6])

            try:
                registro = RegistroCosecha(
                    fecha=fecha,
                    temporada=temporada,
                    semana=semana,
                    parcela_id=parcela_id,
                    cultivo=cultivo,
                    variedad=variedad,
                    n_remito=n_remito,
                    n_ciu=n_ciu,
                    destino=destino,
                    comprador=_safe_str(row[12]),
                    cuadrilla=_safe_str(row[13]),
                    acarreo=_safe_str(row[14]),
                    tipo_envase=tipo_envase,
                    cantidad_envases=cantidad,
                    peso_unitario_kg=peso_u,
                    bruto_kg=bruto,
                    tara_kg=tara,
                    kg_total=kg_total,
                    created_by=user_id,
                )
                session.add(registro)
                inserted += 1
            except Exception as e:
                errors += 1
                print(f"  Row error (fecha={fecha}): {e}")

        await session.commit()

    print("\n=== Seed Cosecha Complete ===")
    print(f"  Inserted:           {inserted}")
    print(f"  Skipped (no kg):    {skipped_no_kg}")
    print(f"  Skipped (no date):  {skipped_no_date}")
    print(f"  Errors:             {errors}")
    if unmatched_parcelas:
        print(f"  Unmatched parcelas: {sorted(unmatched_parcelas)}")


if __name__ == "__main__":
    asyncio.run(seed())
