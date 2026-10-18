"""Agent 验收：hygiene / boundary / evidence / explore 探针，探索导入，Agent↔人工校准，rubric 接线。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib import agent_accept  # noqa: E402
from benchlib.common import Metrics, RunContext, dump_json, load_json, load_rubric  # noqa: E402
from benchlib.probes import REGISTRY, agent  # noqa: E402
from benchlib.scoring import score_run  # noqa: E402


def _ctx(tmp: Path, meta: dict | None = None) -> RunContext:
    (tmp / "output").mkdir(parents=True, exist_ok=True)
    return RunContext(run_dir=tmp, meta=meta or {}, rubric={"deliverable_dir": "", "_dir": str(tmp)}, cfg={}, metrics=Metrics())


def test_registry_has_agent_probes():
    for name in ("hygiene", "boundary", "evidence", "explore"):
        assert name in REGISTRY


def test_hygiene_flags_secrets_eval_longlines_and_embedded_binary(tmp_path):
    ctx = _ctx(tmp_path)
    out = tmp_path / "output"
    payload = "A" * 40000  # ≈ 30 KB 的 base64
    (out / "index.html").write_text(
        "<script>\n"
        "const apiKey = 'abcd1234abcd1234abcd1234';\n"
        "eval('1+1'); // eval( in a comment does not count\n"
        f"const img = 'data:image/png;base64,{payload}';\n"
        "// new Function('x') only in comment\n"
        "</script>", encoding="utf-8")
    (out / "clean.js").write_text("export const a = 1;\nexport function f(){ return a }\n", encoding="utf-8")
    (out / "node_modules").mkdir()
    (out / "node_modules" / "x.js").write_text("eval('ignored')", encoding="utf-8")
    agent.hygiene_probe(ctx, {})
    v = ctx.metrics.values
    assert v["hygiene.secret_hits"] == 1
    assert v["hygiene.eval_hits"] == 1
    assert v["hygiene.embedded_binary_kb"] > 20
    assert v["hygiene.long_line_ratio"] == 0  # data URI 行不算超长行
    assert v["hygiene.handwritten_files"] == 2


def test_hygiene_long_lines_and_vendor_skipped(tmp_path):
    ctx = _ctx(tmp_path)
    out = tmp_path / "output"
    (out / "app.js").write_text("var a=" + "1+" * 400 + "1;\nvar b = 2;\n", encoding="utf-8")
    (out / "three.min.js").write_text("var x=" + "2+" * 4000 + "2;", encoding="utf-8")
    agent.hygiene_probe(ctx, {})
    v = ctx.metrics.values
    assert v["hygiene.long_line_ratio"] == 0.5  # 只统计手写文件
    assert v["hygiene.handwritten_files"] == 1


def test_boundary_scans_logs_and_ignores_own_workspace(tmp_path):
    ws = tmp_path / "model" / "Acme" / "M1" / "V01" / "r1"
    ws.mkdir(parents=True)
    own = str(ws).replace("\\", "\\\\")
    log = ws.parent / "r1.cli.stdout.jsonl"
    log.write_text(
        json.dumps({"cmd": f"cd {own}"}) + "\n"
        + json.dumps({"cmd": "type D:\\\\x\\\\model\\\\Acme\\\\M2\\\\V01\\\\r1\\\\index.html"}) + "\n"
        + json.dumps({"cmd": "cat skills/bench-grader/tasks/V01-pelican-bike/hidden/intent.md"}) + "\n",
        encoding="utf-8")
    (ws.parent / "r1.prompt.md").write_text("see hidden bench-data", encoding="utf-8")  # 提示词不扫
    ctx = _ctx(tmp_path / "run", {"workspace": str(ws)})
    agent.boundary_probe(ctx, {})
    v = ctx.metrics.values
    assert v["boundary.other_run_refs"] == 1
    assert v["boundary.hidden_refs"] >= 1
    assert v["boundary.violations"] >= 2
    ev = load_json(tmp_path / "run" / "_grading" / "boundary.json")
    assert ev["evidence"]["other_run"]


def test_boundary_na_without_logs(tmp_path):
    ctx = _ctx(tmp_path, {"workspace": str(tmp_path / "nowhere" / "r1")})
    agent.boundary_probe(ctx, {})
    assert ctx.metrics.is_na("boundary.violations")


def test_evidence_levels(tmp_path):
    ctx = _ctx(tmp_path)
    out = tmp_path / "output"
    (out / "index.html").write_text("<p>x</p>", encoding="utf-8")
    (tmp_path / "final_message.md").write_text("已完成。", encoding="utf-8")
    agent.evidence_probe(ctx, {})
    assert ctx.metrics.values["evidence.level"] == 0

    (tmp_path / "final_message.md").write_text("我自测过，截图验证通过。", encoding="utf-8")
    agent.evidence_probe(ctx, {})
    assert ctx.metrics.values["evidence.level"] == 1  # 只声称

    (out / "qa").mkdir()
    (out / "qa" / "screenshot-final.png").write_bytes(b"\x89PNG")
    agent.evidence_probe(ctx, {})
    assert ctx.metrics.values["evidence.level"] == 3
    assert ctx.metrics.values["evidence.images"] == 1


def test_explore_na_then_values(tmp_path):
    ctx = _ctx(tmp_path)
    agent.explore_probe(ctx, {})
    assert ctx.metrics.is_na("explore.failure_ratio")
    dump_json(tmp_path / "explore.json", {"controls_total": 20, "controls_tried": 18, "controls_failed": 3, "crashes": 0})
    agent.explore_probe(ctx, {})
    v = ctx.metrics.values
    assert v["explore.failure_ratio"] == round(3 / 18, 3)
    assert v["explore.coverage"] == 0.9


def _make_run(data: Path, rid: str, task: str = "V01") -> Path:
    rd = data / "runs" / rid
    dump_json(rd / "meta.json", {"run_id": rid, "task": task, "model": "M", "harness": "H", "variant": None})
    dump_json(rd / "metrics.json", {"values": {}, "na": {}})
    return rd


def test_ingest_exploration_roundtrip(tmp_path):
    data = tmp_path / "bench-data"
    rd = _make_run(data, "V01-aaa")
    alias = agent_accept.alias_map(data)["V01-aaa"]
    ex = data / "review" / "exploration"
    ex.mkdir(parents=True)
    dump_json(ex / f"{alias}.json", {"controls_total": 10, "controls_tried": 10, "controls_failed": 1, "crashes": 0})
    dump_json(ex / "R999.json", {"controls_tried": 3})
    dump_json(ex / f"{alias}_bad.json", {"controls_tried": 0})
    r = agent_accept.ingest_exploration(data)
    assert r["imported"] == ["V01-aaa"]
    assert len(r["skipped"]) == 2
    assert load_json(rd / "explore.json")["controls_failed"] == 1


def test_keep_agent_score_and_calibration(tmp_path):
    data = tmp_path / "bench-data"
    prev = {"score": 3.0, "by": "agent"}
    new = agent_accept.keep_agent_score(prev, {"score": 1.0, "by": "human"})
    assert new["agent_score"] == 3.0
    again = agent_accept.keep_agent_score(new, {"score": 2.0, "by": "human"})
    assert again["agent_score"] == 3.0  # 第二次人工覆盖不丢最初的 Agent 分
    assert "agent_score" not in agent_accept.keep_agent_score({"score": 1, "by": "human"}, {"score": 2, "by": "human"})

    rd = _make_run(data, "V01-bbb")
    ms = {f"V01-AC0{i}": {"score": 3.0, "by": "human", "agent_score": a} for i, a in enumerate([3, 3, 2, 0, 3], 1)}
    ms["V01-AC09"] = {"score": 2.0, "by": "agent"}
    dump_json(rd / "manual_scores.json", ms)
    res = agent_accept.calibration(data, min_pairs=5)
    assert res["audited_pairs"] == 5
    assert res["agent_scored_pending_audit"] == 1
    assert res["exact"] == 0.6
    assert res["bias"] < 0  # Agent 比人工严
    assert res["worst_items"][0][0] == "AC04"
    assert agent_accept.calibration(tmp_path / "empty", 1)["audited_pairs"] == 0


def test_audit_sample_is_deterministic(tmp_path):
    data = tmp_path / "bench-data"
    rd = _make_run(data, "V01-ccc")
    dump_json(rd / "manual_scores.json", {f"V01-AC{i:02d}": {"score": 2.0, "by": "agent"} for i in range(1, 40)})
    a = agent_accept.audit_sample(data, 0.3)
    b = agent_accept.audit_sample(data, 0.3)
    assert a == b and 0 < len(a) < 39


def test_v2_rubrics_include_agent_acceptance_and_score():
    for t in ("V01", "V02", "V03", "V04", "V05", "V06"):
        rb = load_rubric(t)
        ids = {i["id"] for i in rb["items"]}
        assert {f"{t}-AC{n:02d}" for n in range(1, 16)} <= ids, t
        assert "agent" in rb["dims"]
    rb = load_rubric("V05")
    m = Metrics()
    m.set("build.package_json", False)
    m.set("claims.missing_paths", 0)
    m.set("hygiene.secret_hits", 0)
    m.mark_na("explore.*", "尚未探索")
    sc = score_run(rb, m, {})
    by_id = {i["id"]: i for i in sc["items"]}
    assert by_id["V05-AC06"]["status"] == "scored" and by_id["V05-AC06"]["s"] == 1.0  # 单文件交付天然可复现
    assert by_id["V05-AC01"]["s"] == 1.0
    assert by_id["V05-AC14"]["status"] == "na"  # 没做探索测试 → N/A，不拉低分数
    assert by_id["V05-AC13"]["status"] == "missing"  # 没有日志可扫且未标 N/A 的缺值计 0（本测试没跑探针）

    # 有 package.json 但 npm 不可达 → 构建项 N/A，而不是判 0
    m2 = Metrics()
    m2.set("build.package_json", True)
    m2.mark_na("build.rebuild_ok", "无法访问 registry")
    ac = {i["id"]: i for i in score_run(rb, m2, {})["items"]}
    assert ac["V05-AC06"]["status"] == "na"
