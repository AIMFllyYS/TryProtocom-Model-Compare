"""用法：python dbg_b8.py "<pytest -k 表达式>" [额外 pytest 参数]

同时启动 B8 沙箱网关和参考商户服务。环境变量 B8_TESTS 选择测试文件（默认 test_pay.py，可设为 reference_tests.py）。
环境变量 B8_SRV 可换成别的服务脚本（例如 hidden/naive/server.py）。
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from _task import TASKS

kexpr = sys.argv[1]
which = os.environ.get("B8_TESTS", "test_pay.py")
d = TASKS / "B8-payments-webhooks"
tmp = Path(tempfile.mkdtemp())
for p in [d / "hidden" / which, TASKS / "_common" / "hidden" / "bt.py"]:
    shutil.copy(p, tmp / (which if p.name == which else p.name))


def port() -> str:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = str(s.getsockname()[1])
    s.close()
    return p


pp, mp = port(), port()
penv = dict(os.environ, PORT=pp)
menv = dict(os.environ, PORT=mp, BENCH_MODE="1", DB_PATH=str(tmp / "m.db"), PROVIDER_URL=f"http://127.0.0.1:{pp}", BASE_URL=f"http://127.0.0.1:{mp}")
prov = subprocess.Popen([sys.executable, str(d / "materials" / "provider-sim" / "provider.py")], env=penv, cwd=tmp)
server = os.environ.get("B8_SRV") or str(d / "hidden" / "reference_server.py")
srv = subprocess.Popen([sys.executable, server], env=menv, cwd=tmp)
for base in (pp, mp):
    url = f"http://127.0.0.1:{base}/health"
    for _ in range(60):
        try:
            urllib.request.urlopen(url, timeout=1)
            break
        except Exception:
            time.sleep(0.2)
try:
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-k", kexpr, which, *sys.argv[2:]],
                       cwd=tmp, env=menv, capture_output=True, text=True, encoding="utf-8", errors="replace")
    sys.stdout.buffer.write((r.stdout[-6000:] + r.stderr[-1500:]).encode("utf-8", "replace"))
    sys.exit(r.returncode)
finally:
    srv.kill()
    prov.kill()
