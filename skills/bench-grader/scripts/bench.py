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
import re
import shutil
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from benchlib import aggregate, export, review, runs, spec  # noqa: E402
from benchlib.common import bench_config, dump_json, load_json, load_rubric, task_dirs  # noqa: E402


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
              f"N/A {sc['na_ratio']:.0%}  待评 {len(sc['pending'])}", flush=True)


def cmd_review(a):
    r = review.build_packet(Path(a.data), a.task)
    print(json.dumps(r, ensure_ascii=False, indent=1))


def cmd_ingest_scores(a):
    print("导入", review.ingest_scores(Path(a.data), Path(a.csv), a.by), "条评分")


def cmd_ingest_pairwise(a):
    from benchlib import pairwise
    r = pairwise.ingest(Path(a.data), Path(a.file), a.by)
    print(f"写入 {r['written']} 条评分（跳过 {r['skipped']} 行无效比较）")
    for k, v in r["groups"].items():
        print(f"  {k}: {v['comparisons']} 次比较 → {v['runs']} 个作品")


def cmd_ingest_exploration(a):
    from benchlib import agent_accept
    r = agent_accept.ingest_exploration(Path(a.data), Path(a.dir) if a.dir else None)
    print(f"导入 {len(r['imported'])} 份探索报告")
    for s in r["skipped"]:
        print("  跳过", s)


def cmd_agent_sample(a):
    from benchlib import agent_accept
    rows = agent_accept.audit_sample(Path(a.data), a.rate)
    print(f"抽出 {len(rows)} 条 Agent 打分请人工复核 → review/agent_audit_sample.csv（填 score 列后用 ingest-scores --by human 导入）")


def cmd_agent_calibration(a):
    from benchlib import agent_accept
    agent_accept.print_calibration(agent_accept.calibration(Path(a.data), a.min_pairs))


def cmd_backend_check(a):
    """后端题出题质检：参考实现自测 / 变异检验 / 初始缺陷仓库校验。失败时退出码非 0。"""
    from benchlib import backend_check as bc
    ok = True
    for t in a.tasks:
        if a.mutation:
            r = bc.mutation(t, a.limit)
            print(bc.format_report(f"{t} 变异检验", r))
            ok = ok and r.get("score") is not None and not r.get("valid_failures") and r["score"] >= a.min_kill
        if a.defect:
            r = bc.defect(t)
            print(bc.format_report(f"{t} 初始缺陷仓库", r))
            ok = ok and (r.get("ok", True))
        if not a.mutation and not a.defect:
            r = bc.selftest(t)
            print(bc.format_report(f"{t} 参考实现自测", r))
            ok = ok and r["ok"]
    sys.exit(0 if ok else 1)


def cmd_ingest_usage(a):
    print("导入", review.ingest_usage(Path(a.data), Path(a.csv)), "条用量")


def cmd_aggregate(a):
    agg = aggregate.collect(Path(a.data), a.view)
    for b in agg["board"]:
        extra = ""
        if a.view == "simple":
            extra = f"  n={b.get('n_min')}–{b.get('n_max')}{'*' if b.get('star') else ''}"
        elif a.view == "full":
            extra = f"  稳定性 {b['dims'].get('stability')}（可用 {b.get('availability')} / 一致 {b.get('consistency')}）"
        print(f"{b['rank']:>4}  {b['entrant']:<40} 质量 {b['quality']}  CI [{b['ci_low']}, {b['ci_high']}]{extra}")
    for x in agg.get("excluded", []):
        print(f"  未入榜 {x['entrant']}：{'、'.join(x['missing'])}")


def cmd_mark_incident(a):
    """给一次运行打“事故”标记（环境/Harness/中断等非模型能力原因）。事故不改分，只允许在简化版里重测、并在榜单标注；
    完整版里不剔除，计入稳定性。--clear 取消标记。"""
    rd = runs.runs_dir(Path(a.data)) / a.run
    meta = load_json(rd / "meta.json")
    if not meta:
        print(f"找不到运行 {a.run}")
        return 1
    if a.clear:
        meta["incident"] = None
    else:
        kinds = (bench_config().get("v2") or {}).get("incident_kinds", [])
        if kinds and a.kind not in kinds:
            print(f"kind 必须是 {kinds}")
            return 1
        meta["incident"] = {"kind": a.kind, "reason": a.reason or "", "date": date.today().isoformat()}
    dump_json(rd / "meta.json", meta)
    print(a.run, "incident =", meta["incident"])


