"""Generacion de codigos QR para la carta de trazabilidad. Usa `qrcode`
(Python puro + Pillow, que ya esta instalado) -- sin dependencias de sistema,
mismo criterio que la eleccion de xhtml2pdf sobre WeasyPrint en este proyecto.
"""

from __future__ import annotations

import base64
from io import BytesIO

import qrcode


def generar_qr_png(url: str) -> bytes:
    """PNG del QR que apunta a `url`. Nivel de correccion de error medio (M),
    borde chico -- pensado para imprimirse a ~2-3 cm en la carta."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generar_qr_data_uri(url: str) -> str:
    """El QR como data URI (`data:image/png;base64,...`) para embeberlo directo
    en el HTML del template sin pasar por el sistema de archivos."""
    b64 = base64.b64encode(generar_qr_png(url)).decode("ascii")
    return f"data:image/png;base64,{b64}"
