# backend/app/api/clima.py
# Endpoints de clima. Cachea 30 min en clima_cache, fuente: open-meteo.

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_current_user
from app.services.clima import get_clima, FINCA_COORDS
from app.models.user import User

router = APIRouter(prefix="/clima", tags=["clima"])


@router.get("/actual")
async def clima_actual(
    finca: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Clima actual + máxima/mínima del día + ET0 para la finca dada."""
    if finca not in FINCA_COORDS:
        raise HTTPException(404, f"Finca desconocida: {finca}")
    try:
        return await get_clima(db, finca, "actual")
    except Exception as e:
        raise HTTPException(502, f"No se pudo obtener clima: {e}")


@router.get("/pronostico")
async def clima_pronostico(
    finca: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Pronóstico 7 días: temperaturas, precipitación, viento, ET0."""
    if finca not in FINCA_COORDS:
        raise HTTPException(404, f"Finca desconocida: {finca}")
    try:
        return await get_clima(db, finca, "pronostico")
    except Exception as e:
        raise HTTPException(502, f"No se pudo obtener pronóstico: {e}")


@router.get("/fincas")
async def listar_fincas_con_coords(
    _: User = Depends(get_current_user),
):
    """Devuelve las 3 fincas con sus coordenadas (útil para el mapa)."""
    return [
        {"finca": k, "lat": v[0], "lng": v[1]}
        for k, v in FINCA_COORDS.items()
    ]