def cmd_export(a):
    data = Path(a.data)
    fname = "aggregate.json" if a.view == "history" else f"aggregate-{a.view}.json"
    agg = load_json(data / "results" / fname) or aggregate.collect(data, a.view)
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
        if str(r.get("suite") or "v1") not in ("v1", "v2"):
            print(f"{tid}: suite 只能是 v1 / v2")
            bad += 1
        # v2 题：提示词分“契约 / 愿望”两层（后端题只有契约）；命名视角与部件树采集配置合法
        if str(r.get("suite") or "v1") == "v2":
            pm = Path(r["_dir"]) / "prompt.md"
            ptxt = pm.read_text(encoding="utf-8") if pm.exists() else ""
            need = ["## 契约"] if r.get("kind") == "backend" else ["## 契约", "## 愿望"]
            for h in need:
                if h not in ptxt:
                    print(f"{tid}: prompt.md 缺少 “{h}” 小节")
                    bad += 1
            if r.get("kind") not in ("creative", "backend", "motion"):
                print(f"{tid}: v2 题必须声明 kind（creative / backend / motion）")
                bad += 1
        cap = r.get("capture") or {}
        vids = [v.get("id") for v in cap.get("views", []) if isinstance(v, dict)]
        if cap.get("views") and (len(vids) != len(cap["views"]) or len(set(vids)) != len(vids) or not all(vids)):
            print(f"{tid}: capture.views 每项需要唯一的 id")
            bad += 1
        if cap.get("parts") and not isinstance(cap["parts"].get("min_parts", 0), int):
            print(f"{tid}: capture.parts.min_parts 必须是整数")
            bad += 1
        from benchlib.probes import REGISTRY
        for p in r.get("probes", []):
            if p.get("type") not in REGISTRY:
                print(f"{tid}: 未注册的探针类型 {p.get('type')}")
                bad += 1
        mo = cap.get("motion") or {}
        if mo and not (mo.get("samples") or (mo.get("seek") and mo.get("times"))):
            print(f"{tid}: capture.motion 需要 samples，或同时给出 seek 与 times")
            bad += 1
        for c in cap.get("contacts") or []:
            if not (c.get("a") and c.get("b")):
                print(f"{tid}: capture.contacts 每项需要 a / b")
                bad += 1
        for e in cap.get("expected_parts") or []:
            try:
                re.compile(e.get("re", ""))
            except re.error as ex:
                print(f"{tid}: expected_parts {e.get('id')} 的正则无效：{ex}")
                bad += 1
        for it in r.get("gates", []) + r.get("tier0", []) + r.get("items", []):
            problems = []
            if it in r.get("tier0", []) and not (("metric" in it or "value_expr" in it) and "rule" in it):
                problems.append("Tier0 项缺 metric/rule")
            if it in r.get("items", []):
                if it.get("edition", "base") not in ("base", "detail"):
                    problems.append("edition 只能是 base / detail")
                if it.get("module") is not None and not isinstance(it["module"], str):
                    problems.append("module 必须是字符串")
                if it.get("judge") not in (None, "absolute", "pairwise"):
                    problems.append("judge 只能是 absolute / pairwise")
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
    p = sub.add_parser("ingest-pairwise", help="导入两两比较结果（CSV/JSON：task,item_id,a,b,winner），Bradley–Terry 折算为 0–3 分")
    p.add_argument("file")
    p.add_argument("--by", default="pairwise")
    p.set_defaults(fn=cmd_ingest_pairwise)
    p = sub.add_parser("ingest-exploration", help="导入 Agent 探索测试结果（review/exploration/<别名>.json）→ explore.json")
    p.add_argument("--dir")
    p.set_defaults(fn=cmd_ingest_exploration)
    p = sub.add_parser("agent-sample", help="抽样请人工复核 Agent 的打分（确定性哈希，可复现）")
    p.add_argument("--rate", type=float, default=0.2)
    p.set_defaults(fn=cmd_agent_sample)
    p = sub.add_parser("agent-calibration", help="统计 Agent 分与人工复核分的一致性（准确率 / 偏差 / 加权 kappa）")
    p.add_argument("--min-pairs", type=int, default=20)
    p.set_defaults(fn=cmd_agent_calibration)
    p = sub.add_parser("backend-check", help="后端题出题质检：默认=参考实现自测；--mutation 变异检验；--defect 初始缺陷仓库校验")
    p.add_argument("tasks", nargs="+")
    p.add_argument("--mutation", action="store_true")
    p.add_argument("--defect", action="store_true")
    p.add_argument("--limit", type=int)
    p.add_argument("--min-kill", type=float, default=0.9)
    p.set_defaults(fn=cmd_backend_check)
    p = sub.add_parser("ingest-usage")
    p.add_argument("csv")
    p.set_defaults(fn=cmd_ingest_usage)
    p = sub.add_parser("aggregate")
    p.add_argument("--view", choices=["history", "simple", "full"], default="history",
                   help="history=v1.0 冻结口径；simple=v2 取最高；full=v2 测满 3 次 + 稳定性")
    p.set_defaults(fn=cmd_aggregate)
    p = sub.add_parser("mark-incident")
    p.add_argument("run")
    p.add_argument("--kind", default="other", help="tier0 / harness / interrupted / other")
    p.add_argument("--reason")
    p.add_argument("--clear", action="store_true")
    p.set_defaults(fn=cmd_mark_incident)
    p = sub.add_parser("export")
    p.add_argument("--view", choices=["history", "simple", "full"], default="history")
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
