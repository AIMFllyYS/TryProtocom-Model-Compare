#!/usr/bin/env python3
"""Validate a Minecraft stop-motion project manifest and shot list."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Missing required file: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_dir")
    args = parser.parse_args()

    root = Path(args.project_dir).expanduser().resolve()
    project = load_json(root / "project.json")
    shot_doc = load_json(root / "shot-list.json")
    shots = shot_doc.get("shots", [])

    errors: list[str] = []
    warnings: list[str] = []

    required_project = ["title", "theme", "duration_seconds", "output_fps", "animation_fps", "story", "world", "visual_style", "cameras", "audio"]
    for key in required_project:
        if key not in project:
            errors.append(f"project.json missing key: {key}")

    duration = float(project.get("duration_seconds", 0) or 0)
    output_fps = int(project.get("output_fps", 0) or 0)
    animation_fps = int(project.get("animation_fps", 0) or 0)

    if duration <= 0:
        errors.append("duration_seconds must be > 0")
    if output_fps <= 0 or animation_fps <= 0:
        errors.append("output_fps and animation_fps must both be > 0")
    elif output_fps % animation_fps != 0:
        warnings.append("output_fps is not an integer multiple of animation_fps; pose holds may be uneven")

    cameras = {c.get("id") for c in project.get("cameras", []) if isinstance(c, dict)}
    if not cameras:
        errors.append("No camera IDs defined in project.json")

    if not shots:
        errors.append("shot-list.json contains no shots")
    if len(shots) < 6 or len(shots) > 12:
        warnings.append(f"Shot count is {len(shots)}; 6-12 is the normal one-minute range")

    previous_end = 0.0
    required_shot = ["id", "start", "end", "beat", "story_function", "camera_id", "framing", "camera_move", "action", "lighting", "audio"]

    for index, shot in enumerate(shots, start=1):
        sid = shot.get("id", f"index {index}")
        for key in required_shot:
            if key not in shot:
                errors.append(f"{sid} missing key: {key}")
        try:
            start = float(shot.get("start"))
            end = float(shot.get("end"))
        except (TypeError, ValueError):
            errors.append(f"{sid} has invalid start/end")
            continue
        if end <= start:
            errors.append(f"{sid} end must be greater than start")
        if index == 1 and abs(start) > 0.001:
            errors.append(f"{sid} should start at 0.0")
        if index > 1:
            if start > previous_end + 0.001:
                errors.append(f"Gap before {sid}: previous end {previous_end:.3f}, start {start:.3f}")
            if start < previous_end - 0.001:
                errors.append(f"Overlap before {sid}: previous end {previous_end:.3f}, start {start:.3f}")
        previous_end = end
        if shot.get("camera_id") not in cameras:
            errors.append(f"{sid} references undefined camera: {shot.get('camera_id')}")

    if shots and duration > 0 and abs(previous_end - duration) > 0.01:
        errors.append(f"Shot list ends at {previous_end:.3f}s but project duration is {duration:.3f}s")

    story = project.get("story", {})
    for key in ["central_emotion", "protagonist", "goal", "obstacle_or_change", "hero_prop", "ending_feeling"]:
        if not str(story.get(key, "")).strip():
            warnings.append(f"story.{key} is blank")

    for shot in shots:
        if not str(shot.get("action", "")).strip():
            warnings.append(f"{shot.get('id', '?')} action is blank")
        if not str(shot.get("lighting", "")).strip():
            warnings.append(f"{shot.get('id', '?')} lighting is blank")

    print(f"Project: {project.get('title', '')}")
    print(f"Shots: {len(shots)} | Duration: {duration}s | Output: {output_fps} fps | Animation: {animation_fps} fps")

    if warnings:
        print("\nWarnings:")
        for item in warnings:
            print(f"- {item}")
    if errors:
        print("\nErrors:")
        for item in errors:
            print(f"- {item}")
        return 1

    print("\nValidation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
