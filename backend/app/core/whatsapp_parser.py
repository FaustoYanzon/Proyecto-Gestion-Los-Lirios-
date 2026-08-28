"""Parser de texto libre para mensajes de WhatsApp tipo "5000 nafta camioneta
no pagado". Función pura, sin dependencias de red ni de base de datos -- fácil
de probar con casos sueltos.

Limitación conocida y aceptada: no soporta separador de miles ("5.000" se lee
como 5,000 = cinco). El llamador debe repetir el monto interpretado en la
respuesta del bot para que el usuario pueda corregir si se equivocó.
"""

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# Primera secuencia numérica en cualquier posición del texto (no solo al
# inicio) -- cubre tanto "5000 nafta" como "pagado 1000 combustible".
_MONTO_PATTERN = re.compile(r"\d+(?:[.,]\d+)?")

# "no pagado"/"sin pagar" se busca ANTES que "pagado" a propósito: si se
# buscara "pagado" primero, matchearía también dentro de "no pagado".
_NO_PAGADO_PATTERN = re.compile(r"\b(no\s+pagad[oa]|sin\s+pagar)\b", re.IGNORECASE)
_PAGADO_PATTERN = re.compile(r"\bpagad[oa]\b", re.IGNORECASE)


@dataclass
class GastoParseado:
    monto: Decimal
    descripcion: str
    pagado: bool


def parse_mensaje_gasto(texto: str) -> GastoParseado | None:
    """Devuelve None si no se encuentra ningún monto -- el llamador debe pedirle
    al usuario que reformule el mensaje en ese caso."""
    match = _MONTO_PATTERN.search(texto)
    if match is None:
        return None

    monto_str = match.group().replace(",", ".")
    try:
        monto = Decimal(monto_str)
    except InvalidOperation:
        return None

    resto = texto[: match.start()] + texto[match.end() :]

    no_pagado_match = _NO_PAGADO_PATTERN.search(resto)
    if no_pagado_match is not None:
        pagado = False
        resto = resto[: no_pagado_match.start()] + resto[no_pagado_match.end() :]
    else:
        pagado_match = _PAGADO_PATTERN.search(resto)
        pagado = pagado_match is not None
        if pagado_match is not None:
            resto = resto[: pagado_match.start()] + resto[pagado_match.end() :]

    descripcion = re.sub(r"\s+", " ", resto).strip(" .,-")
    if not descripcion:
        descripcion = "Sin descripción"

    return GastoParseado(monto=monto, descripcion=descripcion, pagado=pagado)
