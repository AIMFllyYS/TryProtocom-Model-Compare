"""两两比较（pairwise）评分：把“A 和 B 哪个更好”的判断折算成 0–3 分写入 manual_scores.json。

适用于 rubric 里 `judge: pairwise` 的人工项（如造型好不好看、整体观感）。绝对打分对这类项区分度差，
两两比较更稳；多个比较结果用 Bradley–Terry 模型拟合每个作品的强度，再在同一题同一检查项内部线性映射到 0–3。

输入（CSV 或 JSON）每行一次比较：
  task, item_id, a, b, winner(a|b|tie), by(可选), note(可选)
  a / b 可以是盲评别名（alias）或 run_id。
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

from .common import dump_json, load_json
from .runs import alias_map, all_meta, rescore


def bradley_terry(comparisons: list[tuple[str, str, float]], iters: int = 400, prior: float = 0.5) -> dict[str, float]:
    """comparisons: (a, b, score_a)，score_a ∈ {1, 0.5, 0}。返回对数强度（均值为 0）。
    用 MM 迭代；每个对手对加 prior 个虚拟平局，保证无全胜/全败时也收敛。"""
    items = sorted({x for a, b, _ in comparisons for x in (a, b)})
    if not items:
        return {}
    wins: dict[str, float] = defaultdict(float)
    games: dict[tuple[str, str], float] = defaultdict(float)
    for a, b, s in comparisons:
        wins[a] += s
        wins[b] += 1 - s
        key = tuple(sorted((a, b)))
        games[key] += 1
    for a in items:  # 先验：对每个对手一个半场胜负
        for b in items:
            if a < b:
                games[(a, b)] += 2 * prior
                wins[a] += prior
                wins[b] += prior
    p = {i: 1.0 for i in items}
    for _ in range(iters):
        new = {}
        for i in items:
            denom = 0.0
            for (x, y), n in games.items():
                if i == x:
                    denom += n / (p[i] + p[y])
                elif i == y:
                    denom += n / (p[i] + p[x])
            new[i] = wins[i] / denom if denom else p[i]
        g = math.exp(sum(math.log(v) for v in new.values()) / len(new))
        new = {i: v / g for i, v in new.items()}
        delta = max(abs(math.log(new[i]) - math.log(p[i])) for i in items)
        p = new
        if delta < 1e-9:
            break
    return {i: math.log(v) for i, v in p.items()}


def to_scale(strength: dict[str, float]) -> dict[str, float]:
    """强度线性映射到 0–3（同一题同一检查项内部）。只有一个作品或强度全相同则全给 1.5。"""
    if not strength:
        return {}
    lo, hi = min(strength.values()), max(strength.values())
    if hi - lo < 1e-9:
        return {k: 1.5 for k in strength}
    return {k: round(3.0 * (v - lo) / (hi - lo), 2) for k, v in strength.items()}


def _read_rows(path: Path) -> list[dict]:
    if path.suffix.lower() == ".json":
        d = json.loads(path.read_text(encoding="utf-8"))
        return d["comparisons"] if isinstance(d, dict) else d
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def ingest(data: Path, path: Path, by: str = "pairwise") -> dict:
    inv = {v: k for k, v in alias_map(data).items()}
    metas = {m["run_id"]: m for m in all_meta(data)}

    def rid(x: str) -> str | None:
        x = (x or "").strip()
        return x if x in metas else inv.get(x)

    groups: dict[tuple[str, str], list[tuple[str, str, float]]] = defaultdict(list)
    skipped = 0
    for row in _read_rows(path):
        a, b = rid(row.get("a", "")), rid(row.get("b", ""))
        w = (row.get("winner") or "").strip().lower()
        if not a or not b or a == b or w not in ("a", "b", "tie"):
            skipped += 1
            continue
        task = (row.get("task") or metas[a]["task"] + (metas[a].get("variant") or "")).strip()
        groups[(task, row["item_id"].strip())].append((a, b, {"a": 1.0, "b": 0.0, "tie": 0.5}[w]))
    written = 0
    report = {}
    for (task, item), comps in sorted(groups.items()):
        scale = to_scale(bradley_terry(comps))
        report[f"{task}/{item}"] = {"comparisons": len(comps), "runs": len(scale)}
        n_cmp = defaultdict(int)
        for a, b, _ in comps:
            n_cmp[a] += 1
            n_cmp[b] += 1
        for run_id, score in scale.items():
            rd = Path(metas[run_id]["_dir"])
            ms = load_json(rd / "manual_scores.json", {}) or {}
            ms[item] = {"score": score, "by": by, "note": f"两两比较 BT：{n_cmp[run_id]} 次比较，同题 {len(scale)} 个作品内归一化"}
            dump_json(rd / "manual_scores.json", ms)
            written += 1
    for m in metas.values():
        rescore(Path(m["_dir"]))
    return {"written": written, "skipped": skipped, "groups": report}
