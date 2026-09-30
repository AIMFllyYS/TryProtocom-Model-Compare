#!/usr/bin/env python3
"""bench-grader 命令行入口。

常用流程：
  python scripts/bench.py doctor                                  # 检查评测机依赖
  python scripts/bench.py init-run --task T07 --model X --harness "Claude Code" --src /path/to/studyspot-api \
         --final-message final.md --workspace /path/to/workdir --started-at 2026-10-08T10:00:00+08:00
  python scripts/bench.py grade --all                             # 自动评分（探针 + 规则）
  python scripts/bench.py review                                  # 生成人工/agent 评分包 + 用量缺失清单
  python scripts/bench.py ingest-scores review/human_scores.csv   # 导入人工评分
  python scripts/bench.py ingest-usage review/usage_needed.csv    # 导入用户补充的用时成本
  python scripts/bench.py aggregate && python scripts/bench.py export --formats csv,md,xlsx,png,html
  python scripts/bench.py build-spec --out spec.html              # 由 rubric 生成规范页
所有命令默认数据目录 ./bench-data，可用 --data 指定。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from benchlib import aggregate, export, review, runs, spec  # noqa: E402
from benchlib.common import load_json, load_rubric, task_dirs  # noqa: E402


def cmd_doctor(a):
    checks = []
    for mod in ("yaml", "playwright", "PIL", "numpy", "openpyxl", "matplotlib", "pytest"):
        try:
            __import__(mod)
            checks.append((mod, True, ""))
        except ImportError:
            checks.append((mod, False, "pip install " + {"yaml": "pyyaml", "PIL": "pillow"}.get(mod, mod)))
    for exe in ("ffmpeg", "ffprobe", "node", "npm"):
        checks.append((exe, shutil.which(exe) is not None, "按系统安装"))
    try:
        from benchlib.probes.jslib import browser_session
        with browser_session() as b:
            p = b.new_page()
            ok = p.evaluate("() => !!document.createElement('canvas').getContext('webgl')")
        checks.append(("chromium+webgl", ok, "Playwright 自带 Chromium；WebGL 需 swiftshader 或 GPU"))
    except Exception as e:  # noqa: BLE001
        checks.append(("chromium", False, str(e)[:120]))
    for opt in ("faster_whisper", "whisper"):
        try:
            __import__(opt)
            checks.append((opt + "（可选，T04 ASR）", True, ""))
            break
        except ImportError:
            pass
    else:
        checks.append(("faster-whisper（可选，T04 ASR）", False, "pip install faster-whisper；缺失时 ASR 项记 N/A"))
    for name, ok, hint in checks:
        print(f"{'✔' if ok else '✘'} {name:<34} {'' if ok else hint}")


def cmd_init(a):
    extra = json.loads(a.extra) if a.extra else None
    rd = runs.init_run(Path(a.data), a.task, a.model, a.harness, Path(a.src), a.variant, a.run_index,
                       Path(a.final_message) if a.final_message else None, a.workspace, a.started_at, a.ended_at, extra)
    for f in ("transcript_notes.json",):
        if a.transcript and Path(a.transcript).exists():
            shutil.copy(a.transcript, rd / f)
    print(rd)


def cmd_grade(a):
    data = Path(a.data)
    targets = [Path(m["_dir"]) for m in runs.all_meta(data)] if a.all else [Path(p) for p in a.runs]
    if a.task:
        targets = [t for t in targets if load_json(t / "meta.json")["task"] == a.task]
    for rd in targets:
        if a.skip_graded and (rd / "metrics.json").exists():
            sc = runs.rescore(rd)
        else:
            sc = runs.grade_run(rd, fast=a.fast, only=a.only.split(",") if a.only else None)
        meta = load_json(rd / "meta.json")
        gate = "通过" if sc["gate_pass"] else "未通过 " + ",".join(g["id"] for g in sc["gate_fail"])
        print(f"{meta['run_id']:<22} {meta['model']} @ {meta['harness']:<16} 总分 {sc['total']:6.2f}  门槛{gate}  "
              f"N/A {sc['na_ratio']:.0%}  待评 {len(sc['pending'])}")


def cmd_review(a):
    r = review.build_packet(Path(a.data), a.task)
    print(json.dumps(r, ensure_ascii=False, indent=1))


def cmd_ingest_scores(a):
    print("导入", review.ingest_scores(Path(a.data), Path(a.csv), a.by), "条评分")


def cmd_ingest_usage(a):
    print("导入", review.ingest_usage(Path(a.data), Path(a.csv)), "条用量")


def cmd_aggregate(a):
    agg = aggregate.collect(Path(a.data))
    for b in agg["board"]:
        print(f"{b['rank']:>4}  {b['entrant']:<40} 质量 {b['quality']}  CI [{b['ci_low']}, {b['ci_high']}]")


def cmd_export(a):
    data = Path(a.data)
    agg = load_json(data / "results" / "aggregate.json") or aggregate.collect(data)
    files = export.export_all(agg, Path(a.out) if a.out else data / "exports", set(a.formats.split(",")))
    for f in files:
        print(f)


def cmd_spec(a):
    p = spec.build(Path(a.out))
    print(p)


def cmd_list(a):
    for tid, d in task_dirs().items():
        r = load_rubric(tid)
        n = len(r.get("items", []))
        auto = sum(1 for i in r["items"] if i.get("method", "auto") == "auto")
        print(f"{tid}  {r['name']:<28} 检查项 {n:>3}（自动 {auto}） 维度 {r.get('dims')}")


def cmd_validate(a):
    """检查 rubric 自洽：id 唯一、维度合法、规则/锚点齐全、层级合法。"""
    from benchlib.common import dimensions
    dims = {d["id"] for d in dimensions()}
    bad = 0
    for tid in task_dirs():
        r = load_rubric(tid)
        ids = set()
        for it in r.get("gates", []) + r.get("items", []):
            problems = []
            if it["id"] in ids:
                problems.append("id 重复")
            ids.add(it["id"])
            if "dim" in it and it["dim"] not in dims:
                problems.append(f"未知维度 {it['dim']}")
            m = it.get("method", "auto")
            if it in r.get("items", []):
                if it.get("tier", "basic") not in ("basic", "advanced", "excellent", "clean"):
                    problems.append("层级非法")
                if m == "auto" and not (("metric" in it or "value_expr" in it) and "rule" in it):
                    problems.append("自动项缺 metric/rule")
                if m in ("human", "agent") and len(it.get("anchors", [])) != 4:
                    problems.append("缺 4 级锚点")
                if it["dim"] not in (r.get("dims") or {}) and not any(it["dim"] in (v.get("dims") or {}) for v in (r.get("variants") or {}).values()):
                    problems.append(f"维度 {it['dim']} 未在 dims 中声明")
            if problems:
                bad += 1
                print(f"{tid} {it['id']}: {'; '.join(problems)}")
    print("rubric 校验通过" if not bad else f"{bad} 处问题")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description="bench-grader")
    ap.add_argument("--data", default="bench-data")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor").set_defaults(fn=cmd_doctor)
    sub.add_parser("list").set_defaults(fn=cmd_list)
    sub.add_parser("validate-rubrics").set_defaults(fn=cmd_validate)
    p = sub.add_parser("init-run")
    p.add_argument("--task", required=True)
    p.add_argument("--variant")
    p.add_argument("--model", required=True)
    p.add_argument("--harness", required=True)
    p.add_argument("--src", required=True, help="模型交付的文件夹")
    p.add_argument("--run-index", type=int)
    p.add_argument("--final-message", help="模型最后一条回复（文本/Markdown 文件）")
    p.add_argument("--transcript", help="T06：评测者记录的 transcript_notes.json")
    p.add_argument("--workspace", help="模型运行时的工作目录（用于匹配本地日志）")
    p.add_argument("--started-at")
    p.add_argument("--ended-at")
    p.add_argument("--extra", help="附加 meta（JSON），如 {\"log_path\": \"...\", \"usage\": {...}}")
    p.set_defaults(fn=cmd_init)
    p = sub.add_parser("grade")
    p.add_argument("runs", nargs="*")
    p.add_argument("--all", action="store_true")
    p.add_argument("--task")
    p.add_argument("--fast", action="store_true", help="跳过评审视频渲染")
    p.add_argument("--only", help="只运行指定探针，逗号分隔")
    p.add_argument("--skip-graded", action="store_true", help="已有 metrics.json 的只重新计分")
    p.set_defaults(fn=cmd_grade)
    p = sub.add_parser("review")
    p.add_argument("--task")
    p.set_defaults(fn=cmd_review)
    p = sub.add_parser("ingest-scores")
    p.add_argument("csv")
    p.add_argument("--by", choices=["human", "agent"])
    p.set_defaults(fn=cmd_ingest_scores)
    p = sub.add_parser("ingest-usage")
    p.add_argument("csv")
    p.set_defaults(fn=cmd_ingest_usage)
    sub.add_parser("aggregate").set_defaults(fn=cmd_aggregate)
    p = sub.add_parser("export")
    p.add_argument("--formats", default="csv,md,xlsx,png,html")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_export)
    p = sub.add_parser("build-spec")
    p.add_argument("--out", default="benchmark-spec.html")
    p.set_defaults(fn=cmd_spec)
    a = ap.parse_args()
    rc = a.fn(a)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
