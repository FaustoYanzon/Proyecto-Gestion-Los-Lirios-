import asyncio

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.parcela import Parcela, TipoParcela, VariedadUva

PARCELAS: list[dict] = [
    # Parrales
    {"nombre": "Parral 2",          "tipo": "parral", "variedad": "flame",     "superficie_ha": 3.0,  "cabezal_riego": "1"},
    {"nombre": "Parral 4",          "tipo": "parral", "variedad": "fiesta",    "superficie_ha": 2.85, "cabezal_riego": "1"},
    {"nombre": "Parral 5",          "tipo": "parral", "variedad": "fiesta",    "superficie_ha": 2.85, "cabezal_riego": "1"},
    {"nombre": "Parral 6",          "tipo": "parral", "variedad": "red_globe", "superficie_ha": 4.0,  "cabezal_riego": "2"},
    {"nombre": "Parral 7",          "tipo": "parral", "variedad": "flame",     "superficie_ha": 4.0,  "cabezal_riego": "2"},
    {"nombre": "Parral 8",          "tipo": "parral", "variedad": "syrah",     "superficie_ha": 2.8,  "cabezal_riego": "4"},
    {"nombre": "Parral 9",          "tipo": "parral", "variedad": "red_globe", "superficie_ha": 2.2,  "cabezal_riego": "1"},
    {"nombre": "Parral 10",         "tipo": "parral", "variedad": "flame",     "superficie_ha": 3.0,  "cabezal_riego": "2"},
    {"nombre": "Parral 11",         "tipo": "parral", "variedad": "flame",     "superficie_ha": 4.0,  "cabezal_riego": "2"},
    {"nombre": "Parral 12",         "tipo": "parral", "variedad": "flame",     "superficie_ha": 2.94, "cabezal_riego": "3"},
    {"nombre": "Parral 13",         "tipo": "parral", "variedad": "flame",     "superficie_ha": 2.5,  "cabezal_riego": "3"},
    {"nombre": "Parral 14",         "tipo": "parral", "variedad": "aspirant",  "superficie_ha": 2.5,  "cabezal_riego": "3"},
    {"nombre": "Parral 15",         "tipo": "parral", "variedad": "flame",     "superficie_ha": 2.5,  "cabezal_riego": "3"},
    {"nombre": "Parral 16",         "tipo": "parral", "variedad": "flame",     "superficie_ha": 2.5,  "cabezal_riego": "3"},
    {"nombre": "Parral 21",         "tipo": "parral", "variedad": "flame",     "superficie_ha": 4.21, "cabezal_riego": "3"},
    {"nombre": "Parral Sult.",      "tipo": "parral", "variedad": "sultanina", "superficie_ha": 4.4,  "cabezal_riego": "1"},
    {"nombre": "Parral Bond. Viejo","tipo": "parral", "variedad": "bonarda",   "superficie_ha": 2.0,  "cabezal_riego": "4"},
    {"nombre": "Parral Bond. Nuevo","tipo": "parral", "variedad": "bonarda",   "superficie_ha": 2.0,  "cabezal_riego": "4"},
    {"nombre": "Parral SYR-RG",     "tipo": "parral", "variedad": "syrah",     "superficie_ha": 2.8,  "cabezal_riego": "4"},
    # Paseros
    {"nombre": "Pasero 1",  "tipo": "pasero",  "variedad": None, "superficie_ha": 2.9,  "cabezal_riego": None},
    {"nombre": "Pasero 2",  "tipo": "pasero",  "variedad": None, "superficie_ha": None, "cabezal_riego": None},
    # Potreros
    {"nombre": "Potrero 1",  "tipo": "potrero", "variedad": None,      "superficie_ha": 3.05, "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 3",  "tipo": "potrero", "variedad": None,      "superficie_ha": 2.2,  "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 17", "tipo": "potrero", "variedad": None,      "superficie_ha": 3.37, "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 22", "tipo": "potrero", "variedad": "alfalfa", "superficie_ha": 5.1,  "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 23", "tipo": "potrero", "variedad": None,      "superficie_ha": 23.0, "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 24", "tipo": "potrero", "variedad": None,      "superficie_ha": 7.0,  "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 25", "tipo": "potrero", "variedad": "alfalfa", "superficie_ha": 5.2,  "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 26", "tipo": "potrero", "variedad": None,      "superficie_ha": 3.0,  "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 27", "tipo": "potrero", "variedad": None,      "superficie_ha": 4.63, "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 28", "tipo": "potrero", "variedad": None,      "superficie_ha": 5.4,  "cabezal_riego": "MANTO"},
    {"nombre": "Potrero 29", "tipo": "potrero", "variedad": None,      "superficie_ha": 5.47, "cabezal_riego": "MANTO"},
    # Cabezales
    {"nombre": "Cabezal 1", "tipo": "cabezal", "variedad": None, "superficie_ha": None, "cabezal_riego": None},
    {"nombre": "Cabezal 2", "tipo": "cabezal", "variedad": None, "superficie_ha": None, "cabezal_riego": None},
    {"nombre": "Cabezal 3", "tipo": "cabezal", "variedad": None, "superficie_ha": None, "cabezal_riego": None},
    {"nombre": "Cabezal 4", "tipo": "cabezal", "variedad": None, "superficie_ha": None, "cabezal_riego": None},
]


async def seed_parcelas() -> None:
    async with AsyncSessionLocal() as session:
        added = 0
        skipped = 0

        for data in PARCELAS:
            result = await session.execute(
                select(Parcela).where(Parcela.nombre == data["nombre"])
            )
            if result.scalar_one_or_none() is not None:
                print(f"  skip  {data['nombre']}")
                skipped += 1
                continue

            parcela = Parcela(
                nombre=data["nombre"],
                tipo=TipoParcela(data["tipo"]),
                variedad=VariedadUva(data["variedad"]) if data["variedad"] else None,
                superficie_ha=data["superficie_ha"],
                cabezal_riego=data["cabezal_riego"],
                coordenadas=None,
            )
            session.add(parcela)
            print(f"  add   {data['nombre']}")
            added += 1

        await session.commit()
        print(f"\nDone — {added} added, {skipped} skipped.")


if __name__ == "__main__":
    asyncio.run(seed_parcelas())
