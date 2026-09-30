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


class Server:
    def __init__(self, cmd: str, cwd: Path, env: dict, log: Path):
        self.cmd, self.cwd, self.env, self.log = cmd, cwd, env, log
        self.proc = None

    def start(self):
        self.fh = open(self.log, "a", encoding="utf-8")
        self.proc = subprocess.Popen(self.cmd, cwd=self.cwd, env=self.env, shell=True, stdout=self.fh, stderr=subprocess.STDOUT, start_new_session=True)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(10)
            except Exception:  # noqa: BLE001
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
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


def api_probe(ctx: RunContext, opts: dict) -> None:
    m = ctx.metrics
    root = ctx.project_root()
    bj = load_json(root / "bench.json")
    m.set("api.bench_json", bool(bj and bj.get("start")))
    if not bj or not bj.get("start"):
        return
    wd = ctx.work_dir / "api_project"
    if wd.exists():
        shutil.rmtree(wd)
    shutil.copytree(root, wd, ignore=shutil.ignore_patterns("node_modules", ".git", "__pycache__", "*.db", "*.sqlite", "*.sqlite3", ".venv", "venv"))
    log = ctx.work_dir / "server.log"
    log.write_text("", encoding="utf-8")
    if bj.get("setup"):
        code, out, _ = run_cmd(bj["setup"], cwd=wd, timeout=900, shell=True)
        (ctx.work_dir / "setup.log").write_text(out, encoding="utf-8")
        m.set("api.setup_ok", code == 0)
    port = free_port()
    db_path = wd / "bench-data.db"
    env = env_with(PORT=port, BENCH_MODE="1", DB_PATH=db_path, NODE_ENV="production")
    base = f"http://127.0.0.1:{port}"
    srv = Server(bj["start"], wd, env, log)
    srv.start()
    up = _wait_health(base, bj.get("health", "/health"))
    m.set("api.started", up is not None)
    if up is None:
        srv.stop()
        return
    m.set("api.startup_s", round(up, 2))

    tdir = ctx.work_dir / "hidden_tests"
    if tdir.exists():
        shutil.rmtree(tdir)
    tdir.mkdir()
    for rel in opts.get("tests", []) + ([opts["persist_test"]] if opts.get("persist_test") else []):
        shutil.copy(ctx.task_dir / rel, tdir / Path(rel).name)
    main_tests = [Path(r).name for r in opts.get("tests", [])]
    xml = tdir / "out.xml"
    code, out, secs = run_cmd([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--timeout=60" if _has_timeout_plugin() else "-q",
                               f"--junitxml={xml}", *main_tests], cwd=tdir, timeout=900, env=env_with(BASE_URL=base))
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
    if excl:
        reg = [ok for n, ok in res.items() if n not in excl and not n.startswith("test_feat_")]
        m.set("api.regression_ratio", round(sum(reg) / len(reg), 3) if reg else 0)
    (ctx.work_dir / "hidden_results.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    perf = opts.get("perf")
    if perf:
        lat, errs = _load(base, perf)
        if lat:
            lat.sort()
            m.set("api.p95_ms", round(lat[int(len(lat) * 0.95) - 1] * 1000, 1))
            m.set("api.p50_ms", round(lat[len(lat) // 2] * 1000, 1))
        m.set("api.load_error_rate", round(errs / max(perf.get("requests", 200), 1), 3))

    if bj.get("test") and opts.get("own_tests", True):
        code, out, secs = run_cmd(bj["test"], cwd=wd, timeout=900, shell=True, env=env_with(BASE_URL=base, PORT=port, BENCH_MODE="1"))
        (ctx.work_dir / "own_tests.log").write_text(out, encoding="utf-8")
        m.set("api.own_tests_ok", code == 0)
        passed = sum(int(x) for x in re.findall(r"(\d+) passed", out)) or sum(int(x) for x in re.findall(r"Tests:\s+(\d+) passed", out))
        m.set("api.own_tests_passed", passed)

    if opts.get("persist_test"):
        st = ctx.work_dir / "persist_state.json"
        pname = Path(opts["persist_test"]).name
        c1, o1, _ = run_cmd([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", pname], cwd=tdir, timeout=120,
                            env=env_with(BASE_URL=base, PERSIST_PHASE="prepare", PERSIST_STATE=st))
        srv.stop()
        time.sleep(1)
        srv = Server(bj["start"], wd, env, log)
        srv.start()
        ok_up = _wait_health(base, bj.get("health", "/health")) is not None
        c2, o2, _ = run_cmd([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", pname], cwd=tdir, timeout=120,
                            env=env_with(BASE_URL=base, PERSIST_PHASE="verify", PERSIST_STATE=st))
        m.set("api.persist_ok", c1 == 0 and ok_up and c2 == 0)
        (ctx.work_dir / "persist.log").write_text(o1 + "\n----\n" + o2, encoding="utf-8")
    srv.stop()

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


def _load(base: str, perf: dict):
    path, n, conc = perf.get("path", "/health"), int(perf.get("requests", 200)), int(perf.get("concurrency", 20))
    headers = perf.get("headers", {})
    lat, errs, lock = [], [0], threading.Lock()
    per = n // conc

    def worker():
        for _ in range(per):
            req = urllib.request.Request(base + path, headers=headers)
            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    r.read()
                    ok = r.status < 400
            except Exception:  # noqa: BLE001
                ok = False
            with lock:
                lat.append(time.time() - t0)
                if not ok:
                    errs[0] += 1

    ts = [threading.Thread(target=worker) for _ in range(conc)]
    [t.start() for t in ts]
    [t.join(120) for t in ts]
    return lat, errs[0]
