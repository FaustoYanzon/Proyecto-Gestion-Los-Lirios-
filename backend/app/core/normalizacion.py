import unicodedata


def normalizar_nombre(nombre: str) -> str:
    """Trim + minusculas + sin tildes, para comparar nombres sin exigir
    que coincidan letra por letra (evita que "Jose Perez" y "José Pérez"
    convivan como dos registros distintos)."""
    sin_tildes = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode("ascii")
    return " ".join(sin_tildes.strip().lower().split())
