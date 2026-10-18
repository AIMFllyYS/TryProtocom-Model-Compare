"""v2：Tier0 封顶、版次/模块得分、三视图（历史/简化/完整）与稳定性。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib import v2  # noqa: E402
from benchlib.common import Metrics  # noqa: E402
from benchlib.scoring import score_run  # noqa: E402

CFG = {"v2": {"full_runs": 3, "tier0_cap": 40,
              "stability": {"availability_weight": 0.5, "consistency_weight": 0.5, "consistency_k": 2.0}}}


def rubric(with_tier0=True):
    r = {"dims": {"visual": 1},
         "gates": [],
         "items": [
             {"id": "a", "dim": "visual", "tier": "basic", "metric": "x.a", "rule": {"type": "bool"}, "desc": "a", "edition": "base", "module": "engine"},
             {"id": "b", "dim": "visual", "tier": "basic", "metric": "x.b", "rule": {"type": "bool"}, "desc": "b", "edition": "detail", "module": "engine"},
             {"id": "c", "dim": "visual", "tier": "basic", "metric": "x.c", "rule": {"type": "bool"}, "desc": "c", "edition": "detail", "module": "nozzle"},
         ]}
    if with_tier0:
        r["tier0"] = [{"id": "T0", "metric": "x.loads", "rule": {"type": "bool"}, "desc": "页面能加载"}]
    return r


def metrics(loads=True, a=True, b=True, c=True):
    m = Metrics()
    for k, v in (("x.loads", loads), ("x.a", a), ("x.b", b), ("x.c", c)):
        m.set(k, v)
    return m


def test_tier0_pass_does_not_cap():
    s = score_run(rubric(), metrics(), {})
    assert s["tier0_pass"] is True and s["total"] == 100 and s["passed"]


def test_tier0_fail_caps_total_and_dims():
    s = score_run(rubric(), metrics(loads=False), {})
    assert s["tier0_pass"] is False and s["total"] == 40 and s["dims"]["visual"] == 40 and not s["passed"]
    assert s["gate_pass"] is True  # 不是门槛，不清零


def test_no_tier0_is_none():
    assert score_run(rubric(False), metrics(), {})["tier0_pass"] is None


def test_editions_and_modules():
    s = score_run(rubric(), metrics(b=False), {})
    assert s["editions"]["base"] == 100 and round(s["editions"]["detail"], 1) == 50.0
    assert s["modules"]["engine"]["score"] == 50.0 and s["modules"]["nozzle"]["score"] == 100.0


def _run(entrant, tkey, idx, total, tier0=True, incident=None, version="v2.0-draft"):
    return {"entrant": entrant, "tkey": tkey,
            "meta": {"run_id": f"{tkey}-{entrant}-{idx}", "run_index": idx, "benchmark_version": version, "incident": incident},
            "score": {"total": total, "gate_pass": True, "tier0_pass": tier0, "passed": total >= 60}}


def test_history_excludes_v2():
    runs = [_run("m", "T01", 1, 70, version="v1.0"), _run("m", "V01", 1, 90)]
    out, _ = v2.apply_view(runs, "history", CFG)
    assert [r["tkey"] for r in out] == ["T01"]


def test_simple_takes_best_and_marks_n():
    runs = [_run("m", "V01", 1, 50), _run("m", "V01", 2, 80, incident=None), _run("m", "V01", 3, 60), _run("m", "V02", 1, 70)]
    out, info = v2.apply_view(runs, "simple", CFG)
    best = {r["tkey"]: r["score"]["total"] for r in out}
    assert best == {"V01": 80, "V02": 70}
    assert info["entrants"]["m"] == {"n_min": 1, "n_max": 3, "star": True, "incident_retries": 0}


def test_full_requires_all_tasks_complete(monkeypatch):
    monkeypatch.setattr(v2, "required_tkeys", lambda suite="v2": ["V01", "V02"])
    runs = []
    for i in (1, 2, 3):
        runs += [_run("full", "V01", i, 80), _run("full", "V02", i, 70)]
    runs += [_run("part", "V01", i, 90) for i in (1, 2, 3)] + [_run("part", "V02", 1, 90)]
    out, info = v2.apply_view(runs, "full", CFG)
    assert {r["entrant"] for r in out} == {"full"}
    assert info["excluded"][0]["entrant"] == "part" and "V02" in info["excluded"][0]["missing"][0]


def test_full_uses_first_n_runs_only(monkeypatch):
    monkeypatch.setattr(v2, "required_tkeys", lambda suite="v2": ["V01"])
    runs = [_run("m", "V01", i, t) for i, t in ((1, 50), (2, 50), (3, 50), (4, 100))]
    out, _ = v2.apply_view(runs, "full", CFG)
    assert [r["score"]["total"] for r in out] == [50, 50, 50]


def test_stability_counts_failures_and_variance():
    steady = {"V01": [_run("m", "V01", i, 80) for i in (1, 2, 3)]}
    s = v2.stability(steady, CFG)
    assert s["availability"] == 100 and s["consistency"] == 100 and s["stability"] == 100
    flaky = {"V01": [_run("m", "V01", 1, 90), _run("m", "V01", 2, 30, tier0=False), _run("m", "V01", 3, 90)]}
    f = v2.stability(flaky, CFG)
    assert round(f["availability"], 1) == 66.7 and f["consistency"] < 60 and f["stability"] < 70
