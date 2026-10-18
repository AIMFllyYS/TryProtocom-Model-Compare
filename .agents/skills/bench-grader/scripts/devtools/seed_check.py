"""用法：python seed_check.py <题号> <materials 下的种子目录名>    在种子上跑自带测试和隐藏测试，打印失败项。"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from _task import TASKS, task_dir

task, seed = sys.argv[1], sys.argv[2]
d = task_dir(task)
tmp = Path(tempfile.mkdtemp())
sd = tmp / seed
shutil.copytree(d / "materials" / seed, sd)
hid = tmp / "hid"
hid.mkdir()
for p in list((d / "hidden").glob("test_*.py")) + [TASKS / "_common" / "hidden" / "bt.py"] + list((d / "hidden").glob("seedgen.py")):
    if "chaos" in p.name or "persist" in p.name or "reference_tests" in p.name:
        continue
    shutil.copy(p, hid)
s = socket.socket()
s.bind(("127.0.0.1", 0))
port = str(s.getsockname()[1])
s.close()
env = dict(os.environ, PORT=port, BENCH_MODE="1", DB_PATH=str(sd / "x.db"), SERVER_DB_PATH=str(sd / "x.db"), BASE_URL=f"http://127.0.0.1:{port}", PYTHONIOENCODING="utf-8")
bj = json.loads((sd / "bench.json").read_text(encoding="utf-8"))
start = [sys.executable if a in ("python", "python3") else a for a in bj["start"].split()]
srv = subprocess.Popen(start, env=env, cwd=sd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        urllib.request.urlopen(env["BASE_URL"] + bj.get("health", "/health"), timeout=1)
        break
    except Exception:
        time.sleep(0.2)
try:
    test_cmd = bj["test"].replace("python3", f'"{sys.executable}"').replace("python ", f'"{sys.executable}" ')
    r = subprocess.run(test_cmd, shell=True, cwd=sd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (r.stdout or r.stderr or "").strip().splitlines()[-1:]
    print("OWN TESTS exit", r.returncode, tail)
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--tb=no", "-rf", *[p.name for p in hid.glob("test_*.py")]],
                       cwd=hid, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in r.stdout.splitlines():
        if line.startswith("FAILED") or re.search(r"\d+ (passed|failed)", line):
            sys.stdout.buffer.write((line + "\n").encode("utf-8", "replace"))
finally:
    srv.kill()
