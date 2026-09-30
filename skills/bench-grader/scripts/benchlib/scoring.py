"""评分引擎：指标 → 检查项得分 → 单次运行的维度分与总分。

检查项得分 s ∈ [0, 1]；状态：
  scored   已评分
  na       评测环境原因无法检查（不计入分母，计入 N/A 占比）
  missing  被测产出缺失导致指标不存在（按 0 分计）
  pending  人工 / agent 项尚未评分（不计入分母，报告标注“未完成”）
"""
from __future__ import annotations

import math
from pathlib import Path

from .common import Metrics, bench_config, load_json

TIER_WEIGHT = {"basic": 1, "advanced": 2, "excellent": 3, "clean": 1}
TIER_LABEL = {"basic": "基础", "advanced": "进阶", "excellent": "卓越", "clean": "扣分项"}


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def apply_rule(rule: dict, v) -> float:
    t = rule.get("type", "bool")
    if t == "bool":
        return 1.0 if bool(v) == rule.get("expect", True) else 0.0
    if t == "eq":
        return 1.0 if v == rule["value"] else 0.0
    if v is None:
        return 0.0
    v = float(v)
    if t == "ratio":
        return _clamp(v)
    if t == "min":
        lo = rule["min"]
        if v >= lo:
            return 1.0
        z = rule.get("zero")
        return _clamp((v - z) / (lo - z)) if z is not None and lo != z else 0.0
    if t == "max":
        hi = rule["max"]
        if v <= hi:
            return 1.0
        z = rule.get("zero")
        return _clamp((z - v) / (z - hi)) if z is not None and z != hi else 0.0
    if t == "linear":
        bad, good = float(rule["bad"]), float(rule["good"])
        if rule.get("log"):
            v, bad, good = math.log10(max(v, 1e-9)), math.log10(max(bad, 1e-9)), math.log10(max(good, 1e-9))
        return _clamp((v - bad) / (good - bad)) if good != bad else 0.0
    if t == "band":
        lo, hi, tol = rule["lo"], rule["hi"], rule["tol"]
        if lo <= v <= hi:
            return 1.0
        d = lo - v if v < lo else v - hi
        return _clamp(1 - d / tol)
    raise ValueError(f"unknown rule type {t}")


def _value(item: dict, metrics: Metrics):
    """返回 (value, status)。支持 metric（单个指标）与 value_expr（多指标组合表达式）。"""
    vals = metrics.values
    if "value_expr" in item:
        try:
            v = eval(item["value_expr"], {"__builtins__": {}}, {"v": vals, "min": min, "max": max, "abs": abs, "len": len, "sum": sum, "all": all, "any": any, "round": round})
            return v, "scored"
        except (KeyError, TypeError, ZeroDivisionError, ValueError):
            na = next((metrics.is_na(k) for k in _expr_keys(item["value_expr"]) if metrics.is_na(k)), None)
            return None, "na" if na else "missing"
    key = item["metric"]
    if key in vals and vals[key] is not None:
        return vals[key], "scored"
    if metrics.is_na(key):
        return None, "na"
    return None, "missing"


def _expr_keys(expr: str) -> list[str]:
    import re
    return re.findall(r"v\[['\"]([^'\"]+)['\"]\]", expr)


def item_weight(item: dict) -> float:
    return float(item.get("weight", TIER_WEIGHT.get(item.get("tier", "basic"), 1)))


def score_run(rubric: dict, metrics: Metrics, manual: dict, variant: str | None = None) -> dict:
    cfg = bench_config()
    vconf = (rubric.get("variants") or {}).get(variant or "", {})
    dims_w = vconf.get("dims", rubric.get("dims", {}))
    items_out, gate_fail = [], []
    for g in rubric.get("gates", []):
        if g.get("variants") and variant not in g["variants"]:
            continue
        v, st = _value(g, metrics)
        if st == "na":
            continue
        s = apply_rule(g.get("rule", {"type": "bool"}), v) if st == "scored" else 0.0
        if s < 1:
            gate_fail.append({"id": g["id"], "desc": g["desc"], "value": v})
    for it in rubric.get("items", []):
        if it.get("variants") and variant not in it["variants"]:
            continue
        rec = {"id": it["id"], "dim": it["dim"], "tier": it.get("tier", "basic"), "method": it.get("method", "auto"),
               "weight": item_weight(it), "desc": it["desc"]}
        if rec["method"] in ("human", "agent"):
            ms = manual.get(it["id"])
            if ms is None or ms.get("score") in (None, ""):
                rec.update(status="pending", s=None)
            else:
                sc = float(ms["score"])
                rec.update(status="scored", s=_clamp(sc / 3.0), value=sc, by=ms.get("by", rec["method"]), note=ms.get("note", ""))
        else:
            v, st = _value(it, metrics)
            rec["value"] = v
            if st == "scored":
                rec.update(status="scored", s=round(apply_rule(it["rule"], v), 4))
            elif st == "na":
                rec.update(status="na", s=None, na_reason=metrics.is_na(it.get("metric", "")) or "")
            else:
                rec.update(status="missing", s=0.0)
        items_out.append(rec)

    gate_pass = not gate_fail
    counted = [r for r in items_out if r["status"] in ("scored", "missing")]
    dims = {}
    for d in dims_w:
        rs = [r for r in counted if r["dim"] == d]
        w = sum(r["weight"] for r in rs)
        dims[d] = round(100 * sum(r["weight"] * r["s"] for r in rs) / w, 2) if w else None
    wsum = sum(r["weight"] for r in counted)
    total = round(100 * sum(r["weight"] * r["s"] for r in counted) / wsum, 2) if wsum else 0.0
    if not gate_pass:
        dims = {d: 0.0 for d in dims}
        total = 0.0
    all_w = sum(r["weight"] for r in items_out)
    na_w = sum(r["weight"] for r in items_out if r["status"] == "na")
    pend = [r["id"] for r in items_out if r["status"] == "pending"]
    tiers = {}
    for t in TIER_WEIGHT:
        rs = [r for r in counted if r["tier"] == t]
        w = sum(r["weight"] for r in rs)
        tiers[t] = round(100 * sum(r["weight"] * r["s"] for r in rs) / w, 1) if w else None
    return {
        "gate_pass": gate_pass, "gate_fail": gate_fail, "total": total, "dims": dims, "dim_weights": dims_w,
        "tiers": tiers, "items": items_out, "na_ratio": round(na_w / all_w, 3) if all_w else 0,
        "low_confidence": (na_w / all_w if all_w else 0) > cfg.get("low_confidence_na_ratio", 0.2),
        "pending": pend, "complete": not pend,
        "passed": gate_pass and total >= cfg.get("pass_threshold", 60),
    }


def load_manual(run_dir: Path) -> dict:
    return load_json(run_dir / "manual_scores.json", {}) or {}
