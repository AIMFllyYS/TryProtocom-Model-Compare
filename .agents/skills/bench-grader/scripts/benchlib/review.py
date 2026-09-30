"""人工 / agent 评分与用量补录：生成统一的评分包，导入用户填写结果。

原则：
- 人工评分一次性汇总询问：同一检查项的所有运行放在一起横向比较（盲评，只显示别名）。
- agent 项由执行本 skill 的 agent 阅读代码/文档后填写并附证据，用户可覆盖。
- 用时成本缺失的运行汇总到 usage_needed.csv，一次性请用户补充。
"""
from __future__ import annotations

import csv
import html
import json
import os
from pathlib import Path

from .common import dimensions, dump_json, load_json, load_rubric
from .scoring import TIER_LABEL
from .runs import alias_map, all_meta, rescore
from .usage import USER_FIELDS, resolve_usage

SHEET_FIELDS = ["task", "item_id", "method", "dim", "tier", "criterion", "anchor_0", "anchor_1", "anchor_2", "anchor_3", "evidence", "alias", "open", "score", "note"]


DIM_NAME = {d["id"]: d["name"] for d in dimensions()}


def build_packet(data: Path, task: str | None = None) -> dict:
    rv = data / "review"
    rv.mkdir(parents=True, exist_ok=True)
    aliases = alias_map(data)
    rows = {"human": [], "agent": []}
    cards = []
    for meta in all_meta(data):
        if task and meta["task"] != task:
            continue
        rd = Path(meta["_dir"])
        sc = rescore(rd)
        rub = load_rubric(meta["task"])
        items = {it["id"]: it for it in rub.get("items", [])}
        metrics = load_json(rd / "metrics.json", {}) or {}
        arts = metrics.get("artifacts", {})
        entry = _entry(rd, rub)
        for r in sc["items"]:
            if r["status"] != "pending":
                continue
            it = items[r["id"]]
            anchors = it.get("anchors", ["", "", "", ""])
            row = {"task": meta["task"] + (meta.get("variant") or ""), "item_id": r["id"], "method": r["method"], "dim": DIM_NAME.get(r["dim"], r["dim"]),
                   "tier": TIER_LABEL.get(r["tier"], r["tier"]), "criterion": it["desc"], "anchor_0": anchors[0], "anchor_1": anchors[1], "anchor_2": anchors[2],
                   "anchor_3": anchors[3], "evidence": it.get("evidence", ""), "alias": aliases[meta["run_id"]],
                   "open": os.path.relpath(entry, rv) if entry else "", "score": "", "note": ""}
            rows[r["method"]].append(row)
            shots = [arts[k] for k in ("desktop", "timeline_contact", "mobile") if arts.get(k)] + [p for k, p in arts.items() if k.startswith("shots_")]
            cards.append({**row, "shots": [os.path.relpath(p, rv) for p in shots if p.endswith((".png", ".jpg")) and Path(p).exists()][:4],
                          "video": os.path.relpath(arts["review_video"], rv) if arts.get("review_video") and Path(arts["review_video"]).exists() else
                                   (os.path.relpath(arts["video"], rv) if arts.get("video") and Path(arts["video"]).exists() else "")})
    for kind in ("human", "agent"):
        rows[kind].sort(key=lambda r: (r["task"], r["item_id"], r["alias"]))
        with open(rv / f"{kind}_sheet.csv", "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=SHEET_FIELDS)
            w.writeheader()
            w.writerows(rows[kind])
    _write_html(rv / "index.html", [c for c in cards if c["method"] == "human"])
    usage_rows = usage_needed(data)
    return {"human": len(rows["human"]), "agent": len(rows["agent"]), "usage_missing": len(usage_rows), "dir": str(rv)}


def _entry(rd: Path, rub: dict) -> Path | None:
    root = rd / "output" / rub.get("deliverable_dir", "")
    for cand in ("dist/index.html", "index.html", "final.mp4", "FIXES.md", "README.md"):
        p = root / cand
        if p.exists():
            return p
    return root if root.exists() else None


def usage_needed(data: Path) -> list[dict]:
    from .common import bench_config
    cfg = bench_config()
    out = []
    for meta in all_meta(data):
        u = resolve_usage(meta, cfg)
        meta_path = Path(meta["_dir"]) / "meta.json"
        m = load_json(meta_path)
        m["usage_resolved"] = u
        dump_json(meta_path, m)
        if u["missing"]:
            out.append({"run_id": meta["run_id"], "task": meta["task"] + (meta.get("variant") or ""), "model": meta["model"],
                        "harness": meta["harness"], "workspace": meta.get("workspace") or "", "started_at": meta.get("started_at") or "",
                        "found_source": u["source"], "missing": "|".join(u["missing"]),
                        **{k: u.get(k, "") for k in USER_FIELDS}})
    rv = data / "review"
    rv.mkdir(parents=True, exist_ok=True)
    with open(rv / "usage_needed.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["run_id", "task", "model", "harness", "workspace", "started_at", "found_source", "missing", *USER_FIELDS])
        w.writeheader()
        w.writerows(out)
    return out


def ingest_scores(data: Path, csv_path: Path, by: str | None = None) -> int:
    aliases = alias_map(data)
    inv = {v: k for k, v in aliases.items()}
    n = 0
    with open(csv_path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            s = (row.get("score") or "").strip()
            if s == "":
                continue
            rid = inv.get(row["alias"].strip())
            if not rid:
                continue
            rd = data / "runs" / rid
            ms = load_json(rd / "manual_scores.json", {}) or {}
            ms[row["item_id"].strip()] = {"score": max(0.0, min(3.0, float(s))), "note": row.get("note", ""), "by": by or row.get("method", "human")}
            dump_json(rd / "manual_scores.json", ms)
            n += 1
    for meta in all_meta(data):
        rescore(Path(meta["_dir"]))
    return n


def ingest_usage(data: Path, csv_path: Path) -> int:
    n = 0
    with open(csv_path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            rd = data / "runs" / row["run_id"].strip()
            meta = load_json(rd / "meta.json")
            if not meta:
                continue
            u = meta.get("usage") or {}
            for k in USER_FIELDS:
                v = (row.get(k) or "").strip()
                if v:
                    u[k] = float(v)
            meta["usage"] = u
            dump_json(rd / "meta.json", meta)
            n += 1
    return n


def _write_html(path: Path, cards: list[dict]) -> None:
    data = json.dumps(cards, ensure_ascii=False)
    path.write_text(REVIEW_HTML.replace("__DATA__", data.replace("</", "<\\/")), encoding="utf-8")


REVIEW_HTML = r"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>人工评分</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--muted:#5d6678;--line:#dde1e8;--accent:#2f5bd3;--pick:#e7eefc}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1a1f27;--fg:#e6e9ef;--muted:#9aa3b2;--line:#2b323d;--accent:#7ea2ff;--pick:#233150;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;z-index:2}
header h1{font-size:16px;margin:0}
.bar{margin-left:auto;display:flex;gap:8px;align-items:center}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:6px 12px;border-radius:6px;cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
main{max-width:1200px;margin:0 auto;padding-block:16px;padding-inline:16px;display:grid;gap:20px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
section h2{font-size:15px;margin:0 0 4px}
.meta{color:var(--muted);font-size:12px}
.anchors{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px;margin:10px 0;font-size:12.5px}
.anchors div{border:1px solid var(--line);border-radius:6px;padding:6px 8px}
.anchors b{color:var(--accent)}
.runs{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.run{border:1px solid var(--line);border-radius:8px;padding:10px;min-width:0}
.run img{width:100%;max-height:220px;object-fit:contain;object-position:top;background:var(--bg);border-radius:4px;display:block;margin-bottom:6px;cursor:zoom-in}
.run .alias{font-weight:600}
.scores{display:flex;gap:6px;margin:8px 0}
.scores label{flex:1;text-align:center;border:1px solid var(--line);border-radius:6px;padding:4px 0;cursor:pointer}
.scores input{display:none}
.scores input:checked+span{font-weight:700;color:var(--accent)}
.scores label:has(input:checked){background:var(--pick);border-color:var(--accent)}
textarea{width:100%;box-sizing:border-box;font:inherit;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg);min-height:34px}
a{color:var(--accent)}
.progress{font-variant-numeric:tabular-nums;color:var(--muted)}
</style></head><body>
<header><h1>人工评分（盲评）</h1><span class="progress" id="prog"></span>
<div class="bar"><button id="exp" class="primary">导出 human_scores.csv</button></div></header>
<main id="main"></main>
<script id="data" type="application/json">__DATA__</script>
<script>
const cards = JSON.parse(document.getElementById('data').textContent);
const KEY = 'bench-review-v1';
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
const groups = {};
for (const c of cards) (groups[c.task + '|' + c.item_id] ||= []).push(c);
const main = document.getElementById('main');
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
for (const [k, list] of Object.entries(groups)) {
  const c0 = list[0];
  const sec = document.createElement('section');
  sec.innerHTML = `<h2>${esc(c0.task)} · ${esc(c0.item_id)} ${esc(c0.criterion)}</h2>
  <div class="meta">维度 ${esc(c0.dim)} · ${esc(c0.tier)} · 依据：${esc(c0.evidence)}</div>
  <div class="anchors">${[0,1,2,3].map(i => `<div><b>${i}</b> ${esc(c0['anchor_' + i])}</div>`).join('')}</div>
  <div class="runs">${list.map(c => {
    const id = c.item_id + '::' + c.alias; const s = saved[id] || {};
    return `<div class="run" data-id="${esc(id)}">
      <div class="alias">${esc(c.alias)}</div>
      ${(c.shots || []).slice(0, 2).map(p => `<a href="${esc(p)}" target="_blank"><img loading="lazy" src="${esc(p)}" alt="截图"></a>`).join('')}
      <div class="meta">${c.video ? `<a href="${esc(c.video)}" target="_blank">评审视频</a> · ` : ''}${c.open ? `<a href="${esc(c.open)}" target="_blank">打开作品</a>` : ''}</div>
      <div class="scores">${[0,1,2,3].map(i => `<label><input type="radio" name="${esc(id)}" value="${i}" ${String(s.score) === String(i) ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div>
      <textarea placeholder="备注（可选）">${esc(s.note || '')}</textarea></div>`;
  }).join('')}</div>`;
  main.appendChild(sec);
}
function collect() {
  const out = {};
  document.querySelectorAll('.run').forEach(el => {
    const id = el.dataset.id; const r = el.querySelector('input:checked');
    out[id] = {score: r ? r.value : '', note: el.querySelector('textarea').value};
  });
  return out;
}
function update() {
  const all = collect(); saved = all;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  const done = Object.values(all).filter(x => x.score !== '').length;
  document.getElementById('prog').textContent = `已评 ${done} / ${Object.keys(all).length}`;
}
main.addEventListener('change', update); main.addEventListener('input', update); update();
document.getElementById('exp').addEventListener('click', () => {
  const all = collect();
  const rows = [['task','item_id','alias','score','note','method']];
  for (const c of cards) { const s = all[c.item_id + '::' + c.alias] || {}; rows.push([c.task, c.item_id, c.alias, s.score ?? '', (s.note || '').replace(/\n/g, ' '), 'human']); }
  const csv = rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv'}));
  a.download = 'human_scores.csv'; a.click();
});
</script></body></html>"""
