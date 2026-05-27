# backend/app/models/clima_cache.py
# Cache simple para evitar golpear open-meteo en cada request.
# TTL controlado por el service layer (services/clima.py).

from datetime import datetime
from sqlalchemy import Column, String, DateTime, JSON
from app.core.database import Base


class ClimaCache(Base):
    __tablename__ = "clima_cache"

    # Composite key: finca + kind ("actual" o "pronostico")
    finca = Column(String(64), primary_key=True)
    kind = Column(String(32), primary_key=True)

    payload = Column(JSON, nullable=False)
    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)
