"""Agent 验收的数据侧支持：探索报告导入、Agent 打分抽检样本、Agent↔人工校准。

校准的数据来源是 manual_scores.json：Agent 先给分（by=agent），人工复核后覆盖（by=human）时，
被覆盖的 Agent 分保存在 `agent_score`，所以“Agent 与人工的一致程度”可以在日常复核中自然积累，不需要另做一轮。
"""
from __future__ import annotations

import csv
import hashlib
import json
import shutil
from collections import defaultdict
from pathlib import Path

from .common import dump_json, load_json
from .runs import alias_map, all_meta, rescore


def keep_agent_score(prev: dict | None, new: dict) -> dict:
    """人工覆盖 Agent 分时，把 Agent 的原分留在 agent_score 里（再次覆盖也不丢）。"""
    if not prev:
        return new
    if prev.get("agent_score") is not None:
        new["agent_score"] = prev["agent_score"]
    elif prev.get("by") == "agent" and new.get("by") != "agent":
        new["agent_score"] = prev.get("score")
    return new


EXPLORE_KEYS = ("controls_total", "controls_tried", "controls_failed", "crashes", "critical")


def ingest_exploration(data: Path, src: Path | None = None) -> dict:
    """把 review/exploration/<别名>.json（以及同名 .md）导入对应运行的 explore.json / explore.md。"""
    src = src or (data / "review" / "exploration")
    inv = {v: k for k, v in alias_map(data).items()}
    done, skipped = [], []
    for f in sorted(src.glob("*.json")) if src.exists() else []:
        rid = inv.get(f.stem)
        d = load_json(f)
        if not rid or not isinstance(d, dict):
            skipped.append(f.name)
            continue
        if int(d.get("controls_tried", 0) or 0) < 1:
            skipped.append(f.name + "（controls_tried 必须 ≥ 1）")
            continue
        rd = data / "runs" / rid
        dump_json(rd / "explore.json", {k: d.get(k, 0) for k in EXPLORE_KEYS} | {"findings": d.get("findings", [])})
        md = f.with_suffix(".md")
        if md.exists():
            shutil.copy(md, rd / "explore.md")
        done.append(rid)
    for rid in done:
        rescore(data / "runs" / rid)
    return {"imported": done, "skipped": skipped}


def audit_sample(data: Path, rate: float = 0.2) -> list[dict]:
    """从全部 Agent 已打分条目里，按确定性哈希抽 rate 比例请人工复核（同输入同样本，可复现）。"""
    aliases = alias_map(data)
    rows = []
    for meta in all_meta(data):
        rd = Path(meta["_dir"])
        ms = load_json(rd / "manual_scores.json", {}) or {}
        for item, e in ms.items():
            if e.get("by") != "agent":
                continue
            h = int(hashlib.sha1(f"{meta['run_id']}|{item}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
            if h < rate:
                rows.append({"alias": aliases.get(meta["run_id"], meta["run_id"]), "item_id": item,
                             "agent_score": e.get("score"), "score": "", "note": ""})
    rows.sort(key=lambda r: (r["alias"], r["item_id"]))
    out = data / "review" / "agent_audit_sample.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["alias", "item_id", "agent_score", "score", "note"])
        w.writeheader()
        w.writerows(rows)
    return rows


def _kappa(pairs: list[tuple[int, int]], k: int = 4) -> float | None:
    """二次加权 Cohen's kappa（0–3 四档）。"""
    n = len(pairs)
    if n < 2:
        return None
    obs = [[0] * k for _ in range(k)]
    for a, b in pairs:
        obs[a][b] += 1
    ra = [sum(obs[i]) for i in range(k)]
    cb = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    w = lambda i, j: ((i - j) / (k - 1)) ** 2
    num = sum(w(i, j) * obs[i][j] for i in range(k) for j in range(k)) / n
    den = sum(w(i, j) * ra[i] * cb[j] for i in range(k) for j in range(k)) / (n * n)
    if den == 0:
        return None
    return round(1 - num / den, 3)


def calibration(data: Path, min_pairs: int = 20) -> dict:
    """统计 Agent 分与人工复核分的一致程度，按板块（条目 id 里的模块）细分，给出是否可信的结论。"""
    pairs: list[tuple[str, float, float]] = []
    agent_total = 0
    for meta in all_meta(data):
        ms = load_json(Path(meta["_dir"]) / "manual_scores.json", {}) or {}
        for item, e in ms.items():
            if e.get("by") == "agent":
                agent_total += 1
            if e.get("by") == "human" and e.get("agent_score") is not None:
                pairs.append((item, float(e["agent_score"]), float(e["score"])))
    n = len(pairs)
    res: dict = {"agent_scored_pending_audit": agent_total, "audited_pairs": n, "min_pairs": min_pairs}
    if not n:
        res["verdict"] = "尚无复核样本：先用 audit_sample 抽样请人工复核"
        return res
    diffs = [a - h for _, a, h in pairs]
    ints = [(min(3, max(0, round(a))), min(3, max(0, round(h)))) for _, a, h in pairs]
    res["exact"] = round(sum(1 for a, h in ints if a == h) / n, 3)
    res["within_1"] = round(sum(1 for a, h in ints if abs(a - h) <= 1) / n, 3)
    res["mean_abs_diff"] = round(sum(abs(d) for d in diffs) / n, 3)
    res["bias"] = round(sum(diffs) / n, 3)  # >0：Agent 偏宽松
    res["kappa_w"] = _kappa(ints)
    by_item: dict[str, list[float]] = defaultdict(list)
    for item, a, h in pairs:
        by_item[item.split("-", 1)[-1]].append(abs(a - h))
    res["worst_items"] = sorted(((k, round(sum(v) / len(v), 2), len(v)) for k, v in by_item.items()),
                                key=lambda x: -x[1])[:5]
    if n < min_pairs:
        res["verdict"] = f"样本不足（{n}/{min_pairs}），结论仅供参考"
    elif res["mean_abs_diff"] <= 0.4 and (res["kappa_w"] or 0) >= 0.6 and abs(res["bias"]) <= 0.25:
        res["verdict"] = "Agent 分可用：与人工一致且无明显宽严偏差"
    elif abs(res["bias"]) > 0.25:
        res["verdict"] = "Agent 有系统性" + ("宽松" if res["bias"] > 0 else "严苛") + "偏差：先修正 anchors/提示再继续"
    else:
        res["verdict"] = "Agent 与人工分歧偏大：Agent 项降级为‘建议分’，以人工复核为准"
    return res


def print_calibration(res: dict) -> None:
    print(json.dumps(res, ensure_ascii=False, indent=1))
