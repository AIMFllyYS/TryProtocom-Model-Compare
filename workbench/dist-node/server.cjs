"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server/index.ts
var index_exports = {};
__export(index_exports, {
  startServer: () => startServer
});
module.exports = __toCommonJS(index_exports);
var import_node_fs9 = __toESM(require("node:fs"), 1);
var import_node_http2 = __toESM(require("node:http"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);
var import_node_child_process5 = require("node:child_process");

// shared/aggregate.ts
var mean = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
var psd = (xs) => {
  const v = xs.filter((x) => typeof x === "number");
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};
var r2 = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
var INF = Number.POSITIVE_INFINITY;
function logScore(value, best, worst) {
  if (value == null) return null;
  if (value === INF) return 0;
  const v = Math.max(value, 1e-9);
  const s = (Math.log10(worst) - Math.log10(v)) / (Math.log10(worst) - Math.log10(best));
  return r2(100 * Math.max(0, Math.min(1, s)), 1);
}
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = seed + 1831565813 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var entrantOf = (r) => `${r.model} @ ${r.harness}`;
function aggregate(allRuns, spec, opts = {}) {
  const cfg = { ...spec.cfg, ...spec.config_full || {} };
  const dims = spec.dims;
  const qdims = dims.filter((d) => d.kind === "quality");
  const runs = allRuns.filter((r) => r.graded && r.score);
  const byEt = /* @__PURE__ */ new Map();
  const k = (e, t) => `${e}\0${t}`;
  for (const r of runs) {
    const key = k(r.entrant, r.tkey);
    if (!byEt.has(key)) byEt.set(key, []);
    byEt.get(key).push(r);
  }
  const entrants = [...new Set(runs.map((r) => r.entrant))].sort();
  const tkeys = [...new Set(runs.map((r) => r.tkey))].sort();
  const eff = cfg.efficiency;
  const usageMin = (r) => r.usage?.active_min ?? r.usage?.wall_min ?? null;
  const taskRows = [];
  for (const key of [...byEt.keys()].sort()) {
    const rs = byEt.get(key);
    const [e, tk] = key.split("\0");
    const totals = rs.map((r) => r.score.total);
    const passed = rs.map((r) => r.score.passed);
    const pr = passed.filter(Boolean).length / passed.length;
    const mc = mean(rs.map((r) => r.usage?.cost_usd ?? null));
    const mm = mean(rs.map(usageMin));
    const row = {
      entrant: e,
      task: tk,
      runs: rs.length,
      mean: r2(mean(totals) ?? 0),
      sd: r2(psd(totals)),
      min: Math.min(...totals),
      max: Math.max(...totals),
      pass_rate: r2(pr, 3),
      pass_at_k: passed.some(Boolean),
      gate_fail_runs: rs.filter((r) => !r.score.gate_pass).length,
      complete: rs.every((r) => r.score.complete),
      low_confidence: rs.some((r) => r.score.low_confidence),
      mean_cost_usd: mc != null ? r2(mc, 4) : null,
      mean_min: mm != null ? r2(mm) : null,
      exp_cost_usd: mc != null ? pr > 0 ? r2(mc / pr, 4) : INF : null,
      exp_min: mm != null ? pr > 0 ? r2(mm / pr) : INF : null,
      dims: {},
      dim_weights: rs[0].score.dim_weights,
      tiers: Object.fromEntries(["basic", "advanced", "excellent", "clean"].map((t) => [t, mean(rs.map((r) => r.score.tiers?.[t] ?? null))])),
      cost_score: null,
      speed_score: null
    };
    for (const d of Object.keys(row.dim_weights)) {
      const v = mean(rs.map((r) => r.score.dims[d] ?? null));
      row.dims[d] = v != null ? r2(v) : null;
    }
    row.cost_score = logScore(row.exp_cost_usd, eff.cost.best, eff.cost.worst);
    row.speed_score = logScore(row.exp_min, eff.speed.best, eff.speed.worst);
    taskRows.push(row);
  }
  const entrantScores = (e, sample) => {
    const acc = {};
    for (const tk of tkeys) {
      const rs = sample ? sample.get(tk) : byEt.get(k(e, tk));
      if (!rs || !rs.length) continue;
      const w = rs[0].score.dim_weights;
      for (const [d, wt] of Object.entries(w)) {
        const v = mean(rs.map((r) => r.score.dims[d] ?? null));
        if (v != null) {
          acc[d] ??= [0, 0];
          acc[d][0] += wt * v;
          acc[d][1] += wt;
        }
      }
    }
    const ds = {};
    for (const [d, [a, b]] of Object.entries(acc)) if (b) ds[d] = r2(a / b);
    let num = 0, den = 0;
    for (const qd of qdims) if (qd.id in ds) {
      num += (qd.weight ?? 1) * ds[qd.id];
      den += qd.weight ?? 1;
    }
    return { dims: ds, quality: den ? r2(num / den) : null };
  };
  const rng = mulberry32(20261008);
  const B = opts.bootstrap ?? Number(cfg.statistics?.bootstrap_samples ?? 2e3);
  const ci = Number(cfg.statistics?.ci ?? 0.95);
  const board = [];
  for (const e of entrants) {
    const base = entrantScores(e);
    const boots = [];
    for (let b = 0; b < B; b++) {
      const sample = /* @__PURE__ */ new Map();
      for (const tk of tkeys) {
        const rs = byEt.get(k(e, tk));
        if (rs) sample.set(tk, rs.map(() => rs[Math.floor(rng() * rs.length)]));
      }
      const q = entrantScores(e, sample).quality;
      if (q != null) boots.push(q);
    }
    boots.sort((a, b) => a - b);
    const lo = boots.length ? boots[Math.floor((1 - ci) / 2 * boots.length)] : null;
    const hi = boots.length ? boots[Math.floor((1 + ci) / 2 * boots.length) - 1] : null;
    const trs = taskRows.filter((t) => t.entrant === e);
    const costS = trs.map((t) => t.cost_score).filter((x) => x != null);
    const speedS = trs.map((t) => t.speed_score).filter((x) => x != null);
    const expC = trs.map((t) => t.exp_cost_usd).filter((x) => x != null);
    const expM = trs.map((t) => t.exp_min).filter((x) => x != null);
    const er = runs.filter((r) => r.entrant === e);
    const dimsFull = { ...base.dims };
    dimsFull.cost = costS.length ? r2(mean(costS), 1) : null;
    dimsFull.speed = speedS.length ? r2(mean(speedS), 1) : null;
    const suite = (xs, d) => xs.length ? xs.every((x) => x !== INF) ? r2(xs.reduce((a, b) => a + b, 0), d) : INF : null;
    const row = {
      rank: "",
      entrant: e,
      model: er[0].model,
      vendor: er[0].vendor,
      harness: er[0].harness,
      quality: base.quality,
      ci_low: lo,
      ci_high: hi,
      dims: dimsFull,
      runs: er.length,
      tasks: trs.length,
      pass_rate: r2(er.filter((r) => r.score.passed).length / er.length, 3),
      suite_exp_cost_usd: suite(expC, 3),
      suite_exp_min: suite(expM, 1),
      cost_coverage: `${costS.length}/${trs.length}`,
      complete: er.every((r) => r.score.complete),
      na_ratio: r2(mean(er.map((r) => r.score.na_ratio)) ?? 0, 3)
    };
    const cc = cfg.composite;
    if (cc?.enabled && row.quality != null) row.composite = r2(cc.quality_weight * row.quality + cc.cost_weight * (dimsFull.cost ?? 0) + cc.speed_weight * (dimsFull.speed ?? 0));
    board.push(row);
  }
  board.sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
  let rank = 1, i = 0;
  while (i < board.length) {
    const lead = board[i];
    let j = i;
    while (j < board.length && board[j].ci_high != null && lead.ci_low != null && board[j].ci_high >= lead.ci_low) j++;
    j = Math.max(j, i + 1);
    const tie = j - i > 1;
    for (let x = i; x < j; x++) board[x].rank = tie ? `${rank}=` : String(rank);
    rank += j - i;
    i = j;
  }
  const perItem = /* @__PURE__ */ new Map();
  const itemMeta = /* @__PURE__ */ new Map();
  for (const r of runs) for (const it of r.score.items) {
    if ((it.status === "scored" || it.status === "missing") && it.s != null) {
      const key = `${r.tkey}\0${it.id}`;
      if (!perItem.has(key)) perItem.set(key, /* @__PURE__ */ new Map());
      const m = perItem.get(key);
      if (!m.has(r.entrant)) m.set(r.entrant, []);
      m.get(r.entrant).push(it.s);
      itemMeta.set(key, { dim: it.dim, tier: it.tier, method: it.method, desc: it.desc, tk: r.tkey, id: it.id });
    }
  }
  const items = [];
  for (const key of [...perItem.keys()].sort()) {
    const byE = perItem.get(key);
    const allv = [...byE.values()].flat();
    const means = [...byE.values()].map((vs) => vs.reduce((a, b) => a + b, 0) / vs.length);
    const mu = allv.reduce((a, b) => a + b, 0) / allv.length;
    const within = mean([...byE.values()].map(psd)) ?? 0;
    const m = itemMeta.get(key);
    items.push({
      task: m.tk,
      item_id: m.id,
      dim: m.dim,
      tier: m.tier,
      method: m.method,
      desc: m.desc,
      mean: r2(mu, 3),
      between_sd: r2(psd(means), 3),
      within_sd: r2(within, 3),
      n: allv.length,
      flag: mu >= 0.95 ? "\u5929\u82B1\u677F" : mu <= 0.05 ? "\u5730\u677F" : means.length > 1 && psd(means) < 0.05 ? "\u533A\u5206\u5EA6\u4F4E" : "",
      by_entrant: Object.fromEntries([...byE.entries()].map(([en, vs]) => [en, r2(vs.reduce((a, b) => a + b, 0) / vs.length, 3)]))
    });
  }
  const uplift = [];
  for (const t of spec.tasks.filter((t2) => Object.keys(t2.variants || {}).length)) {
    for (const e of entrants) {
      const a = taskRows.find((x) => x.entrant === e && x.task === t.id + "A");
      const c = taskRows.find((x) => x.entrant === e && x.task === t.id + "C");
      if (a && c) uplift.push({
        entrant: e,
        task: t.id,
        A_mean: a.mean,
        C_mean: c.mean,
        uplift: r2(c.mean - a.mean),
        A_anim: a.dims.anim ?? null,
        C_anim: c.dims.anim ?? null,
        anim_uplift: r2((c.dims.anim ?? 0) - (a.dims.anim ?? 0)),
        A_cost: a.mean_cost_usd,
        C_cost: c.mean_cost_usd,
        A_min: a.mean_min,
        C_min: c.mean_min
      });
    }
  }
  const failures = [];
  for (const r of runs) {
    const sc = r.score;
    const tags = [];
    if (r.failure_tag) tags.push(r.failure_tag);
    for (const g of sc.gate_fail) {
      if (g.desc.includes("\u6C47\u62A5")) tags.push("\u8C0E\u62A5\u5B8C\u6210");
      else if (/启动|加载|seek/.test(g.desc)) tags.push("\u65E0\u6CD5\u8FD0\u884C");
      else tags.push("\u4EA4\u4ED8\u7F3A\u5931");
    }
    if (r.timed_out) tags.push("\u8D85\u65F6");
    if (!sc.gate_pass || !sc.passed) failures.push({ entrant: r.entrant, task: r.tkey, run_id: r.run_id, total: sc.total, tags: [...new Set(tags)].join("|") || "\u80FD\u529B\u4E0D\u8DB3\uFF08\u672A\u8FBE\u6807\uFF09" });
  }
  const pending = { human: 0, agent: 0, usage_missing: 0, ungraded: 0, low_confidence: 0 };
  for (const r of allRuns) {
    if (!r.graded || !r.score) {
      pending.ungraded++;
      continue;
    }
    for (const it of r.score.items) if (it.status === "pending") it.method === "human" ? pending.human++ : pending.agent++;
    if ((r.usage?.missing || []).length) pending.usage_missing++;
    if (r.score.low_confidence) pending.low_confidence++;
  }
  return { board, tasks: taskRows, items, uplift, failures, entrants, tkeys, generated_at: (/* @__PURE__ */ new Date()).toISOString(), pending };
}

// shared/deliverables.ts
var FINAL_FILE = "FINAL_MESSAGE.md";
var LOCKS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "requirements.txt", "uv.lock", "poetry.lock"];
var DELIVERABLES = {
  T01: { dir: "pelican-bike", kind: "web", preview: "index.html", files: [{ path: "index.html", label: "\u5355\u6587\u4EF6\u9875\u9762\uFF08\u4EE3\u7801\u5168\u90E8\u5185\u8054\uFF09" }] },
  T02: {
    dir: "mc-sol-luna",
    kind: "web",
    preview: "index.html",
    files: [
      { path: "index.html", label: "\u5355\u6587\u4EF6\u6210\u7247" },
      { path: "project.json" },
      { path: "shot-list.json" },
      { path: "audio-cue-sheet.csv" },
      { path: "qc-report.md" },
      { path: "delivery-manifest.json" },
      { path: "keyframes", dir: true, label: "keyframes/ \u5173\u952E\u5E27" },
      { path: "contact-sheet.jpg", optional: true, label: "contact-sheet.jpg\uFF08\u65E0\u6CD5\u622A\u56FE\u65F6\u5728 qc-report.md \u8BF4\u660E\uFF09" }
    ]
  },
  T03: { dir: "tempo-promo", kind: "web", preview: "index.html", files: [{ path: "index.html", label: "\u53EF\u76F4\u63A5\u6253\u5F00\u7684\u6210\u7247\u9875\u9762\uFF08window.__hf\uFF09" }, { path: "*.mp4", any: [], optional: true, label: "\u5BFC\u51FA\u7684 MP4\uFF08\u53EF\u9009\uFF09" }] },
  T04: { dir: "aether9-promo", kind: "video", preview: "final.mp4", files: [{ path: "final.mp4" }, { path: "subtitles.srt" }, { path: "script.md", label: "script.md \u65C1\u767D\u811A\u672C" }] },
  T05: {
    dir: "aether9-site",
    kind: "web",
    preview: "dist/index.html",
    files: [
      { path: "package.json" },
      { path: "lock", any: LOCKS.slice(0, 5), label: "lock \u6587\u4EF6\uFF08npm / pnpm / yarn / bun\uFF09" },
      { path: "dist/index.html", label: "\u6784\u5EFA\u4EA7\u7269 dist/index.html\uFF08\u5355\u6587\u4EF6 \u2264 8 MB\uFF09" }
    ]
  },
  T06: { dir: "studyspot-web", kind: "web", preview: "index.html", files: [{ path: "index.html", label: "\u5355\u6587\u4EF6\u9875\u9762\uFF08window.__bench\uFF09" }, { path: "ASSUMPTIONS.md", label: "ASSUMPTIONS.md \u9700\u6C42\u7406\u89E3\u4E0E\u5047\u8BBE" }] },
  T07: {
    dir: "studyspot-api",
    kind: "api",
    preview: "README.md",
    files: [
      { path: "bench.json", label: "bench.json \u542F\u52A8\u7EA6\u5B9A" },
      { path: "lock", any: LOCKS, label: "\u4F9D\u8D56\u6E05\u5355 / lock \u6587\u4EF6" },
      { path: "README.md" },
      { path: "DECISIONS.md" }
    ]
  },
  T08: { dir: "studyspot-legacy", kind: "repo", preview: "FIXES.md", note: "\u76F4\u63A5\u4FEE\u6539\u9884\u7F6E\u7684 studyspot-legacy/", files: [{ path: "FIXES.md", label: "FIXES.md \u4FEE\u590D\u8BB0\u5F55\uFF08\u65B0\u589E\uFF09" }, { path: "tests", dir: true, label: "tests/ \u56DE\u5F52\u6D4B\u8BD5" }] }
};
var deliverableFor = (task, fallbackDir) => DELIVERABLES[task] || { dir: fallbackDir || "", kind: "web", files: [], preview: "index.html" };
function evalDeliverable(d, exists, list) {
  return d.files.map((f2) => {
    const label = f2.label || f2.path;
    if (f2.path.startsWith("*.")) {
      const ext = f2.path.slice(1).toLowerCase();
      const hit = list(d.dir).find((x) => x.toLowerCase().endsWith(ext));
      return { path: f2.path, label, ok: !!hit, optional: !!f2.optional, found: hit };
    }
    if (f2.any) {
      const hit = f2.any.find((a) => exists(`${d.dir}/${a}`));
      return { path: f2.path, label, ok: !!hit, optional: !!f2.optional, found: hit };
    }
    return { path: f2.path, label, ok: exists(`${d.dir}/${f2.path}`, f2.dir), optional: !!f2.optional };
  });
}

