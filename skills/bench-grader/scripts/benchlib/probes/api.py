"""后端探针：按 bench.json 启动被测服务，运行隐藏测试套件、并发压测、持久化重启测试、PIN 明文扫描、模型自带测试。"""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from ..common import RunContext, env_with, free_port, load_json, run_cmd

SOURCE_EXT = {".py", ".js", ".ts", ".mjs", ".cjs", ".go", ".md", ".rs", ".java", ".lock", ".toml", ".yaml", ".yml"}
EVALUATOR_PYTHON_PACKAGES = {'pytest': '8.4.2', 'requests': '2.32.5', 'tzdata': '2025.2'}


def _own_tests_passed(output: str) -> int:
    tap = re.search(r"^\s*# pass (\d+)\s*$", output, re.M)
    if tap:return int(tap.group(1))
    jest = re.search(r"^\s*Tests:\s*(?:\d+ failed,\s*)?(\d+) passed", output, re.M)
    if jest:return int(jest.group(1))
    passed = sum(int(x) for x in re.findall(r"(\d+) passed", output))
    if passed:
        return passed
    # unittest writes a Ran/OK summary rather than pytest's "N passed".
    ran = re.search(r"\bRan (\d+) tests? in [^\n]+", output)
    summary = re.search(r"^OK(?: \(([^\n]+)\))?\s*$", output, re.M)
    if ran and summary:
        excluded = sum(int(n) for n in re.findall(r"(?:skipped|expected failures)=(\d+)", summary.group(1) or ""))
        return max(0, int(ran.group(1)) - excluded)
    return 0


