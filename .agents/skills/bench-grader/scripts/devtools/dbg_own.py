"""用法：python dbg_own.py <题号> "<pytest -k 表达式>" [额外 pytest 参数]    启动参考实现，跑 hidden/reference_tests.py。B8 请改用 dbg_b8.py。"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from _task import TASKS, task_dir

task, kexpr = sys.argv[1], sys.argv[2]
d = task_dir(task)
tests = [d / "hidden" / "reference_tests.py"]
tmp = tempfile.mkdtemp()
from pathlib import Path
tmp = Path(tmp)
for p in tests + [TASKS / "_common" / "hidden" / "bt.py"]:
    shutil.copy(p, tmp)
s = socket.socket()
s.bind(("127.0.0.1", 0))
port = str(s.getsockname()[1])
s.close()
env = dict(os.environ, PORT=port, BENCH_MODE="1", DB_PATH=str(tmp / "x.db"), BASE_URL=f"http://127.0.0.1:{port}")
srv = subprocess.Popen([sys.executable, str(d / "hidden" / "reference_server.py")], env=env, cwd=tmp)
for _ in range(50):
    try:
        urllib.request.urlopen(env["BASE_URL"] + "/health", timeout=1)
        break
    except Exception:
        time.sleep(0.2)
try:
    r = subprocess.run([sys.executable, "-m", "pytest", "-x", "-q", "-p", "no:cacheprovider", "-k", kexpr, *[t.name for t in tests], *sys.argv[3:]],
                       cwd=tmp, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    sys.stdout.buffer.write((r.stdout[-5000:] + r.stderr[-1500:]).encode("utf-8", "replace"))
    sys.exit(r.returncode)
finally:
    srv.kill()
