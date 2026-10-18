"""v2 评分页的数据与页面：两两比较、固定交互走查清单、多模态预填与探索报告。

约定：
- 页面永远只显示盲评别名（alias），不出现模型名。
- 两两比较项（rubric `judge: pairwise`）：同一题同一检查项下的作品两两配对，成对展示同一命名视角的截图 / 环绕视频；
  结果导出为 pairwise.csv，交给 `bench.py ingest-pairwise`（Bradley–Terry → 0–3 分）。同题只有 1 个作品时退回绝对打分。
- 交互走查（`*-H00`）：固定清单逐项勾选，页面按失败数给出建议分；最终分数由人决定。
- 多模态预填：`review/agent_prefill.json`（多模态模型按 `agent_prefill_request.json` 填写）只作为“建议”显示，
  必须由人点“采纳”或自己打分；导出时记录“是否与预填一致”，用于校准多模态与人工的一致性。
- 探索报告：`review/exploration/<alias>.md` 是 agent 点过整个页面后的发现，折叠显示在对应作品的卡片里。
"""
from __future__ import annotations

import hashlib
import json
import os
import random
from pathlib import Path

DEFAULT_WALKTHROUGH = [
    "打开页面后不用任何操作就有画面（没有白屏 / 报错弹窗）",
    "把页面上每一个按钮都点一遍：没有点了没反应、卡死或抛错的按钮",
    "每一个滑块 / 开关 / 下拉：拖动或切换后画面有对应变化",
    "拖拽 / 缩放 / 旋转镜头：能操作，且有合理边界（不会翻进地下或飞走）",
    "命名视角与预设切换：每个都能切换，切完画面稳定",
    "键盘操作（如果页面声明了快捷键）：按声明的键有对应效果",
    "刷新页面后能恢复正常，没有残留的错误状态",
    "窗口缩小到手机宽度（390px）：布局没有崩坏，主要功能仍可用",
    "连续操作 30 秒（反复点击、反复切换）：不卡死、不越来越慢、不报错",
    "页面里声称有的功能（说明文字、按钮标签、FINAL_MESSAGE 里提到的）都真的存在",
]


def make_pairs(aliases: list[str], key: str, per_run: int = 3) -> list[tuple[str, str]]:
    """确定性配对：n ≤ 5 全配；否则先连成环保证连通，再给每个作品补随机对手，直到至少 per_run 次比较。
    A / B 位置由 key 派生的随机数决定（同一批数据每次生成结果一致）。"""
    al = sorted(aliases)
    rnd = random.Random(int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:8], 16))
    pairs: set[tuple[str, str]] = set()
    n = len(al)
    if n < 2:
        return []
    if n <= 5:
        pairs = {(al[i], al[j]) for i in range(n) for j in range(i + 1, n)}
    else:
        order = al[:]
        rnd.shuffle(order)
        for i in range(n):
            a, b = order[i], order[(i + 1) % n]
            pairs.add((min(a, b), max(a, b)))
        deg = {a: 0 for a in al}
        for a, b in pairs:
            deg[a] += 1
            deg[b] += 1
        for a in al:
            tries = 0
            while deg[a] < per_run and tries < 50:
                tries += 1
                b = rnd.choice(al)
                if b == a:
                    continue
                p = (min(a, b), max(a, b))
                if p not in pairs:
                    pairs.add(p)
                    deg[a] += 1
                    deg[b] += 1
    out = []
    for a, b in sorted(pairs):
        out.append((b, a) if rnd.random() < 0.5 else (a, b))
    rnd.shuffle(out)
    return out