// shared/prompt.ts
function buildPrompt(raw, taskId, variant, opts = {}) {
  const warnings = [];
  let text = raw.replace(/\r\n/g, "\n");
  const sep = text.split("\n").findIndex((l) => /^-{3,}\s*$/.test(l.trim()));
  if (taskId === "T06" && sep >= 0) text = text.split("\n").slice(sep + 1).join("\n").trim() + "\n";
  if (variant) {
    const other = variant === "A" ? "C" : "A";
    text = text.split("\n").filter((l) => !l.trim().startsWith(`\u3010${other} \u7EC4\u3011`) && !l.trim().startsWith(`\u3010${other}\u7EC4\u3011`)).join("\n");
  }
  if (text.includes("{TTS_COMMAND}")) {
    if (opts.tts) text = text.split("{TTS_COMMAND}").join(opts.tts);
    else warnings.push("\u63D0\u793A\u8BCD\u542B {TTS_COMMAND} \u5360\u4F4D\u7B26\uFF1A\u8BF7\u5728\u300C\u8BBE\u7F6E\u300D\u586B\u5199\u8BC4\u6D4B\u673A\u4E0A\u7EDF\u4E00\u7684 TTS \u547D\u4EE4\u540E\u518D\u53D1\u9001\u3002");
  }
  return { text, warnings };
}
function runHeader(h) {
  const d = deliverableFor(h.taskId, h.deliverableDir);
  const dir = d.dir || h.deliverableDir;
  const tag = `${h.taskId}${h.variant || ""}`;
  const L = [];
  L.push(`# \u8FD0\u884C\u7EA6\u5B9A\uFF08${h.bench} \xB7 ${tag}${h.runIndex ? ` \xB7 \u7B2C ${h.runIndex} \u6B21\u8FD0\u884C` : ""}\uFF09`);
  L.push("");
  L.push("\u5F00\u59CB\u524D\u8BF7\u5B8C\u6574\u9605\u8BFB\u672C\u8282\uFF0C\u5B83\u4E0E\u4E0B\u9762\u7684\u9898\u76EE\u539F\u6587\u540C\u7B49\u91CD\u8981\u3002");
  L.push("");
  L.push(`1. **\u5DE5\u4F5C\u76EE\u5F55**\uFF1A${h.workspace ? `\`${h.workspace}\`` : "\uFF08\u590D\u5236\u65F6\u7531\u5DE5\u4F5C\u53F0\u521B\u5EFA\u5E76\u586B\u5165\u7EDD\u5BF9\u8DEF\u5F84\uFF09"}\u3002\u53EA\u5728\u8FD9\u4E2A\u76EE\u5F55\u91CC\u521B\u5EFA\u548C\u4FEE\u6539\u6587\u4EF6\uFF0C\u4E0D\u8981\u8BFB\u53D6\u6216\u6539\u52A8\u76EE\u5F55\u4E4B\u5916\u7684\u4EFB\u4F55\u5185\u5BB9\u3002`);
  if (d.kind === "repo") L.push(`2. **\u4EA4\u4ED8\u4F4D\u7F6E**\uFF1A\u76F4\u63A5\u4FEE\u6539\u5DE5\u4F5C\u76EE\u5F55\u4E2D\u5DF2\u6709\u7684 \`${dir}/\`\uFF08\u4E0D\u8981\u65B0\u5EFA\u526F\u672C\uFF0C\u4E0D\u8981\u91CD\u5199\u6574\u4E2A\u9879\u76EE\uFF09\u3002`);
  else L.push(`2. **\u4EA4\u4ED8\u6587\u4EF6\u5939**\uFF1A\u5728\u5DE5\u4F5C\u76EE\u5F55\u4E0B\u65B0\u5EFA \`${dir}/\`\uFF0C\u540D\u79F0\u5FC5\u987B\u5B8C\u5168\u4E00\u81F4\uFF08\u533A\u5206\u5927\u5C0F\u5199\uFF0C\u4E0D\u8981\u52A0\u524D\u7F00\u6216\u7248\u672C\u53F7\uFF09\u3002`);
  const req = d.files.filter((f2) => !f2.optional);
  const opt = d.files.filter((f2) => f2.optional);
  if (req.length) {
    L.push("3. **\u5B8C\u6210\u65F6\u5FC5\u987B\u5B58\u5728**\uFF1A");
    for (const f2 of req) L.push(`   - \`${dir}/${f2.any ? "" : f2.path}${f2.dir ? "/" : ""}\`${f2.any ? f2.label || "" : f2.label && f2.label !== f2.path ? ` \u2014\u2014 ${f2.label}` : ""}`);
    for (const f2 of opt) L.push(`   - \uFF08\u53EF\u9009\uFF09${f2.label || f2.path}`);
  }
  L.push(`4. **\u7ED3\u675F\u65B9\u5F0F**\uFF1A\u5168\u90E8\u5B8C\u6210\u540E\uFF0C\u628A\u4F60\u7ED9\u6211\u7684\u6700\u540E\u4E00\u6761\u603B\u7ED3\u7684\u539F\u6587\uFF0C\u540C\u65F6\u4FDD\u5B58\u4E3A\u5DE5\u4F5C\u76EE\u5F55\u4E0B\u7684 \`${FINAL_FILE}\`\uFF08\u4E0E\u56DE\u590D\u5185\u5BB9\u4E00\u81F4\uFF0C\u53EA\u5199\u771F\u5B9E\u5B58\u5728\u7684\u6587\u4EF6\uFF09\u3002\u8FD9\u4E2A\u6587\u4EF6\u51FA\u73B0\u5373\u89C6\u4E3A\u672C\u6B21\u8FD0\u884C\u7ED3\u675F\u3002`);
  if (h.timeLimit) L.push(`5. **\u65F6\u95F4\u4E0A\u9650**\uFF1A${h.timeLimit} \u5206\u949F\u3002`);
  if (h.materials.length) L.push(`${h.timeLimit ? 6 : 5}. **\u9884\u7F6E\u7D20\u6750**\uFF1A\u5DF2\u653E\u5728\u5DE5\u4F5C\u76EE\u5F55\u4E2D\uFF08${h.materials.map((m) => m.replace(/^materials\//, "")).join("\uFF1B")}\uFF09\uFF0C\u76F4\u63A5\u4F7F\u7528\uFF0C\u4E0D\u8981\u91CD\u65B0\u4E0B\u8F7D\u6216\u6539\u540D\u3002`);
  L.push("");
  L.push("---");
  L.push("");
  return L.join("\n");
}
function buildRunPrompt(raw, h, opts = {}) {
  const body = buildPrompt(raw, h.taskId, h.variant, opts);
  if (opts.header === false) return body;
  return { text: runHeader(h) + body.text.replace(/^\s+/, ""), warnings: body.warnings };
}
function reviewPrompt(p) {
  const sep = p.root.includes("\\") ? "\\" : "/";
  const abs = (...x) => [p.root, ...x].join(sep);
  const s = p.scope;
  const one = s !== "all";
  const rid = one ? s.run_id : null;
  const target = one ? `\u8FD0\u884C \`${rid || s.ref}\`\uFF08${s.task || ""}${s.taskName ? " " + s.taskName : ""}\uFF09` : `\u6240\u6709\u5F85\u8BC4\u7684 Agent \u5BA1\u67E5\u9879${p.pendingAgent != null ? `\uFF08\u5F53\u524D ${p.pendingAgent} \u9879\uFF09` : ""}`;
  const L = [];
  L.push(`# \u4EFB\u52A1\uFF1A\u4E3A ${p.bench} \u7684${target}\u5B8C\u6210 Agent \u5BA1\u67E5\u8BC4\u5206`);
  L.push("");
  L.push("\u4F60\u662F**\u8BC4\u5206\u65B9**\uFF0C\u4E0D\u662F\u88AB\u6D4B\u6A21\u578B\u3002\u53EA\u7ED9 Agent \u5BA1\u67E5\u9879\u6253\u5206\uFF0C\u6BCF\u4E00\u5206\u90FD\u5FC5\u987B\u6709\u8BC1\u636E\u3002");
  L.push("");
  L.push("## 1. \u5148\u8BFB skills\uFF08\u6309\u987A\u5E8F\uFF09");
  L.push("- `.agents/skills/bench-workbench/SKILL.md` \u2014\u2014 \u5DE5\u4F5C\u53F0 CLI\uFF08wb\uFF09\u7528\u6CD5");
  L.push("- `.agents/skills/bench-grader/SKILL.md` \u2014\u2014 \u8BC4\u5206\u53E3\u5F84\u4E0E\u4E0D\u53EF\u8FDD\u53CD\u7684\u89C4\u5219");
  L.push("");
  L.push("\u5982\u679C\u4E0A\u9762\u7684\u76F8\u5BF9\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF0C\u6539\u7528\u7EDD\u5BF9\u8DEF\u5F84\uFF1A");
  L.push(`- \`${abs("skills", "bench-workbench", "SKILL.md")}\``);
  L.push(`- \`${abs("skills", "bench-grader", "SKILL.md")}\``);
  L.push("");
  L.push("## 2. \u5DE5\u4F5C\u4F4D\u7F6E");
  L.push(`\u5728\u4ED3\u5E93\u6839\u76EE\u5F55 \`${p.root}\` \u6267\u884C\u547D\u4EE4\uFF08Windows \u7528 \`wb.cmd\`\uFF0C\u5176\u4ED6\u7CFB\u7EDF\u7528 \`./wb\`\uFF09\u3002\u6240\u6709\u547D\u4EE4\u52A0 \`--json\` \u5E76\u89E3\u6790\u8F93\u51FA\u3002`);
  L.push("");
  L.push("## 3. \u6B65\u9AA4");
  L.push("1. `wb status --json`\uFF1A\u786E\u8BA4\u670D\u52A1\u53EF\u7528\uFF08\u672A\u542F\u52A8\u4F1A\u81EA\u52A8\u540E\u53F0\u542F\u52A8\uFF09\u3002");
  let n = 2;
  if (one && !rid && s.ref) {
    L.push(`${n++}. \u8BE5\u8FD0\u884C\u5C1A\u672A\u767B\u8BB0\uFF1A\`wb run register ${s.ref} --json\`\uFF0C\u518D\u7528 \`wb job <\u4EFB\u52A1id> --wait --json\` \u7B49\u5F85\u767B\u8BB0\u4E0E\u81EA\u52A8\u8BC4\u5206\u5B8C\u6210\uFF0C\u4ECE\u8F93\u51FA\u53D6\u5F97 run_id\u3002`);
  }
  const R = rid || "<run_id>";
  if (one) L.push(`${n++}. \`wb show ${R} --json\`\uFF1A\u67E5\u770B\u95E8\u69DB\u3001\u81EA\u52A8\u8BC4\u5206\u4E0E\u63A2\u9488\u5907\u6CE8\u3002\u82E5\u662F\u8BC4\u6D4B\u73AF\u5883\u95EE\u9898\uFF08\u7F3A ffmpeg / Chromium / npm\uFF09\u5BFC\u81F4\u7684\u7F3A\u5931\uFF0C\u5148\u5728\u6C47\u62A5\u4E2D\u6307\u51FA\uFF0C\u4E0D\u8981\u63A5\u53D7 0 \u5206\u3002`);
  L.push(`${n++}. \`wb pending --method agent${one && s.task ? ` --task ${s.task}` : ""} --json\`${one ? `\uFF1A\u53EA\u5904\u7406 run_id = ${R} \u7684\u9879` : "\uFF1A\u9010\u4E2A\u8FD0\u884C\u5904\u7406"}\u3002\u6BCF\u9879\u7ED9\u51FA\u63CF\u8FF0\u3001\u4F9D\u636E\u30010\u20133 \u951A\u70B9\u548C\u4EA7\u51FA\u76EE\u5F55\uFF08open \u5B57\u6BB5\uFF09\u3002`);
  L.push(`${n++}. \u9010\u9879\u9605\u8BFB\u4EA7\u51FA\u4E2D\u7684\u4EE3\u7801\u4E0E\u6587\u6863\uFF1B\u9700\u8981\u770B\u9875\u9762\u6548\u679C\u65F6\u7528 \`wb check <ref> --json\`\uFF08\u79FB\u52A8\u7AEF\u52A0 \`--mobile --viewport 390x844\`\uFF09\u83B7\u53D6\u63A7\u5236\u53F0\u62A5\u9519\u3001\u5931\u8D25\u8BF7\u6C42\u4E0E\u622A\u56FE\uFF0C\u4F5C\u4E3A\u8BC1\u636E\u3002`);
  L.push(`${n++}. \u6309\u951A\u70B9\u6253\u5206\uFF1A\`wb score ${R} <item_id> <0-3> --note "\u6587\u4EF6:\u884C\u53F7 \u6216 \u53EF\u590D\u73B0\u73B0\u8C61" --by agent\`\u3002`);
  L.push(`${n++}. \u770B\u4E0D\u5230\u8BC1\u636E\u7684\u9879\u4FDD\u6301\u5F85\u8BC4\uFF0C\u4E0D\u8981\u731C\u5206\uFF1B\u4EBA\u5DE5\u9879\uFF08method=human\uFF09\u4E0D\u8981\u6253\u5206\uFF0C\u7559\u7ED9\u7528\u6237\u5728\u5DE5\u4F5C\u53F0\u8BC4\u5206\u9762\u677F\u5B8C\u6210\u3002`);
  L.push("");
  L.push("## 4. \u89C4\u5219");
  L.push("- `skills/bench-grader/tasks/*/hidden/` \u53EA\u80FD\u7528\u4E8E\u6838\u5BF9\uFF0C\u7EDD\u4E0D\u590D\u5236\u5230\u4EFB\u4F55\u88AB\u6D4B\u5DE5\u4F5C\u76EE\u5F55\u6216\u5BF9\u8BDD\u91CC\u3002");
  L.push("- \u4E0D\u4FEE\u6539\u88AB\u6D4B\u4EA7\u51FA\uFF1B\u4E0D\u91CD\u65B0\u8FD0\u884C\u88AB\u6D4B\u6A21\u578B\u3002");
  L.push("");
  L.push("## 5. \u5B8C\u6210\u540E\u6C47\u62A5");
  L.push("\u5217\u51FA\uFF1A\u6253\u5206\u7684 item_id\u3001\u5206\u6570\u4E0E\u8BC1\u636E\u6458\u8981\uFF1B\u4ECD\u5F85\u4EBA\u5DE5\u7684\u9879\u6570\uFF1BN/A \u6216\u4F4E\u53EF\u4FE1\u7684\u539F\u56E0\uFF1B\u5DE5\u4F5C\u53F0\u4E2D\u67E5\u770B\u7ED3\u679C\u7684\u4F4D\u7F6E\uFF08\u8FD0\u884C \u2192 \u8BE5 ref\uFF09\u3002");
  return L.join("\n") + "\n";
}

// shared/vendors.ts
var VENDORS = [
  { id: "OpenAI", name: "OpenAI", icon: "openai", color: "#10a37f", match: /^(gpt|o\d|chatgpt|codex|openai|davinci|sora)/i },
  { id: "Anthropic", name: "Anthropic", icon: "anthropic", color: "#d97757", match: /^(claude|anthropic|opus|sonnet|haiku)/i },
  { id: "Google", name: "Google", icon: "google", color: "#4285f4", match: /^(gemini|gemma|palm|bard|google|veo|imagen)/i },
  { id: "DeepSeek", name: "DeepSeek", cn: "\u6DF1\u5EA6\u6C42\u7D22", icon: "deepseek", color: "#4d6bfe", match: /^deepseek/i },
  { id: "Alibaba", name: "Alibaba Qwen", cn: "\u901A\u4E49\u5343\u95EE", icon: "qwen", color: "#615ced", match: /^(qwen|qwq|qvq|tongyi|alibaba)/i },
  { id: "Zhipu", name: "Zhipu \xB7 Z.ai", cn: "\u667A\u8C31", icon: "zhipu", color: "#3859ff", match: /^(glm|chatglm|codegeex|zhipu|z\.?ai)/i },
  { id: "Moonshot", name: "Moonshot", cn: "\u6708\u4E4B\u6697\u9762", icon: "kimi", color: "#1783ff", match: /^(kimi|moonshot)/i },
  { id: "xAI", name: "xAI", icon: "xai", color: "#9aa4b2", match: /^(grok|xai)/i },
  { id: "ByteDance", name: "ByteDance Seed", cn: "\u5B57\u8282\u8DF3\u52A8", icon: "doubao", color: "#3c8cff", match: /^(doubao|seed|bytedance|skylark)/i },
  { id: "MiniMax", name: "MiniMax", icon: "minimax", color: "#f23f5d", match: /^(minimax|abab|hailuo)/i },
  { id: "Xiaomi", name: "Xiaomi MiMo", cn: "\u5C0F\u7C73", icon: "xiaomimimo", color: "#ff6900", match: /^(mimo|xiaomi)/i },
  { id: "Tencent", name: "Tencent Hunyuan", cn: "\u817E\u8BAF\u6DF7\u5143", icon: "hunyuan", color: "#0052d9", match: /^(hunyuan|tencent|hy-)/i },
  { id: "Baidu", name: "Baidu ERNIE", cn: "\u6587\u5FC3", icon: "wenxin", color: "#2932e1", match: /^(ernie|wenxin|baidu)/i },
  { id: "StepFun", name: "StepFun", cn: "\u9636\u8DC3\u661F\u8FB0", icon: "stepfun", color: "#01a9e0", match: /^(step|stepfun)/i },
  { id: "Mistral", name: "Mistral AI", icon: "mistral", color: "#fa520f", match: /^(mistral|codestral|devstral|magistral|mixtral|ministral|pixtral)/i },
  { id: "Meta", name: "Meta Llama", icon: "meta", color: "#0668e1", match: /^(llama|meta)/i },
  { id: "NVIDIA", name: "NVIDIA", icon: "nvidia", color: "#76b900", match: /^(nemotron|nvidia)/i },
  { id: "Microsoft", name: "Microsoft", icon: "microsoft", color: "#00a4ef", match: /^(phi|microsoft|mai-)/i },
  { id: "Cohere", name: "Cohere", icon: "cohere", color: "#39594d", match: /^(command|aya|cohere)/i },
  { id: "Amazon", name: "Amazon Nova", icon: "nova", color: "#ff9900", match: /^(nova|amazon|titan)/i },
  { id: "Meituan", name: "Meituan LongCat", cn: "\u7F8E\u56E2", icon: "longcat", color: "#ffc300", match: /^longcat/i },
  { id: "Kuaishou", name: "Kuaishou KAT", cn: "\u5FEB\u624B", icon: "kwaikat", color: "#ff4906", match: /^(kat|kwai)/i },
  { id: "01AI", name: "01.AI", cn: "\u96F6\u4E00\u4E07\u7269", icon: "yi", color: "#133426", match: /^(yi-|01)/i },
  { id: "Baichuan", name: "Baichuan", cn: "\u767E\u5DDD", icon: "baichuan", color: "#fe5a1d", match: /^baichuan/i },
  { id: "SenseTime", name: "SenseNova", cn: "\u5546\u6C64", icon: "sensenova", color: "#5b3cf5", match: /^(sensenova|sensechat)/i },
  { id: "iFlytek", name: "iFlytek Spark", cn: "\u8BAF\u98DE\u661F\u706B", icon: "spark", color: "#0070f0", match: /^spark/i },
  { id: "InternLM", name: "InternLM", cn: "\u4E66\u751F", icon: "internlm", color: "#1b3882", match: /^intern/i },
  { id: "NousResearch", name: "Nous Research", icon: "nousresearch", color: "#8b8b8b", match: /^hermes/i }
];
var FAMILY_ICONS = [
  [/^claude/i, "claude"],
  [/^gemini/i, "gemini"],
  [/^gemma/i, "gemma"],
  [/^qwen|^qwq|^qvq/i, "qwen"],
  [/^kimi/i, "kimi"],
  [/^grok/i, "grok"],
  [/^doubao|^seed/i, "doubao"],
  [/^hunyuan/i, "hunyuan"],
  [/^ernie|^wenxin/i, "wenxin"],
  [/^glm|^chatglm/i, "zhipu"],
  [/^nova/i, "nova"],
  [/^codex/i, "codex"],
  [/^mimo/i, "xiaomimimo"],
  [/^deepseek/i, "deepseek"],
  [/^minimax|^abab/i, "minimax"]
];
var vendorById = (id) => VENDORS.find((v) => v.id.toLowerCase() === String(id || "").toLowerCase());
function inferVendor(model) {
  const s = model.trim().split("/").pop() || "";
  for (const v of VENDORS) if (v.match.test(s)) return v;
  return null;
}
function parseModelInput(raw) {
  const s = raw.trim();
  const i = s.indexOf("/");
  if (i > 0) {
    const vp = s.slice(0, i).trim();
    return { vendor: vendorById(vp)?.id || vp, name: s.slice(i + 1).trim(), inferred: false };
  }
  return { vendor: inferVendor(s)?.id || null, name: s, inferred: true };
}
function iconFor(vendor, model) {
  if (model) {
    for (const [re, ic] of FAMILY_ICONS) if (re.test(model)) return ic;
  }
  return vendorById(vendor)?.icon || (vendor ? inferVendor(vendor)?.icon || null : null);
}
var HARNESSES = [
  { id: "deepseek-harness", name: "DeepSeek Harness", kind: "app", icon: "deepseek", win: { dirs: ["DeepSeek Harness"], exe: /^DeepSeek Harness\.exe$/i } },
  { id: "codex", name: "Codex CLI", kind: "cli", icon: "codex", vendor: "OpenAI", cmd: "codex", logs: "codex" },
  { id: "claude-code", name: "Claude Code", kind: "cli", icon: "claudecode", vendor: "Anthropic", cmd: "claude", logs: "claude_code" },
  { id: "gemini-cli", name: "Gemini CLI", kind: "cli", icon: "gemini", vendor: "Google", cmd: "gemini", logs: "gemini_cli" },
  { id: "kimi-cli", name: "Kimi CLI", kind: "cli", icon: "kimi", vendor: "Moonshot", cmd: "kimi" },
  { id: "opencode", name: "OpenCode", kind: "cli", icon: "opencode", cmd: "opencode" },
  { id: "opencode-desktop", name: "OpenCode Desktop", kind: "app", icon: "opencode", win: { dirs: ["@opencode-aidesktop"], exe: /^OpenCode\.exe$/i } },
  { id: "cline", name: "Cline CLI", kind: "cli", icon: "cline", cmd: "cline" },
  { id: "kiro-cli", name: "Kiro CLI", kind: "cli", icon: "kiro", cmd: "kiro-cli" },
  { id: "cursor", name: "Cursor", kind: "ide", icon: "cursor", win: { dirs: ["cursor"], exe: /^Cursor\.exe$/i }, folderArg: true },
  { id: "antigravity", name: "Antigravity", kind: "ide", icon: "antigravity", vendor: "Google", win: { dirs: ["Antigravity", "Antigravity IDE"], exe: /^Antigravity( IDE)?\.exe$/i }, folderArg: true },
  { id: "qoder", name: "Qoder", kind: "ide", icon: "qoder", win: { dirs: ["Qoder", "Qoder IDE"], exe: /^Qoder( IDE)?\.exe$/i }, folderArg: true },
  { id: "trae", name: "TRAE", kind: "ide", icon: "trae", vendor: "ByteDance", win: { dirs: ["Trae", "Trae CN"], exe: /^Trae( CN)?\.exe$/i }, folderArg: true },
  { id: "windsurf", name: "Windsurf", kind: "ide", icon: "windsurf", win: { dirs: ["Windsurf"], exe: /^Windsurf\.exe$/i }, folderArg: true },
  { id: "devin", name: "Devin", kind: "app", icon: "devin", win: { dirs: ["Devin"], exe: /^Devin\.exe$/i } },
  { id: "hermes", name: "Hermes Agent", kind: "app", icon: "hermesagent", win: { dirs: ["hermes-desktop"], exe: /^hermes-agent\.exe$/i } },
  { id: "multica", name: "Multica", kind: "app", icon: null, win: { dirs: ["@multicadesktop"], exe: /^Multica\.exe$/i } },
  { id: "catpaw", name: "CatPaw", kind: "app", icon: null, win: { dirs: ["CatPawAI"], exe: /^CatPawAI\.exe$/i } }
];
var harnessById = (id) => HARNESSES.find((h) => h.id === id);
var harnessByName = (name) => {
  const n = String(name || "").trim().toLowerCase();
  return n ? HARNESSES.find((h) => h.name.toLowerCase() === n || h.id === n) : void 0;
};
function suggestHarness(vendor, installed, preferred) {
  const ok = (h) => !!h && installed.includes(h.id);
  const pref = harnessById(preferred || "") || harnessByName(preferred || "");
  if (ok(pref)) return pref;
  const same = HARNESSES.find((h) => h.vendor && h.vendor === vendor && ok(h));
  if (same) return same;
  const ds = harnessById("deepseek-harness");
  if (ok(ds)) return ds;
  return HARNESSES.find((h) => ok(h)) || null;
}

