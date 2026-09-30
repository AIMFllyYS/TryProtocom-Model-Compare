#!/usr/bin/env python3
"""bench-workbench ↔ bench-grader 桥接脚本。

工作台服务端（Node）通过本脚本调用 bench-grader 的 Python 实现，保证规范、评分、用量解析与 skill 完全一致。
所有命令向 stdout 输出一行 JSON：{"ok": true, "data": ...} 或 {"ok": false, "error": "..."}。

  python wbbridge.py spec                                   # 规范数据（= build-spec 使用的数据）+ 完整配置 + 单价表
  python wbbridge.py snapshot --data <bench-data>           # 全部运行：meta、重新计分后的 score、用量、人工分、产物、别名
  python wbbridge.py rescore  --data <bench-data> --run <id>
  python wbbridge.py set-manual --data <bench-data> --run <id> --item <item_id> --score <0-3|""> [--note ..] [--by human|agent]
  python wbbridge.py probe-page --url <url> [--viewport 1440x900] [--wait 2500] [--shot out.png] [--mobile]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
GRADER = Path(os.environ.get("WB_GRADER_DIR") or HERE.parents[1] / "skills" / "bench-grader")
sys.path.insert(0, str(GRADER / "scripts"))


def out(data=None, error: str | None = None) -> None:
    payload = {"ok": error is None, "data": data} if error is None else {"ok": False, "error": error}
    # 评分代码内部可能 print；用标记行分隔，服务端只解析标记之后的 JSON
    sys.stdout.write("\n@@WB@@" + json.dumps(payload, ensure_ascii=False, default=str))
    sys.stdout.flush()


def _clean(v):
    """JSON 不支持 inf/nan：统一转为字符串标记，前端按 'inf' 处理。"""
    import math
    if isinstance(v, float):
        if math.isinf(v):
            return "inf"
        if math.isnan(v):
            return None
        return v
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


def cmd_spec(a):
    from benchlib import spec
    from benchlib.common import CONFIG_DIR, bench_config, load_yaml
    data = spec.collect()
    data["config_full"] = bench_config()
    try:
        data["prices"] = load_yaml(CONFIG_DIR / "prices.yaml") or {}
    except Exception:  # noqa: BLE001
        data["prices"] = {}
    # 每题的素材是否已生成（T03/T04 的 wav 需先运行 build_materials.py）
    from benchlib.common import task_dirs
    mats = {}
    for tid, d in task_dirs().items():
        md = d / "materials"
        files = sorted(p.relative_to(md).as_posix() for p in md.rglob("*") if p.is_file()) if md.exists() else []
        missing = []
        for m in (spec.load_rubric(tid).get("materials") or []):
            if not (isinstance(m, str) and m.startswith("materials/")):
                continue
            m = m.split("（")[0].split("(")[0].strip()
            if "*" in m:
                if not list(d.glob(m)):
                    missing.append(m)
            elif not (d / m).exists():
                missing.append(m)
        mats[tid] = {"dir": str(d), "files": files, "missing": missing}
    data["materials_state"] = mats
    out(_clean(data))


def _run_record(rd: Path, root: Path) -> dict:
    from benchlib.common import bench_config, load_json
    from benchlib.runs import rescore
    from benchlib.usage import resolve_usage
    meta = load_json(rd / "meta.json") or {}
    sc = rescore(rd) if (rd / "metrics.json").exists() or meta else None
    try:
        usage = resolve_usage(meta, bench_config())
    except Exception as e:  # noqa: BLE001
        usage = {"source": "error", "missing": ["wall_min", "cost_usd"], "error": str(e)}
    metrics = load_json(rd / "metrics.json", {}) or {}
    arts = {}
    for k, p in (metrics.get("artifacts") or {}).items():
        if isinstance(p, str):
            pp = Path(p)
            try:
                arts[k] = pp.resolve().relative_to(root).as_posix()
            except ValueError:
                arts[k] = str(pp)
    graded = (rd / "metrics.json").exists()
    return {
        "run_id": meta.get("run_id", rd.name), "meta": {k: v for k, v in meta.items() if k != "usage_resolved"},
        "score": sc if graded else None, "usage": usage, "manual": load_json(rd / "manual_scores.json", {}) or {},
        "artifacts": arts, "notes": metrics.get("notes", []), "na": metrics.get("na", {}),
        "graded": graded, "dir": rd.resolve().relative_to(root).as_posix() if str(rd.resolve()).startswith(str(root)) else str(rd),
        "has_final_message": (rd / "final_message.md").exists(),
    }


def cmd_snapshot(a):
    from benchlib.runs import alias_map, runs_dir
    data = Path(a.data)
    root = Path(a.root).resolve() if a.root else data.resolve().parent
    rows = []
    rdir = runs_dir(data)
    if rdir.exists():
        for d in sorted(rdir.iterdir()):
            if (d / "meta.json").exists():
                try:
                    rows.append(_run_record(d, root))
                except Exception as e:  # noqa: BLE001
                    rows.append({"run_id": d.name, "error": f"{type(e).__name__}: {e}"})
    aliases = alias_map(data) if rows else {}
    for r in rows:
        r["alias"] = aliases.get(r["run_id"])
    out(_clean({"runs": rows, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}))


def cmd_rescore(a):
    data = Path(a.data)
    rd = data / "runs" / a.run
    root = Path(a.root).resolve() if a.root else data.resolve().parent
    out(_clean(_run_record(rd, root)))


def cmd_set_manual(a):
    from benchlib.common import dump_json, load_json
    data = Path(a.data)
    rd = data / "runs" / a.run
    if not (rd / "meta.json").exists():
        return out(error=f"运行不存在：{a.run}")
    ms = load_json(rd / "manual_scores.json", {}) or {}
    if a.score in (None, ""):
        ms.pop(a.item, None)
    else:
        s = max(0.0, min(3.0, float(a.score)))
        ms[a.item] = {"score": s, "note": a.note or "", "by": a.by or "human", "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    dump_json(rd / "manual_scores.json", ms)
    root = Path(a.root).resolve() if a.root else data.resolve().parent
    out(_clean(_run_record(rd, root)))


def cmd_probe_page(a):
    """无头 Chromium 打开页面，收集 console / 页面异常 / 失败请求，并截图。供 CLI 与 Agent 读取“F12 报错”。"""
    try:
        from benchlib.probes.jslib import browser_session
    except Exception as e:  # noqa: BLE001
        return out(error=f"无法加载 playwright：{e}")
    w, h = (int(x) for x in (a.viewport or "1440x900").lower().split("x"))
    logs, failed, errors = [], [], []
    t0 = time.time()
    with browser_session() as b:
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=a.dpr or 1,
                            is_mobile=bool(a.mobile), has_touch=bool(a.mobile),
                            user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" if a.mobile else None))
        page = ctx.new_page()
        page.on("console", lambda m: logs.append({"level": m.type, "text": m.text, "url": (m.location or {}).get("url"), "line": (m.location or {}).get("lineNumber")}))
        page.on("pageerror", lambda e: errors.append({"level": "error", "text": str(e)}))
        page.on("requestfailed", lambda r: failed.append({"url": r.url, "method": r.method, "error": (r.failure or "")}))
        statuses = []
        page.on("response", lambda r: statuses.append({"url": r.url, "status": r.status}) if r.status >= 400 else None)
        load_ok, load_err = True, None
        try:
            page.goto(a.url, wait_until="load", timeout=int(a.timeout or 45000))
        except Exception as e:  # noqa: BLE001
            load_ok, load_err = False, str(e)[:500]
        page.wait_for_timeout(int(a.wait or 2500))
        title = ""
        try:
            title = page.title()
        except Exception:  # noqa: BLE001
            pass
        shot = None
        if a.shot:
            Path(a.shot).parent.mkdir(parents=True, exist_ok=True)
            try:
                page.screenshot(path=a.shot, full_page=bool(a.full))
                shot = a.shot
            except Exception as e:  # noqa: BLE001
                errors.append({"level": "error", "text": f"截图失败：{e}"})
        ctx.close()
    n_err = sum(1 for l in logs if l["level"] == "error") + len(errors)
    out({"url": a.url, "title": title, "loaded": load_ok, "load_error": load_err, "viewport": [w, h], "mobile": bool(a.mobile),
         "console": logs[-400:], "page_errors": errors, "failed_requests": failed[-200:], "http_errors": statuses[-200:],
         "counts": {"error": n_err, "warning": sum(1 for l in logs if l["level"] == "warning"), "failed_requests": len(failed), "http_errors": len(statuses)},
         "screenshot": shot, "ms": int((time.time() - t0) * 1000)})


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("spec").set_defaults(fn=cmd_spec)
    p = sub.add_parser("snapshot"); p.add_argument("--data", required=True); p.add_argument("--root"); p.set_defaults(fn=cmd_snapshot)
    p = sub.add_parser("rescore"); p.add_argument("--data", required=True); p.add_argument("--root"); p.add_argument("--run", required=True); p.set_defaults(fn=cmd_rescore)
    p = sub.add_parser("set-manual")
    for k in ("--data", "--run", "--item"):
        p.add_argument(k, required=True)
    p.add_argument("--root"); p.add_argument("--score", default=""); p.add_argument("--note", default=""); p.add_argument("--by", default="human")
    p.set_defaults(fn=cmd_set_manual)
    p = sub.add_parser("probe-page")
    p.add_argument("--url", required=True); p.add_argument("--viewport"); p.add_argument("--wait", type=int); p.add_argument("--timeout", type=int)
    p.add_argument("--shot"); p.add_argument("--full", action="store_true"); p.add_argument("--mobile", action="store_true"); p.add_argument("--dpr", type=float)
    p.set_defaults(fn=cmd_probe_page)
    a = ap.parse_args()
    try:
        a.fn(a)
    except Exception as e:  # noqa: BLE001
        out(error=f"{type(e).__name__}: {e}\n{traceback.format_exc()[-1500:]}")


if __name__ == "__main__":
    main()
