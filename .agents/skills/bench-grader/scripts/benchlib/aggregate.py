"""汇总：运行 → 题目 → 维度 → 参赛者（模型 @ harness）；效率、稳定性、置信区间、题目分析、skill 增益。"""
from __future__ import annotations

import math
import random
import statistics as st
from collections import defaultdict
from pathlib import Path

from .common import bench_config, dimensions, dump_json, load_json, load_rubric, task_dirs
from .runs import all_meta, rescore
from .usage import resolve_usage


def entrant(meta: dict) -> str:
    return f"{meta['model']} @ {meta['harness']}"


def task_key(meta: dict) -> str:
    return meta["task"] + (meta.get("variant") or "")


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _sd(xs):
    xs = [x for x in xs if x is not None]
    return st.pstdev(xs) if len(xs) > 1 else 0.0


def _log_score(value: float | None, best: float, worst: float) -> float | None:
    if value is None:
        return None
    if value == math.inf:
        return 0.0
    v = max(value, 1e-9)
    s = (math.log10(worst) - math.log10(v)) / (math.log10(worst) - math.log10(best))
    return round(100 * max(0.0, min(1.0, s)), 1)


def collect(data: Path) -> dict:
    cfg = bench_config()
    dims = dimensions()
    qdims = [d for d in dims if d["kind"] == "quality"]
    runs = []
    for meta in all_meta(data):
        rd = Path(meta["_dir"])
        sc = rescore(rd)
        u = resolve_usage(meta, cfg)
        runs.append({"meta": meta, "score": sc, "usage": u, "entrant": entrant(meta), "tkey": task_key(meta)})

    by_et = defaultdict(list)
    for r in runs:
        by_et[(r["entrant"], r["tkey"])].append(r)
    entrants = sorted({r["entrant"] for r in runs})
    tkeys = sorted({r["tkey"] for r in runs})

    task_rows = []
    for (e, tk), rs in sorted(by_et.items()):
        totals = [r["score"]["total"] for r in rs]
        passed = [r["score"]["passed"] for r in rs]
        costs = [r["usage"].get("cost_usd") for r in rs]
        mins = [r["usage"].get("active_min", r["usage"].get("wall_min")) for r in rs]
        pr = sum(passed) / len(passed)
        mc, mm = _mean(costs), _mean(mins)
        row = {
            "entrant": e, "task": tk, "runs": len(rs), "mean": round(_mean(totals), 2), "sd": round(_sd(totals), 2),
            "min": min(totals), "max": max(totals), "pass_rate": round(pr, 3), "pass_at_k": any(passed),
            "gate_fail_runs": sum(1 for r in rs if not r["score"]["gate_pass"]),
            "complete": all(r["score"]["complete"] for r in rs),
            "low_confidence": any(r["score"]["low_confidence"] for r in rs),
            "mean_cost_usd": round(mc, 4) if mc is not None else None,
            "mean_min": round(mm, 2) if mm is not None else None,
            "exp_cost_usd": (round(mc / pr, 4) if pr > 0 else math.inf) if mc is not None else None,
            "exp_min": (round(mm / pr, 2) if pr > 0 else math.inf) if mm is not None else None,
            "dims": {}, "dim_weights": rs[0]["score"]["dim_weights"],
            "tiers": {t: _mean([r["score"]["tiers"].get(t) for r in rs]) for t in ("basic", "advanced", "excellent", "clean")},
        }
        for d in row["dim_weights"]:
            v = _mean([r["score"]["dims"].get(d) for r in rs])
            row["dims"][d] = round(v, 2) if v is not None else None
        eff = cfg["efficiency"]
        row["cost_score"] = _log_score(row["exp_cost_usd"], eff["cost"]["best"], eff["cost"]["worst"])
        row["speed_score"] = _log_score(row["exp_min"], eff["speed"]["best"], eff["speed"]["worst"])
        task_rows.append(row)

    def entrant_scores(e: str, sample: dict | None = None) -> dict:
        """sample: {tkey: [runs]}，用于 bootstrap。"""
        dim_acc = defaultdict(lambda: [0.0, 0.0])
        for tk in tkeys:
            rs = (sample or {}).get(tk) if sample else by_et.get((e, tk))
            if not rs:
                continue
            w = rs[0]["score"]["dim_weights"]
            for d, wt in w.items():
                v = _mean([r["score"]["dims"].get(d) for r in rs])
                if v is not None:
                    dim_acc[d][0] += wt * v
                    dim_acc[d][1] += wt
        ds = {d: round(a / b, 2) for d, (a, b) in dim_acc.items() if b}
        num = sum(qd.get("weight", 1) * ds[qd["id"]] for qd in qdims if qd["id"] in ds)
        den = sum(qd.get("weight", 1) for qd in qdims if qd["id"] in ds)
        return {"dims": ds, "quality": round(num / den, 2) if den else None}

    rng = random.Random(20261008)
    B = int(cfg.get("statistics", {}).get("bootstrap_samples", 2000))
    ci = float(cfg.get("statistics", {}).get("ci", 0.95))
    board = []
    for e in entrants:
        base = entrant_scores(e)
        boots = []
        for _ in range(B):
            sample = {}
            for tk in tkeys:
                rs = by_et.get((e, tk))
                if rs:
                    sample[tk] = [rng.choice(rs) for _ in rs]
            boots.append(entrant_scores(e, sample)["quality"])
        boots = sorted(b for b in boots if b is not None)
        lo = boots[int((1 - ci) / 2 * len(boots))] if boots else None
        hi = boots[int((1 + ci) / 2 * len(boots)) - 1] if boots else None
        trs = [t for t in task_rows if t["entrant"] == e]
        cost_scores = [t["cost_score"] for t in trs if t["cost_score"] is not None]
        speed_scores = [t["speed_score"] for t in trs if t["speed_score"] is not None]
        exp_costs = [t["exp_cost_usd"] for t in trs if t["exp_cost_usd"] is not None]
        exp_mins = [t["exp_min"] for t in trs if t["exp_min"] is not None]
        dims_full = dict(base["dims"])
        dims_full["cost"] = round(_mean(cost_scores), 1) if cost_scores else None
        dims_full["speed"] = round(_mean(speed_scores), 1) if speed_scores else None
        er = [r for r in runs if r["entrant"] == e]
        row = {
            "entrant": e, "quality": base["quality"], "ci_low": lo, "ci_high": hi, "dims": dims_full,
            "runs": len(er), "tasks": len(trs), "pass_rate": round(sum(r["score"]["passed"] for r in er) / len(er), 3),
            "suite_exp_cost_usd": round(sum(exp_costs), 3) if exp_costs and all(c != math.inf for c in exp_costs) else (math.inf if exp_costs else None),
            "suite_exp_min": round(sum(exp_mins), 1) if exp_mins and all(c != math.inf for c in exp_mins) else (math.inf if exp_mins else None),
            "cost_coverage": f"{len(cost_scores)}/{len(trs)}", "complete": all(r["score"]["complete"] for r in er),
            "na_ratio": round(_mean([r["score"]["na_ratio"] for r in er]) or 0, 3),
        }
        cfg_c = cfg.get("composite", {})
        if cfg_c.get("enabled") and row["quality"] is not None:
            row["composite"] = round(cfg_c["quality_weight"] * row["quality"] + cfg_c["cost_weight"] * (dims_full["cost"] or 0) + cfg_c["speed_weight"] * (dims_full["speed"] or 0), 2)
        board.append(row)
    board.sort(key=lambda r: -(r["quality"] or -1))
    # 并列：与本组首位 CI 重叠的记为并列
    rank, i = 1, 0
    while i < len(board):
        lead = board[i]
        j = i
        while j < len(board) and board[j]["ci_high"] is not None and lead["ci_low"] is not None and board[j]["ci_high"] >= lead["ci_low"]:
            j += 1
        j = max(j, i + 1)
        tie = j - i > 1
        for k in range(i, j):
            board[k]["rank"] = f"{rank}=" if tie else str(rank)
        rank += j - i
        i = j

    # 题目分析（区分度）
    item_rows = []
    per_item = defaultdict(lambda: defaultdict(list))
    item_meta = {}
    for r in runs:
        for it in r["score"]["items"]:
            if it["status"] in ("scored", "missing") and it["s"] is not None:
                per_item[(r["tkey"], it["id"])][r["entrant"]].append(it["s"])
                item_meta[(r["tkey"], it["id"])] = it
    for (tk, iid), by_e in sorted(per_item.items()):
        allv = [v for vs in by_e.values() for v in vs]
        means = [sum(vs) / len(vs) for vs in by_e.values()]
        mu = sum(allv) / len(allv)
        within = _mean([_sd(vs) for vs in by_e.values()])
        it = item_meta[(tk, iid)]
        item_rows.append({"task": tk, "item_id": iid, "dim": it["dim"], "tier": it["tier"], "method": it["method"], "desc": it["desc"],
                          "mean": round(mu, 3), "between_sd": round(_sd(means), 3), "within_sd": round(within or 0, 3), "n": len(allv),
                          "flag": "天花板" if mu >= 0.95 else "地板" if mu <= 0.05 else ("区分度低" if len(means) > 1 and _sd(means) < 0.05 else "")})

    # skill 增益（同一题 A/C 两组）
    uplift = []
    variants_tasks = {tid: load_rubric(tid) for tid in task_dirs() if load_rubric(tid).get("variants")}
    for tid in variants_tasks:
        for e in entrants:
            a = next((t for t in task_rows if t["entrant"] == e and t["task"] == tid + "A"), None)
            c = next((t for t in task_rows if t["entrant"] == e and t["task"] == tid + "C"), None)
            if a and c:
                uplift.append({"entrant": e, "task": tid, "A_mean": a["mean"], "C_mean": c["mean"], "uplift": round(c["mean"] - a["mean"], 2),
                               "A_anim": a["dims"].get("anim"), "C_anim": c["dims"].get("anim"),
                               "anim_uplift": round((c["dims"].get("anim") or 0) - (a["dims"].get("anim") or 0), 2),
                               "A_cost": a["mean_cost_usd"], "C_cost": c["mean_cost_usd"], "A_min": a["mean_min"], "C_min": c["mean_min"]})

    # 失败归因
    fails = []
    for r in runs:
        tags = []
        sc = r["score"]
        if r["meta"].get("failure_tag"):
            tags.append(r["meta"]["failure_tag"])
        for g in sc["gate_fail"]:
            if "汇报" in g["desc"]:
                tags.append("谎报完成")
            elif "启动" in g["desc"] or "加载" in g["desc"] or "seek" in g["desc"]:
                tags.append("无法运行")
            else:
                tags.append("交付缺失")
        if r["meta"].get("timed_out"):
            tags.append("超时")
        if not sc["gate_pass"] or not sc["passed"]:
            fails.append({"entrant": r["entrant"], "task": r["tkey"], "run_id": r["meta"]["run_id"], "total": sc["total"],
                          "tags": "|".join(dict.fromkeys(tags)) or "能力不足（未达标）"})

    # 覆盖矩阵
    coverage = []
    for tid in task_dirs():
        rub = load_rubric(tid)
        for vk, vconf in ((rub.get("variants") or {"": {"dims": rub.get("dims", {})}}).items()):
            row = {"task": tid + vk, "name": rub["name"]}
            for d in qdims:
                row[d["id"]] = (vconf.get("dims") or rub.get("dims", {})).get(d["id"], "")
            row["items"] = sum(1 for it in rub.get("items", []) if not it.get("variants") or vk in it["variants"])
            coverage.append(row)

    out = {"benchmark": cfg.get("name"), "version": cfg.get("version"), "frozen_date": cfg.get("frozen_date"),
           "dimensions": dims, "board": board, "tasks": task_rows, "items": item_rows, "uplift": uplift, "failures": fails,
           "coverage": coverage,
           "runs": [{"run_id": r["meta"]["run_id"], "entrant": r["entrant"], "task": r["tkey"], "run_index": r["meta"].get("run_index"),
                     "date": r["meta"].get("date"), "total": r["score"]["total"], "gate_pass": r["score"]["gate_pass"],
                     "passed": r["score"]["passed"], "complete": r["score"]["complete"], "na_ratio": r["score"]["na_ratio"],
                     "pending": len(r["score"]["pending"]), **{f"dim_{k}": v for k, v in r["score"]["dims"].items()},
                     "wall_min": r["usage"].get("wall_min"), "active_min": r["usage"].get("active_min"),
                     "input_tokens": r["usage"].get("input_tokens"), "output_tokens": r["usage"].get("output_tokens"),
                     "cache_read_tokens": r["usage"].get("cache_read_tokens"), "cache_write_tokens": r["usage"].get("cache_write_tokens"),
                     "cost_usd": r["usage"].get("cost_usd"), "cost_estimated": r["usage"].get("cost_estimated", False),
                     "usage_source": r["usage"].get("source")} for r in runs],
           "long": [{"run_id": r["meta"]["run_id"], "entrant": r["entrant"], "task": r["tkey"], **{k: it.get(k) for k in ("id", "dim", "tier", "method", "weight", "status", "s", "value")}}
                    for r in runs for it in r["score"]["items"]]}
    dump_json(data / "results" / "aggregate.json", out)
    return out
