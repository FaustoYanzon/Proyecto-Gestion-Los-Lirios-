"""
Genera icon.png (1024x1024) y splash-icon.png (512x512) para Expo.
Fondo crema #FAF8F5, logo original centrado con padding del 15%.
Requiere: pip install Pillow
"""
from PIL import Image
import sys

LOGO_SRC  = r"c:\claude-projects\los-lirios\frontend\public\logo.png"
ICON_DST  = r"c:\claude-projects\los-lirios\mobile\assets\icon.png"
SPLASH_DST= r"c:\claude-projects\los-lirios\mobile\assets\splash-icon.png"
BG_COLOR  = (250, 248, 245, 255)   # #FAF8F5 opaque

def make_asset(logo: Image.Image, size: int, dst: str) -> None:
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

def main():
    try:
        logo = Image.open(LOGO_SRC).convert("RGBA")
    except FileNotFoundError:
        print(f"ERROR: no se encontró {LOGO_SRC}", file=sys.stderr)
        sys.exit(1)

    make_asset(logo, 1024, ICON_DST)
    make_asset(logo,  512, SPLASH_DST)
    print("Listo.")

if __name__ == "__main__":
    main()
