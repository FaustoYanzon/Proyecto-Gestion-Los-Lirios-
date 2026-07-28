"""
Genera los assets que pide Play Console para la ficha de la app (no van
dentro del bundle, se suben a mano en la consola):
  - icon-512.png: hi-res icon, 512x512, PNG opaco (sin alfa)
  - feature-graphic-1024x500.png: banner de la ficha, 1024x500

Mismo estilo que gen_mobile_assets.py (fondo crema + logo centrado).
Requiere: pip install Pillow
"""
from PIL import Image
import sys
from pathlib import Path

LOGO_SRC = r"c:\claude-projects\los-lirios\frontend\public\logo.png"
OUT_DIR = Path(r"c:\claude-projects\los-lirios\mobile\assets\play-store")
BG_COLOR = (250, 248, 245, 255)  # #FAF8F5 opaco


def make_square_icon(logo: Image.Image, size: int, dst: Path) -> None:
    canvas = Image.new("RGBA", (size, size), BG_COLOR)
    pad = int(size * 0.15)
    max_logo = size - pad * 2
    logo_copy = logo.copy()
    logo_copy.thumbnail((max_logo, max_logo), Image.LANCZOS)
    lw, lh = logo_copy.size
    x = (size - lw) // 2
    y = (size - lh) // 2
    canvas.paste(logo_copy, (x, y), logo_copy if logo_copy.mode == "RGBA" else None)
    canvas.convert("RGB").save(dst, "PNG", optimize=True)
    print(f"  OK {dst}  ({size}x{size})")


def make_feature_graphic(logo: Image.Image, w: int, h: int, dst: Path) -> None:
    canvas = Image.new("RGBA", (w, h), BG_COLOR)
    max_logo_h = int(h * 0.6)
    logo_copy = logo.copy()
    logo_copy.thumbnail((max_logo_h * 4, max_logo_h), Image.LANCZOS)
    lw, lh = logo_copy.size
    x = (w - lw) // 2
    y = (h - lh) // 2
    canvas.paste(logo_copy, (x, y), logo_copy if logo_copy.mode == "RGBA" else None)
    canvas.convert("RGB").save(dst, "PNG", optimize=True)
    print(f"  OK {dst}  ({w}x{h})")


def main():
    try:
        logo = Image.open(LOGO_SRC).convert("RGBA")
    except FileNotFoundError:
        print(f"ERROR: no se encontró {LOGO_SRC}", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    make_square_icon(logo, 512, OUT_DIR / "icon-512.png")
    make_feature_graphic(logo, 1024, 500, OUT_DIR / "feature-graphic-1024x500.png")
    print("Listo. Subir a mano en Play Console -> Presencia en la tienda -> Recursos gráficos.")


if __name__ == "__main__":
    main()
