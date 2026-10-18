"""后端题族评分器：变异体应用、回归比例、加速比门控、重置探测，以及 B1–B8 rubric 自洽。"""
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

import bench
from benchlib.common import load_rubric, task_dirs
from benchlib.probes.api import _gate_speedup, _post_reset, _regression_ratio, apply_mutant

TASKS = [t for t in task_dirs() if t.startswith("B")]


def test_apply_mutant_replaces_once_and_honors_count():
    src = "alpha beta alpha"
    assert apply_mutant(src, {"find": "alpha", "replace": "A"}) == "A beta alpha"
    assert apply_mutant(src, {"find": "alpha", "replace": "A", "count": 2}) == "A beta A"


def test_apply_mutant_rejects_missing_and_noop():
    assert apply_mutant("alpha", {"find": "nope", "replace": "x"}) is None
    assert apply_mutant("alpha", {"find": "alpha", "replace": "alpha"}) is None


def test_apply_mutant_edits_all_or_nothing():
    src = "one two"
    ok = apply_mutant(src, {"edits": [{"find": "one", "replace": "1"}, {"find": "two", "replace": "2"}]})
    assert ok == "1 2"
    assert apply_mutant(src, {"edits": [{"find": "one", "replace": "1"}, {"find": "missing", "replace": "x"}]}) is None
    assert apply_mutant(src, {"edits": []}) == src


def test_regression_ratio_drops_parametrized_and_feature_tests():
    res = {"test_func_ok": True, "test_inj_sqli[a]": False, "test_inj_sqli[b]": False, "test_feat_new": False, "test_edge_bad": False}
    assert _regression_ratio(res, {"test_inj_sqli"}) == 0.5
    assert _regression_ratio(res, set()) is None
    assert _regression_ratio({"test_feat_only": True, "test_x[1]": False}, {"test_x"}) == 0.0


def test_gate_speedup_requires_categories_and_clean_load():
    perf = {"gate_categories": ["func", "fresh"]}
    assert _gate_speedup({"api.speedup": 8, "api.cat.func": 1, "api.cat.fresh": 1, "api.load_error_rate": 0}, perf) == 8
    assert _gate_speedup({"api.speedup": 8, "api.cat.func": 0.9, "api.cat.fresh": 1, "api.load_error_rate": 0}, perf) == 0
    assert _gate_speedup({"api.speedup": 8, "api.cat.func": 1, "api.load_error_rate": 0}, perf) == 0
    assert _gate_speedup({"api.speedup": 8, "api.cat.func": 1, "api.cat.fresh": 1, "api.load_error_rate": 0.01}, perf) == 0
    assert _gate_speedup({"api.speedup": 3, "api.load_error_rate": 0}, {}) == 3


def test_post_reset_true_on_reachable_false_on_dead_port():
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            self.rfile.read(n)
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        assert _post_reset(f"http://127.0.0.1:{srv.server_address[1]}") is True
    finally:
        srv.shutdown()
    assert _post_reset("http://127.0.0.1:1") is False


def _api_opts(rubric: dict) -> dict:
    opts: dict = {}
    for probe in rubric.get("probes") or []:
        if probe.get("type") == "api":
            opts.update(probe.get("opts") or {})
    return opts


def test_all_rubrics_validate():
    assert bench.cmd_validate(None) == 0


@pytest.mark.parametrize("task", TASKS)
def test_backend_task_is_self_consistent(task):
    rubric = load_rubric(task)
    root = Path(rubric["_dir"])
    hidden = root / "hidden"
    assert (root / "prompt.md").read_text(encoding="utf-8").find("## 契约") >= 0
    assert (hidden / "reference_server.py").is_file()
    mutants = json.loads((hidden / "mutants.json").read_text(encoding="utf-8"))
    ids = [m["id"] for m in mutants]
    assert ids and len(ids) == len(set(ids))
    for m in mutants:
        assert ("find" in m and "replace" in m) or m.get("edits"), m["id"]
        for e in m.get("edits") or []:
            assert "find" in e and "replace" in e
    opts = _api_opts(rubric)
    for rel in list(opts.get("tests") or []) + list(opts.get("support") or []):
        assert (root / rel).is_file(), rel
    bodies = "\n".join((root / rel).read_text(encoding="utf-8") for rel in opts.get("tests") or [])
    defined = set(re.findall(r"^def (test_\w+)\(", bodies, re.M))
    named = opts.get("named_tests") or {}
    for alias, names in named.items():
        for name in names if isinstance(names, list) else [names]:
            assert name in defined, (task, alias, name)
    for name in opts.get("regression_exclude") or []:
        assert name in defined, (task, name)
    for item in rubric.get("items") or []:
        metric = str(item.get("metric") or "")
        mt = re.fullmatch(r"api\.test\.(\w+)", metric)
        if mt:
            assert mt.group(1) in named, (task, item["id"], metric)
    own = (opts.get("own_test_mutation") or {}).get("reference")
    if own:
        assert (root / own).is_file()
    mat = root / "materials"
    if mat.is_dir():
        for f in mat.rglob("*"):
            if f.is_file() and f.suffix.lower() in {".py", ".md", ".json", ".yaml", ".yml", ".txt"}:
                text = f.read_text(encoding="utf-8", errors="replace")
                assert "/hidden/" not in text and "hidden\\" not in text, f