def capture_media(rd: Path, rv: Path) -> dict:
    """某次运行的采集产物（capture 探针）：命名视角缩略图、环绕视频 / 帧、部件树摘要。路径相对 review 目录。"""
    cdir = rd / "_grading" / "capture"
    mf = cdir / "manifest.json"
    out = {"views": [], "orbit_video": "", "orbit": [], "parts": 0}
    if not mf.exists():
        return out
    try:
        m = json.loads(mf.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return out
    for v in m.get("views", []):
        if v.get("png") and (cdir / v["png"]).exists():
            out["views"].append({"id": v["id"], "label": v.get("label", v["id"]), "src": os.path.relpath(cdir / v["png"], rv), "rendered": bool(v.get("rendered"))})
        else:
            out["views"].append({"id": v["id"], "label": v.get("label", v["id"]), "src": "", "rendered": False})
    if m.get("orbit_video") and (cdir / m["orbit_video"]).exists():
        out["orbit_video"] = os.path.relpath(cdir / m["orbit_video"], rv)
    out["orbit"] = [os.path.relpath(cdir / f, rv) for f in m.get("orbit", [])[:8] if (cdir / f).exists()]
    out["parts"] = len((m.get("parts") or {}).get("tree") or [])
    return out


def load_prefill(rv: Path) -> dict:
    """多模态预填：{ 'abs': {'alias::item': {...}}, 'pair': {'a|b|item': {...}} }。文件不存在则为空。"""
    p = rv / "agent_prefill.json"
    out = {"abs": {}, "pair": {}}
    if not p.exists():
        return out
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return out
    for r in d.get("scores", []) if isinstance(d, dict) else []:
        if r.get("alias") and r.get("item_id") and r.get("score") is not None:
            out["abs"][f"{r['alias']}::{r['item_id']}"] = {"score": float(r["score"]), "reason": str(r.get("reason", ""))[:600]}
    for r in d.get("pairs", []) if isinstance(d, dict) else []:
        if r.get("a") and r.get("b") and r.get("item_id") and r.get("winner") in ("a", "b", "tie"):
            out["pair"][f"{r['a']}|{r['b']}|{r['item_id']}"] = {"winner": r["winner"], "reason": str(r.get("reason", ""))[:600]}
            out["pair"][f"{r['b']}|{r['a']}|{r['item_id']}"] = {"winner": {"a": "b", "b": "a", "tie": "tie"}[r["winner"]], "reason": str(r.get("reason", ""))[:600]}
    return out


def load_exploration(rv: Path) -> dict:
    d = rv / "exploration"
    out = {}
    if d.exists():
        for f in sorted(d.glob("*.md")):
            out[f.stem] = f.read_text(encoding="utf-8", errors="replace")[:6000]
    return out


PREFILL_README = (
    "把这份请求交给一个能看图 / 看视频的多模态模型（或 agent）。它只能看到盲评别名，不要告诉它模型名。\n"
    "一、按 requests[*] 里的 images / orbit_video / anchors 逐项给出建议，写入 review/agent_prefill.json：\n"
    '{"scores": [{"alias": "A07", "item_id": "V02-H04", "score": 2, "reason": "一句话说明依据"}],\n'
    ' "pairs": [{"a": "A07", "b": "A12", "item_id": "V02-H01", "winner": "a|b|tie", "reason": "…"}]}\n'
    "二、如果能打开页面：按 walkthrough 清单把每个控件操作一遍，写成 review/exploration/<alias>.md，"
    "至少包含：点了哪些控件、哪些无效 / 报错 / 卡死、复现步骤。\n"
    "三、预填只是建议：评分页会把它显示在评分按钮旁边，由人点“采纳”或自己打分，导出时记录二者是否一致。"
)


def prefill_request(cards: list[dict], pairs: list[dict], walk: list[str]) -> dict:
    reqs = []
    for c in cards:
        reqs.append({"alias": c["alias"], "task": c["task"], "item_id": c["item_id"], "criterion": c["criterion"],
                     "anchors": [c.get(f"anchor_{i}", "") for i in range(4)], "evidence": c.get("evidence", ""),
                     "images": [v["src"] for v in c.get("views", []) if v.get("src")] + c.get("shots", []), "orbit_video": c.get("orbit_video", ""),
                     "video": c.get("video", ""), "open": c.get("open", "")})
    prs = []
    for p in pairs:
        prs.append({"a": p["a"]["alias"], "b": p["b"]["alias"], "task": p["task"], "item_id": p["item_id"], "criterion": p["criterion"],
                    "anchors": [p.get(f"anchor_{i}", "") for i in range(4)],
                    "images_a": [v["src"] for v in p["a"].get("views", []) if v.get("src")] + p["a"].get("shots", []),
                    "images_b": [v["src"] for v in p["b"].get("views", []) if v.get("src")] + p["b"].get("shots", []),
                    "orbit_video_a": p["a"].get("orbit_video", ""), "orbit_video_b": p["b"].get("orbit_video", "")})
    return {"_readme": PREFILL_README, "walkthrough": walk, "requests": reqs, "pairs": prs}


def render_html(payload: dict) -> str:
    data = json.dumps(payload, ensure_ascii=False)
    return HTML.replace("__DATA__", data.replace("</", "<\\/"))


HTML = r"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>人工评分（v2）</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--muted:#5d6678;--line:#dde1e8;--accent:#2f5bd3;--pick:#e7eefc;--ai:#7a4fd0;--bad:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1a1f27;--fg:#e6e9ef;--muted:#9aa3b2;--line:#2b323d;--accent:#7ea2ff;--pick:#233150;--ai:#b79bff;--bad:#fb923c;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;z-index:2}
header h1{font-size:16px;margin:0}
.bar{margin-left:auto;display:flex;gap:8px;align-items:center}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:6px 12px;border-radius:6px;cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
button.ai{border-color:var(--ai);color:var(--ai)}
main{max-width:1280px;margin:0 auto;padding-block:16px;padding-inline:16px;display:grid;gap:20px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
section h2{font-size:15px;margin:0 0 4px}
.meta{color:var(--muted);font-size:12px}
.anchors{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px;margin:10px 0;font-size:12.5px}
.anchors div{border:1px solid var(--line);border-radius:6px;padding:6px 8px}
.anchors b{color:var(--accent)}
.runs{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.run{border:1px solid var(--line);border-radius:8px;padding:10px;min-width:0}
.run img{width:100%;max-height:220px;object-fit:contain;object-position:top;background:var(--bg);border-radius:4px;display:block;margin-bottom:6px;cursor:zoom-in}
.run .alias{font-weight:600}
.views{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:4px;margin:6px 0}
.views figure{margin:0;font-size:11px;color:var(--muted)}
.views img{max-height:70px;margin:0 0 2px}
.views .fail{color:var(--bad)}
.scores{display:flex;gap:6px;margin:8px 0}
.scores label,.picks label{flex:1;text-align:center;border:1px solid var(--line);border-radius:6px;padding:4px 0;cursor:pointer}
.scores input,.picks input{display:none}
.scores input:checked+span,.picks input:checked+span{font-weight:700;color:var(--accent)}
.scores label:has(input:checked),.picks label:has(input:checked){background:var(--pick);border-color:var(--accent)}
.picks{display:flex;gap:6px;margin:10px 0}
textarea{width:100%;box-sizing:border-box;font:inherit;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg);min-height:34px}
a{color:var(--accent)}
.progress{font-variant-numeric:tabular-nums;color:var(--muted)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;border-top:1px dashed var(--line);padding-top:12px}
.pair .side{min-width:0}
.pair .tag{display:inline-block;padding:0 8px;border-radius:10px;background:var(--pick);font-weight:700}
.ai{border:1px solid var(--ai);border-radius:6px;padding:6px 8px;margin:6px 0;font-size:12.5px}
.ai b{color:var(--ai)}
details.rep{margin-top:6px;font-size:12.5px}
details.rep pre{white-space:pre-wrap;margin:6px 0 0;max-height:260px;overflow:auto}
.walk{margin:8px 0;font-size:12.5px;border:1px solid var(--line);border-radius:6px;padding:6px 8px}
.walk div{display:flex;gap:6px;align-items:flex-start;margin:2px 0}
.walk select{font:inherit;flex:none}
.hint{color:var(--muted);font-size:12px}
</style></head><body>
<header><h1>人工评分（盲评 · v2）</h1><span class="progress" id="prog"></span><span class="progress" id="agree"></span>
<div class="bar"><button id="exp" class="primary">导出 human_scores.csv</button><button id="expp" class="primary">导出 pairwise.csv</button></div></header>
<main id="main"></main>
<script id="data" type="application/json">__DATA__</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const KEY = 'bench-review-v2';
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const main = document.getElementById('main');
const prefillAbs = D.prefill.abs || {}, prefillPair = D.prefill.pair || {};
const expl = D.exploration || {};

const viewsHtml = (c) => (c.views && c.views.length) ? `<div class="views">${c.views.map(v => `<figure>${v.src ? `<a href="${esc(v.src)}" target="_blank"><img loading="lazy" src="${esc(v.src)}" alt="${esc(v.label)}"></a>` : ''}<span class="${v.rendered ? '' : 'fail'}">${esc(v.label)}${v.rendered ? '' : '（未渲染）'}</span></figure>`).join('')}</div>` : '';
const mediaLinks = (c) => `<div class="meta">${c.orbit_video ? `<a href="${esc(c.orbit_video)}" target="_blank">环绕视频</a> · ` : ''}${c.video ? `<a href="${esc(c.video)}" target="_blank">评审视频</a> · ` : ''}${c.open ? `<a href="${esc(c.open)}" target="_blank">打开作品</a>` : ''}</div>`;
const reportHtml = (alias) => expl[alias] ? `<details class="rep"><summary>AI 探索报告</summary><pre>${esc(expl[alias])}</pre></details>` : '';
const anchorsHtml = (c) => `<div class="anchors">${[0,1,2,3].map(i => `<div><b>${i}</b> ${esc(c['anchor_' + i])}</div>`).join('')}</div>`;

// ---------- 绝对打分 ----------
const groups = {};
for (const c of D.cards) (groups[c.task + '|' + c.item_id] ||= []).push(c);
for (const [k, list] of Object.entries(groups)) {
  const c0 = list[0];
  const sec = document.createElement('section');
  const walk = c0.walkthrough || null;
  sec.innerHTML = `<h2>${esc(c0.task)} · ${esc(c0.item_id)} ${esc(c0.criterion)}</h2>
  <div class="meta">维度 ${esc(c0.dim)} · ${esc(c0.tier)} · 依据：${esc(c0.evidence)}</div>${anchorsHtml(c0)}
  <div class="runs">${list.map(c => {
    const id = c.item_id + '::' + c.alias; const s = saved[id] || {}; const pf = prefillAbs[c.alias + '::' + c.item_id];
    return `<div class="run" data-kind="abs" data-id="${esc(id)}" data-task="${esc(c.task)}" data-item="${esc(c.item_id)}" data-alias="${esc(c.alias)}" ${pf ? `data-prefill="${pf.score}"` : ''}>
      <div class="alias">${esc(c.alias)}</div>
      ${(c.shots || []).slice(0, 2).map(p => `<a href="${esc(p)}" target="_blank"><img loading="lazy" src="${esc(p)}" alt="截图"></a>`).join('')}
      ${viewsHtml(c)}${mediaLinks(c)}
      ${walk ? `<div class="walk"><b>走查清单</b>（把页面上每个控件都操作一遍）${walk.map((w, i) => `<div><select data-w="${i}"><option value="">未查</option><option value="ok" ${s.walk && s.walk[i] === 'ok' ? 'selected' : ''}>通过</option><option value="bad" ${s.walk && s.walk[i] === 'bad' ? 'selected' : ''}>失败</option><option value="na" ${s.walk && s.walk[i] === 'na' ? 'selected' : ''}>不适用</option></select><span>${esc(w)}</span></div>`).join('')}<div class="hint" data-hint></div></div>` : ''}
      ${pf ? `<div class="ai"><b>AI 预填</b> 建议 ${pf.score} 分：${esc(pf.reason)} <button class="ai" data-adopt="${pf.score}">采纳</button></div>` : ''}
      ${reportHtml(c.alias)}
      <div class="scores">${[0,1,2,3].map(i => `<label><input type="radio" name="${esc(id)}" value="${i}" ${String(s.score) === String(i) ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div>
      <textarea placeholder="备注（可选）">${esc(s.note || '')}</textarea></div>`;
  }).join('')}</div>`;
  main.appendChild(sec);
}

// ---------- 两两比较 ----------
const pgroups = {};
for (const p of D.pairs) (pgroups[p.task + '|' + p.item_id] ||= []).push(p);
for (const [k, list] of Object.entries(pgroups)) {
  const p0 = list[0];
  const sec = document.createElement('section');
  sec.innerHTML = `<h2>${esc(p0.task)} · ${esc(p0.item_id)} ${esc(p0.criterion)} <span class="tag">两两比较</span></h2>
  <div class="meta">维度 ${esc(p0.dim)} · ${esc(p0.tier)} · 依据：${esc(p0.evidence)} · 共 ${list.length} 组。每组只回答“哪一个在这一项上更好”，差不多就选平局。</div>${anchorsHtml(p0)}
  ${list.map(p => {
    const id = 'P::' + p.item_id + '::' + p.a.alias + '|' + p.b.alias; const s = saved[id] || {}; const pf = prefillPair[p.a.alias + '|' + p.b.alias + '|' + p.item_id];
    const side = (x, tag) => `<div class="side"><div class="alias"><span class="tag">${tag}</span> ${esc(x.alias)}</div>${(x.shots || []).slice(0, 1).map(q => `<a href="${esc(q)}" target="_blank"><img loading="lazy" src="${esc(q)}" alt="截图"></a>`).join('')}${viewsHtml(x)}${mediaLinks(x)}${reportHtml(x.alias)}</div>`;
    return `<div class="pair run" data-kind="pair" data-id="${esc(id)}" data-task="${esc(p.task)}" data-item="${esc(p.item_id)}" data-a="${esc(p.a.alias)}" data-b="${esc(p.b.alias)}" ${pf ? `data-prefill="${pf.winner}"` : ''}>
      ${side(p.a, 'A')}${side(p.b, 'B')}
      <div style="grid-column:1/-1">
        ${pf ? `<div class="ai"><b>AI 预填</b> 建议 ${pf.winner === 'tie' ? '平局' : pf.winner.toUpperCase() + ' 更好'}：${esc(pf.reason)} <button class="ai" data-adopt="${pf.winner}">采纳</button></div>` : ''}
        <div class="picks">${[['a','A 更好'],['tie','差不多'],['b','B 更好']].map(([v, t]) => `<label><input type="radio" name="${esc(id)}" value="${v}" ${s.winner === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        <textarea placeholder="备注（可选）">${esc(s.note || '')}</textarea></div></div>`;
  }).join('')}`;
  main.appendChild(sec);
}

function collect() {
  const out = {};
  document.querySelectorAll('.run').forEach(el => {
    const id = el.dataset.id; const r = el.querySelector('input:checked'); const note = el.querySelector('textarea').value;
    if (el.dataset.kind === 'pair') { out[id] = {winner: r ? r.value : '', note, prefill: el.dataset.prefill || '', adopted: el.dataset.adopted === '1'}; return; }
    const walk = [...el.querySelectorAll('select[data-w]')].map(s => s.value);
    out[id] = {score: r ? r.value : '', note, walk: walk.length ? walk : undefined, prefill: el.dataset.prefill ?? '', adopted: el.dataset.adopted === '1'};
  });
  return out;
}
function hints() {
  document.querySelectorAll('.walk').forEach(w => {
    const v = [...w.querySelectorAll('select')].map(s => s.value); const done = v.filter(x => x && x !== 'na').length, bad = v.filter(x => x === 'bad').length;
    const tot = v.filter(x => x !== 'na').length || v.length;
    const h = w.querySelector('[data-hint]');
    h.textContent = !done ? '尚未开始走查' : `已查 ${v.filter(x => x).length}/${v.length}，失败 ${bad} 项 → 建议 ${bad === 0 ? (done >= tot ? 3 : 2) : bad <= 2 ? 2 : bad <= 4 ? 1 : 0} 分（仅供参考，最终由你决定）`;
  });
}
function update() {
  const all = collect(); saved = all; hints();
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  const vals = Object.values(all);
  const done = vals.filter(x => (x.score ?? x.winner) !== '').length;
  document.getElementById('prog').textContent = `已评 ${done} / ${vals.length}`;
  const pf = vals.filter(x => x.prefill !== '' && x.prefill !== undefined && (x.score ?? x.winner) !== '');
  const same = pf.filter(x => String(x.prefill) === String(x.score ?? x.winner)).length;
  document.getElementById('agree').textContent = pf.length ? `与 AI 预填一致 ${same} / ${pf.length}` : '';
}
main.addEventListener('change', update); main.addEventListener('input', update);
main.addEventListener('click', ev => {
  const b = ev.target.closest('[data-adopt]'); if (!b) return;
  const run = b.closest('.run'); const v = b.dataset.adopt; run.dataset.adopted = '1';
  const inp = [...run.querySelectorAll('input[type=radio]')].find(i => String(i.value) === String(Math.round(Number(v))) || i.value === v);
  if (inp) { inp.checked = true; update(); }
});
update();
const dl = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], {type: 'text/csv'})); a.download = name; a.click(); };
const csvOf = rows => rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
document.getElementById('exp').addEventListener('click', () => {
  const all = collect(); const WALK = D.walkthrough || [];
  const rows = [['task','item_id','alias','score','note','method','prefill_score','prefill_adopted']];
  for (const c of D.cards) {
    const s = all[c.item_id + '::' + c.alias] || {}; let note = (s.note || '').replace(/\n/g, ' ');
    if (s.walk && s.walk.some(x => x)) { const bad = s.walk.map((x, i) => x === 'bad' ? (i + 1) : null).filter(Boolean); note = `走查 ${s.walk.filter(x => x === 'ok').length}/${s.walk.filter(x => x && x !== 'na').length} 通过` + (bad.length ? `；失败项 ${bad.join(',')}` : '') + (note ? '；' + note : ''); }
    rows.push([c.task, c.item_id, c.alias, s.score ?? '', note, 'human', s.prefill ?? '', s.adopted ? '1' : '0']);
  }
  dl('human_scores.csv', csvOf(rows));
});
document.getElementById('expp').addEventListener('click', () => {
  const all = collect();
  const rows = [['task','item_id','a','b','winner','note','by','prefill_winner','prefill_adopted']];
  for (const p of D.pairs) {
    const s = all['P::' + p.item_id + '::' + p.a.alias + '|' + p.b.alias] || {};
    if (!s.winner) continue;
    rows.push([p.task, p.item_id, p.a.alias, p.b.alias, s.winner, (s.note || '').replace(/\n/g, ' '), 'human', s.prefill ?? '', s.adopted ? '1' : '0']);
  }
  dl('pairwise.csv', csvOf(rows));
});
</script></body></html>"""
