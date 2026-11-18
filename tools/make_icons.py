#!/usr/bin/env python3
"""
Generates the launcher icon set.

Why this exists: the previous icon shipped an OPAQUE WHITE foreground layer. Android renders an
adaptive icon as background + foreground composited into the launcher's mask, so an opaque
foreground covers the background completely and the tile appears as a blank white square. The
foreground must be transparent everywhere except the mark.

The mark is the app's own: a bold "E" cut from a stem and three timeline bars, with a playhead
notch, drawn in near-black over a teal-to-blue gradient. The notch is what makes it read as a
timeline rather than a letter.
"""
from PIL import Image, ImageDraw
from math import pi

BRAND_TEAL = (58, 217, 198)
BRAND_CYAN = (34, 184, 212)
BRAND_BLUE = (43, 127, 255)
INK = (11, 13, 16)

# Adaptive icon geometry, per Android: the foreground canvas is 108dp with the middle 72dp
# guaranteed visible. The safe radius is 66dp/2, so the mark is kept well inside that.
DENSITIES = {
    "mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0,
}


def gradient(size: int, diagonal: bool = True) -> Image.Image:
    """Three-stop diagonal gradient, drawn once at 1:1 and scaled by the caller."""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2) if diagonal else y / (size - 1)
            if t < 0.5:
                u = t / 0.5
                c = tuple(int(BRAND_TEAL[i] + (BRAND_CYAN[i] - BRAND_TEAL[i]) * u) for i in range(3))
            else:
                u = (t - 0.5) / 0.5
                c = tuple(int(BRAND_CYAN[i] + (BRAND_BLUE[i] - BRAND_CYAN[i]) * u) for i in range(3))
            px[x, y] = (*c, 255)
    return img


def mark(size: int, color=INK) -> Image.Image:
    """
    The EditorsHub mark on a transparent canvas.

    Proportions are expressed as fractions of [size] so the same drawing is pixel-identical at
    every density. The three arms are deliberately unequal: an E with equal arms reads as a
    hamburger menu icon at small sizes.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size
    # Stem and arms occupy the central 56% of the canvas, inside the 72dp safe circle.
    left = 0.22 * s
    right = 0.78 * s
    stem_w = 0.115 * s
    top = 0.235 * s
    bottom = 0.765 * s
    mid = (top + bottom) / 2
    arm_h = 0.105 * s
    top_arm_r = right
    mid_arm_r = right - 0.10 * s
    bot_arm_r = right - 0.03 * s

    # Stem.
    d.rectangle([left, top, left + stem_w, bottom], fill=(*color, 255))
    # Top arm: the longest.
    d.rectangle([left, top, top_arm_r, top + arm_h], fill=(*color, 255))
    # Middle arm: shorter, with the playhead notch cut from its leading edge.
    d.rectangle([left, mid - arm_h / 2, mid_arm_r, mid + arm_h / 2], fill=(*color, 255))
    notch = 0.055 * s
    d.polygon(
        [
            (mid_arm_r, mid - arm_h / 2),
            (mid_arm_r + notch, mid),
            (mid_arm_r, mid + arm_h / 2),
        ],
        fill=(*color, 255),
    )
    # Bottom arm: shortest, so the silhouette is asymmetric and legible small.
    d.rectangle([left, bottom - arm_h, bot_arm_r, bottom], fill=(*color, 255))
    return img


def rounded_tile(size: int, radius_ratio: float = 0.225) -> Image.Image:
    """The legacy (pre-adaptive) icon: gradient tile with the mark, rounded like the platform."""
    base = gradient(size)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    out.alpha_composite(mark(size))
    return out


def circle_tile(size: int) -> Image.Image:
    base = gradient(size)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    out.alpha_composite(mark(size))
    return out


def main():
    import os
    root = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res")
    for density, scale in DENSITIES.items():
        folder = os.path.join(root, f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)
        legacy = int(48 * scale)
        # Adaptive foreground: 108dp at this density, TRANSPARENT except for the mark.
        adaptive = int(108 * scale)

        rounded_tile(legacy).save(os.path.join(folder, "ic_launcher.png"), optimize=True)
        circle_tile(legacy).save(os.path.join(folder, "ic_launcher_round.png"), optimize=True)

        fg = mark(adaptive)
        fg.save(os.path.join(folder, "ic_launcher_foreground.png"), optimize=True)
        print(f"mipmap-{density}: legacy {legacy}px, foreground {adaptive}px")

    # A store-quality render, for the README and the release notes.
    docs = os.path.join(root, "..", "..", "..", "docs", "branding")
    os.makedirs(docs, exist_ok=True)
    rounded_tile(512).save(os.path.join(docs, "editorshub-512.png"), optimize=True)
    circle_tile(512).save(os.path.join(docs, "editorshub-round-512.png"), optimize=True)
    print("docs/branding: 512px renders written")


if __name__ == "__main__":
    main()
