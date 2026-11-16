#!/usr/bin/env python3
"""
Draws the EditorsHub launcher artwork.

The upstream artwork was an `M` wordmark borrowed with the engine; the app needs its own
mark. It is drawn here instead of being stored as a bitmap so every density comes from the
same geometry: a blocky `E` monogram with chamfered right corners, filled with the app's
teal-to-blue gradient on the studio-black backdrop from `values/colors.xml`.

    python3 tools/render-icons.py

Writes `app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png`.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "app" / "src" / "main" / "res"

# Sizes in dp, multiplied by the density factor. Adaptive foregrounds carry a 108dp canvas
# with the mark inside the 72dp safe zone, which is what `ic_launcher_foreground` expects.
DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
SUPERSAMPLE = 8
BACKGROUND = (0, 0, 0, 255)
TEAL = (86, 207, 191)
BLUE = (46, 107, 255)


def mark_shapes() -> list[tuple[float, float, float, float]]:
    """The `E` bars in unit space, top-left origin."""
    return [
        (0.24, 0.22, 0.40, 0.78),  # stem
        (0.40, 0.22, 0.72, 0.38),  # top arm
        (0.40, 0.42, 0.62, 0.58),  # middle arm
        (0.40, 0.62, 0.72, 0.78),  # bottom arm
    ]


def gradient(size: int) -> Image.Image:
    """Vertical teal-to-blue ramp, matching the accent colours of the editor skin."""
    column = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        column.putpixel((0, y), tuple(round(TEAL[i] + (BLUE[i] - TEAL[i]) * t) for i in range(3)))
    return column.resize((size, size), Image.BILINEAR)


def draw_mark(canvas: int, inset: float) -> Image.Image:
    """The monogram on a transparent canvas, occupying `1 - 2 * inset` of the square."""
    big = canvas * SUPERSAMPLE
    shape = Image.new("L", (big, big), 0)
    pen = ImageDraw.Draw(shape)
    span = big * (1 - 2 * inset)
    origin = big * inset
    for left, top, right, bottom in mark_shapes():
        pen.rectangle(
            [origin + left * span, origin + top * span,
             origin + right * span, origin + bottom * span],
            fill=255,
        )
    # A single 45-degree cut on the two outer arm tips keeps the mark from reading as a
    # plain letter block at small sizes.
    for corner in ((0.72, 0.22, -1), (0.72, 0.62, -1)):
        pen.polygon([(origin + corner[0] * span, origin + corner[1] * span),
                     (origin + (corner[0] + 0.10) * span, origin + corner[1] * span),
                     (origin + corner[0] * span, origin + (corner[1] + 0.16) * span)], fill=0)

    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    layer.paste(gradient(big).convert("RGBA"), (0, 0), shape)
    return layer.resize((canvas, canvas), Image.LANCZOS)


def launcher(size: int, round_icon: bool) -> Image.Image:
    art = Image.new("RGBA", (size, size), BACKGROUND)
    glyph = draw_mark(size, inset=0.12)
    art.paste(glyph, (0, 0), glyph)
    if not round_icon:
        return art
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(art, (0, 0), mask)
    return out


def foreground(size: int) -> Image.Image:
    """Adaptive foreground: transparent, mark inside the safe zone."""
    return draw_mark(size, inset=0.255)


def main() -> int:
    for name, factor in DENSITIES.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        side = round(48 * factor)
        launcher(side, round_icon=False).save(folder / "ic_launcher.png")
        launcher(side, round_icon=True).save(folder / "ic_launcher_round.png")
        foreground(round(108 * factor)).save(folder / "ic_launcher_foreground.png")
    print("icons written to", RES.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
