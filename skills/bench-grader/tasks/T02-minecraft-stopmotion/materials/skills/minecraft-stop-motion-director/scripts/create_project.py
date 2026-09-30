#!/usr/bin/env python3
"""Create a working project folder from bundled Minecraft stop-motion templates."""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
from pathlib import Path


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "minecraft-film"


def scale_timeline(destination: Path, duration: float) -> None:
    """Scale default 60-second shot/audio timing to the requested duration."""
    ratio = duration / 60.0

    shot_path = destination / "shot-list.json"
    shot_doc = json.loads(shot_path.read_text(encoding="utf-8"))
    for shot in shot_doc.get("shots", []):
        shot["start"] = round(float(shot["start"]) * ratio, 3)
        shot["end"] = round(float(shot["end"]) * ratio, 3)
    shot_path.write_text(json.dumps(shot_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    cue_path = destination / "audio-cue-sheet.csv"
    rows = []
    with cue_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames
        for row in reader:
            for key in ("time_start", "time_end"):
                row[key] = f"{float(row[key]) * ratio:.3f}"
            rows.append(row)
    with cue_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", required=True)
    parser.add_argument("--theme", required=True)
    parser.add_argument("--out", required=True, help="Parent directory for the project")
    parser.add_argument("--duration", type=float, default=60.0)
    parser.add_argument("--output-fps", type=int, default=24)
    parser.add_argument("--animation-fps", type=int, default=12)
    args = parser.parse_args()

    if args.duration <= 0:
        raise SystemExit("--duration must be > 0")
    if args.output_fps <= 0 or args.animation_fps <= 0:
        raise SystemExit("--output-fps and --animation-fps must be > 0")

    skill_root = Path(__file__).resolve().parents[1]
    template = skill_root / "assets" / "project-template"
    destination = Path(args.out).expanduser().resolve() / slugify(args.title)

    if destination.exists() and any(destination.iterdir()):
        raise SystemExit(f"Destination is not empty: {destination}")

    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(template, destination, dirs_exist_ok=True)

    project_path = destination / "project.json"
    project = json.loads(project_path.read_text(encoding="utf-8"))
    project["title"] = args.title
    project["theme"] = args.theme
    project["duration_seconds"] = args.duration
    project["output_fps"] = args.output_fps
    project["animation_fps"] = args.animation_fps
    project_path.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    scale_timeline(destination, args.duration)

    for filename in ["qc-report.md", "delivery-manifest.json"]:
        path = destination / filename
        text = path.read_text(encoding="utf-8").replace("PROJECT_TITLE", args.title)
        path.write_text(text, encoding="utf-8")

    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
