"""Helpers geometricos minimos para datos de parcela (Parcela.coordenadas)."""

from __future__ import annotations


def centroide_poligono(coordenadas: list | None) -> tuple[float, float] | None:
    """Centro aproximado de un poligono [[lat, lng], ...] -- promedio simple
    de los vertices, no un centroide de area ponderada. Suficiente para
    mostrar "donde esta" la parcela, no para calculos de superficie."""
    if not coordenadas:
        return None
    lat = sum(p[0] for p in coordenadas) / len(coordenadas)
    lng = sum(p[1] for p in coordenadas) / len(coordenadas)
    return round(lat, 6), round(lng, 6)
