"""v2 榜单视图：历史版 / 简化版（取最高）/ 完整版（测满 3 次 + 稳定性）。

- 历史版（history）：v1.0 冻结数据，口径与此前完全一致。
- 简化版（simple）：每个参赛者每题取已测运行中的最高分；榜单标注 n（用了几次）。重测只用于“事故”。
- 完整版（full）：只收每道 v2 题都测满 `v2.full_runs` 次的参赛者；失误计入稳定性，不剔除。

稳定性 = 可用率权重 × 可用率 + 一致性权重 × 一致性
  可用率 = Tier0 通过的运行占比（没有 Tier0 的题退化为“门槛通过且总分 > 0”）
  一致性 = 100 − k × 各题运行分标准差的均值（只统计有 ≥ 2 次运行的题），截断到 0–100
"""
from __future__ import annotations

import statistics as st
from collections import defaultdict

from .common import load_rubric, task_dirs

VIEWS = ("history", "simple", "full")
V1_VERSION = "v1.0"


def version_of(meta: dict) -> str:
    return meta.get("benchmark_version") or V1_VERSION


def is_v2(meta: dict) -> bool:
    return str(version_of(meta)).lower().startswith("v2")


def suite_of(task_id: str) -> str:
    try:
        return str(load_rubric(task_id).get("suite") or "v1")
    except KeyError:
        return "v1"


def suite_tasks(suite: str) -> list[str]:
    return [tid for tid in task_dirs() if suite_of(tid) == suite]


def required_tkeys(suite: str = "v2") -> list[str]:
    """某个题库要求测满的 tkey（T03 这类带 A/C 变体的题展开成 T03A / T03C）。"""
    keys: list[str] = []
    for tid in suite_tasks(suite):
        variants = load_rubric(tid).get("variants") or {}
        keys.extend([tid + v for v in variants] if variants else [tid])
    return keys


def _tier0_ok(score: dict) -> bool:
    t0 = score.get("tier0_pass")
    if t0 is None:
        return bool(score.get("gate_pass")) and (score.get("total") or 0) > 0
    return bool(t0) and bool(score.get("gate_pass", True))


def stability(runs_by_task: dict[str, list[dict]], cfg: dict) -> dict:
    sc = (cfg.get("v2") or {}).get("stability") or {}
    wa, wc, k = float(sc.get("availability_weight", 0.5)), float(sc.get("consistency_weight", 0.5)), float(sc.get("consistency_k", 2.0))
    allruns = [r for rs in runs_by_task.values() for r in rs]
    if not allruns:
        return {"stability": None, "availability": None, "consistency": None, "incidents": 0}
    avail = 100.0 * sum(1 for r in allruns if _tier0_ok(r["score"])) / len(allruns)
    sds = [st.pstdev([r["score"]["total"] for r in rs]) for rs in runs_by_task.values() if len(rs) >= 2]
    cons = max(0.0, min(100.0, 100.0 - k * (sum(sds) / len(sds)))) if sds else None
    if cons is None:
        value = None
    else:
        value = round((wa * avail + wc * cons) / (wa + wc), 1)
    return {"stability": value, "availability": round(avail, 1), "consistency": round(cons, 1) if cons is not None else None,
            "incidents": sum(1 for r in allruns if r["meta"].get("incident"))}


def apply_view(runs: list[dict], view: str, cfg: dict) -> tuple[list[dict], dict]:
    """runs: [{meta, score, usage, entrant, tkey}]；返回 (该视图使用的运行, 附加信息)。"""
    if view not in VIEWS:
        raise ValueError(f"unknown view {view!r}; expected one of {VIEWS}")
    if view == "history":
        return [r for r in runs if not is_v2(r["meta"])], {"entrants": {}, "excluded": []}
    v2runs = [r for r in runs if is_v2(r["meta"]) and not r["meta"].get("discarded")]
    by = defaultdict(list)
    for r in v2runs:
        by[(r["entrant"], r["tkey"])].append(r)
    for rs in by.values():
        rs.sort(key=lambda r: (r["meta"].get("run_index") or 0, r["meta"].get("run_id", "")))
    info: dict = {"entrants": {}, "excluded": []}
    entrants = sorted({r["entrant"] for r in v2runs})
    if view == "simple":
        out = []
        for e in entrants:
            ns, retries = [], 0
            for (ee, tk), rs in sorted(by.items()):
                if ee != e:
                    continue
                best = max(rs, key=lambda r: (r["score"]["total"], -(r["meta"].get("run_index") or 0)))
                out.append({**best, "n_used": len(rs)})
                ns.append(len(rs))
                retries += sum(1 for r in rs if r["meta"].get("incident"))
            info["entrants"][e] = {"n_min": min(ns), "n_max": max(ns), "star": max(ns) > 1, "incident_retries": retries}
        return out, info
    # full
    need = int((cfg.get("v2") or {}).get("full_runs", 3))
    required = required_tkeys("v2") or sorted({r["tkey"] for r in v2runs})
    out = []
    for e in entrants:
        missing = [f"{tk}（{len(by.get((e, tk), []))}/{need}）" for tk in required if len(by.get((e, tk), [])) < need]
        if missing:
            info["excluded"].append({"entrant": e, "missing": missing})
            continue
        picked = {tk: by[(e, tk)][:need] for tk in required}  # 只取前 need 次，避免“多测挑好的”
        for rs in picked.values():
            out.extend(rs)
        info["entrants"][e] = stability(picked, cfg)
    return out, info