// server/harness.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_child_process = require("node:child_process");

// server/http.ts
var HttpError = class extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
  status;
};
var Router = class {
  routes = [];
  /** open=true：GET 只读接口；其余需要 x-wb-token */
  add(method, pattern, fn, open = method === "GET") {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)(\*)?/g, (_m, k, star) => {
      keys.push(k);
      return star ? "(.+)" : "([^/]+)";
    }) + "$");
    this.routes.push({ method, re, keys, fn, open });
  }
  get(p, fn) {
    this.add("GET", p, fn);
  }
  post(p, fn) {
    this.add("POST", p, fn);
  }
  patch(p, fn) {
    this.add("PATCH", p, fn);
  }
  del(p, fn) {
    this.add("DELETE", p, fn);
  }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
};
function sendJson(res, status, data) {
  const body = JSON.stringify(data, (_k, v) => v === Infinity ? "inf" : v);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}
async function readBody(req, limit = 50 * 1024 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, "\u8BF7\u6C42\u4F53\u8FC7\u5927");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try {
    return JSON.parse(b.toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON \u89E3\u6790\u5931\u8D25");
  }
}
var EventHub = class {
  clients = /* @__PURE__ */ new Set();
  attach(res) {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "hello", at: Date.now() })}

`);
    this.clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 2e4);
    res.on("close", () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }
  emit(ev) {
    const s = `data: ${JSON.stringify(ev, (_k, v) => v === Infinity ? "inf" : v)}

`;
    for (const c of this.clients) c.write(s);
  }
};
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".hdr": "application/octet-stream",
  ".ktx2": "image/ktx2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};
var mimeOf = (p) => MIME[(p.match(/\.[^./\\]+$/)?.[0] || "").toLowerCase()] || "application/octet-stream";

// server/harness.ts
var cache = null;
function winRoots() {
  const e = process.env;
  return [e.LOCALAPPDATA && import_node_path.default.join(e.LOCALAPPDATA, "Programs"), e.ProgramFiles, e["ProgramFiles(x86)"], e.LOCALAPPDATA].filter(Boolean);
}
function findExe(h) {
  if (!h.win || process.platform !== "win32") return null;
  for (const root of winRoots()) {
    for (const d of h.win.dirs) {
      const dir = import_node_path.default.join(root, d);
      try {
        const hit = import_node_fs.default.readdirSync(dir).find((f2) => h.win.exe.test(f2));
        if (hit) return import_node_path.default.join(dir, hit);
      } catch {
      }
    }
  }
  return null;
}
function findCmd(cmd) {
  const probe = process.platform === "win32" ? (0, import_node_child_process.spawnSync)("where", [cmd], { encoding: "utf8", timeout: 4e3, windowsHide: true }) : (0, import_node_child_process.spawnSync)("which", [cmd], { encoding: "utf8", timeout: 4e3 });
  if (probe.status !== 0) return null;
  const first = probe.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return first.find((p) => /\.(exe|cmd|bat)$/i.test(p)) || first[0] || null;
}
function detectHarnesses(force = false) {
  if (cache && !force && Date.now() - cache.at < 6e4) return cache.list;
  const list = HARNESSES.map((h) => {
    const p = h.kind === "cli" ? h.cmd ? findCmd(h.cmd) : null : findExe(h);
    return { id: h.id, name: h.name, kind: h.kind, icon: h.icon, path: p, installed: !!p };
  });
  cache = { at: Date.now(), list };
  return list;
}
function openHarness(id, cwd) {
  const def = HARNESSES.find((h) => h.id === id);
  if (!def) throw new HttpError(400, `\u672A\u77E5 harness\uFF1A${id}`);
  const info = detectHarnesses().find((h) => h.id === id);
  if (!info?.path) throw new HttpError(404, `\u672C\u673A\u672A\u68C0\u6D4B\u5230 ${def.name}`);
  const dir = cwd && import_node_fs.default.existsSync(cwd) ? cwd : void 0;
  if (def.kind === "cli") {
    if (process.platform !== "win32") throw new HttpError(501, "\u547D\u4EE4\u884C harness \u81EA\u52A8\u6253\u5F00\u76EE\u524D\u53EA\u652F\u6301 Windows\uFF1B\u8BF7\u5728\u7EC8\u7AEF\u8FDB\u5165\u5DE5\u4F5C\u76EE\u5F55\u540E\u624B\u52A8\u8FD0\u884C");
    (0, import_node_child_process.spawn)("cmd.exe", ["/c", "start", def.name, "/D", dir || process.cwd(), "cmd.exe", "/k", info.path], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return { ok: true, how: `\u5DF2\u5728\u65B0\u7EC8\u7AEF\u4E2D\u542F\u52A8 ${def.name}` };
  }
  const args = def.folderArg && dir ? [dir] : [];
  (0, import_node_child_process.spawn)(info.path, args, { detached: true, stdio: "ignore", cwd: dir, windowsHide: false }).unref();
  return { ok: true, how: def.folderArg && dir ? `\u5DF2\u7528 ${def.name} \u6253\u5F00\u5DE5\u4F5C\u76EE\u5F55` : `\u5DF2\u542F\u52A8 ${def.name}` };
}

// server/config.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_node_child_process2 = require("node:child_process");
var VERSION = "1.0.0";
var DEFAULT_PORT = 41873;
var PREVIEW_PORT_RANGE = [41901, 41999];
function findRoot() {
  const cands = [process.env.WB_ROOT, process.env.PORTABLE_EXECUTABLE_DIR, process.cwd(), __dirnameSafe()].filter(Boolean);
  for (const c of cands) {
    let d = import_node_path2.default.resolve(c);
    for (let i = 0; i < 8; i++) {
      if (import_node_fs2.default.existsSync(import_node_path2.default.join(d, "skills", "bench-grader", "SKILL.md"))) return d;
      const up = import_node_path2.default.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return import_node_path2.default.resolve(process.env.WB_ROOT || process.cwd());
}
function __dirnameSafe() {
  try {
    return __dirname;
  } catch {
    return process.cwd();
  }
}
function detectPython() {
  const cands = [process.env.WB_PYTHON, "python", "python3", "py"].filter(Boolean);
  for (const c of cands) {
    try {
      const r = (0, import_node_child_process2.spawnSync)(c, ["-c", "import sys;print(sys.version_info[0])"], { encoding: "utf8", timeout: 8e3, windowsHide: true });
      if (r.status === 0 && r.stdout.trim() === "3") return c;
    } catch {
    }
  }
  return null;
}
function loadConfig(over = {}) {
  const root = over.root || findRoot();
  const env = process.env;
  const rel = (v, def) => import_node_path2.default.resolve(root, v || def);
  const runtimeDir = import_node_path2.default.join(root, "workbench", ".runtime");
  import_node_fs2.default.mkdirSync(runtimeDir, { recursive: true });
  const webDist = [over.webDist, env.WB_WEB_DIST, import_node_path2.default.join(root, "workbench", "dist")].find((p) => p && import_node_fs2.default.existsSync(import_node_path2.default.join(p, "index.html"))) || import_node_path2.default.join(root, "workbench", "dist");
  const cfg = {
    root,
    port: Number(env.WB_PORT || over.port || DEFAULT_PORT),
    host: "127.0.0.1",
    modelDir: rel(env.WB_MODEL_DIR, "model"),
    benchData: rel(env.WB_BENCH_DATA, "bench-data"),
    storeFile: rel(env.WB_STORE, import_node_path2.default.join("data", "bench-store.json")),
    reportsDir: rel(env.WB_REPORTS, "reports"),
    graderDir: import_node_path2.default.join(root, "skills", "bench-grader"),
    skillDir: import_node_path2.default.join(root, "skills", "bench-workbench"),
    bridgePy: import_node_path2.default.join(root, "workbench", "py", "wbbridge.py"),
    runtimeDir,
    scratchDir: import_node_path2.default.join(runtimeDir, "scratch"),
    webDist,
    python: detectPython(),
    desktop: !!over.desktop,
    token: import_node_crypto.default.randomBytes(18).toString("base64url"),
    ...over
  };
  import_node_fs2.default.mkdirSync(cfg.scratchDir, { recursive: true });
  return cfg;
}
var machineName = () => import_node_os.default.hostname();

// server/fsapi.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
var ALLOWED = ["model", "bench-data", "reports", "data", "skills", "workbench/.runtime", "benchmark-spec.html", "README.md"];
function resolveSafe(root, rel) {
  const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = import_node_path3.default.resolve(root, clean);
  const r = import_node_path3.default.relative(root, abs).split(import_node_path3.default.sep).join("/");
  if (r.startsWith("..") || import_node_path3.default.isAbsolute(r)) throw new HttpError(403, "\u8DEF\u5F84\u8D8A\u754C");
  if (r && !ALLOWED.some((a) => r === a || r.startsWith(a + "/"))) throw new HttpError(403, `\u4E0D\u5141\u8BB8\u8BBF\u95EE\uFF1A${r}`);
  return abs;
}
var toRel = (root, abs) => import_node_path3.default.relative(root, abs).split(import_node_path3.default.sep).join("/");
function listDir(root, rel) {
  const abs = resolveSafe(root, rel);
  let ents;
  try {
    ents = import_node_fs3.default.readdirSync(abs, { withFileTypes: true });
  } catch {
    throw new HttpError(404, `\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${rel}`);
  }
  const rows = ents.filter((d) => d.name !== "node_modules" && d.name !== ".git" && d.name !== "__pycache__" && d.name !== ".venv").map((d) => {
    const p = import_node_path3.default.join(abs, d.name);
    let size = 0, mtime = 0;
    try {
      const st = import_node_fs3.default.statSync(p);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
    }
    return { name: d.name, dir: d.isDirectory(), size, mtime, path: toRel(root, p) };
  }).filter((x) => !rel && !x.dir ? ALLOWED.includes(x.name) : !rel ? ALLOWED.some((a) => a === x.name || a.startsWith(x.name + "/")) : true);
  rows.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, void 0, { numeric: true }));
  return { path: rel, entries: rows };
}
function readText(root, rel, max = 2 * 1024 * 1024) {
  const abs = resolveSafe(root, rel);
  let st;
  try {
    st = import_node_fs3.default.statSync(abs);
  } catch {
    throw new HttpError(404, `\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${rel}`);
  }
  if (st.isDirectory()) throw new HttpError(400, "\u8FD9\u662F\u76EE\u5F55");
  const fd = import_node_fs3.default.openSync(abs, "r");
  const len = Math.min(st.size, max);
  const buf = Buffer.alloc(len);
  import_node_fs3.default.readSync(fd, buf, 0, len, 0);
  import_node_fs3.default.closeSync(fd);
  const binary = buf.subarray(0, 4e3).includes(0);
  return { path: rel, size: st.size, truncated: st.size > max, binary, text: binary ? "" : buf.toString("utf8"), mtime: st.mtimeMs };
}
function sendRaw(root, rel, req, res, download = false) {
  const abs = resolveSafe(root, rel);
  let st;
  try {
    st = import_node_fs3.default.statSync(abs);
  } catch {
    throw new HttpError(404, `\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${rel}`);
  }
  if (st.isDirectory()) throw new HttpError(400, "\u8FD9\u662F\u76EE\u5F55");
  const type = mimeOf(abs);
  const headers = {
    "content-type": type.startsWith("text/html") ? "text/plain; charset=utf-8" : type,
    "content-security-policy": "sandbox",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "cache-control": "no-cache"
  };
  if (download) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(import_node_path3.default.basename(abs))}`;
  const m = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (m) {
    const size = st.size;
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    start = Math.max(0, start);
    if (start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    import_node_fs3.default.createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "content-length": st.size });
  import_node_fs3.default.createReadStream(abs).pipe(res);
}

// server/python.ts
var import_node_child_process3 = require("node:child_process");
var PY_ENV = () => ({ ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" });
function callBridge(cfg, args, timeoutMs = 18e4) {
  return new Promise((resolve, reject) => {
    if (!cfg.python) return reject(new Error("\u672A\u627E\u5230 Python 3\uFF08bench-grader \u4F9D\u8D56 Python\uFF09\u3002\u5B89\u88C5\u540E\u91CD\u542F\u5DE5\u4F5C\u53F0\uFF0C\u6216\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF WB_PYTHON\u3002"));
    const p = (0, import_node_child_process3.spawn)(cfg.python, [cfg.bridgePy, ...args], { cwd: cfg.root, env: PY_ENV(), windowsHide: true });
    const out = [], err = [];
    const t = setTimeout(() => {
      p.kill();
      reject(new Error(`bridge ${args[0]} \u8D85\u65F6`));
    }, timeoutMs);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", () => {
      clearTimeout(t);
      const s = Buffer.concat(out).toString("utf8");
      const i = s.lastIndexOf("@@WB@@");
      if (i < 0) return reject(new Error(`bridge ${args[0]} \u65E0\u8F93\u51FA\uFF1A${Buffer.concat(err).toString("utf8").slice(-1200)}`));
      try {
        const j = JSON.parse(s.slice(i + 6), (_k, v) => v === "inf" ? Infinity : v);
        if (j.ok) resolve(j.data);
        else reject(new Error(j.error));
      } catch (e) {
        reject(e);
      }
    });
  });
}
function spawnStream(cmd, args, opts) {
  const child = (0, import_node_child_process3.spawn)(cmd, args, { cwd: opts.cwd, env: { ...PY_ENV(), ...opts.env || {} }, windowsHide: true, shell: opts.shell ?? false });
  const pipe = (stream, name) => {
    if (!stream) return;
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (d) => {
      buf += d;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() || "";
      for (const l of parts) opts.onLine(l, name);
    });
    stream.on("end", () => {
      if (buf) opts.onLine(buf, name);
    });
  };
  pipe(child.stdout, "stdout");
  pipe(child.stderr, "stderr");
  const done = new Promise((resolve) => {
    child.on("error", (e) => {
      opts.onLine(`[spawn error] ${e.message}`, "stderr");
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  return { child, done };
}
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") (0, import_node_child_process3.spawn)("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  else try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
    }
  }
}

// server/jobs.ts
var Jobs = class {
  constructor(hub) {
    this.hub = hub;
  }
  hub;
  list = [];
  running = false;
  seq = 0;
  info(j) {
    const { spec: _s, out: _o, child: _c, waiters: _w, ...rest } = j;
    return rest;
  }
  submit(spec) {
    const j = {
      id: `j${Date.now().toString(36)}${(this.seq++).toString(36)}`,
      kind: spec.kind,
      title: spec.title,
      status: "queued",
      started_at: Date.now(),
      ended_at: null,
      code: null,
      lines: 0,
      spec,
      out: [],
      waiters: []
    };
    this.list.unshift(j);
    if (this.list.length > 60) this.list.splice(60).forEach((x) => x.child && killTree(x.child.pid));
    this.hub.emit({ type: "job", job: this.info(j) });
    void this.pump();
    return this.info(j);
  }
  get(id) {
    return this.list.find((j) => j.id === id);
  }
  output(id, from = 0) {
    const j = this.get(id);
    return j ? j.out.slice(from) : null;
  }
  wait(id) {
    const j = this.get(id);
    if (!j) return Promise.reject(new Error("\u4EFB\u52A1\u4E0D\u5B58\u5728"));
    if (j.status === "done" || j.status === "failed" || j.status === "cancelled") return Promise.resolve(this.info(j));
    return new Promise((r) => j.waiters.push(r));
  }
  cancel(id) {
    const j = this.get(id);
    if (!j) return false;
    if (j.status === "queued") {
      this.finish(j, "cancelled", null);
      return true;
    }
    if (j.status === "running" && j.child) {
      killTree(j.child.pid);
      j.status = "cancelled";
      return true;
    }
    return false;
  }
  line(j, l) {
    j.out.push(l);
    if (j.out.length > 8e3) j.out.splice(0, j.out.length - 8e3);
    j.lines++;
    this.hub.emit({ type: "job-line", id: j.id, line: l });
  }
  finish(j, status, code) {
    j.status = status;
    j.code = code;
    j.ended_at = Date.now();
    this.hub.emit({ type: "job", job: this.info(j) });
    j.waiters.splice(0).forEach((w) => w(this.info(j)));
  }
  async pump() {
    if (this.running) return;
    const j = [...this.list].reverse().find((x) => x.status === "queued");
    if (!j) return;
    this.running = true;
    j.status = "running";
    j.started_at = Date.now();
    this.hub.emit({ type: "job", job: this.info(j) });
    this.line(j, `$ ${j.spec.cmd} ${j.spec.args.map((a) => /\s/.test(a) ? JSON.stringify(a) : a).join(" ")}`);
    try {
      const { child, done } = spawnStream(j.spec.cmd, j.spec.args, { cwd: j.spec.cwd, env: j.spec.env, shell: j.spec.shell, onLine: (l) => this.line(j, l) });
      j.child = child;
      const code = await done;
      const cancelled = j.status === "cancelled";
      if (j.spec.after && !cancelled) {
        try {
          j.result = await j.spec.after(code, j.out);
        } catch (e) {
          j.error = e.message;
          this.line(j, `[after] ${j.error}`);
        }
      }
      this.finish(j, cancelled ? "cancelled" : code === 0 && !j.error ? "done" : "failed", code);
    } catch (e) {
      j.error = e.message;
      this.finish(j, "failed", null);
    } finally {
      this.running = false;
      void this.pump();
    }
  }
};

