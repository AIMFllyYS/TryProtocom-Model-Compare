#!/usr/bin/env python3
"""Create a labeled storyboard/contact sheet from rendered keyframes."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:
    raise SystemExit("Pillow is required: pip install Pillow") from exc


def fit_image(image: Image.Image, width: int, height: int) -> Image.Image:
    image = image.convert("RGB")
    scale = min(width / image.width, height / image.height)
    new_size = (max(1, int(image.width * scale)), max(1, int(image.height * scale)))
    return image.resize(new_size, Image.Resampling.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Directory containing keyframes")
    parser.add_argument("--output", required=True)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--cell-width", type=int, default=480)
    parser.add_argument("--cell-height", type=int, default=300)
    args = parser.parse_args()

    input_dir = Path(args.input).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    images = sorted([p for p in input_dir.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}])
    if not images:
        raise SystemExit(f"No images found in {input_dir}")
    if args.columns < 1:
        raise SystemExit("--columns must be >= 1")

    label_h = 34
    rows = math.ceil(len(images) / args.columns)
    sheet = Image.new("RGB", (args.columns * args.cell_width, rows * (args.cell_height + label_h)), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for i, path in enumerate(images):
        row, col = divmod(i, args.columns)
        x = col * args.cell_width
        y = row * (args.cell_height + label_h)
        image = fit_image(Image.open(path), args.cell_width, args.cell_height)
        px = x + (args.cell_width - image.width) // 2
        py = y + (args.cell_height - image.height) // 2
        sheet.paste(image, (px, py))
        draw.rectangle([x, y, x + args.cell_width - 1, y + args.cell_height + label_h - 1], outline="black", width=1)
        draw.text((x + 8, y + args.cell_height + 9), path.stem, fill="black", font=font)

    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=92)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
