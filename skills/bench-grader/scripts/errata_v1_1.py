#!/usr/bin/env python3
"""v1.1 勘误：在临时副本里重评受评分器缺陷影响的 v1 运行，不改动冻结的原始分。

用法：
  python scripts/errata_v1_1.py --data bench-data --out data/v1.1-errata.json            # 自动挑选受影响运行
  python scripts/errata_v1_1.py --data bench-data --runs T08-e07a546b T03A-d0de04cf       # 指定运行

自动挑选规则（只挑“评分器缺陷”造成的门槛失败，不挑模型本身的失败）：
  - T03A 的 G3 失败，且该运行源码在剥离注释后并没有真实使用 hyperframes/remotion；
  - 门槛 G1 失败且 metrics 里 api.started 为 False，同时服务日志显示 python3 无法解析（Microsoft Store 别名）。

输出的每条记录同时保留原始分与勘误分，榜单“历史版”继续显示原始分，勘误分只作为 v1.1 附注。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from benchlib import runs  # noqa: E402
from benchlib.common import load_json  # noqa: E402

REASONS = {
    "G3": "T03A G3 门槛把注释和 window.__hf 的说明文字当成“使用了视频框架”（评分器缺陷，已改为只统计真实依赖）",
    "G1-python3": "评测机 python3 指向 Microsoft Store 别名，服务未被真正启动（评分器环境缺陷，已自动补 python3 别名）",
}


def _affected(rd: Path) -> str | None:
    meta = load_json(rd / "meta.json") or {}
    score = load_json(rd / "score.json") or {}
    if score.get("gate_pass", True):
        return None
    ids = {g["id"] for g in score.get("gate_fail", [])}
    if meta.get("task") == "T03" and meta.get("variant") == "A" and "G3" in ids:
        from benchlib.probes.static import usage_hits, TEXT_EXT
        out = rd / "output"
        hits = 0
        for p in out.rglob("*"):
            if p.is_file() and p.suffix.lower() in TEXT_EXT and p.suffix.lower() != ".md" and "node_modules" not in p.parts:
                hits += usage_hits(p.read_text(encoding="utf-8", errors="replace"), "hyperframes|remotion", p.suffix.lower())
        return "G3" if hits == 0 else None
    if "G1" in ids and (load_json(rd / "metrics.json") or {}).get("values", {}).get("api.started") is False:
        log = rd / "_grading" / "server.log"
        text = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
        if "Python was not found" in text:
            return "G1-python3"
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="bench-data")
    ap.add_argument("--out", default="data/v1.1-errata.json")
    ap.add_argument("--runs", nargs="*")
    a = ap.parse_args()
    data = Path(a.data).resolve()
    metas = runs.all_meta(data)
    targets = []
    for m in metas:
        rd = Path(m["_dir"])
        if a.runs and m["run_id"] not in a.runs:
            continue
        reason = _affected(rd) if not a.runs else (_affected(rd) or "manual")
        if reason:
            targets.append((m, reason))
    # 已经在 bench-data 里被重评修复的 python3 别名受害者：只登记，不再重评。
    already = []
    for m in metas:
        rd = Path(m["_dir"])
        log = rd / "_grading" / "server.log"
        score = load_json(rd / "score.json") or {}
        if log.exists() and score.get("gate_pass") and "Python was not found" in log.read_text(encoding="utf-8", errors="replace"):
            already.append({"run_id": m["run_id"], "task": m["task"], "model": m["model"], "run_index": m["run_index"],
                            "current_total": score.get("total"), "reason": "G1-python3",
                            "note": "旧服务日志仍有 Store 别名报错，但该运行已在修复后重评并入库，无需再次处理。"})
    if not targets and not already:
        print("没有受影响的运行")
        return 0
    records = []
    with tempfile.TemporaryDirectory(prefix="bench-errata-") as tmp:
        tmp_data = Path(tmp) / "bench-data"
        for m, reason in targets:
            src = Path(m["_dir"])
            dst = tmp_data / "runs" / m["run_id"]
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", ".git", "__pycache__"))
            before = load_json(src / "score.json")
            only = ["files"] if reason == "G3" else None
            after = runs.grade_run(dst, fast=True, only=only)
            records.append({
                "run_id": m["run_id"], "task": m["task"], "variant": m.get("variant"), "model": m["model"],
                "harness": m["harness"], "run_index": m["run_index"], "reason": reason,
                "reason_text": REASONS.get(reason, "手动指定"),
                "original": {"total": before.get("total"), "gate_pass": before.get("gate_pass"),
                             "gate_fail": [g["id"] for g in before.get("gate_fail", [])], "dims": before.get("dims")},
                "corrected": {"total": after.get("total"), "gate_pass": after.get("gate_pass"),
                              "gate_fail": [g["id"] for g in after.get("gate_fail", [])], "dims": after.get("dims"),
                              "pending": len(after.get("pending", [])), "na_ratio": after.get("na_ratio")},
            })
            print(f"{m['run_id']:<18} {m['model']:<28} {before.get('total')} -> {after.get('total')} ({reason})", flush=True)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": "v1.1-errata", "generated_at": datetime.now(timezone.utc).isoformat(),
               "note": "原始分保持冻结；勘误分只在榜单“历史版”以 v1.1 附注显示。", "runs": records, "already_corrected": already}
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("写入", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
