"""Draw the raster brand pictures from the Lumora mark and the app icons."""
import io
import sys

import resvg_py
from PIL import Image

root = sys.argv[1]
mark_svg = open(f"{root}/docs/img/lumora-mark.svg").read()


def render(svg: str, size: int) -> Image.Image:
    data = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    return Image.open(io.BytesIO(bytes(data))).convert("RGBA")


def tile(size: int, bg: str, inset: float) -> Image.Image:
    """The mark centered on a solid square (no rounding: the system rounds it)."""
    out = Image.new("RGBA", (size, size), bg)
    m = round(size * (1 - 2 * inset))
    mk = render(mark_svg, m)
    off = (size - m) // 2
    out.alpha_composite(mk, (off, off))
    return out


# Website and email: the plain mark, and the favicons.
render(mark_svg, 96).save(f"{root}/docs/img/lumora-mark-96.png", optimize=True)
render(mark_svg, 192).save(f"{root}/docs/img/lumora-mark-192.png", optimize=True)
render(mark_svg, 32).save(f"{root}/docs/img/favicon-32.png", optimize=True)
tile(180, "#15171b", 0.14).convert("RGB").save(f"{root}/docs/img/apple-touch-icon.png", optimize=True)


def installer_images(app_dir: str) -> None:
    icon = Image.open(f"{app_dir}/icons/icon.png").convert("RGBA")
    # Welcome and finish pages: the app's icon on the app's dark gray.
    side = Image.new("RGBA", (164, 314), "#15171b")
    ic = icon.resize((104, 104), Image.LANCZOS)
    side.alpha_composite(ic, ((164 - 104) // 2, 70))
    side.convert("RGB").save(f"{app_dir}/icons/nsis-sidebar.bmp")
    # The other pages' header strip (white in the Windows installer look; Tauri puts it at the left).
    head = Image.new("RGBA", (150, 57), "#ffffff")
    ic = icon.resize((45, 45), Image.LANCZOS)
    head.alpha_composite(ic, ((150 - 45) // 2, 6))
    head.convert("RGB").save(f"{app_dir}/icons/nsis-header.bmp")


installer_images(f"{root}/src-tauri")
installer_images(f"{root}/editor/src-tauri")

# Previews to look at (not part of the repo).
prev = sys.argv[2]
for name in ["category", "icon"]:
    svg = open(f"{root}/streamdeck/com.lumora.streamdeck.sdPlugin/imgs/plugin/{name}.svg").read()
    im = render(svg, 112 if name == "category" else 256)
    bg = Image.new("RGBA", im.size, "#2d2d2d")
    bg.alpha_composite(im)
    bg.save(f"{prev}/sd-{name}.png")
print("ok")
