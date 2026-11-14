"""人工 1–10：旧 0–3 仍除以 3；新档除以 10；改分不重写已落盘的自动项。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib.common import dump_json, load_rubric, task_dirs  # noqa: E402
from benchlib.human_levels import levels_for, load_levels  # noqa: E402
from benchlib.scoring import Metrics, score_run  # noqa: E402
from benchlib import runs  # noqa: E402


def _rubric():
    return {"dims": {"x": 1}, "items": [
        {"id": "H", "dim": "x", "tier": "basic", "method": "human", "desc": "d", "anchors": ["a", "b", "c", "d"]},
        {"id": "A", "dim": "x", "tier": "basic", "method": "agent", "desc": "d", "anchors": ["a", "b", "c", "d"]},
        {"id": "P", "dim": "x", "tier": "basic", "method": "auto", "desc": "d", "metric": "p.ok", "rule": {"type": "bool"}},
    ]}


def _metrics():
    return Metrics.from_dict({"values": {}, "na": {}, "artifacts": {}, "notes": []})


def test_legacy_human_still_divides_by_three():
    sc = score_run(_rubric(), _metrics(), {"H": {"score": 2, "by": "human"}})
    assert sc["items"][0]["s"] == pytest.approx(2 / 3)


def test_human10_divides_by_ten():
    sc = score_run(_rubric(), _metrics(), {"H": {"score": 7, "scale": "human-10", "by": "human"}})
    item = next(i for i in sc["items"] if i["id"] == "H")
    assert item["s"] == pytest.approx(0.7)
    assert item["value"] == 7


def test_agent_ignores_human10_scale():
    sc = score_run(_rubric(), _metrics(), {"A": {"score": 3, "scale": "human-10", "by": "agent"}})
    item = next(i for i in sc["items"] if i["id"] == "A")
    assert item["s"] == pytest.approx(1.0)


def test_frozen_auto_survives_human_rescore(tmp_path: Path):
    rd = tmp_path / "runs" / "V01-test0001"
    rd.mkdir(parents=True)
    dump_json(rd / "meta.json", {"run_id": rd.name, "task": "V01", "variant": None})
    dump_json(rd / "metrics.json", {"values": {}, "na": {}, "artifacts": {}, "notes": []})
    dump_json(rd / "manual_scores.json", {})
    old_auto = {"id": "V01-M01", "dim": "3d", "tier": "basic", "method": "auto", "weight": 1,
                "desc": "kept", "status": "scored", "s": 0.25, "edition": "base", "module": None}
    dump_json(rd / "score.json", {"total": 10, "run_id": rd.name, "items": [old_auto], "pending": [],
                                  "gate_fail": [], "tier0_pass": True, "tier0_fail": [], "scorer_version": "legacy-1"})
    dump_json(rd / "manual_scores.json", {"V01-H05": {"score": 7, "scale": "human-10", "by": "human"}})
    sc = runs.rescore(rd, persist=False, preserve_auto=True)
    kept = next(i for i in sc["items"] if i["id"] == "V01-M01")
    assert kept["s"] == 0.25
    human = next(i for i in sc["items"] if i["id"] == "V01-H05")
    assert human["s"] == pytest.approx(0.7)
    assert sc["scorer_version"] == "legacy-1"
    assert sc["auto_preserved"] is True


def test_every_human_item_has_ten_levels_and_original_anchors():
    load_levels.cache_clear()
    n = 0
    for tid in task_dirs():
        rub = load_rubric(tid)
        for it in rub.get("items", []):
            if it.get("method") != "human":
                continue
            n += 1
            levels = levels_for(it)
            assert len(levels) == 10, it["id"]
            anchors = it.get("anchors") or []
            assert anchors == [levels[1], levels[3], levels[5], levels[9]], it["id"]
            assert len(set(levels)) == 10, it["id"]
    assert n >= 100