// server/preview.ts
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_http = __toESM(require("node:http"), 1);
var import_node_net = __toESM(require("node:net"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);

// server/bridge-script.ts
var BRIDGE_JS = String.raw`(function () {
  if (window.__wbBridge) return;
  var SID = "__SID__";
  var W = window, q = [], timer = null, perfOn = false;
  W.__wbBridge = { sid: SID, version: 1 };
  var oFetch = W.fetch;
  function ser(v, d) {
    d = d || 0;
    try {
      if (v === undefined) return 'undefined';
      if (v === null) return 'null';
      var t = typeof v;
      if (t === 'string') return d ? JSON.stringify(v) : v;
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
      if (t === 'symbol') return v.toString();
      if (t === 'function') return 'ƒ ' + (v.name || 'anonymous') + '()';
      if (v instanceof Error) return (v.name || 'Error') + ': ' + v.message + (v.stack && d === 0 ? '\n' + String(v.stack).split('\n').slice(1, 8).join('\n') : '');
      if (typeof Element !== 'undefined' && v instanceof Element) {
        return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + (v.className && typeof v.className === 'string' ? '.' + v.className.trim().split(/\s+/).join('.') : '') + '>';
      }
      if (d > 2) return Array.isArray(v) ? '[…]' : '{…}';
      if (Array.isArray(v)) {
        var a = [];
        for (var i = 0; i < Math.min(v.length, 50); i++) a.push(ser(v[i], d + 1));
        return '[' + a.join(', ') + (v.length > 50 ? ', …(' + v.length + ')' : '') + ']';
      }
      var keys = Object.keys(v), parts = [];
      for (var j = 0; j < Math.min(keys.length, 30); j++) parts.push(keys[j] + ': ' + ser(v[keys[j]], d + 1));
      var name = v.constructor && v.constructor.name && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : '';
      return name + '{' + parts.join(', ') + (keys.length > 30 ? ', …' : '') + '}';
    } catch (e) { return '[不可序列化]'; }
  }
  function flush() {
    timer = null;
    if (!q.length) return;
    var body = JSON.stringify(q); q = [];
    try { oFetch.call(W, '/__wb/log', { method: 'POST', body: body, keepalive: body.length < 60000, headers: { 'content-type': 'text/plain' } })['catch'](function () {}); } catch (e) {}
  }
  function send(e) {
    e.ts = Date.now(); if (!e.src) e.src = 'page';
    q.push(e);
    if (q.length > 200) flush(); else if (!timer) timer = setTimeout(flush, 160);
  }
  function post(m) { try { if (W.parent && W.parent !== W) { m.__wb = 'evt'; m.sid = SID; W.parent.postMessage(m, '*'); } } catch (e) {} }
  function where() {
    try {
      var s = String(new Error().stack || '').split('\n');
      for (var i = 2; i < s.length; i++) if (s[i].indexOf('/__wb/bridge.js') < 0) { var m = /\(?((?:https?|file):\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/.exec(s[i]); if (m) return { url: m[1], line: +m[2], col: +m[3] }; }
    } catch (e) {}
    return {};
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (lv) {
    var o = console[lv];
    console[lv] = function () {
      try {
        var args = Array.prototype.slice.call(arguments), txt;
        if (typeof args[0] === 'string' && /%[sdifoOc]/.test(args[0])) {
          var fmt = args.shift();
          txt = fmt.replace(/%[sdifoOc]/g, function (m) { if (m === '%c') { args.shift(); return ''; } return args.length ? ser(args.shift()) : m; });
          if (args.length) txt += ' ' + args.map(function (a) { return ser(a); }).join(' ');
        } else txt = args.map(function (a) { return ser(a); }).join(' ');
        var w = where(), e = { level: lv, text: txt, url: w.url, line: w.line, col: w.col };
        if (lv === 'error') { for (var k = 0; k < args.length; k++) if (args[k] instanceof Error) { e.stack = args[k].stack; break; } }
        send(e);
      } catch (x) {}
      return o && o.apply(console, arguments);
    };
  });
  var oAssert = console.assert;
  console.assert = function (c) { if (!c) send({ level: 'error', text: 'Assertion failed: ' + Array.prototype.slice.call(arguments, 1).map(function (a) { return ser(a); }).join(' ') }); return oAssert && oAssert.apply(console, arguments); };
  W.addEventListener('error', function (ev) {
    var t = ev.target;
    if (t && t !== W && t.tagName) {
      var u = t.currentSrc || t.src || t.href || '';
      send({ level: 'resource', text: '资源加载失败 <' + t.tagName.toLowerCase() + '> ' + u, url: u });
    } else {
      send({ level: 'error', text: 'Uncaught ' + (ev.error ? ser(ev.error, 1) : ev.message), url: ev.filename, line: ev.lineno, col: ev.colno, stack: ev.error && ev.error.stack });
    }
  }, true);
  W.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    send({ level: 'error', text: 'Uncaught (in promise) ' + ser(r, 1), stack: r && r.stack });
  });
  document.addEventListener('securitypolicyviolation', function (ev) {
    send({ level: 'warn', text: 'CSP 拦截：' + ev.violatedDirective + ' ' + (ev.blockedURI || ''), url: ev.sourceFile, line: ev.lineNumber });
  });
  if (oFetch) {
    W.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (url.indexOf('/__wb/') >= 0) return oFetch.apply(this, arguments);
      var method = (init && init.method) || (input && input.method) || 'GET', t0 = Date.now();
      return oFetch.apply(this, arguments).then(function (r) {
        send({ level: 'network', method: method.toUpperCase(), url: r.url || url, status: r.status, ms: Date.now() - t0, text: 'fetch ' + method.toUpperCase() + ' ' + (r.url || url) + ' → ' + r.status });
        return r;
      }, function (err) {
        send({ level: 'network', method: method.toUpperCase(), url: url, status: 0, ms: Date.now() - t0, text: 'fetch ' + method.toUpperCase() + ' ' + url + ' 失败：' + ser(err) });
        throw err;
      });
    };
  }
  var XO = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
  if (XO) {
    var oOpen = XO.open, oSend = XO.send;
    XO.open = function (m, u) { this.__wbm = m; this.__wbu = u; return oOpen.apply(this, arguments); };
    XO.send = function () {
      var x = this, t0 = Date.now();
      try { x.addEventListener('loadend', function () { send({ level: 'network', method: String(x.__wbm || 'GET').toUpperCase(), url: x.responseURL || String(x.__wbu), status: x.status, ms: Date.now() - t0, text: 'xhr ' + String(x.__wbm || 'GET').toUpperCase() + ' ' + (x.responseURL || x.__wbu) + ' → ' + (x.status || '失败') }); }); } catch (e) {}
      return oSend.apply(this, arguments);
    };
  }
  function nav() { post({ type: 'nav', url: location.href, title: document.title }); }
  ['pushState', 'replaceState'].forEach(function (k) {
    var o = history[k];
    if (o) history[k] = function () { var r = o.apply(this, arguments); setTimeout(nav, 0); return r; };
  });
  W.addEventListener('popstate', nav); W.addEventListener('hashchange', nav);
  W.addEventListener('load', function () {
    nav();
    try {
      var n = performance.getEntriesByType('navigation')[0];
      if (n) send({ level: 'system', text: '页面加载完成 · DOMContentLoaded ' + Math.round(n.domContentLoadedEventEnd) + 'ms · load ' + Math.round(n.loadEventEnd || performance.now()) + 'ms' });
    } catch (e) {}
    flush();
  });
  W.addEventListener('pagehide', flush);
  send({ level: 'system', text: '导航到 ' + location.href });
  // 性能：帧率 + JS 堆
  var frames = 0, last = 0;
  function tick(t) {
    if (!perfOn) return;
    frames++;
    if (!last) last = t;
    if (t - last >= 1000) {
      var mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      post({ type: 'perf', fps: Math.round(frames * 1000 / (t - last)), mem: mem, nodes: document.getElementsByTagName('*').length });
      frames = 0; last = t;
    }
    requestAnimationFrame(tick);
  }
  W.addEventListener('message', function (ev) {
    if (ev.source !== W.parent) return;
    var d = ev.data;
    if (!d || d.__wb !== 'cmd') return;
    if (d.type === 'eval') {
      send({ level: 'log', src: 'eval', text: '› ' + d.code });
      try {
        var r = (0, eval)(d.code);
        Promise.resolve(r).then(function (v) { send({ level: 'result', src: 'eval', text: ser(v) }); flush(); }, function (e) { send({ level: 'error', src: 'eval', text: ser(e) }); flush(); });
      } catch (e) { send({ level: 'error', src: 'eval', text: ser(e) }); flush(); }
    } else if (d.type === 'back') history.back();
    else if (d.type === 'forward') history.forward();
    else if (d.type === 'reload') location.reload();
    else if (d.type === 'perf') { perfOn = !!d.on; frames = 0; last = 0; if (perfOn) requestAnimationFrame(tick); }
    else if (d.type === 'ping') { nav(); post({ type: 'info', w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent }); }
  });
  nav();
})();`;

// server/preview.ts
var MAX_LOGS = 3e3;
var MAX_REQ = 1500;
var Previews = class {
  constructor(hub, range) {
    this.hub = hub;
    this.range = range;
  }
  hub;
  range;
  sessions = /* @__PURE__ */ new Map();
  n = 0;
  public(s) {
    const { server: _s, logs: _l, requests: _r, seq: _q, pendingReq: _p, reqTimer: _t, ...pub } = s;
    return pub;
  }
  list() {
    return [...this.sessions.values()].map((s) => this.public(s));
  }
  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, `\u9884\u89C8\u4F1A\u8BDD\u4E0D\u5B58\u5728\uFF1A${id}`);
    return s;
  }
  newSess(kind, label, extra) {
    const id = `p${(++this.n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return { id, kind, label, url: "", created_at: Date.now(), inject: kind !== "url", counts: { error: 0, warn: 0, log: 0, failed: 0 }, logs: [], requests: [], seq: 0, pendingReq: [], ...extra };
  }
  async listen(server) {
    for (let p = this.range[0]; p <= this.range[1]; p++) {
      const used = [...this.sessions.values()].some((s) => s.port === p);
      if (used) continue;
      const ok = await new Promise((resolve) => {
        const onErr = () => {
          server.off("listening", onOk);
          resolve(false);
        };
        const onOk = () => {
          server.off("error", onErr);
          resolve(true);
        };
        server.once("error", onErr);
        server.once("listening", onOk);
        server.listen(p, "127.0.0.1");
      });
      if (ok) return p;
    }
    throw new HttpError(503, `\u9884\u89C8\u7AEF\u53E3 ${this.range[0]}\u2013${this.range[1]} \u5DF2\u5168\u90E8\u5360\u7528\uFF0C\u8BF7\u5173\u95ED\u4E00\u4E9B\u9884\u89C8\u4F1A\u8BDD`);
  }
  /** 以目录为根的静态预览。reuse：同根目录已有会话时复用（避免端口泄漏）。 */
  async createStatic(opts) {
    const root = import_node_path4.default.resolve(opts.root);
    if (!import_node_fs4.default.existsSync(root) || !import_node_fs4.default.statSync(root).isDirectory()) throw new HttpError(400, `\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${root}`);
    const entry = (opts.entry || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const existing = [...this.sessions.values()].find((s2) => s2.kind === "static" && s2.root === root && s2.inject === (opts.inject !== false));
    if (existing) {
      existing.entry = entry;
      existing.url = `http://127.0.0.1:${existing.port}/${encodePath(entry)}`;
      existing.label = opts.label || existing.label;
      this.hub.emit({ type: "session", id: existing.id, session: this.public(existing) });
      return this.public(existing);
    }
    const s = this.newSess("static", opts.label || import_node_path4.default.basename(root), { root, entry, inject: opts.inject !== false });
    s.server = import_node_http.default.createServer((req, res) => this.handleStatic(s, req, res).catch((e) => {
      res.writeHead(500);
      res.end(String(e));
    }));
    s.port = await this.listen(s.server);
    s.url = `http://127.0.0.1:${s.port}/${encodePath(entry)}`;
    this.sessions.set(s.id, s);
    this.system(s, `\u9759\u6001\u9884\u89C8\u5DF2\u542F\u52A8\uFF1A${root}`);
    this.hub.emit({ type: "session", id: s.id, session: this.public(s) });
    return this.public(s);
  }
  /** 反向代理到开发服务器（target 如 http://localhost:5173） */
  async createProxy(opts) {
    let t;
    try {
      t = new URL(opts.target);
    } catch {
      throw new HttpError(400, `\u5730\u5740\u4E0D\u5408\u6CD5\uFF1A${opts.target}`);
    }
    if (!/^https?:$/.test(t.protocol)) throw new HttpError(400, "\u53EA\u652F\u6301 http(s) \u5F00\u53D1\u670D\u52A1\u5668");
    const existing = [...this.sessions.values()].find((s2) => s2.kind === "proxy" && s2.target === t.origin);
    if (existing) return this.public(existing);
    const s = this.newSess("proxy", opts.label || t.host, { target: t.origin, proc_id: opts.proc_id, entry: (t.pathname + t.search).replace(/^\//, "") });
    s.server = import_node_http.default.createServer((req, res) => this.handleProxy(s, t, req, res));
    s.server.on("upgrade", (req, socket, head) => this.handleUpgrade(t, req, socket, head));
    s.port = await this.listen(s.server);
    s.url = `http://127.0.0.1:${s.port}/${s.entry || ""}`;
    this.sessions.set(s.id, s);
    this.system(s, `\u5F00\u53D1\u670D\u52A1\u5668\u4EE3\u7406\u5DF2\u542F\u52A8\uFF1A${t.origin} \u2192 127.0.0.1:${s.port}`);
    this.hub.emit({ type: "session", id: s.id, session: this.public(s) });
    return this.public(s);
  }
  createUrl(opts) {
    let u;
    try {
      u = new URL(opts.url);
    } catch {
      throw new HttpError(400, `\u5730\u5740\u4E0D\u5408\u6CD5\uFF1A${opts.url}`);
    }
    const s = this.newSess("url", opts.label || u.host, { url: u.href, target: u.origin, inject: false });
    this.sessions.set(s.id, s);
    this.hub.emit({ type: "session", id: s.id, session: this.public(s) });
    return this.public(s);
  }
  close(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.server?.closeAllConnections?.();
    s.server?.close();
    this.sessions.delete(id);
    this.hub.emit({ type: "session", id, session: null });
    return true;
  }
  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
  // ---------- 日志 ----------
  addLogs(id, entries) {
    const s = this.sessions.get(id);
    if (!s) return;
    const out = [];
    for (const e of entries.slice(0, 500)) {
      const lv = e.level || "log";
      const entry = {
        seq: ++s.seq,
        ts: Number(e.ts) || Date.now(),
        level: lv,
        text: String(e.text ?? "").slice(0, 2e4),
        src: e.src || "page",
        url: e.url ? String(e.url).slice(0, 2e3) : void 0,
        line: e.line,
        col: e.col,
        stack: e.stack ? String(e.stack).slice(0, 8e3) : void 0,
        status: e.status,
        method: e.method,
        ms: e.ms
      };
      const last = s.logs[s.logs.length - 1];
      if (last && last.text === entry.text && last.level === entry.level && last.url === entry.url && entry.level !== "network") {
        last.count = (last.count || 1) + 1;
        last.ts = entry.ts;
        out.push(last);
        continue;
      }
      s.logs.push(entry);
      out.push(entry);
      if (lv === "error" || lv === "resource" || lv === "network" && (!e.status || e.status >= 400)) s.counts.error++;
      else if (lv === "warn") s.counts.warn++;
      else s.counts.log++;
      if (lv === "network" && (!e.status || e.status >= 400)) s.counts.failed++;
    }
    if (s.logs.length > MAX_LOGS) s.logs.splice(0, s.logs.length - MAX_LOGS);
    if (out.length) {
      this.hub.emit({ type: "log", session: id, entries: out });
      this.hub.emit({ type: "session", id, session: this.public(s) });
    }
  }
  logs(id, since = 0, levels) {
    const s = this.get(id);
    return s.logs.filter((l) => l.seq > since && (!levels || levels.includes(l.level)));
  }
  requests(id, since = 0) {
    return this.get(id).requests.filter((r) => r.seq > since);
  }
  clear(id) {
    const s = this.get(id);
    s.logs = [];
    s.requests = [];
    s.counts = { error: 0, warn: 0, log: 0, failed: 0 };
    this.hub.emit({ type: "session", id, session: this.public(s) });
  }
  system(s, text) {
    this.addLogs(s.id, [{ level: "system", src: "server", text }]);
  }
  recordReq(s, r) {
    const e = { ...r, seq: ++s.seq };
    s.requests.push(e);
    if (s.requests.length > MAX_REQ) s.requests.splice(0, s.requests.length - MAX_REQ);
    if (r.status >= 400 || r.status === 0) this.addLogs(s.id, [{ level: "network", src: "server", method: r.method, url: r.url, status: r.status, ms: r.ms, text: `${r.method} ${r.url} \u2192 ${r.status || "\u5931\u8D25"}` }]);
    s.pendingReq.push(e);
    if (!s.reqTimer) s.reqTimer = setTimeout(() => {
      s.reqTimer = void 0;
      this.hub.emit({ type: "request", session: s.id, entries: s.pendingReq.splice(0) });
    }, 150);
  }
  /** bridge 自身的端点：/__wb/bridge.js 与 /__wb/log */
  async handleBridge(s, req, res, pathname) {
    if (pathname === "/__wb/bridge.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(BRIDGE_JS.replace("__SID__", s.id));
      return true;
    }
    if (pathname === "/__wb/log" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString("utf8"));
        this.addLogs(s.id, Array.isArray(body) ? body : [body]);
      } catch {
      }
      res.writeHead(204);
      res.end();
      return true;
    }
    return false;
  }
  async handleStatic(s, req, res) {
    const t0 = Date.now();
    const u = new URL(req.url || "/", "http://x");
    let pathname;
    try {
      pathname = decodeURIComponent(u.pathname);
    } catch {
      pathname = u.pathname;
    }
    if (await this.handleBridge(s, req, res, pathname)) return;
    const done = (status, bytes, type2) => this.recordReq(s, { ts: t0, method: req.method || "GET", url: u.pathname + u.search, status, bytes, ms: Date.now() - t0, type: type2, src: "server" });
    const abs = import_node_path4.default.resolve(s.root, "." + pathname);
    const relp = import_node_path4.default.relative(s.root, abs);
    if (relp.startsWith("..") || import_node_path4.default.isAbsolute(relp)) {
      res.writeHead(403);
      res.end("forbidden");
      return done(403, 0, "");
    }
    let file = abs;
    let st = null;
    try {
      st = import_node_fs4.default.statSync(file);
    } catch {
    }
    if (st?.isDirectory()) {
      if (!pathname.endsWith("/")) {
        res.writeHead(301, { location: u.pathname + "/" + u.search });
        res.end();
        return done(301, 0, "");
      }
      const idx = import_node_path4.default.join(file, "index.html");
      if (import_node_fs4.default.existsSync(idx)) {
        file = idx;
        st = import_node_fs4.default.statSync(idx);
      } else {
        const html = dirListing(pathname, file);
        const body = Buffer.from(s.inject ? injectBridge(html) : html);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(body);
        return done(200, body.length, "text/html");
      }
    }
    if (!st) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`404 Not Found: ${pathname}`);
      return done(404, 0, "");
    }
    const type = mimeOf(file);
    const headers = { "content-type": type, "cache-control": "no-store", "accept-ranges": "bytes", "access-control-allow-origin": "*" };
    if (s.inject && type.startsWith("text/html")) {
      const body = Buffer.from(injectBridge(import_node_fs4.default.readFileSync(file, "utf8")));
      res.writeHead(200, { ...headers, "content-length": body.length });
      res.end(req.method === "HEAD" ? void 0 : body);
      return done(200, body.length, type);
    }
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const size = st.size;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (!range[1]) end = size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end) {
        res.writeHead(416, { "content-range": `bytes */${size}` });
        res.end();
        return done(416, 0, type);
      }
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      if (req.method === "HEAD") {
        res.end();
        return done(206, 0, type);
      }
      import_node_fs4.default.createReadStream(file, { start, end }).pipe(res);
      return done(206, end - start + 1, type);
    }
    res.writeHead(200, { ...headers, "content-length": st.size });
    if (req.method === "HEAD") {
      res.end();
      return done(200, 0, type);
    }
    import_node_fs4.default.createReadStream(file).pipe(res);
    done(200, st.size, type);
  }
  handleProxy(s, t, req, res) {
    const t0 = Date.now();
    const u = new URL(req.url || "/", "http://x");
    void (async () => {
      if (await this.handleBridge(s, req, res, u.pathname)) return;
      const headers = { ...req.headers, host: t.host, "accept-encoding": "identity" };
      if (headers.origin) headers.origin = t.origin;
      if (headers.referer) headers.referer = String(headers.referer).replace(/^https?:\/\/127\.0\.0\.1:\d+/, t.origin);
      const up = import_node_http.default.request({ protocol: t.protocol, hostname: t.hostname, port: t.port || 80, method: req.method, path: req.url, headers }, (ur) => {
        const type = String(ur.headers["content-type"] || "");
        const h = { ...ur.headers };
        if (h.location) h.location = String(h.location).replace(t.origin, `http://127.0.0.1:${s.port}`);
        const rec = (bytes) => this.recordReq(s, { ts: t0, method: req.method || "GET", url: u.pathname + u.search, status: ur.statusCode || 0, bytes, ms: Date.now() - t0, type: type.split(";")[0], src: "server" });
        if (s.inject && type.includes("text/html") && (ur.statusCode || 0) < 300) {
          const chunks = [];
          ur.on("data", (c) => chunks.push(c));
          ur.on("end", () => {
            const body = Buffer.from(injectBridge(Buffer.concat(chunks).toString("utf8")));
            delete h["content-length"];
            delete h["transfer-encoding"];
            res.writeHead(ur.statusCode || 200, { ...h, "content-length": body.length, "cache-control": "no-store" });
            res.end(body);
            rec(body.length);
          });
          return;
        }
        res.writeHead(ur.statusCode || 502, h);
        let n = 0;
        ur.on("data", (c) => {
          n += c.length;
        });
        ur.on("end", () => rec(n));
        ur.pipe(res);
      });
      up.on("error", (e) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
        res.end(`<meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#c33">\u5F00\u53D1\u670D\u52A1\u5668\u65E0\u54CD\u5E94\uFF1A${t.origin}<br><small>${String(e.message).replace(/</g, "&lt;")}</small></body>`);
        this.recordReq(s, { ts: t0, method: req.method || "GET", url: u.pathname + u.search, status: 0, bytes: 0, ms: Date.now() - t0, type: "", src: "server" });
      });
      req.pipe(up);
    })();
  }
  handleUpgrade(t, req, socket, head) {
    const up = import_node_net.default.connect(Number(t.port || 80), t.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i], lk = k.toLowerCase();
        let v = req.rawHeaders[i + 1];
        if (lk === "host") v = t.host;
        if (lk === "origin") v = t.origin;
        lines.push(`${k}: ${v}`);
      }
      up.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  }
};
var TAG = '<script src="/__wb/bridge.js" data-wb-bridge></script>';
function injectBridge(html) {
  if (html.includes("data-wb-bridge")) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + TAG + html.slice(head.index + head[0].length);
  const h = /<html(\s[^>]*)?>/i.exec(html);
  if (h) return html.slice(0, h.index + h[0].length) + TAG + html.slice(h.index + h[0].length);
  const dt = /<!doctype[^>]*>/i.exec(html);
  if (dt) return html.slice(0, dt.index + dt[0].length) + TAG + html.slice(dt.index + dt[0].length);
  return TAG + html;
}
var encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");
function dirListing(urlPath, dir) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let items = [];
  try {
    items = import_node_fs4.default.readdirSync(dir, { withFileTypes: true }).filter((d) => d.name !== "node_modules" && !d.name.startsWith("."));
  } catch {
  }
  items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = items.map((d) => `<li><a href="${encodeURIComponent(d.name)}${d.isDirectory() ? "/" : ""}">${d.isDirectory() ? "\u{1F4C1}" : "\u{1F4C4}"} ${esc(d.name)}${d.isDirectory() ? "/" : ""}</a></li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(urlPath)}</title><style>body{font:14px/1.6 system-ui,"Microsoft YaHei";margin:24px;color:#1b2230;background:#f6f7f9}@media(prefers-color-scheme:dark){body{background:#12151b;color:#e6e9ef}a{color:#8aa4ff}}ul{list-style:none;padding:0}li{padding:3px 0}a{text-decoration:none;color:#2c4bc7}</style></head><body><h3>${esc(urlPath)}</h3><ul>${urlPath !== "/" ? '<li><a href="../">\u2B06 ..</a></li>' : ""}${rows}</ul></body></html>`;
}

