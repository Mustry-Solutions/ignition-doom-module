#!/usr/bin/env python3
"""Assemble docs/images/control-room.gif from the frames the screenshot job
wrote (e2e/tests/screenshots.spec.ts, "control room clip frames").

    SCREENSHOTS=1 npx playwright test screenshots -g 'clip frames'   # in e2e/
    python3 ops/make-gif.py

Pillow only; no ffmpeg. Frames are downscaled and quantised to keep the GIF
small enough for a README (GitHub will not animate above ~10 MB and nobody
should wait for that anyway).
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "docs" / "images" / "clip"
OUT = ROOT / "docs" / "images" / "control-room.gif"
WIDTH = 820
MS_PER_FRAME = 200
MAX_BYTES = 6 * 1024 * 1024


def main() -> int:
    files = sorted(FRAMES.glob("*.png"))
    if not files:
        print(f"no frames in {FRAMES}; run the screenshot job first", file=sys.stderr)
        return 1
    images = []
    for f in files:
        im = Image.open(f).convert("RGB")
        if im.width > WIDTH:
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        images.append(im.quantize(colors=96, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG))
    images[0].save(OUT, save_all=True, append_images=images[1:], duration=MS_PER_FRAME,
                   loop=0, optimize=True, disposal=2)
    size = OUT.stat().st_size
    print(f"{OUT.relative_to(ROOT)}: {len(images)} frames, {size / 1024:.0f} KB")
    if size > MAX_BYTES:
        print(f"warning: {size / 1024 / 1024:.1f} MB is too big for a README", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
