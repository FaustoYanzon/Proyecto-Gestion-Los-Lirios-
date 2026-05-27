# backend/app/services/clima.py
# Cliente para open-meteo + cache de 30 min.
# Open-Meteo es gratis, sin API key, devuelve JSON. Docs:
#   https://open-meteo.com/en/docs

from datetime import datetime, timedelta
from typing import Literal
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.clima_cache import ClimaCache

# Coordenadas de las 3 fincas. Mantener sincronizado con
# frontend/lib/theme.ts y mobile/lib/theme.ts.
FINCA_COORDS: dict[str, tuple[float, float]] = {
    "los_mimbres": (-31.45, -68.55),
    "media_agua":  (-31.97, -68.42),
    "caucete":     (-31.65, -68.28),
}

CACHE_TTL_MIN = 30
ClimaKind = Literal["actual", "pronostico"]


def _is_fresh(fetched_at: datetime) -> bool:
    return datetime.utcnow() - fetched_at < timedelta(minutes=CACHE_TTL_MIN)


async def _fetch_open_meteo(lat: float, lng: float, kind: ClimaKind) -> dict:
    """Hace la request HTTP a open-meteo. Sólo se llama cuando el cache no sirve."""
    common = {
        "latitude": lat,
        "longitude": lng,
        "timezone": "America/Argentina/Buenos_Aires",
        "windspeed_unit": "kmh",
    }
    if kind == "actual":
        params = {
            **common,
            "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code",
            "daily": "temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration",
            "forecast_days": 1,
        }
    else:  # pronostico
        params = {
            **common,
            "daily": ",".join([
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_sum",
                "wind_speed_10m_max",
                "weather_code",
                "et0_fao_evapotranspiration",
            ]),
            "forecast_days": 7,
        }

    url = "https://api.open-meteo.com/v1/forecast"
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        return r.json()


async def get_clima(db: AsyncSession, finca: str, kind: ClimaKind) -> dict:
    """Devuelve los datos de clima, usando cache si está fresco."""
    if finca not in FINCA_COORDS:
        raise ValueError(f"Finca desconocida: {finca}")

    # 1. Buscar en cache
    stmt = select(ClimaCache).where(
        ClimaCache.finca == finca,
        ClimaCache.kind == kind,
    )
    res = await db.execute(stmt)
    row = res.scalar_one_or_none()

    if row is not None and _is_fresh(row.fetched_at):
        return {**row.payload, "_cached": True, "_fetched_at": row.fetched_at.isoformat()}

    # 2. Si no, ir a open-meteo
    lat, lng = FINCA_COORDS[finca]
    try:
        payload = await _fetch_open_meteo(lat, lng, kind)
    except httpx.HTTPError as e:
        # Si la fuente falla, devolver lo último que tengamos en cache (aunque esté stale)
        if row is not None:
            return {**row.payload, "_cached": True, "_stale": True, "_error": str(e)}
        raise

    # 3. Actualizar cache (upsert)
    if row is None:
        row = ClimaCache(finca=finca, kind=kind, payload=payload, fetched_at=datetime.utcnow())
        db.add(row)
    else:
        row.payload = payload
        row.fetched_at = datetime.utcnow()
    await db.flush()

    return {**payload, "_cached": False, "_fetched_at": row.fetched_at.isoformat()}