// server/procs.ts
var import_node_fs5 = __toESM(require("node:fs"), 1);
var ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;
var URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:\/[^\s'"`)]*)?/;
var Procs = class {
  constructor(hub, previews) {
    this.hub = hub;
    this.previews = previews;
  }
  hub;
  previews;
  list = /* @__PURE__ */ new Map();
  n = 0;
  info(p) {
    const { child: _c, out: _o, ...rest } = p;
    return rest;
  }
  all() {
    return [...this.list.values()].map((p) => this.info(p));
  }
  get(id) {
    const p = this.list.get(id);
    if (!p) throw new HttpError(404, `\u8FDB\u7A0B\u4E0D\u5B58\u5728\uFF1A${id}`);
    return p;
  }
  output(id, from = 0) {
    return this.get(id).out.slice(from);
  }
  start(opts) {
    if (!import_node_fs5.default.existsSync(opts.cwd)) throw new HttpError(400, `\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${opts.cwd}`);
    if (!opts.cmd?.trim()) throw new HttpError(400, "\u547D\u4EE4\u4E0D\u80FD\u4E3A\u7A7A");
    const id = `c${(++this.n).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const p = { id, name: opts.name || opts.cmd, cwd: opts.cwd, cmd: opts.cmd, pid: null, status: "running", code: null, started_at: Date.now(), ended_at: null, url: null, session_id: null, out: [] };
    this.list.set(id, p);
    const { child, done } = spawnStream(opts.cmd, [], {
      cwd: opts.cwd,
      shell: true,
      env: { FORCE_COLOR: "0", NO_COLOR: "1", BROWSER: "none", ...opts.env || {} },
      onLine: (raw, stream) => {
        const line = raw.replace(ANSI, "");
        p.out.push({ line, stream, ts: Date.now() });
        if (p.out.length > 5e3) p.out.splice(0, p.out.length - 5e3);
        this.hub.emit({ type: "proc-line", id, line, stream });
        if (p.session_id) this.previews.addLogs(p.session_id, [{ level: stream === "stderr" ? "stderr" : "stdout", src: "proc", text: line }]);
        if (!p.url) {
          const m = URL_RE.exec(line);
          if (m) {
            p.url = m[0].replace("0.0.0.0", "127.0.0.1").replace(/[.,;]+$/, "");
            this.hub.emit({ type: "proc", proc: this.info(p) });
            if (opts.autoPreview !== false) {
              this.previews.createProxy({ target: p.url, label: p.name, proc_id: id }).then((s) => {
                p.session_id = s.id;
                this.hub.emit({ type: "proc", proc: this.info(p) });
              }).catch(() => {
              });
            }
          }
        }
      }
    });
    p.child = child;
    p.pid = child.pid ?? null;
    this.hub.emit({ type: "proc", proc: this.info(p) });
    void done.then((code) => {
      p.code = code;
      p.ended_at = Date.now();
      if (p.status === "running") p.status = code === 0 ? "exited" : "failed";
      this.hub.emit({ type: "proc", proc: this.info(p) });
      if (p.session_id) this.previews.addLogs(p.session_id, [{ level: "system", src: "proc", text: `\u5F00\u53D1\u670D\u52A1\u5668\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF08\u4EE3\u7801 ${code}\uFF09` }]);
    });
    return this.info(p);
  }
  stop(id) {
    const p = this.get(id);
    if (p.status === "running") {
      p.status = "exited";
      killTree(p.pid);
    }
    if (p.session_id) this.previews.close(p.session_id);
    this.hub.emit({ type: "proc", proc: this.info(p) });
    return this.info(p);
  }
  remove(id) {
    this.stop(id);
    this.list.delete(id);
  }
  stopAll() {
    for (const p of this.list.values()) if (p.status === "running") killTree(p.pid);
  }
};

// server/report.ts
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
var f = (v, d = 1) => v == null ? "\u2014" : v === Infinity ? "\u221E" : Number(v).toFixed(d);
function modelReport(store, agg, spec, vendor, name) {
  const dims = spec.dims;
  const rows = agg.board.filter((b) => b.model === name && (b.vendor === vendor || b.vendor == null));
  const runs = store.runs.filter((r) => r.model === name && (r.vendor === vendor || r.vendor == null));
  const wss = store.workspaces.filter((w) => w.vendor === vendor && w.model === name);
  const L = [];
  L.push(`# ${vendor} / ${name} \u2014 \u8BC4\u6D4B\u62A5\u544A`, "");
  L.push(`> ${spec.cfg.name} ${spec.cfg.version} \xB7 \u751F\u6210\u4E8E ${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { hour12: false })} \xB7 \u7531 bench-workbench \u6C47\u603B bench-grader \u8BC4\u5206`, "");
  if (!rows.length) L.push("\u5C1A\u65E0\u5DF2\u8BC4\u5206\u8FD0\u884C\u3002", "");
  for (const b of rows) {
    const total = agg.board.length;
    L.push(`## ${b.entrant}`, "");
    L.push(`- \u540D\u6B21\uFF1A**${b.rank}** / ${total}\u3000\u8D28\u91CF\u603B\u5206\uFF1A**${f(b.quality, 2)}**\uFF0895% CI ${f(b.ci_low, 2)}\u2013${f(b.ci_high, 2)}\uFF09`);
    L.push(`- \u8FBE\u6807\u7387 ${f(b.pass_rate * 100, 0)}%\u3000\u8FD0\u884C ${b.runs} \u6B21 / \u8986\u76D6 ${b.tasks} \u9898\u3000\u6574\u5957\u671F\u671B\u6210\u672C $${f(b.suite_exp_cost_usd, 2)}\u3000\u671F\u671B\u7528\u65F6 ${f(b.suite_exp_min, 0)} \u5206\u949F`);
    L.push(`- \u8BC4\u5206\u5B8C\u6574\uFF1A${b.complete ? "\u662F" : "\u5426\uFF08\u4ECD\u6709\u5F85\u8BC4\u9879\uFF09"}\u3000\u5E73\u5747 N/A \u5360\u6BD4 ${f(b.na_ratio * 100, 0)}%`, "");
    L.push("| \u7EF4\u5EA6 | \u5F97\u5206 |", "|---|---:|");
    for (const d of dims) L.push(`| ${d.name} | ${f(b.dims[d.id])} |`);
    L.push("", "### \u5404\u9898", "", "| \u9898\u76EE | \u8FD0\u884C | \u5747\u503C | \u6807\u51C6\u5DEE | \u6700\u4F4E | \u6700\u9AD8 | \u8FBE\u6807\u7387 | \u671F\u671B\u6210\u672C | \u671F\u671B\u7528\u65F6 |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const t of agg.tasks.filter((t2) => t2.entrant === b.entrant)) {
      L.push(`| ${t.task} | ${t.runs} | ${f(t.mean, 2)} | ${f(t.sd, 2)} | ${f(t.min, 1)} | ${f(t.max, 1)} | ${f(t.pass_rate * 100, 0)}% | ${t.exp_cost_usd == null ? "\u2014" : "$" + f(t.exp_cost_usd, 2)} | ${f(t.exp_min, 0)} |`);
    }
    const fails = agg.failures.filter((x) => x.entrant === b.entrant);
    if (fails.length) {
      L.push("", "### \u672A\u8FBE\u6807 / \u5931\u8D25\u5F52\u56E0", "", "| \u8FD0\u884C | \u9898\u76EE | \u603B\u5206 | \u5F52\u56E0 |", "|---|---|---:|---|");
      for (const x of fails) L.push(`| ${x.run_id} | ${x.task} | ${f(x.total, 1)} | ${x.tags} |`);
    }
    const strong = agg.items.filter((i) => i.by_entrant[b.entrant] != null && Object.keys(i.by_entrant).length > 1).map((i) => ({ i, d: i.by_entrant[b.entrant] - i.mean })).sort((a, c) => c.d - a.d);
    if (strong.length) {
      L.push("", "### \u76F8\u5BF9\u5F3A\u9879\uFF08\u9AD8\u4E8E\u5168\u4F53\u5747\u503C\u6700\u591A\u7684\u68C0\u67E5\u9879\uFF09", "");
      for (const { i, d } of strong.slice(0, 5)) L.push(`- ${i.task} ${i.item_id}\uFF08${i.desc}\uFF09\uFF1A${f(i.by_entrant[b.entrant] * 100, 0)}%\uFF0C\u9AD8\u51FA ${f(d * 100, 0)} \u4E2A\u767E\u5206\u70B9`);
      L.push("", "### \u76F8\u5BF9\u5F31\u9879", "");
      for (const { i, d } of strong.slice(-5).reverse()) L.push(`- ${i.task} ${i.item_id}\uFF08${i.desc}\uFF09\uFF1A${f(i.by_entrant[b.entrant] * 100, 0)}%\uFF0C\u4F4E ${f(-d * 100, 0)} \u4E2A\u767E\u5206\u70B9`);
    }
    L.push("");
  }
  L.push("## \u8FD0\u884C\u660E\u7EC6", "", "| \u8FD0\u884C id | \u9898\u76EE | \u6B21\u5E8F | harness | \u603B\u5206 | \u95E8\u69DB | \u8FBE\u6807 | \u5F85\u8BC4 | \u7528\u65F6(\u5206) | \u8D39\u7528($) | \u7528\u91CF\u6765\u6E90 | \u5DE5\u4F5C\u533A |", "|---|---|---:|---|---:|---|---|---:|---:|---:|---|---|");
  for (const r of runs) {
    const s = r.score;
    L.push(`| ${r.run_id} | ${r.tkey} | ${r.run_index ?? ""} | ${r.harness} | ${s ? f(s.total, 1) : "\u672A\u8BC4\u5206"} | ${s ? s.gate_pass ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7" : "\u2014"} | ${s ? s.passed ? "\u662F" : "\u5426" : "\u2014"} | ${s ? s.pending.length : "\u2014"} | ${f(r.usage.active_min ?? r.usage.wall_min, 0)} | ${f(r.usage.cost_usd, 2)} | ${r.usage.source || "\u2014"} | ${r.ws_ref || ""} |`);
  }
  const unreg = wss.filter((w) => !w.grader_run_id);
  if (unreg.length) {
    L.push("", "## \u672A\u767B\u8BB0\u7684\u5DE5\u4F5C\u533A", "");
    for (const w of unreg) L.push(`- ${w.ref}\uFF08${w.status || "prepared"}\uFF09${w.has_deliverable ? "" : " \u2014 \u5C1A\u65E0\u4EA4\u4ED8\u76EE\u5F55"}`);
  }
  L.push("", "---", "\u8BC4\u5206\u53E3\u5F84\u89C1 skills/bench-grader/references/scoring-model.md\u3002\u672A\u5B8C\u6210\u7684\u4EBA\u5DE5/agent \u9879\u4E0D\u8BA1\u5165\u5206\u6BCD\uFF0C\u6B63\u5F0F\u53D1\u5E03\u524D\u5E94\u6E05\u96F6\u3002", "");
  return L.join("\n");
}
function writeModelReport(modelDir, vendor, name, md, summary) {
  const dir = import_node_path5.default.join(modelDir, vendor, name, "_report");
  import_node_fs6.default.mkdirSync(dir, { recursive: true });
  import_node_fs6.default.writeFileSync(import_node_path5.default.join(dir, "REPORT.md"), md, "utf8");
  import_node_fs6.default.writeFileSync(import_node_path5.default.join(dir, "summary.json"), JSON.stringify(summary, (_k, v) => v === Infinity ? "inf" : v, 2), "utf8");
  return dir;
}
function listReports(reportsDir) {
  import_node_fs6.default.mkdirSync(reportsDir, { recursive: true });
  return import_node_fs6.default.readdirSync(reportsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const p = import_node_path5.default.join(reportsDir, d.name);
    const files = import_node_fs6.default.readdirSync(p).sort();
    return { name: d.name, files, mtime: import_node_fs6.default.statSync(p).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
}

// server/store.ts
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_path6 = __toESM(require("node:path"), 1);
function emptyStore() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return { schema: "bench-store/1", created_at: now, updated_at: now, machine: machineName(), benchmark: {}, settings: {}, models: [], runs: [], workspaces: [], notes: [], history: [], spec: null };
}
var StoreFile = class {
  constructor(file) {
    this.file = file;
    this.data = this.read(file) || emptyStore();
  }
  file;
  data;
  read(file) {
    try {
      const j = JSON.parse(import_node_fs7.default.readFileSync(file, "utf8"), (_k, v) => v === "inf" ? Infinity : v);
      if (j && j.schema === "bench-store/1") return { ...emptyStore(), ...j };
    } catch {
    }
    return null;
  }
  save() {
    this.data.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    this.data.machine = machineName();
    import_node_fs7.default.mkdirSync(import_node_path6.default.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    import_node_fs7.default.writeFileSync(tmp, JSON.stringify(this.data, (_k, v) => v === Infinity ? "inf" : v, 1) + "\n", "utf8");
    import_node_fs7.default.renameSync(tmp, this.file);
  }
  log(action, detail) {
    this.data.history.unshift({ at: (/* @__PURE__ */ new Date()).toISOString(), action, detail });
    this.data.history.splice(300);
  }
  setSpec(spec) {
    this.data.spec = spec;
    this.data.benchmark = { name: spec.cfg.name, version: spec.cfg.version };
  }
  /** 合并 bench-grader 快照 + 工作区扫描结果。本机不存在的历史运行（从别的电脑导入）保留不动。 */
  syncFrom(snapshot, models, wss) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const byId = new Map(this.data.runs.map((r) => [r.run_id, r]));
    const wsByGrader = new Map(wss.filter((w) => w.grader_run_id).map((w) => [w.grader_run_id, w]));
    for (const row of snapshot) {
      if (row.error || !row.meta) continue;
      const m = row.meta;
      const ws = wsByGrader.get(row.run_id);
      const run = {
        run_id: row.run_id,
        task: m.task,
        variant: m.variant || null,
        tkey: m.task + (m.variant || ""),
        model: m.model,
        vendor: m.vendor || ws?.vendor || byId.get(row.run_id)?.vendor || null,
        harness: m.harness,
        entrant: entrantOf(m),
        run_index: m.run_index ?? null,
        date: m.date ?? null,
        alias: row.alias ?? null,
        ws_ref: m.ws_ref || ws?.ref || null,
        started_at: m.started_at ?? null,
        ended_at: m.ended_at ?? null,
        timed_out: !!m.timed_out,
        failure_tag: m.failure_tag ?? null,
        graded: !!row.graded,
        score: row.score || null,
        usage: row.usage || {},
        manual: row.manual || {},
        artifacts: row.artifacts || {},
        notes: row.notes || [],
        dir: row.dir,
        has_final_message: !!row.has_final_message,
        synced_at: now,
        origin: machineName()
      };
      byId.set(run.run_id, run);
    }
    this.data.runs = [...byId.values()].sort((a, b) => a.tkey.localeCompare(b.tkey) || a.entrant.localeCompare(b.entrant) || (a.run_index ?? 0) - (b.run_index ?? 0));
    const mm = new Map(this.data.models.map((x) => [`${x.vendor}/${x.name}`, x]));
    for (const x of models) mm.set(`${x.vendor}/${x.name}`, x);
    this.data.models = [...mm.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
    const wm = new Map(this.data.workspaces.map((x) => [x.ref, x]));
    for (const w of wss) wm.set(w.ref, { ...w, status: this.wsStatus(w) });
    const local = new Set(wss.map((w) => w.ref));
    const localModels = new Set(models.map((x) => `${x.vendor}/${x.name}`));
    for (const ref of [...wm.keys()]) {
      const [v, n] = ref.split("/");
      if (localModels.has(`${v}/${n}`) && !local.has(ref)) wm.delete(ref);
    }
    this.data.workspaces = [...wm.values()].sort((a, b) => a.ref.localeCompare(b.ref, void 0, { numeric: true }));
  }
  wsStatus(w) {
    if (w.grader_run_id) {
      const r = this.data.runs.find((x) => x.run_id === w.grader_run_id);
      if (r?.graded) return r.score && r.score.pending.length === 0 ? "reviewed" : "graded";
      return "registered";
    }
    if (w.ended_at) return "finished";
    if (w.started_at) return "running";
    return "prepared";
  }
  updateRun(run) {
    const i = this.data.runs.findIndex((r) => r.run_id === run.run_id);
    if (i >= 0) this.data.runs[i] = { ...this.data.runs[i], ...run };
    else this.data.runs.push(run);
    for (const w of this.data.workspaces) if (w.grader_run_id === run.run_id) w.status = this.wsStatus(w);
  }
  /** 导入另一份存储文件：按 run_id / 模型 / 工作区 ref 合并，较新的 synced_at 覆盖。 */
  importFrom(other) {
    if (other?.schema !== "bench-store/1") throw new Error("\u4E0D\u662F bench-store/1 \u683C\u5F0F\u7684\u5B58\u50A8\u6587\u4EF6");
    const stat = { runs: 0, models: 0, workspaces: 0, notes: 0 };
    const runs = new Map(this.data.runs.map((r) => [r.run_id, r]));
    for (const r of other.runs || []) {
      const cur = runs.get(r.run_id);
      if (!cur || (r.synced_at || "") > (cur.synced_at || "")) {
        runs.set(r.run_id, r);
        stat.runs++;
      }
    }
    this.data.runs = [...runs.values()];
    const models = new Map(this.data.models.map((m) => [`${m.vendor}/${m.name}`, m]));
    for (const m of other.models || []) if (!models.has(`${m.vendor}/${m.name}`)) {
      models.set(`${m.vendor}/${m.name}`, m);
      stat.models++;
    }
    this.data.models = [...models.values()];
    const wss = new Map(this.data.workspaces.map((w) => [w.ref, w]));
    for (const w of other.workspaces || []) if (!wss.has(w.ref)) {
      wss.set(w.ref, w);
      stat.workspaces++;
    }
    this.data.workspaces = [...wss.values()];
    const notes = new Set(this.data.notes.map((n) => n.id));
    for (const n of other.notes || []) if (!notes.has(n.id)) {
      this.data.notes.push(n);
      stat.notes++;
    }
    if (!this.data.spec && other.spec) this.data.spec = other.spec;
    this.log("import", `\u5BFC\u5165 ${stat.runs} \u6B21\u8FD0\u884C\u3001${stat.models} \u4E2A\u6A21\u578B\uFF08\u6765\u81EA ${other.machine || "\u672A\u77E5\u7535\u8111"}\uFF09`);
    return stat;
  }
};

// server/workspaces.ts
var import_node_fs8 = __toESM(require("node:fs"), 1);
var import_node_path7 = __toESM(require("node:path"), 1);
var import_node_child_process4 = require("node:child_process");
var BAD = /[<>:"/\\|?*\u0000-\u001f]/;
function checkName(kind, s) {
  const v = String(s ?? "").trim();
  if (!v || v === "." || v === ".." || BAD.test(v) || v.length > 80 || /[. ]$/.test(v)) throw new HttpError(400, `${kind}\u540D\u79F0\u4E0D\u5408\u6CD5\uFF1A\u201C${v}\u201D\uFF08\u4E0D\u80FD\u542B <>:"/\\|?* \uFF0C\u4E0D\u80FD\u4EE5\u70B9\u6216\u7A7A\u683C\u7ED3\u5C3E\uFF09`);
  return v;
}
var readJson2 = (p) => {
  try {
    return JSON.parse(import_node_fs8.default.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
var writeJson = (p, d) => {
  import_node_fs8.default.mkdirSync(import_node_path7.default.dirname(p), { recursive: true });
  import_node_fs8.default.writeFileSync(p, JSON.stringify(d, null, 2) + "\n", "utf8");
};
var isDir = (p) => {
  try {
    return import_node_fs8.default.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
var TASK_DIR = /^(T\d{2})([A-Z])?$/;
var RUN_DIR = /^r(\d+)$/;
var Workspaces = class {
  constructor(modelDir) {
    this.modelDir = modelDir;
    import_node_fs8.default.mkdirSync(modelDir, { recursive: true });
  }
  modelDir;
  modelPath(vendor, name) {
    return import_node_path7.default.join(this.modelDir, vendor, name);
  }
  listModels() {
    const out = [];
    for (const v of this.dirs(this.modelDir)) {
      if (v.startsWith(".") || v.startsWith("_")) continue;
      for (const m of this.dirs(import_node_path7.default.join(this.modelDir, v))) {
        if (m.startsWith(".") || m.startsWith("_")) continue;
        const p = import_node_path7.default.join(this.modelDir, v, m, "model.json");
        const prof = readJson2(p);
        if (prof) out.push({ ...prof, vendor: v, name: m });
        else {
          const created = { schema: 1, vendor: v, name: m, created_at: this.mtime(import_node_path7.default.join(this.modelDir, v, m)) };
          writeJson(p, created);
          out.push(created);
        }
      }
    }
    return out.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
  }
  vendors() {
    return this.dirs(this.modelDir).filter((v) => !v.startsWith(".") && !v.startsWith("_"));
  }
  upsertModel(input) {
    const vendor = checkName("\u4F9B\u5E94\u5546", input.vendor), name = checkName("\u6A21\u578B", input.name);
    const dir = this.modelPath(vendor, name);
    const cur = readJson2(import_node_path7.default.join(dir, "model.json"));
    const prof = { schema: 1, created_at: cur?.created_at || (/* @__PURE__ */ new Date()).toISOString(), ...cur || {}, ...input, vendor, name };
    import_node_fs8.default.mkdirSync(dir, { recursive: true });
    writeJson(import_node_path7.default.join(dir, "model.json"), prof);
    return prof;
  }
  listRuns() {
    const out = [];
    for (const m of this.listModels()) {
      const md = this.modelPath(m.vendor, m.name);
      for (const t of this.dirs(md)) {
        const tm = TASK_DIR.exec(t);
        if (!tm) continue;
        const td = import_node_path7.default.join(md, t);
        const seen = /* @__PURE__ */ new Set();
        for (const f2 of import_node_fs8.default.readdirSync(td)) {
          const rm = /^r(\d+)\.run\.json$/.exec(f2) || (isDir(import_node_path7.default.join(td, f2)) ? RUN_DIR.exec(f2) : null);
          if (!rm) continue;
          const n = Number(rm[1]);
          if (seen.has(n)) continue;
          seen.add(n);
          out.push(this.readRun(m.vendor, m.name, t, n));
        }
      }
    }
    return out.sort((a, b) => a.ref.localeCompare(b.ref, void 0, { numeric: true }));
  }
  parseRef(ref) {
    const parts = ref.split("/");
    if (parts.length !== 4) throw new HttpError(400, `\u5DE5\u4F5C\u533A\u5F15\u7528\u5E94\u4E3A \u4F9B\u5E94\u5546/\u6A21\u578B/\u9898\u53F7/rN\uFF1A${ref}`);
    const [vendor, model, tkey, r] = parts;
    checkName("\u4F9B\u5E94\u5546", vendor);
    checkName("\u6A21\u578B", model);
    const tm = TASK_DIR.exec(tkey), rm = RUN_DIR.exec(r);
    if (!tm || !rm) throw new HttpError(400, `\u5DE5\u4F5C\u533A\u5F15\u7528\u4E0D\u5408\u6CD5\uFF1A${ref}`);
    return { vendor, model, tkey, task: tm[1], variant: tm[2] || null, index: Number(rm[1]) };
  }
  files(ref) {
    const { vendor, model, tkey, index } = this.parseRef(ref);
    const td = import_node_path7.default.join(this.modelPath(vendor, model), tkey);
    const b = import_node_path7.default.join(td, `r${index}`);
    return { taskDir: td, ws: b, run: `${b}.run.json`, prompt: `${b}.prompt.md`, final: `${b}.final.md`, transcript: `${b}.transcript.json` };
  }
  readRun(vendor, model, tkey, index) {
    const ref = `${vendor}/${model}/${tkey}/r${index}`;
    const f2 = this.files(ref);
    const tm = TASK_DIR.exec(tkey);
    const cur = readJson2(f2.run);
    const run = {
      schema: 1,
      vendor,
      model,
      task: tm[1],
      variant: tm[2] || null,
      tkey,
      index,
      harness: "",
      created_at: this.mtime(f2.ws),
      started_at: null,
      ended_at: null,
      deliverable_dir: "",
      grader_run_id: null,
      ...cur || {},
      ref
    };
    run.workspace = f2.ws;
    run.has_final = import_node_fs8.default.existsSync(f2.final);
    const droot = run.deliverable_dir ? import_node_path7.default.join(f2.ws, run.deliverable_dir) : f2.ws;
    run.has_deliverable = !!run.deliverable_dir && isDir(droot);
    const d = deliverableFor(run.task, run.deliverable_dir);
    const pv = d.preview && run.has_deliverable ? import_node_path7.default.join(droot, d.preview) : null;
    run.entry = pv && import_node_fs8.default.existsSync(pv) ? import_node_path7.default.relative(f2.ws, pv).split(import_node_path7.default.sep).join("/") : this.detectEntry(run.has_deliverable ? droot : f2.ws, f2.ws);
    run.detect = this.detect(f2.ws, d, run.deliverable_dir);
    return run;
  }
  /** 交付检测：按清单逐项检查 + 最近修改时间 + FINAL_MESSAGE.md 是否出现。 */
  detect(ws, d, dirName) {
    const dd = { ...d, dir: d.dir || dirName };
    const exists = (rel, dir) => {
      try {
        const s = import_node_fs8.default.statSync(import_node_path7.default.join(ws, rel));
        return dir ? s.isDirectory() : true;
      } catch {
        return false;
      }
    };
    const list = (rel) => {
      try {
        return import_node_fs8.default.readdirSync(import_node_path7.default.join(ws, rel));
      } catch {
        return [];
      }
    };
    const checks = evalDeliverable(dd, exists, list);
    const req = checks.filter((c) => !c.optional);
    let last = null;
    const walk = (p, depth) => {
      if (depth > 3) return;
      let es = [];
      try {
        es = import_node_fs8.default.readdirSync(p, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of es) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const fp = import_node_path7.default.join(p, e.name);
        try {
          const m = import_node_fs8.default.statSync(fp).mtimeMs;
          if (!last || m > last) last = m;
        } catch {
        }
        if (e.isDirectory()) walk(fp, depth + 1);
      }
    };
    if (dd.dir && isDir(import_node_path7.default.join(ws, dd.dir))) walk(import_node_path7.default.join(ws, dd.dir), 0);
    return { dir_exists: !!dd.dir && isDir(import_node_path7.default.join(ws, dd.dir)), checks, done: req.filter((c) => c.ok).length, total: req.length, final: import_node_fs8.default.existsSync(import_node_path7.default.join(ws, FINAL_FILE)), last_change: last };
  }
  /** 模型写出 FINAL_MESSAGE.md 后：导入为 rN.final.md，并以文件时间结束计时。返回是否有变化。 */
  absorbFinal(ref) {
    const f2 = this.files(ref);
    const src = import_node_path7.default.join(f2.ws, FINAL_FILE);
    if (!import_node_fs8.default.existsSync(src)) return false;
    let changed = false;
    const txt = import_node_fs8.default.readFileSync(src, "utf8");
    const cur = import_node_fs8.default.existsSync(f2.final) ? import_node_fs8.default.readFileSync(f2.final, "utf8") : null;
    if (cur == null) {
      import_node_fs8.default.writeFileSync(f2.final, txt, "utf8");
      changed = true;
    }
    const p = this.parseRef(ref);
    const run = this.readRun(p.vendor, p.model, p.tkey, p.index);
    if (!run.ended_at && !run.grader_run_id) {
      run.ended_at = new Date(import_node_fs8.default.statSync(src).mtimeMs).toISOString();
      if (!run.started_at) run.started_at = run.created_at;
      run.auto_finished = true;
      this.saveRun(run);
      changed = true;
    }
    return changed;
  }
  /** 与 benchlib/review._entry 一致的入口优先级，另外识别视频 */
  detectEntry(root, ws) {
    if (!isDir(root)) return null;
    for (const c of ["dist/index.html", "index.html", "final.mp4", "renders/final.mp4", "FIXES.md", "README.md"]) {
      const p = import_node_path7.default.join(root, c);
      if (import_node_fs8.default.existsSync(p)) return import_node_path7.default.relative(ws, p).split(import_node_path7.default.sep).join("/");
    }
    try {
      const v = import_node_fs8.default.readdirSync(root).find((x) => /\.(mp4|webm|mov)$/i.test(x));
      if (v) return import_node_path7.default.relative(ws, import_node_path7.default.join(root, v)).split(import_node_path7.default.sep).join("/");
    } catch {
    }
    return null;
  }
  /** 下一个可用的运行序号（题目页据此预先生成带绝对路径的提示词）。 */
  nextIndex(vendor, model, tkey) {
    const td = import_node_path7.default.join(this.modelPath(vendor, model), tkey);
    let n = 1;
    while (import_node_fs8.default.existsSync(import_node_path7.default.join(td, `r${n}`)) || import_node_fs8.default.existsSync(import_node_path7.default.join(td, `r${n}.run.json`))) n++;
    return n;
  }
  wsPath(vendor, model, tkey, n) {
    return import_node_path7.default.join(this.modelPath(vendor, model), tkey, `r${n}`);
  }
  createRun(input) {
    const { vendor, model, task } = input;
    checkName("\u4F9B\u5E94\u5546", vendor);
    checkName("\u6A21\u578B", model);
    if (Object.keys(task.variants || {}).length && !input.variant) throw new HttpError(400, `${task.id} \u9700\u8981\u9009\u62E9\u53D8\u4F53\uFF08${Object.keys(task.variants).join(" / ")}\uFF09`);
    if (input.variant && !(task.variants || {})[input.variant]) throw new HttpError(400, `${task.id} \u6CA1\u6709\u53D8\u4F53 ${input.variant}`);
    if (!this.listModels().some((m) => m.vendor === vendor && m.name === model)) this.upsertModel({ vendor, name: model, harness: input.harness });
    const tkey = task.id + (input.variant || "");
    const td = import_node_path7.default.join(this.modelPath(vendor, model), tkey);
    import_node_fs8.default.mkdirSync(td, { recursive: true });
    let n = input.index && input.index > 0 ? input.index : this.nextIndex(vendor, model, tkey);
    if (import_node_fs8.default.existsSync(import_node_path7.default.join(td, `r${n}`)) || import_node_fs8.default.existsSync(import_node_path7.default.join(td, `r${n}.run.json`))) n = this.nextIndex(vendor, model, tkey);
    const ws = import_node_path7.default.join(td, `r${n}`);
    import_node_fs8.default.mkdirSync(ws, { recursive: true });
    const mat = import_node_path7.default.join(input.taskDir, "materials");
    if (isDir(mat)) for (const e of import_node_fs8.default.readdirSync(mat)) import_node_fs8.default.cpSync(import_node_path7.default.join(mat, e), import_node_path7.default.join(ws, e), { recursive: true });
    try {
      (0, import_node_child_process4.spawnSync)("git", ["init", "-q"], { cwd: ws, timeout: 1e4, windowsHide: true });
    } catch {
    }
    const run = {
      schema: 1,
      ref: `${vendor}/${model}/${tkey}/r${n}`,
      vendor,
      model,
      task: task.id,
      variant: input.variant,
      tkey,
      index: n,
      harness: input.harness,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      started_at: null,
      ended_at: null,
      deliverable_dir: task.deliverable,
      grader_run_id: null,
      usage: {},
      notes: ""
    };
    this.saveRun(run);
    import_node_fs8.default.writeFileSync(`${ws}.prompt.md`, typeof input.prompt === "function" ? input.prompt(ws, n) : input.prompt, "utf8");
    return this.readRun(vendor, model, tkey, n);
  }
  saveRun(run) {
    const { workspace: _w, has_final: _h, has_deliverable: _d, entry: _e, status: _s, detect: _t, ...persist } = run;
    writeJson(this.files(run.ref).run, persist);
  }
  patchRun(ref, patch) {
    const p = this.parseRef(ref);
    const cur = this.readRun(p.vendor, p.model, p.tkey, p.index);
    const allowed = ["harness", "started_at", "ended_at", "timed_out", "notes", "usage", "grader_run_id", "deliverable_dir"];
    for (const k of allowed) if (k in patch) cur[k] = patch[k];
    this.saveRun(cur);
    return this.readRun(p.vendor, p.model, p.tkey, p.index);
  }
  writeFinal(ref, text) {
    import_node_fs8.default.writeFileSync(this.files(ref).final, text, "utf8");
  }
  writeTranscript(ref, data) {
    writeJson(this.files(ref).transcript, data);
  }
  dirs(p) {
    try {
      return import_node_fs8.default.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  }
  mtime(p) {
    try {
      return import_node_fs8.default.statSync(p).mtime.toISOString();
    } catch {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
  }
};

// server/index.ts
async function startServer(over = {}) {
  const cfg = loadConfig(over);
  const hub = new EventHub();
  const jobs = new Jobs(hub);
  const previews = new Previews(hub, PREVIEW_PORT_RANGE);
  const procs = new Procs(hub, previews);
  const ws = new Workspaces(cfg.modelDir);
  const store = new StoreFile(cfg.storeFile);
  const R = new Router();
  const startedAt = Date.now();
  const bench = import_node_path8.default.join(cfg.graderDir, "scripts", "bench.py");
  const py = () => {
    if (!cfg.python) throw new HttpError(500, "\u672A\u627E\u5230 Python 3");
    return cfg.python;
  };
  let spec = null;
  async function loadSpec(refresh = false) {
    if (spec && !refresh) return spec;
    try {
      spec = { ...await callBridge(cfg, ["spec"], 9e4), _source: "python" };
      store.setSpec(spec);
      store.save();
    } catch (e) {
      if (store.data.spec) spec = { ...store.data.spec, _source: "cache" };
      else {
        const html = import_node_fs9.default.readFileSync(import_node_path8.default.join(cfg.root, "benchmark-spec.html"), "utf8");
        const m = /<script id="spec" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
        if (!m) throw e;
        const d = JSON.parse(m[1].replace(/<\\\//g, "</"));
        spec = { ...d, config_full: d.cfg, _source: "html" };
      }
    }
    return spec;
  }
  let aggCache = null;
  async function getAgg() {
    const key = store.data.updated_at + ":" + store.data.runs.length;
    if (aggCache?.key === key) return aggCache.agg;
    const agg = aggregate(store.data.runs, await loadSpec());
    aggCache = { key, agg };
    return agg;
  }
  let syncing = null;
  async function sync() {
    if (syncing) await syncing.catch(() => {
    });
    const p = (async () => {
      let snap = { runs: [] };
      if (import_node_fs9.default.existsSync(import_node_path8.default.join(cfg.benchData, "runs"))) snap = await callBridge(cfg, ["snapshot", "--data", cfg.benchData, "--root", cfg.root], 6e5);
      store.syncFrom(snap.runs, ws.listModels(), ws.listRuns());
      store.log("sync", `\u540C\u6B65 ${snap.runs.length} \u6B21\u8FD0\u884C`);
      store.save();
      hub.emit({ type: "store", updated_at: store.data.updated_at });
      return { runs: snap.runs.length, models: store.data.models.length, workspaces: store.data.workspaces.length };
    })();
    syncing = p;
    try {
      return await p;
    } finally {
      syncing = null;
    }
  }
  const refreshWorkspaces = () => {
    store.syncFrom([], ws.listModels(), ws.listRuns());
    store.save();
    hub.emit({ type: "store", updated_at: store.data.updated_at });
  };
  const graderJob = (kind, title, args, after) => jobs.submit({ kind, title, cmd: py(), args: [bench, "--data", cfg.benchData, ...args], cwd: cfg.graderDir, after });
  function gradeRuns(runDirs, opts = {}) {
    const args = ["grade", ...runDirs === "all" ? ["--all"] : runDirs];
    if (opts.fast) args.push("--fast");
    if (opts.skip) args.push("--skip-graded");
    if (opts.task) args.push("--task", opts.task);
    return graderJob("grade", runDirs === "all" ? `\u8BC4\u5206\uFF1A\u5168\u90E8\u8FD0\u884C${opts.task ? " \xB7 " + opts.task : ""}` : `\u8BC4\u5206\uFF1A${runDirs.map((d) => import_node_path8.default.basename(d)).join(", ")}`, args, async () => sync());
  }
  function registerWs(ref, opts) {
    const pr = ws.parseRef(ref);
    const w = ws.readRun(pr.vendor, pr.model, pr.tkey, pr.index);
    if (w.grader_run_id && import_node_fs9.default.existsSync(import_node_path8.default.join(cfg.benchData, "runs", w.grader_run_id))) throw new HttpError(409, `\u5DF2\u767B\u8BB0\u4E3A ${w.grader_run_id}\uFF1B\u5982\u9700\u91CD\u65B0\u767B\u8BB0\u8BF7\u5148\u5728 run.json \u6E05\u7A7A grader_run_id`);
    if (!w.harness) throw new HttpError(400, "\u8BF7\u5148\u586B\u5199 harness\uFF08\u4F8B\u5982 Claude Code / Codex CLI / Kiro\uFF09");
    const f2 = ws.files(ref);
    const src = w.deliverable_dir ? import_node_path8.default.join(f2.ws, w.deliverable_dir) : f2.ws;
    if (!import_node_fs9.default.existsSync(src)) throw new HttpError(400, `\u4EA4\u4ED8\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${toRel(cfg.root, src)}\uFF08\u6A21\u578B\u5E94\u5728\u5DE5\u4F5C\u76EE\u5F55\u4E0B\u65B0\u5EFA ${w.deliverable_dir}/\uFF09`);
    const extra = { vendor: w.vendor, ws_ref: w.ref };
    if (w.usage && Object.keys(w.usage).length) extra.usage = w.usage;
    if (w.timed_out) extra.timed_out = true;
    const args = ["init-run", "--task", w.task, "--model", w.model, "--harness", w.harness, "--src", src, "--workspace", f2.ws, "--run-index", String(w.index), "--extra", JSON.stringify(extra)];
    if (w.variant) args.push("--variant", w.variant);
    if (import_node_fs9.default.existsSync(f2.final)) args.push("--final-message", f2.final);
    if (w.task === "T06" && import_node_fs9.default.existsSync(f2.transcript)) args.push("--transcript", f2.transcript);
    if (w.started_at) args.push("--started-at", w.started_at);
    if (w.ended_at) args.push("--ended-at", w.ended_at);
    return graderJob("register", `\u767B\u8BB0\uFF1A${ref}`, args, async (code, lines) => {
      if (code !== 0) throw new Error("init-run \u5931\u8D25");
      const last = [...lines].reverse().find((l) => /runs[\\/][^\\/\s]+\s*$/.test(l.trim()));
      const rid = last ? import_node_path8.default.basename(last.trim()) : null;
      if (!rid) throw new Error("\u65E0\u6CD5\u4ECE\u8F93\u51FA\u4E2D\u89E3\u6790\u8FD0\u884C id");
      ws.patchRun(ref, { grader_run_id: rid });
      store.log("register", `${ref} \u2192 ${rid}`);
      if (opts.grade) gradeRuns([import_node_path8.default.join(cfg.benchData, "runs", rid)], { fast: opts.fast });
      else await sync();
      return { run_id: rid };
    });
  }
  const openFolder = (p) => {
    const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
    (0, import_node_child_process5.spawn)(cmd, [p], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  };
  const taskDirOf = (task) => spec?.materials_state?.[task.id]?.dir || import_node_path8.default.join(cfg.graderDir, "tasks", import_node_fs9.default.readdirSync(import_node_path8.default.join(cfg.graderDir, "tasks")).find((d) => d.startsWith(task.id + "-")) || task.id);
  const findTask = async (id) => {
    const s = await loadSpec();
    const t = s.tasks.find((x) => x.id === String(id || "").toUpperCase());
    if (!t) throw new HttpError(404, `\u9898\u76EE\u4E0D\u5B58\u5728\uFF1A${id}`);
    return { s, t };
  };
  const settings = () => store.data.settings;
  const renderPrompt = (s, t, variant, wsAbs, index) => buildRunPrompt(t.prompt, {
    bench: `${s.cfg.name} ${s.cfg.version}`,
    taskId: t.id,
    taskName: t.name,
    variant,
    runIndex: index,
    workspace: wsAbs,
    deliverableDir: t.deliverable,
    timeLimit: t.time_limit,
    materials: t.materials,
    condition: t.condition
  }, { tts: settings().tts_command, header: settings().prompt_header !== false });
  const claimable = (vendor, model, tkey) => ws.listRuns().find((w) => w.vendor === vendor && w.model === model && w.tkey === tkey && !w.started_at && !w.grader_run_id && !w.detect?.dir_exists && !w.detect?.final);
  async function promptFor(q) {
    const { s, t } = await findTask(q.task);
    const variant = q.variant || null;
    if (Object.keys(t.variants || {}).length && !variant) throw new HttpError(400, `${t.id} \u9700\u8981\u9009\u62E9\u53D8\u4F53\uFF08${Object.keys(t.variants).join(" / ")}\uFF09`);
    if (!q.vendor || !q.model) return { ...renderPrompt(s, t, variant, null, null), ref: null, workspace: null, index: null, exists: false };
    const tkey = t.id + (variant || "");
    const cur = claimable(q.vendor, q.model, tkey);
    const index = cur ? cur.index : ws.nextIndex(q.vendor, q.model, tkey);
    const wsAbs = cur?.workspace || ws.wsPath(q.vendor, q.model, tkey, index);
    return { ...renderPrompt(s, t, variant, wsAbs, index), ref: `${q.vendor}/${q.model}/${tkey}/r${index}`, workspace: wsAbs, index, exists: !!cur };
  }
  async function claimRun(b) {
    const { s, t } = await findTask(b.task);
    const variant = b.variant || null;
    const tkey = t.id + (variant || "");
    const prof = store.data.models.find((m) => m.vendor === b.vendor && m.name === b.model);
    const harness = b.harness || prof?.harness || harnessById(settings().default_harness)?.name || "";
    let run = claimable(b.vendor, b.model, tkey);
    if (!run || b.index && run.index !== b.index) {
      run = ws.createRun({ vendor: b.vendor, model: b.model, task: t, variant, harness, taskDir: taskDirOf(t), index: b.index, prompt: (wsAbs, n) => renderPrompt(s, t, variant, wsAbs, n).text });
      store.log("ws-create", run.ref);
    } else if (harness && !run.harness) run = ws.patchRun(run.ref, { harness });
    if (b.start !== false && !run.started_at) run = ws.patchRun(run.ref, { started_at: (/* @__PURE__ */ new Date()).toISOString(), ended_at: null });
    const text = import_node_fs9.default.readFileSync(ws.files(run.ref).prompt, "utf8");
    let opened = null;
    if (b.open) {
      const h = harnessByName(harness) || harnessById(settings().default_harness);
      if (h) {
        try {
          opened = openHarness(h.id, run.workspace || null).how;
        } catch (e) {
          opened = `\u672A\u80FD\u6253\u5F00\uFF1A${e.message}`;
        }
      }
    }
    refreshWorkspaces();
    return { run, text, opened };
  }
  const agentsSkills = import_node_path8.default.join(cfg.root, ".agents", "skills");
  function mirrorSkills() {
    let copied = 0;
    for (const name of ["bench-grader", "bench-workbench"]) {
      const src = import_node_path8.default.join(cfg.root, "skills", name);
      const dst = import_node_path8.default.join(agentsSkills, name);
      if (!import_node_fs9.default.existsSync(src)) continue;
      const walk = (a, b) => {
        import_node_fs9.default.mkdirSync(b, { recursive: true });
        for (const e of import_node_fs9.default.readdirSync(a, { withFileTypes: true })) {
          if (e.name === "hidden" || e.name === "__pycache__" || e.name.endsWith(".pyc")) continue;
          const sa = import_node_path8.default.join(a, e.name), sb = import_node_path8.default.join(b, e.name);
          if (e.isDirectory()) walk(sa, sb);
          else {
            const st = import_node_fs9.default.statSync(sa);
            let same = false;
            try {
              const tb = import_node_fs9.default.statSync(sb);
              same = tb.size === st.size && tb.mtimeMs >= st.mtimeMs;
            } catch {
            }
            if (!same) {
              import_node_fs9.default.copyFileSync(sa, sb);
              copied++;
            }
          }
        }
      };
      walk(src, dst);
    }
    import_node_fs9.default.writeFileSync(import_node_path8.default.join(agentsSkills, "README.md"), "# .agents/skills\n\n\u7531 Bench Workbench \u81EA\u52A8\u4ECE `skills/` \u955C\u50CF\uFF08\u4E0D\u542B `hidden/`\uFF09\u3002\u8BF7\u4FEE\u6539 `skills/` \u4E0B\u7684\u6E90\u6587\u4EF6\uFF0C\u4E0D\u8981\u76F4\u63A5\u6539\u8FD9\u91CC\u3002\n", "utf8");
    return { copied, dir: agentsSkills };
  }
  try {
    mirrorSkills();
  } catch (e) {
    console.error("[wb] skills \u955C\u50CF\u5931\u8D25\uFF1A", e.message);
  }
  const fp = /* @__PURE__ */ new Map();
  const detectTick = () => {
    let changed = false;
    for (const w of store.data.workspaces) {
      if (w.grader_run_id) continue;
      try {
        if (ws.absorbFinal(w.ref)) changed = true;
        const p = ws.parseRef(w.ref);
        const r = ws.readRun(p.vendor, p.model, p.tkey, p.index);
        const key = JSON.stringify([r.detect?.done, r.detect?.dir_exists, r.detect?.final, r.detect?.last_change, r.ended_at, r.has_final, r.entry]);
        if (fp.has(w.ref) && fp.get(w.ref) !== key) changed = true;
        fp.set(w.ref, key);
      } catch {
        changed = true;
      }
    }
    if (changed) refreshWorkspaces();
  };
  const detectTimer = setInterval(detectTick, 3e3);
  detectTimer.unref();
  R.get("/api/session", () => ({
    version: VERSION,
    token: cfg.token,
    port: cfg.port,
    preview_ports: PREVIEW_PORT_RANGE,
    root: cfg.root,
    python: cfg.python,
    desktop: cfg.desktop,
    started_at: startedAt,
    paths: { model: cfg.modelDir, bench_data: cfg.benchData, store: cfg.storeFile, reports: cfg.reportsDir, grader: cfg.graderDir, skill: cfg.skillDir, agents_skills: agentsSkills },
    github: settings().github || "https://github.com/AIMFllyYS/TryProtocom-Model-Compare"
  }));
  R.get("/api/health", () => ({ ok: true, version: VERSION, port: cfg.port, pid: process.pid }));
  R.get("/api/events", (req, res) => {
    hub.attach(res);
    return void 0;
  });
  R.get("/api/spec", async (req) => loadSpec(req.query.get("refresh") === "1"));
  R.get("/api/store", () => store.data);
  R.get("/api/aggregate", () => getAgg());
  R.post("/api/sync", () => sync());
  R.get("/api/models", () => store.data.models);
  R.post("/api/models", async (req) => {
    const b = await readJson(req);
    if (b.input && !b.name) {
      const p = parseModelInput(String(b.input));
      b.vendor = b.vendor || p.vendor;
      b.name = p.name;
    }
    if (!b.vendor) throw new HttpError(400, `\u65E0\u6CD5\u4ECE\u201C${b.name}\u201D\u63A8\u65AD\u4F9B\u5E94\u5546\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u6216\u8F93\u5165\u201C\u4F9B\u5E94\u5546/\u6A21\u578B\u201D`);
    if (!b.harness && !store.data.models.some((m2) => m2.vendor === b.vendor && m2.name === b.name)) {
      const installed = detectHarnesses().filter((h) => h.installed).map((h) => h.id);
      b.harness = suggestHarness(b.vendor, installed, settings().default_harness)?.name || "";
    }
    const m = ws.upsertModel(b);
    store.log("model", `\u65B0\u589E/\u66F4\u65B0\u6A21\u578B ${m.vendor}/${m.name}`);
    refreshWorkspaces();
    return m;
  });
  R.post("/api/models/report", async (req) => {
    const { vendor, name } = await readJson(req);
    const md = modelReport(store.data, await getAgg(), await loadSpec(), vendor, name);
    const agg = await getAgg();
    const dir = writeModelReport(cfg.modelDir, vendor, name, md, { board: agg.board.filter((b) => b.model === name), tasks: agg.tasks.filter((t) => t.entrant.startsWith(name + " @ ")), generated_at: agg.generated_at });
    return { dir: toRel(cfg.root, dir), file: toRel(cfg.root, import_node_path8.default.join(dir, "REPORT.md")), markdown: md };
  });
  R.get("/api/ws", () => store.data.workspaces);
  R.post("/api/ws/scan", () => {
    refreshWorkspaces();
    return store.data.workspaces;
  });
  R.get("/api/ws/prompt", async (req) => {
    const q = req.query;
    const model = q.get("for") ? parseModelInput(q.get("for")) : null;
    return promptFor({ task: q.get("task") || "", variant: q.get("variant"), vendor: model?.vendor || q.get("vendor"), model: model?.name || q.get("model") });
  });
  R.post("/api/ws/claim", async (req) => claimRun(await readJson(req)));
  R.post("/api/ws/create", async (req) => {
    const b = await readJson(req);
    const { s, t: task } = await findTask(b.task);
    const variant = b.variant || null;
    const run = ws.createRun({ vendor: b.vendor, model: b.model, task, variant, harness: b.harness || "", taskDir: taskDirOf(task), prompt: (wsAbs, n) => renderPrompt(s, task, variant, wsAbs, n).text });
    const pr = { text: import_node_fs9.default.readFileSync(ws.files(run.ref).prompt, "utf8"), warnings: renderPrompt(s, task, variant, null, null).warnings };
    const warnings = [...pr.warnings, ...(s.materials_state?.[task.id]?.missing || []).map((m) => `\u7D20\u6750\u7F3A\u5931\uFF1A${m}\uFF08\u5148\u5728\u300C\u8BBE\u7F6E \u2192 \u8BC4\u6D4B\u673A\u300D\u8FD0\u884C\u201C\u751F\u6210\u7D20\u6750\u201D\uFF09`)];
    if (task.id === "T02") warnings.push("T02 \u9700\u8981\u628A\u7528\u6237\u63D0\u4F9B\u7684 minecraft-stop-motion-director skill \u590D\u5236\u5230\u5DE5\u4F5C\u76EE\u5F55\u7684 skills/ \u4E0B\u3002");
    if (task.id === "T06") warnings.push("T06 \u4E3A\u6709\u4EBA\u503C\u5B88\uFF1A\u6309 hidden/intent.md \u56DE\u7B54\u6A21\u578B\u63D0\u95EE\uFF0C\u5E76\u5728\u5B8C\u6210\u65F6\u586B\u5199 transcript_notes\u3002");
    store.log("ws-create", run.ref);
    refreshWorkspaces();
    return { run, prompt: pr.text, warnings, workspace: run.workspace };
  });
  R.get("/api/ws/detect", () => {
    detectTick();
    return store.data.workspaces.filter((w) => !w.grader_run_id).map((w) => ({ ref: w.ref, detect: w.detect, ended_at: w.ended_at, has_final: w.has_final, entry: w.entry }));
  });
  R.get("/api/harness", (req) => detectHarnesses(req.query.get("refresh") === "1"));
  R.post("/api/harness/open", async (req) => {
    const b = await readJson(req);
    const cwd = b.ref ? ws.files(b.ref).ws : null;
    const id = b.id || harnessByName(b.name)?.id;
    return openHarness(id, cwd);
  });
  R.get("/api/models/infer", (req) => {
    const p = parseModelInput(req.query.get("name") || "");
    const installed = detectHarnesses().filter((h2) => h2.installed).map((h2) => h2.id);
    const h = suggestHarness(p.vendor, installed, settings().default_harness);
    const exists = store.data.models.some((m) => m.vendor === p.vendor && m.name === p.name);
    return { ...p, icon: iconFor(p.vendor, p.name), harness: h ? { id: h.id, name: h.name } : null, exists, vendors: ws.vendors() };
  });
  R.get("/api/review-prompt", async (req) => {
    const s = await loadSpec();
    const rid = req.query.get("run_id");
    const ref = req.query.get("ref");
    const agg = await getAgg();
    if (!rid && !ref) return { text: reviewPrompt({ root: cfg.root, bench: `${s.cfg.name} ${s.cfg.version}`, scope: "all", pendingAgent: agg.pending.agent }) };
    const w = ref ? store.data.workspaces.find((x) => x.ref === ref) : store.data.workspaces.find((x) => x.grader_run_id === rid);
    const run = rid ? store.data.runs.find((r) => r.run_id === rid) : w?.grader_run_id ? store.data.runs.find((r) => r.run_id === w.grader_run_id) : void 0;
    const task = run?.task || w?.task || null;
    return { text: reviewPrompt({ root: cfg.root, bench: `${s.cfg.name} ${s.cfg.version}`, scope: { run_id: run?.run_id || w?.grader_run_id || rid, ref: w?.ref || ref, task, taskName: s.tasks.find((t) => t.id === task)?.name } }) };
  });
  R.post("/api/skills/sync", () => mirrorSkills());
  R.get("/api/source.zip", (req, res) => {
    const r = (0, import_node_child_process5.spawnSync)("git", ["rev-parse", "--short", "HEAD"], { cwd: cfg.root, encoding: "utf8", windowsHide: true });
    if (r.status !== 0) throw new HttpError(500, "\u5F53\u524D\u76EE\u5F55\u4E0D\u662F git \u4ED3\u5E93\uFF0C\u65E0\u6CD5\u6253\u5305\u6E90\u7801");
    const rev = r.stdout.trim();
    res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="TryProtocom-Model-Compare-${rev}.zip"` });
    const p = (0, import_node_child_process5.spawn)("git", ["archive", "--format=zip", `--prefix=TryProtocom-Model-Compare/`, "HEAD"], { cwd: cfg.root, windowsHide: true });
    p.stdout.pipe(res);
    p.on("error", () => res.end());
    return void 0;
  });
  R.post("/api/ws/start", async (req) => {
    const b = await readJson(req);
    const r = ws.patchRun(b.ref, { started_at: b.at || (/* @__PURE__ */ new Date()).toISOString(), ended_at: null });
    refreshWorkspaces();
    return r;
  });
  R.post("/api/ws/finish", async (req) => {
    const b = await readJson(req);
    if (typeof b.final_message === "string" && b.final_message.trim()) ws.writeFinal(b.ref, b.final_message);
    if (b.transcript) ws.writeTranscript(b.ref, b.transcript);
    const patch = { ended_at: b.at || (/* @__PURE__ */ new Date()).toISOString() };
    if (b.usage) patch.usage = b.usage;
    if (b.timed_out != null) patch.timed_out = !!b.timed_out;
    const r = ws.patchRun(b.ref, patch);
    refreshWorkspaces();
    let job = null;
    if (b.register) job = registerWs(b.ref, { grade: b.grade !== false, fast: !!b.fast });
    return { run: r, job };
  });
  R.post("/api/ws/patch", async (req) => {
    const b = await readJson(req);
    if (typeof b.final_message === "string") ws.writeFinal(b.ref, b.final_message);
    const r = ws.patchRun(b.ref, b);
    refreshWorkspaces();
    return r;
  });
  R.get("/api/ws/final", (req) => {
    const f2 = ws.files(req.query.get("ref") || "");
    return { text: import_node_fs9.default.existsSync(f2.final) ? import_node_fs9.default.readFileSync(f2.final, "utf8") : "", prompt: import_node_fs9.default.existsSync(f2.prompt) ? import_node_fs9.default.readFileSync(f2.prompt, "utf8") : "" };
  });
  R.post("/api/ws/register", async (req) => {
    const b = await readJson(req);
    return registerWs(b.ref, { grade: b.grade !== false, fast: !!b.fast });
  });
  R.post("/api/open-folder", async (req) => {
    const b = await readJson(req);
    const p = b.ref ? ws.files(b.ref).ws : resolveSafe(cfg.root, b.path || "");
    if (!import_node_fs9.default.existsSync(p)) throw new HttpError(404, "\u76EE\u5F55\u4E0D\u5B58\u5728");
    openFolder(p);
    return { ok: true, path: p };
  });
  R.get("/api/runs", () => store.data.runs);
  R.get("/api/runs/:id", async (req) => {
    const run = store.data.runs.find((r) => r.run_id === req.params.id);
    if (!run) throw new HttpError(404, "\u8FD0\u884C\u4E0D\u5B58\u5728");
    const rd = import_node_path8.default.join(cfg.benchData, "runs", run.run_id);
    const metrics = import_node_fs9.default.existsSync(import_node_path8.default.join(rd, "metrics.json")) ? JSON.parse(import_node_fs9.default.readFileSync(import_node_path8.default.join(rd, "metrics.json"), "utf8")) : null;
    const final = import_node_fs9.default.existsSync(import_node_path8.default.join(rd, "final_message.md")) ? import_node_fs9.default.readFileSync(import_node_path8.default.join(rd, "final_message.md"), "utf8") : null;
    return { run, metrics, final_message: final, local: import_node_fs9.default.existsSync(rd) };
  });
  R.post("/api/runs/:id/manual", async (req) => {
    const b = await readJson(req);
    const rid = req.params.id;
    const items = Array.isArray(b.items) ? b.items : [{ item: b.item, score: b.score, note: b.note }];
    let last = null;
    for (const it of items) {
      last = await callBridge(cfg, ["set-manual", "--data", cfg.benchData, "--root", cfg.root, "--run", rid, "--item", it.item, "--score", it.score == null ? "" : String(it.score), "--note", it.note || "", "--by", b.by || "human"]);
    }
    const cur = store.data.runs.find((r) => r.run_id === rid);
    if (cur && last) {
      store.updateRun({ ...cur, score: last.score, manual: last.manual, graded: last.graded, synced_at: (/* @__PURE__ */ new Date()).toISOString() });
      store.save();
      hub.emit({ type: "store", updated_at: store.data.updated_at });
    }
    return { ok: true, score: last?.score, manual: last?.manual };
  });
  R.get("/api/jobs", () => jobs.list.map((j) => jobs.info(j)));
  R.get("/api/jobs/:id", (req) => {
    const j = jobs.get(req.params.id);
    if (!j) throw new HttpError(404, "\u4EFB\u52A1\u4E0D\u5B58\u5728");
    return { ...jobs.info(j), output: jobs.output(j.id, Number(req.query.get("from") || 0)) };
  });
  R.get("/api/jobs/:id/wait", async (req) => {
    const info = await jobs.wait(req.params.id);
    return { ...info, output: jobs.output(info.id, Number(req.query.get("from") || 0)) };
  });
  R.post("/api/jobs/:id/cancel", (req) => ({ ok: jobs.cancel(req.params.id) }));
  R.post("/api/jobs", async (req) => {
    const b = await readJson(req);
    switch (b.kind) {
      case "grade": {
        const ids = b.runs || [];
        if (b.all || !ids.length) return gradeRuns("all", { fast: b.fast, skip: b.skip_graded, task: b.task });
        return gradeRuns(ids.map((id) => import_node_path8.default.join(cfg.benchData, "runs", id)), { fast: b.fast, skip: b.skip_graded });
      }
      case "review":
        return graderJob("review", "\u751F\u6210\u8BC4\u5206\u5305\uFF08\u4EBA\u5DE5/agent/\u7528\u91CF\uFF09", ["review", ...b.task ? ["--task", b.task] : []], async () => sync());
      case "export": {
        const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace(/[:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
        const out = import_node_path8.default.join(cfg.reportsDir, `${stamp}-${(b.label || "leaderboard").replace(/[^\w.-]+/g, "-")}`);
        return graderJob("aggregate", "bench-grader \u6C47\u603B", ["aggregate"], () => {
          graderJob("export", `\u5BFC\u51FA\u62A5\u8868 \u2192 ${toRel(cfg.root, out)}`, ["export", "--formats", b.formats || "csv,md,xlsx,png,html", "--out", out], () => {
            import_node_fs9.default.mkdirSync(out, { recursive: true });
            import_node_fs9.default.copyFileSync(cfg.storeFile, import_node_path8.default.join(out, "bench-store.snapshot.json"));
            return { dir: toRel(cfg.root, out) };
          });
          return null;
        });
      }
      case "doctor":
        return jobs.submit({ kind: "doctor", title: "\u8BC4\u6D4B\u673A\u4F9D\u8D56\u68C0\u67E5\uFF08doctor\uFF09", cmd: py(), args: [bench, "doctor"], cwd: cfg.graderDir });
      case "validate":
        return jobs.submit({ kind: "validate", title: "rubric \u81EA\u68C0", cmd: py(), args: [bench, "validate-rubrics"], cwd: cfg.graderDir });
      case "materials":
        return jobs.submit({ kind: "materials", title: "\u751F\u6210 T03/T04 \u7EDF\u4E00\u7D20\u6750", cmd: py(), args: [import_node_path8.default.join(cfg.graderDir, "scripts", "build_materials.py")], cwd: cfg.graderDir, after: async () => {
          await loadSpec(true);
          return null;
        } });
      case "build-spec":
        return jobs.submit({ kind: "build-spec", title: "\u91CD\u65B0\u751F\u6210 benchmark-spec.html", cmd: py(), args: [bench, "build-spec", "--out", import_node_path8.default.join(cfg.root, "benchmark-spec.html")], cwd: cfg.graderDir, after: async () => {
          await loadSpec(true);
          return null;
        } });
      case "npm-install": {
        const cwd = resolveSafe(cfg.root, b.cwd);
        return jobs.submit({ kind: "npm-install", title: `npm install \xB7 ${toRel(cfg.root, cwd)}`, cmd: "npm install --no-audit --no-fund", args: [], cwd, shell: true });
      }
      case "sync": {
        const r = await sync();
        return { id: "sync", kind: "sync", status: "done", result: r };
      }
      default:
        throw new HttpError(400, `\u672A\u77E5\u4EFB\u52A1\u7C7B\u578B\uFF1A${b.kind}`);
    }
  });
  R.get("/api/preview", () => previews.list());
  R.post("/api/preview", async (req) => {
    const b = await readJson(req);
    if (b.kind === "proxy" || b.target) return previews.createProxy({ target: b.target, label: b.label });
    if (b.kind === "url" || b.url) return previews.createUrl({ url: b.url, label: b.label });
    let abs;
    if (b.ref) abs = import_node_path8.default.join(ws.files(b.ref).ws, b.entry || "");
    else abs = resolveSafe(cfg.root, b.path || "");
    if (!import_node_fs9.default.existsSync(abs)) throw new HttpError(404, `\u4E0D\u5B58\u5728\uFF1A${toRel(cfg.root, abs)}`);
    const isDirP = import_node_fs9.default.statSync(abs).isDirectory();
    const root = b.root ? resolveSafe(cfg.root, b.root) : isDirP ? abs : import_node_path8.default.dirname(abs);
    const entry = isDirP ? "" : import_node_path8.default.relative(root, abs).split(import_node_path8.default.sep).join("/");
    return previews.createStatic({ root, entry, label: b.label || toRel(cfg.root, abs), inject: b.inject !== false });
  });
  R.del("/api/preview/:id", (req) => ({ ok: previews.close(req.params.id) }));
  R.get("/api/preview/:id", (req) => previews.public(previews.get(req.params.id)));
  R.get("/api/preview/:id/logs", (req) => {
    const lv = req.query.get("levels");
    return previews.logs(req.params.id, Number(req.query.get("since") || 0), lv ? lv.split(",") : void 0);
  });
  R.get("/api/preview/:id/requests", (req) => previews.requests(req.params.id, Number(req.query.get("since") || 0)));
  R.post("/api/preview/:id/logs", async (req) => {
    previews.addLogs(req.params.id, (await readJson(req)).entries || []);
    return { ok: true };
  });
  R.post("/api/preview/:id/clear", (req) => {
    previews.clear(req.params.id);
    return { ok: true };
  });
  R.get("/api/procs", () => procs.all());
  R.post("/api/procs", async (req) => {
    const b = await readJson(req);
    const cwd = b.ref ? import_node_path8.default.join(ws.files(b.ref).ws, b.sub || "") : resolveSafe(cfg.root, b.cwd || "");
    return procs.start({ cwd, cmd: b.cmd, name: b.name, env: b.env, autoPreview: b.autoPreview });
  });
  R.get("/api/procs/:id/output", (req) => procs.output(req.params.id, Number(req.query.get("from") || 0)));
  R.post("/api/procs/:id/stop", (req) => procs.stop(req.params.id));
  R.del("/api/procs/:id", (req) => {
    procs.remove(req.params.id);
    return { ok: true };
  });
  R.get("/api/scripts", (req) => {
    const dir = req.query.get("ref") ? import_node_path8.default.join(ws.files(req.query.get("ref")).ws, req.query.get("sub") || "") : resolveSafe(cfg.root, req.query.get("cwd") || "");
    const found = [];
    const scan = (d, depth) => {
      if (depth > 2 || !import_node_fs9.default.existsSync(d)) return;
      const pj = import_node_path8.default.join(d, "package.json");
      if (import_node_fs9.default.existsSync(pj)) {
        try {
          found.push({ dir: toRel(cfg.root, d), scripts: JSON.parse(import_node_fs9.default.readFileSync(pj, "utf8")).scripts || {}, has_modules: import_node_fs9.default.existsSync(import_node_path8.default.join(d, "node_modules")) });
        } catch {
        }
      }
      for (const e of import_node_fs9.default.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !["node_modules", ".git", "dist"].includes(e.name) && !e.name.startsWith(".")) scan(import_node_path8.default.join(d, e.name), depth + 1);
    };
    scan(dir, 0);
    const pyApps = ["app.py", "server.py", "main.py"].filter((f2) => import_node_fs9.default.existsSync(import_node_path8.default.join(dir, f2)));
    return { packages: found, python: pyApps, bench_json: import_node_fs9.default.existsSync(import_node_path8.default.join(dir, "bench.json")) ? JSON.parse(import_node_fs9.default.readFileSync(import_node_path8.default.join(dir, "bench.json"), "utf8")) : null };
  });
  R.post("/api/probe", async (req) => {
    const b = await readJson(req);
    let url2 = b.url;
    if (b.session) url2 = previews.public(previews.get(b.session)).url;
    if (!url2) throw new HttpError(400, "\u9700\u8981 url \u6216 session");
    const shot = import_node_path8.default.join(cfg.runtimeDir, "shots", `shot-${Date.now()}.png`);
    const args = ["probe-page", "--url", url2, "--viewport", b.viewport || "1440x900", "--wait", String(b.wait ?? 2500), "--shot", shot];
    if (b.mobile) args.push("--mobile");
    if (b.full) args.push("--full");
    const r = await callBridge(cfg, args, 12e4);
    if (r.screenshot) r.screenshot = toRel(cfg.root, r.screenshot);
    return r;
  });
  R.post("/api/ui", async (req) => {
    const b = await readJson(req);
    hub.emit({ type: "ui", action: b.action, params: b.params || {} });
    return { ok: true, clients: hub.clients.size };
  });
  R.get("/api/store/export", (req, res) => {
    store.save();
    const name = `bench-store-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"` });
    import_node_fs9.default.createReadStream(cfg.storeFile).pipe(res);
    return void 0;
  });
  R.post("/api/store/import", async (req) => {
    const b = await readJson(req);
    const stat = store.importFrom(b);
    store.save();
    hub.emit({ type: "store", updated_at: store.data.updated_at });
    return stat;
  });
  R.post("/api/settings", async (req) => {
    const b = await readJson(req);
    store.data.settings = { ...store.data.settings, ...b };
    store.save();
    hub.emit({ type: "store", updated_at: store.data.updated_at });
    return store.data.settings;
  });
  R.post("/api/notes", async (req) => {
    const b = await readJson(req);
    const n = { id: `n${Date.now().toString(36)}`, target: String(b.target || ""), text: String(b.text || ""), at: (/* @__PURE__ */ new Date()).toISOString() };
    store.data.notes.unshift(n);
    store.save();
    hub.emit({ type: "store", updated_at: store.data.updated_at });
    return n;
  });
  R.del("/api/notes/:id", (req) => {
    store.data.notes = store.data.notes.filter((n) => n.id !== req.params.id);
    store.save();
    hub.emit({ type: "store", updated_at: store.data.updated_at });
    return { ok: true };
  });
  R.get("/api/reports", () => listReports(cfg.reportsDir));
  R.get("/api/fs/list", (req) => listDir(cfg.root, req.query.get("path") || ""));
  R.get("/api/fs/read", (req) => readText(cfg.root, req.query.get("path") || ""));
  R.get("/api/fs/raw", (req, res) => {
    sendRaw(cfg.root, req.query.get("path") || "", req, res, req.query.get("download") === "1");
    return void 0;
  });
  R.post("/api/shutdown", () => {
    setTimeout(() => {
      void close().then(() => process.exit(0));
    }, 50);
    return { ok: true };
  });
  const ownOrigins = /* @__PURE__ */ new Set([`http://127.0.0.1:${cfg.port}`, `http://localhost:${cfg.port}`]);
  const server = import_node_http2.default.createServer(async (rq, res) => {
    const req = rq;
    const u = new URL(req.url || "/", "http://127.0.0.1");
    req.query = u.searchParams;
    req.pathname = u.pathname;
    try {
      if (u.pathname.startsWith("/api/")) {
        const host = String(req.headers.host || "").toLowerCase();
        if (host && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) throw new HttpError(403, "\u62D2\u7EDD\u975E\u672C\u673A Host");
        const origin = req.headers.origin;
        if (origin && !ownOrigins.has(origin) && origin !== "null" && !origin.startsWith("file://")) throw new HttpError(403, "\u62D2\u7EDD\u8DE8\u6E90\u8BF7\u6C42");
        const m = R.match(req.method || "GET", u.pathname);
        if (!m) throw new HttpError(404, `\u63A5\u53E3\u4E0D\u5B58\u5728\uFF1A${req.method} ${u.pathname}`);
        if (!m.route.open && req.headers["x-wb-token"] !== cfg.token) throw new HttpError(401, "\u7F3A\u5C11\u6216\u9519\u8BEF\u7684 x-wb-token");
        req.params = m.params;
        const out = await m.route.fn(req, res);
        if (out !== void 0 && !res.headersSent) sendJson(res, 200, out);
        return;
      }
      serveWeb(u.pathname, res);
    } catch (e) {
      const err = e;
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message || String(e) });
      else res.end();
    }
  });
  function serveWeb(pathname, res) {
    const dist = cfg.webDist;
    let p = import_node_path8.default.resolve(dist, "." + decodeURIComponent(pathname));
    if (!p.startsWith(import_node_path8.default.resolve(dist)) || !import_node_fs9.default.existsSync(p) || import_node_fs9.default.statSync(p).isDirectory()) p = import_node_path8.default.join(dist, "index.html");
    if (!import_node_fs9.default.existsSync(p)) {
      res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
      res.end('<meta charset="utf-8"><p style="font:15px system-ui;padding:30px">\u524D\u7AEF\u5C1A\u672A\u6784\u5EFA\uFF1A\u5728 workbench/ \u4E0B\u8FD0\u884C <code>npm run build</code>\uFF0C\u6216\u53CC\u51FB\u6839\u76EE\u5F55 Start-Workbench.cmd\u3002</p>');
      return;
    }
    const immutable = p.includes(`${import_node_path8.default.sep}assets${import_node_path8.default.sep}`);
    res.writeHead(200, { "content-type": mimeOf(p), "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache", "x-frame-options": "SAMEORIGIN" });
    import_node_fs9.default.createReadStream(p).pipe(res);
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  const url = `http://127.0.0.1:${cfg.port}`;
  import_node_fs9.default.writeFileSync(import_node_path8.default.join(cfg.runtimeDir, "runtime.json"), JSON.stringify({ url, port: cfg.port, token: cfg.token, pid: process.pid, started_at: startedAt, version: VERSION }, null, 2));
  void loadSpec().then(() => sync()).catch((e) => console.error("[wb] \u521D\u6B21\u540C\u6B65\u5931\u8D25\uFF1A", e.message));
  async function close() {
    procs.stopAll();
    previews.closeAll();
    for (const c of hub.clients) c.end();
    try {
      import_node_fs9.default.unlinkSync(import_node_path8.default.join(cfg.runtimeDir, "runtime.json"));
    } catch {
    }
    await new Promise((r) => server.close(() => r()));
  }
  return { cfg, server, url, close };
}
if (require.main === module && !process.versions.electron) {
  startServer().then(({ url, cfg, close }) => {
    console.log(`
  Bench Workbench ${VERSION}
  \u25B6 ${url}
  \u6839\u76EE\u5F55  ${cfg.root}
  Python  ${cfg.python || "\u672A\u627E\u5230"}
  \u6309 Ctrl+C \u9000\u51FA
`);
    if (process.argv.includes("--open")) {
      const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      (0, import_node_child_process5.spawn)(cmd, args, { detached: true, stdio: "ignore" }).unref();
    }
    const bye = () => {
      void close().then(() => process.exit(0));
    };
    process.on("SIGINT", bye);
    process.on("SIGTERM", bye);
  }).catch((e) => {
    if (e.code === "EADDRINUSE") console.error(`\u7AEF\u53E3\u5DF2\u88AB\u5360\u7528\uFF1A\u53EF\u80FD\u5DE5\u4F5C\u53F0\u5DF2\u5728\u8FD0\u884C\uFF08\u6253\u5F00 http://127.0.0.1:${process.env.WB_PORT || 41873}\uFF09\uFF0C\u6216\u8BBE\u7F6E WB_PORT \u6362\u7AEF\u53E3\u3002`);
    else console.error(e);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  startServer
});