class Server:
    def __init__(self, cmd: str, cwd: Path, env: dict, log: Path):
        self.cmd, self.cwd, self.env, self.log = cmd, cwd, env, log
        self.proc = None

    def start(self):
        self.fh = open(self.log, "a", encoding="utf-8")
        self.proc = subprocess.Popen(self.cmd, cwd=self.cwd, env=self.env, shell=True, stdout=self.fh, stderr=subprocess.STDOUT,
                                     start_new_session=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                if os.name == 'nt':
                    # shell=True owns a cmd.exe plus its server child. Terminating
                    # just the shell leaks the Python/Node server on Windows.
                    subprocess.run(['taskkill', '/PID', str(self.proc.pid), '/T', '/F'],
                                   capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(10)
            except Exception:  # noqa: BLE001
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                except Exception:  # noqa: BLE001
                    pass
        if getattr(self, "fh", None):
            self.fh.close()

    def kill(self):
        """Hard kill (SIGKILL / taskkill /F): no shutdown hooks, no flush. Used by the chaos phase."""
        if self.proc and self.proc.poll() is None:
            try:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(self.proc.pid), '/T', '/F'],
                                   capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait(10)
            except Exception:  # noqa: BLE001
                pass
        if getattr(self, "fh", None):
            self.fh.close()


def _wait_health(base: str, path: str, timeout=60) -> float | None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(base + path, timeout=2) as r:
                if r.status < 500:
                    return time.time() - t0
        except Exception:  # noqa: BLE001
            time.sleep(0.3)
    return None


def _junit(path: Path) -> dict[str, bool]:
    res = {}
    if not path.exists():
        return res
    for tc in ET.parse(path).getroot().iter("testcase"):
        ok = not any(child.tag in ("failure", "error") for child in tc)
        skipped = any(child.tag == "skipped" for child in tc)
        res[tc.get("name")] = ok and not skipped
    return res


def _ensure_python3_alias(exe: Path) -> None:
    """Guarantee a `python3` executable next to the isolated interpreter.

    bench.json seeds use `python3` (the POSIX name), but `python -m venv` on
    Windows only writes `python.exe`. Without this alias the shell resolves
    `python3` to the zero-byte Microsoft Store App Execution Alias, which
    prints "Python was not found" and exits 9009 — the service never starts and
    the G1 gate zeroes an otherwise complete run. The alias is a copy so it
    behaves exactly like the interpreter beside it.
    """
    alias=exe.parent/('python3.exe' if os.name=='nt' else 'python3')
    if alias.exists():
        return
    try:
        if os.name=='nt':
            shutil.copy2(exe,alias)
        else:
            alias.symlink_to(exe.name)
    except OSError:
        # A read-only or locked runtime directory must not mask the real
        # grading result; resolution failure is reported by the caller.
        return


def _python3_resolves_to(env: dict, expected: Path) -> bool:
    """True when `python3` on this PATH resolves into the isolated runtime.

    Compares directories, not files: the alias is a distinct `python3` file
    beside the interpreter, so file-level equality would always fail. What
    matters is that resolution does not fall through to the Store alias.
    """
    found=shutil.which('python3',path=env.get('PATH'))
    if not found:
        return False
    try:
        return Path(found).resolve().parent==expected.resolve().parent
    except OSError:
        return False


def _api_runtime_env(ctx: RunContext) -> dict:
    """Use target-compatible runtimes and isolate Python dependencies per run."""
    env=env_with()
    external=ctx.cfg.get('external') or {}
    py=external.get('api_python');node=external.get('api_node');prefix=[]
    if py:
        runtime=(ctx.work_dir/'api-python311').resolve()
        if runtime != ctx.run_dir.resolve()/'_grading/api-python311':
            raise RuntimeError('API runtime directory resolves outside its intended scratch location')
        exe=runtime/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        ready=runtime/'evaluator-ready.json'
        if not exe.exists():
            code,out,_=run_cmd([str(py),'-m','venv',str(runtime)],timeout=120)
            (ctx.work_dir/'api-runtime-setup.log').write_text(out,encoding='utf-8')
            if code:raise RuntimeError('Could not create isolated target Python environment')
        # Windows has no system IANA database. Supply the same timezone data
        # available to zoneinfo on Linux, without changing the model artifact.
        if load_json(ready,{}) != EVALUATOR_PYTHON_PACKAGES:
            packages=[f'{name}=={version}' for name,version in EVALUATOR_PYTHON_PACKAGES.items()]
            code,out,_=run_cmd([str(exe),'-m','pip','install',*packages],timeout=300)
            with (ctx.work_dir/'api-runtime-setup.log').open('a',encoding='utf-8') as log:log.write(out)
            if code:raise RuntimeError('Could not install evaluator test tools in target Python environment')
            ready.write_text(json.dumps(EVALUATOR_PYTHON_PACKAGES),encoding='utf-8')
        env['VIRTUAL_ENV']=str(runtime);prefix.append(str(exe.parent))
        _,version,_=run_cmd([str(exe),'--version'],timeout=15)
        ctx.metrics.set('api.runtime_python',version.strip())
    if node:
        prefix.append(str(Path(node).parent))
        _,version,_=run_cmd([str(node),'--version'],timeout=15)
        ctx.metrics.set('api.runtime_node',version.strip())
    if prefix:env['PATH']=os.pathsep.join(prefix+[env.get('PATH','')])
    if py:
        # The seed's `python3` must resolve to the evaluator interpreter, not the
        # Windows Store alias. Record the outcome so an environment defect is
        # visible in metrics.json instead of silently zeroing the run.
        _ensure_python3_alias(exe)
        ctx.metrics.set('api.python3_ok',_python3_resolves_to(env,exe))
    return env


def _interpreter_env_failure(cmd: str, log: Path) -> str | None:
    """Return a reason when the service failed to start because the interpreter
    named in `bench.json` could not be resolved on this host.

    A missing/aliased interpreter is an evaluator-environment defect, not a
    model defect: the model's artifact was never executed. Treating it as a
    scored failure would zero an otherwise complete run and misattribute it to
    the model, so the caller marks the api metrics N/A instead.
    """
    if not re.search(r'\bpython3\b', cmd):
        return None
    try:
        text = log.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return None
    if 'Python was not found' in text:
        return 'host `python3` is the Microsoft Store App Execution Alias, not an interpreter'
    if re.search(r"'python3' is not recognized|python3: command not found|No such file or directory", text):
        return 'host has no resolvable `python3` executable'
    return None


def _py_cmd(script: Path) -> str:
    return f'"{sys.executable}" "{script}"'


def _start_aux(ctx: RunContext, name: str, spec: dict, extra_env: dict | None = None):
    """Start an evaluator-side helper service (mock provider, reference implementation, slow baseline).

    spec = {"script": "hidden/x.py"}            run a private script with the evaluator interpreter, or
           {"dir": "materials/slow-service"}   copy a task directory and run its bench.json `start`.
    Everything runs in `_grading/<name>/`; nothing is ever copied into the model's workspace.
    Returns (server, base_url, healthy).
    """
    wd = (ctx.work_dir / name).resolve()
    if wd.parent != ctx.work_dir.resolve():
        raise RuntimeError("helper directory resolves outside the scratch location")
    if wd.exists():
        shutil.rmtree(wd, ignore_errors=True)
    health = spec.get("health", "/health")
    if "script" in spec:
        wd.mkdir(parents=True)
        cmd = _py_cmd((ctx.task_dir / spec["script"]).resolve())
    else:
        shutil.copytree(ctx.task_dir / spec["dir"], wd, ignore=shutil.ignore_patterns("__pycache__", "*.db", "*.sqlite", ".git"))
        bj = load_json(wd / "bench.json") or {}
        cmd = bj.get("start") or ""
        health = bj.get("health", health)
        if cmd.startswith("python3 "):
            cmd = f'"{sys.executable}" ' + cmd[len("python3 "):]
    port = free_port()
    env = env_with(PORT=port, BENCH_MODE="1", DB_PATH=str(wd / "aux.db"), **(extra_env or {}))
    log = ctx.work_dir / f"{name}.log"
    log.write_text("", encoding="utf-8")
    srv = Server(cmd, wd, env, log)
    srv.start()
    base = f"http://127.0.0.1:{port}"
    return srv, base, _wait_health(base, health, timeout=60) is not None


def _json_tail(out: str) -> dict:
    for line in reversed(out.strip().splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    return {}


def _differential(ctx: RunContext, m, spec: dict, tdir: Path, base: str, extra: dict) -> None:
    """Differential test: a private driver sends the same generated requests to the model's service and
    to a reference, and prints a final JSON line {"cases": N, "mismatches": K, "examples": [...]}."""
    ref, ref_base, ok = _start_aux(ctx, "reference", spec["reference"])
    try:
        m.set("api.diff_ref_ok", ok)
        if not ok:
            m.mark_na("api.diff_*", "参考实现无法启动（评测环境问题，不是模型问题）")
            return
        code, out, _ = run_cmd([sys.executable, str(tdir / Path(spec["driver"]).name)], cwd=tdir, timeout=spec.get("timeout", 600),
                               env=env_with(BASE_URL=base, REF_URL=ref_base, **extra))
        (ctx.work_dir / "differential.log").write_text(out, encoding="utf-8")
        res = _json_tail(out)
        cases, bad = int(res.get("cases", 0)), int(res.get("mismatches", 0))
        if not cases:
            m.mark_na("api.diff_*", "差分驱动没有产生用例")
            return
        m.set("api.diff_cases", cases)
        m.set("api.diff_mismatches", bad)
        m.set("api.diff_match_ratio", round(1 - bad / cases, 4))
        m.set("api.diff_examples", (res.get("examples") or [])[:5])
    finally:
        ref.stop()


def _chaos(ctx: RunContext, m, spec_test: str, tdir: Path, bj: dict, wd: Path, env: dict, base: str,
           srv: "Server", extra: dict) -> "Server":
    """Chaos phase: run `prepare` (load + records every acknowledged operation), SIGKILL the service while it
    is under load, restart it on the same data, then run `verify` (acknowledged operations must have survived
    and the invariants must hold). Returns the (restarted) server."""
    name = Path(spec_test).name
    st, ready = ctx.work_dir / "chaos_state.json", ctx.work_dir / "chaos.ready"
    for p in (st, ready):
        p.unlink(missing_ok=True)
    penv = env_with(BASE_URL=base, PERSIST_PHASE="prepare", PERSIST_STATE=st, CHAOS_READY=ready, **extra)
    proc = subprocess.Popen([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", name], cwd=tdir, env=penv,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    t0, killed = time.time(), False
    while time.time() - t0 < 90 and proc.poll() is None:
        if ready.exists():
            time.sleep(0.4)  # let some requests be in flight
            srv.kill()
            killed = True
            break
        time.sleep(0.1)
    try:
        out1 = proc.communicate(timeout=120)[0]
    except subprocess.TimeoutExpired:
        proc.kill()
        out1 = proc.communicate()[0] + "\n[timeout]"
    m.set("api.chaos_killed_mid_load", killed)
    if not killed:
        srv.stop()
        m.set("api.chaos_ok", False)
        (ctx.work_dir / "chaos.log").write_text(out1, encoding="utf-8")
        return srv
    time.sleep(1)
    srv = Server(bj["start"], wd, env, ctx.work_dir / "server.log")
    srv.start()
    up = _wait_health(base, bj.get("health", "/health"), timeout=60) is not None
    m.set("api.chaos_restart_ok", up)
    c2, out2, _ = run_cmd([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", name], cwd=tdir, timeout=180,
                          env=env_with(BASE_URL=base, PERSIST_PHASE="verify", PERSIST_STATE=st, **extra))
    m.set("api.chaos_ok", up and c2 == 0)
    (ctx.work_dir / "chaos.log").write_text(out1 + "\n----\n" + out2, encoding="utf-8")
    return srv


def _regression_ratio(res: dict, excl: set) -> float | None:
    """通过率里去掉“本题要修的那些测试”之后，剩下的原有功能还通过多少。

    参数化用例名 `test_x[a]` 按去掉方括号后的基础名匹配排除名单。以 test_feat_ 开头的用例是新功能，不计入回归。
    没有排除名单时返回 None，调用方不发布这个指标。
    """
    if not excl:
        return None
    reg = [ok for n, ok in res.items() if n not in excl and n.split("[", 1)[0] not in excl and not n.startswith("test_feat_")]
    return round(sum(reg) / len(reg), 3) if reg else 0.0


def _gate_speedup(values: dict, perf: dict) -> float:
    """加速比只有在门控类别全部通过、且压测没有报错时才计分，否则为 0。"""
    gate = [values.get(f"api.cat.{c}") for c in (perf.get("gate_categories") or [])]
    ok_gate = all(isinstance(v, (int, float)) and v >= 1.0 for v in gate)
    if ok_gate and not values.get("api.load_error_rate"):
        return float(values.get("api.speedup") or 0)
    return 0.0


def apply_mutant(source: str, mutant: dict) -> str | None:
    """Apply one textual mutant {find, replace[, count]}. Returns None if the pattern is absent or a no-op."""
    if "edits" in mutant:  # 多处联动修改（例如“加缓存 + 只在部分写入路径失效”），任何一处不适用都视为无效变异体
        out = source
        for e in mutant["edits"]:
            out = apply_mutant(out, e)
            if out is None:
                return None
        return out
    find, repl = mutant["find"], mutant["replace"]
    if find not in source or find == repl:
        return None
    return source.replace(find, repl, int(mutant.get("count", 1)))


def _own_test_mutation(ctx: RunContext, m, spec: dict, bj: dict, wd: Path, extra: dict) -> None:
    """Mutation check of the model's OWN tests: they must pass on the correct reference service, and fail on each
    mutated (subtly wrong) copy of it. Needs the tests to honor BASE_URL (stated in the task contract)."""
    mutants = (load_json(ctx.task_dir / spec["mutants"]) or [])[: int(spec.get("limit", 12))]
    if not mutants:
        m.mark_na("api.mut_*", "没有变异体定义")
        return
    ref_src = (ctx.task_dir / spec["reference"]).resolve().read_text(encoding="utf-8")
    timeout = int(spec.get("timeout", 90))

    def run_against(source: str, name: str) -> bool | None:
        d = (ctx.work_dir / "mutants" / name).resolve()
        d.mkdir(parents=True, exist_ok=True)
        script = d / "reference_server.py"
        script.write_text(source, encoding="utf-8")
        port = free_port()
        env = env_with(PORT=port, BENCH_MODE="1", DB_PATH=str(d / "m.db"), **extra)
        s = Server(_py_cmd(script), d, env, d / "server.log")
        s.start()
        base = f"http://127.0.0.1:{port}"
        try:
            if _wait_health(base, spec.get("health", "/health"), timeout=30) is None:
                return None
            code, _, _ = run_cmd(bj["test"], cwd=wd, timeout=timeout, shell=True, env=env_with(BASE_URL=base, **{**extra, "SERVER_DB_PATH": str(d / "m.db"), "DB_PATH": str(d / "m.db")}))
            return code == 0
        finally:
            s.stop()

    valid = run_against(ref_src, "valid")
    m.set("api.mut_valid", bool(valid))
    if valid is None:
        m.mark_na("api.mut_*", "参考实现无法启动（评测环境问题）")
        return
    survivors, killed, total = [], 0, 0
    if valid:
        for mu in mutants:
            src = apply_mutant(ref_src, mu)
            if src is None:
                continue
            total += 1
            r = run_against(src, mu["id"])
            if r is False:
                killed += 1
            elif r is True:
                survivors.append(mu["id"])
            else:  # mutant did not start: counts as an invalid mutant, not as a kill
                total -= 1
    m.set("api.mut_total", total)
    m.set("api.mut_killed", killed)
    m.set("api.mut_score", round(killed / total, 3) if (valid and total) else 0.0)
    m.set("api.mut_survivors", survivors)


def api_probe(ctx: RunContext, opts: dict) -> None:
    m = ctx.metrics
    # A failed re-run must not display a previous run's test/persistence results.
    for bucket in (m.values,m.na):
        for key in list(bucket):
            if key.startswith('api.'):
                del bucket[key]
    root = ctx.project_root()
    bj = load_json(root / "bench.json")
    m.set("api.bench_json", bool(bj and bj.get("start")))
    if not bj or not bj.get("start"):
        return
    wd = (ctx.work_dir / "api_project").resolve()
    if wd != ctx.run_dir.resolve()/'_grading/api_project':
        raise RuntimeError('API scratch directory resolves outside its intended location')
    if wd.exists():
        shutil.rmtree(wd)
    shutil.copytree(root, wd, ignore=shutil.ignore_patterns("node_modules", ".git", "__pycache__", "*.db", "*.sqlite", "*.sqlite3", ".venv", "venv"))
    log = ctx.work_dir / "server.log"
    log.write_text("", encoding="utf-8")
    runtime_env=_api_runtime_env(ctx)
    if bj.get("setup"):
        code, out, _ = run_cmd(bj["setup"], cwd=wd, timeout=900, shell=True,env=runtime_env)
        (ctx.work_dir / "setup.log").write_text(out, encoding="utf-8")
        m.set("api.setup_ok", code == 0)
    port = free_port()
    db_path = wd / "bench-data.db"
    env = dict(runtime_env,PORT=str(port),BENCH_MODE='1',DB_PATH=str(db_path),NODE_ENV='production')
    base = f"http://127.0.0.1:{port}"
    # 评测方的测试可以读取服务的数据文件（例如检查密码是否被明文 / 弱哈希保存）；被测服务本身并不会收到这个变量
    extra: dict = {"SERVER_DB_PATH": str(db_path)}
    side = None
    if opts.get("sidecar"):
        # 评测方的外部依赖替身（例如带故障脚本的“第三方服务”）：先于被测服务启动，地址通过环境变量交给两边
        sc = opts["sidecar"]
        side, side_base, side_ok = _start_aux(ctx, "sidecar", sc)
        m.set("api.sidecar_ok", side_ok)
        extra[sc.get("env", "PROVIDER_URL")] = side_base
        extra.update({k: str(v) for k, v in (sc.get("extra_env") or {}).items()})
        env.update(extra)
    srv = Server(bj["start"], wd, env, log)
    srv.start()
    up = _wait_health(base, bj.get("health", "/health"))
    m.set("api.started", up is not None)
    if up is None:
        if side:
            side.stop()
        srv.stop()
        reason = _interpreter_env_failure(bj["start"], log)
        if reason:
            # Do not let an unusable evaluator host zero the run. The model's
            # artifact never executed, so every api-derived metric — including
            # the G1 gate — is unmeasurable and must be N/A rather than 0.
            for key in list(m.values):
                if key.startswith('api.'):
                    del m.values[key]
            m.mark_na('api.*', reason)
            m.notes.append(f'api probe skipped: {reason}')
        return
    m.set("api.startup_s", round(up, 2))

    tdir = ctx.work_dir / "hidden_tests"
    if tdir.exists():
        shutil.rmtree(tdir)
    tdir.mkdir()
    diff_spec = opts.get("differential")
    to_copy = (opts.get("tests", []) + opts.get("support", [])
               + ([opts["persist_test"]] if opts.get("persist_test") else [])
               + ([opts["chaos_test"]] if opts.get("chaos_test") else [])
               + ([diff_spec["driver"]] if diff_spec else []))
    for rel in to_copy:
        shutil.copy(ctx.task_dir / rel, tdir / Path(rel).name)
    main_tests = [Path(r).name for r in opts.get("tests", [])]
    xml = tdir / "out.xml"
    code, out, secs = run_cmd([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--timeout=60" if _has_timeout_plugin() else "-q",
                               f"--junitxml={xml}", *main_tests], cwd=tdir, timeout=opts.get("tests_timeout", 900), env=env_with(BASE_URL=base, **extra))
    (ctx.work_dir / "hidden_tests.log").write_text(out, encoding="utf-8")
    res = _junit(xml)
    m.set("api.tests_total", len(res))
    m.set("api.tests_passed", sum(res.values()))
    m.set("api.pass_ratio", round(sum(res.values()) / len(res), 3) if res else 0)
    cats: dict[str, list[bool]] = {}
    for name, ok in res.items():
        mt = re.match(r"test_([a-z]+)_", name)
        cats.setdefault(mt.group(1) if mt else "other", []).append(ok)
    for cat in opts.get("categories", []):
        vals = cats.get(cat, [])
        m.set(f"api.cat.{cat}", round(sum(vals) / len(vals), 3) if vals else 0)
    for alias, names in (opts.get("named_tests") or {}).items():
        names = names if isinstance(names, list) else [names]
        m.set(f"api.test.{alias}", all(res.get(n, False) for n in names))
    excl = set(opts.get("regression_exclude") or [])
    reg = _regression_ratio(res, excl)
    if reg is not None:
        m.set("api.regression_ratio", reg)
    (ctx.work_dir / "hidden_results.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    perf = opts.get("perf")
    if perf:
        if perf.get("reset_before"):  # 压测前把数据恢复成基线数据，使被测服务与基线实现在同一数据集上比较
            _post_reset(base)
        lat, errs = _load(base, perf)
        if lat:
            lat.sort()
            m.set("api.p95_ms", round(lat[int(len(lat) * 0.95) - 1] * 1000, 1))
            m.set("api.p50_ms", round(lat[len(lat) // 2] * 1000, 1))
        m.set("api.load_error_rate", round(errs / max(perf.get("requests", 200), 1), 3))
        if perf.get("baseline") and lat:
            # 同一台评测机、同一组请求下跑原始（慢）实现，得到可比的加速比，而不是依赖绝对毫秒数
            bsrv, bbase, bok = _start_aux(ctx, "baseline", perf["baseline"])
            try:
                if bok:
                    if perf.get("reset_before"):
                        _post_reset(bbase)
                    blat, berrs = _load(bbase, perf)
                    if blat:
                        blat.sort()
                        bp95 = blat[int(len(blat) * 0.95) - 1] * 1000
                        m.set("api.baseline_p95_ms", round(bp95, 1))
                        m.set("api.speedup", round(bp95 / max(m.values.get("api.p95_ms", 0.1), 0.1), 2))
                        m.set("api.speedup_gated", _gate_speedup(m.values, perf))
                else:
                    m.mark_na("api.speedup", "基线实现无法启动（评测环境问题）")
            finally:
                bsrv.stop()

    if diff_spec:
        _differential(ctx, m, diff_spec, tdir, base, extra)

    if bj.get("test") and opts.get("own_tests", True):
        code, out, secs = run_cmd(bj["test"], cwd=wd, timeout=900, shell=True, env=dict(env,BASE_URL=base))
        (ctx.work_dir / "own_tests.log").write_text(out, encoding="utf-8")
        m.set("api.own_tests_ok", code == 0)
        m.set("api.own_tests_passed", _own_tests_passed(out))
        if opts.get("own_test_mutation"):
            _own_test_mutation(ctx, m, opts["own_test_mutation"], bj, wd, extra)

    if opts.get("persist_test"):
        st = ctx.work_dir / "persist_state.json"
        pname = Path(opts["persist_test"]).name
        c1, o1, _ = run_cmd([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", pname], cwd=tdir, timeout=120,
                            env=env_with(BASE_URL=base, PERSIST_PHASE="prepare", PERSIST_STATE=st, **extra))
        srv.stop()
        time.sleep(1)
        srv = Server(bj["start"], wd, env, log)
        srv.start()
        ok_up = _wait_health(base, bj.get("health", "/health")) is not None
        c2, o2, _ = run_cmd([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", pname], cwd=tdir, timeout=120,
                            env=env_with(BASE_URL=base, PERSIST_PHASE="verify", PERSIST_STATE=st, **extra))
        m.set("api.persist_ok", c1 == 0 and ok_up and c2 == 0)
        (ctx.work_dir / "persist.log").write_text(o1 + "\n----\n" + o2, encoding="utf-8")
    if opts.get("chaos_test"):
        srv = _chaos(ctx, m, opts["chaos_test"], tdir, bj, wd, env, base, srv, extra)
    srv.stop()
    if side:
        side.stop()

    pin = opts.get("pin_probe")
    if pin:
        leak = False
        for p in wd.rglob("*"):
            if p.is_file() and p.suffix.lower() not in SOURCE_EXT and p.name not in ("package.json", "bench.json") and "node_modules" not in p.parts:
                try:
                    if pin.encode() in p.read_bytes():
                        leak = True
                        m.notes.append(f"PIN 明文出现在 {p.relative_to(wd)}")
                except OSError:
                    pass
        m.set("api.pin_plaintext", leak)


def _has_timeout_plugin() -> bool:
    try:
        import pytest_timeout  # noqa: F401
        return True
    except ImportError:
        return False


def _post_reset(base: str) -> bool:
    try:
        req = urllib.request.Request(base + "/api/__bench/reset", data=b"{}", method="POST", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=120).read()
        return True
    except Exception:  # noqa: BLE001
        return False


def _load(base: str, perf: dict):
    paths = perf.get("paths") or [perf.get("path", "/health")]
    n, conc = int(perf.get("requests", 200)), int(perf.get("concurrency", 20))
    headers, timeout = perf.get("headers", {}), float(perf.get("timeout", 10))
    lat, errs, lock = [], [0], threading.Lock()
    per = max(1, n // conc)
    for p in paths[: int(perf.get("warmup", 0))]:  # 预热不计入延迟（缓存、懒加载、JIT）
        try:
            urllib.request.urlopen(urllib.request.Request(base + p, headers=headers), timeout=timeout).read()
        except Exception:  # noqa: BLE001
            pass

    def worker(wid=0):
        for i in range(per):
            path = paths[(wid + i) % len(paths)]
            req = urllib.request.Request(base + path, headers=headers)
            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    r.read()
                    ok = r.status < 400
            except Exception:  # noqa: BLE001
                ok = False
            with lock:
                lat.append(time.time() - t0)
                if not ok:
                    errs[0] += 1

    ts = [threading.Thread(target=worker, args=(i,)) for i in range(conc)]
    [t.start() for t in ts]
    [t.join(300) for t in ts]
    return lat, errs[0]
