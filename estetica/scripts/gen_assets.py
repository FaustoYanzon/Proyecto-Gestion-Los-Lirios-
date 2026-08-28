#!/usr/bin/env python3
"""
Genera los PNG de Expo y el favicon a partir de los SVG de estetica/assets/.

Requiere cairosvg y Pillow:
    pip install cairosvg pillow

Uso, desde la raiz del repo:
    python estetica/scripts/gen_assets.py

Dos reglas que este script respeta y que hay que mantener si se modifica:

1. adaptive-icon.png va con fondo TRANSPARENTE y la marca ocupando como maximo
   el 60% del lienzo, centrada. Android aplica un recorte circular y descarta
   todo lo que quede fuera del 66% central.
2. icon.png lleva el wordmark "LOS LIRIOS"; adaptive-icon.png NO lo lleva.
   A 48px el wordmark es una mancha. Son dos dibujos distintos, no un PNG escalado.
"""

import os
import io
from pathlib import Path

try:
    import cairosvg
    from PIL import Image
except ImportError:
    raise SystemExit("Falta una dependencia. Corre: pip install cairosvg pillow")

RAIZ = Path(__file__).resolve().parents[2]
SVG = RAIZ / "estetica" / "assets"
MOBILE = RAIZ / "mobile" / "assets"
PUBLIC = RAIZ / "frontend" / "public"

BURDEOS = (122, 31, 44, 255)   # #7a1f2c


def rasterizar(nombre_svg, px):
    """Devuelve un Image RGBA del SVG rasterizado a px x px."""
    data = cairosvg.svg2png(
        url=str(SVG / nombre_svg),
        output_width=px,
        output_height=px,
    )
    return Image.open(io.BytesIO(data)).convert("RGBA")


def centrar_en_lienzo(img, lienzo_px, escala, fondo=None):
    """Pega img centrada en un lienzo cuadrado, ocupando 'escala' del ancho.

    escala 0.60 significa que la marca ocupa el 60% del lienzo — el maximo
    seguro para el recorte circular de Android.
    """
    destino = Image.new("RGBA", (lienzo_px, lienzo_px), fondo or (0, 0, 0, 0))
    lado = int(lienzo_px * escala)
    marca = img.resize((lado, lado), Image.LANCZOS)
    off = (lienzo_px - lado) // 2
    destino.alpha_composite(marca, (off, off))
    return destino


def guardar(img, ruta):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    img.save(ruta, "PNG", optimize=True)
    print(f"  {ruta.relative_to(RAIZ)}  {img.width}x{img.height}")


def main():
    print("Generando assets de Los Lirios\n")

    # 1 · icon.png — CON wordmark, fondo burdeos ya incluido en el SVG.
    #     El SVG trae el rect de fondo, asi que se rasteriza tal cual.
    print("icon.png (con wordmark)")
    guardar(rasterizar("app-icon.svg", 1024), MOBILE / "icon.png")

    # 2 · adaptive-icon.png — SIN wordmark, fondo TRANSPARENTE, marca al 60%.
    #     Hay que borrar el <rect> de fondo del SVG antes de rasterizar.
    print("\nadaptive-icon.png (sin wordmark, transparente, marca al 60%)")
    svg_txt = (SVG / "app-icon-sin-wordmark.svg").read_text(encoding="utf-8")
    svg_sin_fondo = svg_txt.replace(
        '<rect width="200" height="200" rx="44" fill="url(#bg2)"/>', ""
    )
    tmp = SVG / "_tmp-adaptive.svg"
    tmp.write_text(svg_sin_fondo, encoding="utf-8")
    try:
        marca = Image.open(io.BytesIO(cairosvg.svg2png(
            url=str(tmp), output_width=1024, output_height=1024
        ))).convert("RGBA")
        guardar(centrar_en_lienzo(marca, 1024, 0.60), MOBILE / "adaptive-icon.png")
    finally:
        tmp.unlink(missing_ok=True)

    # 3 · notification-icon.png — silueta blanca pura sobre transparente.
    print("\nnotification-icon.png (silueta blanca)")
    guardar(rasterizar("notification.svg", 96), MOBILE / "notification-icon.png")

    # 4 · splash-icon.png — marca completa, transparente.
    #     El fondo crema lo pone splash.backgroundColor en app.json.
    print("\nsplash-icon.png (marca completa)")
    data = cairosvg.svg2png(url=str(SVG / "logo.svg"), output_width=820, output_height=1024)
    logo = Image.open(io.BytesIO(data)).convert("RGBA")
    lienzo = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    lado_h = int(1024 * 0.55)
    lado_w = int(lado_h * 0.8)
    logo_r = logo.resize((lado_w, lado_h), Image.LANCZOS)
    lienzo.alpha_composite(logo_r, ((1024 - lado_w) // 2, (1024 - lado_h) // 2))
    guardar(lienzo, MOBILE / "splash-icon.png")

    # 5 · favicon.png de Expo + favicon.ico de la web, los dos desde el glifo.
    print("\nfavicons (desde el glifo)")
    glifo_48 = rasterizar("logo-glifo.svg", 48)
    guardar(glifo_48, MOBILE / "favicon.png")

    ico = PUBLIC / "favicon.ico"
    ico.parent.mkdir(parents=True, exist_ok=True)
    rasterizar("logo-glifo.svg", 64).save(
        ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print(f"  {ico.relative_to(RAIZ)}  16/32/48")

    # 6 · Los SVG van directo a public/, sin rasterizar.
    print("\nSVG a frontend/public/")
    for origen, destino in [
        ("logo.svg", "logo.svg"),
        ("logo-reducido.svg", "logo-reducido.svg"),
        ("logo-glifo.svg", "logo-glifo.svg"),
    ]:
        (PUBLIC / destino).write_text(
            (SVG / origen).read_text(encoding="utf-8"), encoding="utf-8"
        )
        print(f"  frontend/public/{destino}")

    print("\nListo.")
    print("\nRevisa a ojo antes de commitear:")
    print("  - adaptive-icon.png tiene que tener fondo transparente")
    print("  - la marca no puede pasar del 60% del lienzo")
    print("  - notification-icon.png tiene que ser blanco puro, sin gris")
    print("  - icon.png a 48px: el wordmark se lee o es una mancha?")


if __name__ == "__main__":
    main()
