"""后端题族（B1–B8）的出题质检：隐藏测试自己有没有问题。

三个检查，都在评测机上跑，都不需要任何被测模型：
1. selftest  ：把 `hidden/reference_server.py`（参考实现）当成“被测模型”，走完整的 api 探针
               （隐藏测试 + 重启/混沌 + 差分 + 压测…）。参考实现必须 100% 通过，否则是题目或测试的错误，不是模型的错误。
2. mutation  ：对参考实现注入 `hidden/mutants.json` 里的细微错误（把 < 改成 <=、漏掉一个校验…），
               隐藏测试必须逐个“杀死”它们。存活的变异体说明测试有盲区，要补测试；没有杀死任何变异体的测试是冗余测试。
3. defect    ：对“初始有缺陷的仓库”（B5–B7 的 materials）跑同一套测试：应该只有预期的缺陷测试失败，
               其余回归测试一开始就应该通过——否则测试把“原本就能用的功能”也算进了缺陷。
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

from .common import Metrics, RunContext, free_port, env_with, load_json, load_rubric, run_cmd
from .probes.api import Server, _wait_health, api_probe, apply_mutant, _has_timeout_plugin, _junit


def _api_opts(rubric: dict) -> dict:
    opts: dict = {}
    for p in rubric.get("probes", []):
        if p.get("type") == "api":
            opts.update(p.get("opts") or {})
    return opts


def _make_ctx(task_id: str, tmp: Path, src: Path, deliverable: str | None = None) -> RunContext:
    rubric = load_rubric(task_id)
    ddir = deliverable or rubric.get("deliverable_dir") or "deliverable"
    out = tmp / "output" / ddir
    shutil.copytree(src, out, ignore=shutil.ignore_patterns("__pycache__", "*.db", ".git"))
    return RunContext(run_dir=tmp, meta={"task": task_id}, rubric=rubric, cfg={"external": {}}, metrics=Metrics())


def reference_as_model(task_id: str, tmp: Path) -> RunContext:
    """把 hidden/reference_server.py 包装成一份“交付”：reference_server.py + bench.json。"""
    rubric = load_rubric(task_id)
    ref = Path(rubric["_dir"]) / "hidden" / "reference_server.py"
    if not ref.exists():
        raise FileNotFoundError(f"{task_id} 没有 hidden/reference_server.py")
    src = tmp / "_ref_src"
    src.mkdir(parents=True)
    shutil.copy(ref, src / "reference_server.py")
    own = Path(rubric["_dir"]) / "hidden" / "reference_tests.py"
    bj = {"start": f'"{sys.executable}" reference_server.py', "setup": "", "health": "/health"}
    if own.exists():  # 参考实现自带的“模型自测”样例，用于验证 own_tests / 变异检验管线
        shutil.copy(own, src / "test_reference.py")
        bj["test"] = f'"{sys.executable}" -m pytest -q -p no:cacheprovider test_reference.py'
    (src / "bench.json").write_text(json.dumps(bj), encoding="utf-8")
    return _make_ctx(task_id, tmp, src)


def run_probe(ctx: RunContext) -> dict:
    api_probe(ctx, _api_opts(ctx.rubric))
    res = load_json(ctx.work_dir / "hidden_results.json", {}) or {}
    return {"metrics": {k: v for k, v in ctx.metrics.values.items() if k.startswith("api.")}, "na": ctx.metrics.na, "tests": res}


def selftest(task_id: str) -> dict:
    tmp = Path(tempfile.mkdtemp(prefix=f"bt-{task_id}-"))
    try:
        r = run_probe(reference_as_model(task_id, tmp))
        failed = sorted(n for n, ok in r["tests"].items() if not ok)
        r["failed"] = failed
        r["ok"] = bool(r["tests"]) and not failed and r["metrics"].get("api.started") is True \
            and r["metrics"].get("api.persist_ok", True) is not False and r["metrics"].get("api.chaos_ok", True) is not False \
            and r["metrics"].get("api.diff_match_ratio", 1.0) == 1.0
        return r
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def mutation(task_id: str, limit: int | None = None) -> dict:
    """对参考实现逐个注入变异体，用隐藏测试（只跑 opts.tests）检验能否杀死。"""
    rubric = load_rubric(task_id)
    hidden = Path(rubric["_dir"]) / "hidden"
    opts = _api_opts(rubric)
    ref_src = (hidden / "reference_server.py").read_text(encoding="utf-8")
    mutants = load_json(hidden / "mutants.json", []) or []
    if limit:
        mutants = mutants[:limit]
    tmp = Path(tempfile.mkdtemp(prefix=f"mut-{task_id}-"))
    try:
        tdir = tmp / "tests"
        tdir.mkdir()
        for rel in opts.get("tests", []) + opts.get("support", []):
            shutil.copy(Path(rubric["_dir"]) / rel, tdir / Path(rel).name)
        main = [Path(r).name for r in opts.get("tests", [])]
        sidecar = opts.get("sidecar")

        def run_one(name: str, source: str) -> dict:
            d = tmp / name
            d.mkdir()
            script = d / "reference_server.py"
            script.write_text(source, encoding="utf-8")
            extra: dict = {}
            side = None
            if sidecar:
                sport = free_port()
                side = Server(f'"{sys.executable}" "{(Path(rubric["_dir"]) / sidecar["script"]).resolve()}"', d,
                              env_with(PORT=sport), d / "side.log")
                side.start()
                sbase = f"http://127.0.0.1:{sport}"
                _wait_health(sbase, "/health", 30)
                extra[sidecar.get("env", "PROVIDER_URL")] = sbase
                extra.update({k: str(v) for k, v in (sidecar.get("extra_env") or {}).items()})
            port = free_port()
            env = env_with(PORT=port, BENCH_MODE="1", DB_PATH=str(d / "m.db"), **extra)
            srv = Server(f'"{sys.executable}" "{script}"', d, env, d / "server.log")
            srv.start()
            base = f"http://127.0.0.1:{port}"
            try:
                if _wait_health(base, "/health", 30) is None:
                    return {"id": name, "started": False, "killed_by": []}
                xml = d / "out.xml"
                run_cmd([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                         "--timeout=60" if _has_timeout_plugin() else "-q", f"--junitxml={xml}", *main],
                        cwd=tdir, timeout=900, env=env_with(BASE_URL=base, **{**extra, "SERVER_DB_PATH": str(d / "m.db"), "DB_PATH": str(d / "m.db")}))
                res = _junit(xml)
                return {"id": name, "started": True, "tests": len(res), "killed_by": sorted(n for n, ok in res.items() if not ok)}
            finally:
                srv.stop()
                if side:
                    side.stop()

        base_run = run_one("_valid", ref_src)
        report = {"task": task_id, "valid_failures": base_run["killed_by"], "mutants": []}
        for mu in mutants:
            src = apply_mutant(ref_src, mu)
            if src is None:
                report["mutants"].append({"id": mu["id"], "status": "invalid", "desc": mu.get("desc", "")})
                continue
            r = run_one(mu["id"], src)
            status = "invalid" if not r["started"] else ("killed" if r["killed_by"] else "survived")
            report["mutants"].append({"id": mu["id"], "status": status, "desc": mu.get("desc", ""), "killed_by": r["killed_by"]})
        valid = [x for x in report["mutants"] if x["status"] != "invalid"]
        report["total"] = len(valid)
        report["killed"] = sum(1 for x in valid if x["status"] == "killed")
        report["score"] = round(report["killed"] / len(valid), 3) if valid else None
        report["survivors"] = [x["id"] for x in valid if x["status"] == "survived"]
        report["invalid"] = [x["id"] for x in report["mutants"] if x["status"] == "invalid"]
        all_killers = {t for x in valid for t in x.get("killed_by", [])}
        report["killing_tests"] = len(all_killers)
        return report
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def defect(task_id: str) -> dict:
    """用初始有缺陷的仓库当“被测模型”：只有 calibration.defect_must_fail 里列出的命名测试应当失败。"""
    rubric = load_rubric(task_id)
    cal = rubric.get("calibration") or {}
    if not cal.get("defect_src"):
        return {"task": task_id, "skipped": "没有 calibration.defect_src"}
    tmp = Path(tempfile.mkdtemp(prefix=f"defect-{task_id}-"))
    try:
        ctx = _make_ctx(task_id, tmp, Path(rubric["_dir"]) / cal["defect_src"])
        r = run_probe(ctx)
        m = r["metrics"]
        must_fail = cal.get("defect_must_fail", [])
        wrong_pass = [a for a in must_fail if m.get(f"api.test.{a}") is True]
        min_reg = float(cal.get("defect_min_regression", 0.0))
        reg = m.get("api.regression_ratio")
        max_speed = cal.get("defect_max_speedup")
        speed = m.get("api.speedup")
        too_fast = max_speed is not None and isinstance(speed, (int, float)) and speed > float(max_speed)
        r["wrong_pass"] = wrong_pass
        r["too_fast"] = too_fast
        r["ok"] = not wrong_pass and not too_fast and (reg is None or reg >= min_reg) and m.get("api.started") is True
        return r
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def format_report(name: str, r: dict) -> str:
    return f"== {name} ==\n" + json.dumps(r, ensure_ascii=False, indent=1, default=str)
