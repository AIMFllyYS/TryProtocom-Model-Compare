"""用法：python show_bc.py <backend-check 输出文件>    打印 JSON 摘要，兼容 PowerShell 写出的 UTF-16。"""
import json
import sys

raw = open(sys.argv[1], "rb").read()
text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", "replace")
start = text.find("{")
try:
    data = json.JSONDecoder().raw_decode(text[start:])[0]
except Exception as exc:  # noqa: BLE001
    print("parse error", exc)
    print(text[-1500:])
    sys.exit(1)
out = {k: v for k, v in data.items() if k not in ("tests", "mutants")}
sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False, indent=1).encode("utf-8"))
