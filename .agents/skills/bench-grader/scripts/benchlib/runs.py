"""运行目录管理：登记运行、加载、评分入口。"""
from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from datetime import date
from pathlib import Path

from .common import Metrics, RunContext, bench_config, dump_json, load_json, load_rubric
from .probes import REGISTRY
from .scoring import load_manual, score_run


def runs_dir(data: Path) -> Path:
    return data / "runs"


def init_run(data: Path, task: str, model: str, harness: str, src: Path, variant: str | None = None,
             run_index: int | None = None, final_message: Path | None = None, workspace: str | None = None,
             started_at: str | None = None, ended_at: str | None = None, extra: dict | None = None) -> Path:
    rid = f"{task}{variant or ''}-{uuid.uuid4().hex[:8]}"
    rd = runs_dir(data) / rid
    (rd / "output").mkdir(parents=True)
    src = Path(src)
    if src.is_dir():
        shutil.copytree(src, rd / "output" / src.name, ignore=shutil.ignore_patterns("node_modules", ".git", "__pycache__", ".venv"))
    else:
        shutil.copy(src, rd / "output" / src.name)
    if final_message:
        shutil.copy(final_message, rd / "final_message.md")
    if run_index is None:
        run_index = 1 + sum(1 for m in all_meta(data) if m["task"] == task and m.get("variant") == variant and m["model"] == model and m["harness"] == harness)
    meta = {"run_id": rid, "task": task, "variant": variant, "model": model, "harness": harness, "run_index": run_index,
            "date": date.today().isoformat(), "workspace": workspace, "started_at": started_at, "ended_at": ended_at,
            "usage": {}, "failure_tag": None, "notes": ""}
    meta.update(extra or {})
    dump_json(rd / "meta.json", meta)
    return rd


def all_meta(data: Path) -> list[dict]:
    out = []
    rd = runs_dir(data)
    if not rd.exists():
        return out
    for d in sorted(rd.iterdir()):
        m = load_json(d / "meta.json")
        if m:
            m["_dir"] = str(d)
            out.append(m)
    return out


def grade_run(run_dir: Path, fast: bool = False, only: list[str] | None = None) -> dict:
    meta = load_json(run_dir / "meta.json")
    rubric = load_rubric(meta["task"])
    cfg = bench_config()
    old = load_json(run_dir / "metrics.json")
    metrics = Metrics.from_dict(old) if (old and only) else Metrics()
    ctx = RunContext(run_dir=run_dir, meta=meta, rubric=rubric, cfg=cfg, metrics=metrics, fast=fast)
    probes = [p for p in rubric.get("probes", []) if not only or p["type"] in only]
    for i, p in enumerate(probes, 1):
        # 进度行：工作台据此显示“探针 i/n · 类型”（flush：stdout 接管道时默认整块缓冲）
        print(f"[probe {i}/{len(probes)}] {p['type']} {meta['run_id']}", flush=True)
        fn = REGISTRY[p["type"]]
        try:
            fn(ctx, p.get("opts") or {})
        except Exception as e:  # noqa: BLE001
            metrics.notes.append(f"probe {p['type']} crashed: {type(e).__name__}: {e}")
    dump_json(run_dir / "metrics.json", metrics.to_dict())
    return rescore(run_dir)


def rescore(run_dir: Path) -> dict:
    meta = load_json(run_dir / "meta.json")
    rubric = load_rubric(meta["task"])
    metrics = Metrics.from_dict(load_json(run_dir / "metrics.json", {}) or {})
    sc = score_run(rubric, metrics, load_manual(run_dir), meta.get("variant"))
    sc["run_id"] = meta["run_id"]
    dump_json(run_dir / "score.json", sc)
    return sc


def alias_map(data: Path) -> dict:
    path = data / "review" / "aliases.json"
    cur = load_json(path, {}) or {}
    metas = all_meta(data)
    prefix = bench_config().get("blinding", {}).get("alias_prefix", "R")
    new = [m["run_id"] for m in metas if m["run_id"] not in cur]
    new.sort(key=lambda r: hashlib.sha1(r.encode()).hexdigest())
    n = len(cur)
    for r in new:
        n += 1
        cur[r] = f"{prefix}{n:03d}"
    dump_json(path, cur)
    return cur
