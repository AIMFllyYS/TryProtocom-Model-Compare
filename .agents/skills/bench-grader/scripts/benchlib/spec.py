"""由 config + tasks/*/rubric.yaml + prompt.md 生成单文件 HTML 规范页。"""
from __future__ import annotations

import json
from pathlib import Path

from .common import SKILL_ROOT, bench_config, dimensions, load_rubric, task_dirs
from .scoring import TIER_LABEL, item_weight

METHOD_LABEL = {"auto": "自动", "agent": "Agent 审查", "human": "人工"}

RELATIONS = [
    {"title": "同一业务域的三道工程题", "tasks": ["T06", "T07", "T08"],
     "text": "都围绕 StudySpot 自习室预约：T06 用模糊需求做前端，T07 按规格做后端，T08 在注入缺陷的旧版后端上修复与扩展。业务规则相同，便于横向比较同一模型在“理解需求 → 实现 → 维护”三个阶段的表现；T07 的隐藏测试同时是 T08 的回归测试。"},
    {"title": "A / C 对照实验", "tasks": ["T03"],
     "text": "同一份 brief 跑两组：A 组禁用 skill 和视频框架，纯手写；C 组预装 HyperFrames skills。两组由同一渲染管线出片评分，C − A 即 skill 增益。"},
    {"title": "Skill 遵循题组", "tasks": ["T02", "T03", "T04"],
     "text": "T02 考第三方 skill（Minecraft 定格）的逐条遵循，T03-C 与 T04 考 HyperFrames skills 的实战使用。三题共同支撑“Agent 执行”维度。"},
    {"title": "同一品牌的两种载体", "tasks": ["T04", "T05"],
     "text": "虚构火箭 Aether-9：T05 是 3D 交互官网，T04 是发布宣传片。参数表一致，便于核对“内容准确”，也避免真实品牌带来的拒答差异。"},
    {"title": "3D 维度的三道题", "tasks": ["T01", "T02", "T05"],
     "text": "T01 偏程序化建模与物理/生物准确度，T02 偏体素场景、镜头与光照叙事，T05 偏产品级写实渲染与交互。三题用同一套 3D 检查思路（建模、材质光照、运动、性能），3D 维度分取加权平均。"},
]


def rule_text(it: dict) -> str:
    r = it.get("rule") or {}
    t = r.get("type", "bool")
    if it.get("method") in ("human", "agent"):
        return "0–3 分锚定评分，换算为 0–1"
    if t == "bool":
        return "为真得满分" if r.get("expect", True) else "为假得满分"
    if t == "eq":
        return f"等于 {r['value']} 得满分"
    if t == "ratio":
        return "比例直接作为得分（0–1）"
    if t == "min":
        return f"≥ {r['min']} 满分" + (f"，{r['zero']} 记 0，中间线性" if r.get("zero") is not None else "，否则 0")
    if t == "max":
        return f"≤ {r['max']} 满分" + (f"，≥ {r['zero']} 记 0，中间线性" if r.get("zero") is not None else "，否则 0")
    if t == "linear":
        return f"{r['bad']} → {r['good']} 线性映射到 0 → 1" + ("（对数刻度）" if r.get("log") else "")
    if t == "band":
        return f"落在 [{r['lo']}, {r['hi']}] 满分，偏离 {r['tol']} 记 0"
    return t


def collect() -> dict:
    cfg = bench_config()
    dims = dimensions()
    tasks = []
    for tid, d in task_dirs().items():
        r = load_rubric(tid)
        prompt = (d / "prompt.md").read_text(encoding="utf-8") if (d / "prompt.md").exists() else ""
        items = []
        for it in r.get("items", []):
            items.append({"id": it["id"], "dim": it["dim"], "tier": it.get("tier", "basic"), "tier_label": TIER_LABEL.get(it.get("tier", "basic")),
                          "method": it.get("method", "auto"), "method_label": METHOD_LABEL[it.get("method", "auto")], "weight": item_weight(it),
                          "desc": it["desc"], "metric": it.get("metric") or it.get("value_expr", ""), "rule": rule_text(it),
                          "anchors": it.get("anchors", []), "evidence": it.get("evidence", ""), "variants": it.get("variants", [])})
        gates = [{"id": g["id"], "desc": g["desc"], "variants": g.get("variants", [])} for g in r.get("gates", [])]
        hidden = sorted(p.relative_to(d).as_posix() for p in (d / "hidden").rglob("*") if p.is_file()) if (d / "hidden").exists() else []
        tasks.append({"id": tid, "name": r["name"], "short": r.get("short", ""), "dims": r.get("dims", {}), "variants": r.get("variants") or {},
                      "condition": r.get("condition", ""), "materials": r.get("materials", []), "time_limit": r.get("time_limit_min"),
                      "deliverable": r.get("deliverable_dir", ""), "probes": [p["type"] for p in r.get("probes", [])],
                      "prompt": prompt, "items": items, "gates": gates, "hidden": hidden, "bugs": r.get("bugs")})
    return {"cfg": {k: cfg.get(k) for k in ("name", "version", "frozen_date", "runs_per_task", "pass_threshold", "efficiency", "low_confidence_na_ratio")},
            "dims": dims, "tasks": tasks, "relations": RELATIONS}


def build(out: Path) -> Path:
    data = collect()
    tpl = (SKILL_ROOT / "assets" / "spec_template.html").read_text(encoding="utf-8")
    html = tpl.replace("__SPEC_DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    html = html.replace("__TITLE__", f"{data['cfg']['name']} {data['cfg']['version']}")
    out.write_text(html, encoding="utf-8")
    return out
