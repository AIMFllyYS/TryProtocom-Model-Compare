"""用法：python mut_sum.py <题号>    用隐藏测试逐个杀死 hidden/mutants.json，打印存活和无效变异体。"""
import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from benchlib import backend_check as bc

task = sys.argv[1]
r = bc.mutation(task)
print("valid_failures:", r["valid_failures"])
print("total", r["total"], "killed", r["killed"], "score", r["score"])
print("survivors:", r["survivors"], "invalid:", r["invalid"])
for m in r["mutants"]:
    if m["status"] != "killed":
        print(" ", m["id"], m["status"], m["desc"])
print("killing tests:", r["killing_tests"])
