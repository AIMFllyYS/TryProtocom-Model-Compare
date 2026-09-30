#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// cli/wb.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_child_process = require("node:child_process");
var HERE = __dirname;
var ROOT = findRoot();
var RUNTIME = import_node_path.default.join(ROOT, "workbench", ".runtime", "runtime.json");
var argv = process.argv.slice(2);
function findRoot() {
  for (const start of [process.env.WB_ROOT, HERE, process.cwd()].filter(Boolean)) {
    let d = import_node_path.default.resolve(start);
    for (let i = 0; i < 8; i++) {
      if (import_node_fs.default.existsSync(import_node_path.default.join(d, "skills", "bench-grader", "SKILL.md"))) return d;
      const up = import_node_path.default.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return process.cwd();
}
var BOOL = /* @__PURE__ */ new Set(["json", "all", "fast", "skip-graded", "wait", "no-wait", "errors", "follow", "mobile", "full", "show", "register", "no-grade", "timed-out", "open", "no-inject", "warnings", "help", "refresh", "yes"]);
var flags = {};
var pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== void 0) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--") && !BOOL.has(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else pos.push(a);
}
var JSON_OUT = !!flags.json;
var str = (k) => typeof flags[k] === "string" ? flags[k] : void 0;
var num = (k) => str(k) != null ? Number(str(k)) : void 0;
var rt = null;
function readRuntime() {
  try {
    return JSON.parse(import_node_fs.default.readFileSync(RUNTIME, "utf8"));
  } catch {
    return null;
  }
}
async function alive(url) {
  try {
    const r = await fetch(url + "/api/health", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}
async function ensureServer() {
  if (rt) return rt;
  const cur = readRuntime();
  if (cur && await alive(cur.url)) return rt = cur;
  const port = Number(process.env.WB_PORT || 41873);
  if (await alive(`http://127.0.0.1:${port}`)) {
    const s = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json();
    return rt = { url: `http://127.0.0.1:${port}`, token: s.token };
  }
  const serverJs = import_node_path.default.join(ROOT, "workbench", "dist-node", "server.cjs");
  if (!import_node_fs.default.existsSync(serverJs)) die(`\u627E\u4E0D\u5230 ${serverJs}\uFF0C\u8BF7\u5148\u5728 workbench/ \u8FD0\u884C npm run build\uFF08\u6216\u53CC\u51FB Start-Workbench.cmd\uFF09`);
  if (!JSON_OUT) process.stderr.write("\xB7 \u5DE5\u4F5C\u53F0\u670D\u52A1\u672A\u8FD0\u884C\uFF0C\u6B63\u5728\u540E\u53F0\u542F\u52A8\u2026\n");
  const logFile = import_node_fs.default.openSync(import_node_path.default.join(ROOT, "workbench", ".runtime", "server.log"), "a");
  (0, import_node_child_process.spawn)(process.execPath, [serverJs], { cwd: ROOT, detached: true, stdio: ["ignore", logFile, logFile], windowsHide: true }).unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const r = readRuntime();
    if (r && await alive(r.url)) return rt = r;
  }
  die("\u670D\u52A1\u542F\u52A8\u8D85\u65F6\uFF0C\u67E5\u770B workbench/.runtime/server.log");
}
async function api(method, p, body) {
  const s = await ensureServer();
  const r = await fetch(s.url + p, { method, headers: { "content-type": "application/json", "x-wb-token": s.token }, body: body === void 0 ? void 0 : JSON.stringify(body) });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text, (_k, v) => v === "inf" ? Infinity : v);
  } catch {
    j = text;
  }
  if (!r.ok) die(`${method} ${p} \u2192 ${r.status} ${j?.error || text}`);
  return j;
}
var get = (p) => api("GET", p);
var post = (p, b = {}) => api("POST", p, b);
function die(msg) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error("\u2718 " + msg);
  process.exit(1);
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(data, human) {
  if (JSON_OUT || !human) console.log(JSON.stringify(data, (_k, v) => v === Infinity ? "inf" : v, 2));
  else human();
}
var fmt = (v, d = 1) => v == null ? "\u2014" : v === Infinity ? "\u221E" : Number(v).toFixed(d);
var pad = (s, n) => {
  const t = String(s ?? "");
  const w = [...t].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  return t + " ".repeat(Math.max(0, n - w));
};
function table(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => [...String(r[i] ?? "")].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0))));
  for (const r of rows) console.log(r.map((c, i) => pad(c, w[i])).join("  ").trimEnd());
}
async function waitJob(job, quiet = false) {
  let from = 0;
  for (; ; ) {
    const j = await get(`/api/jobs/${job.id}?from=${from}`);
    if (!quiet && !JSON_OUT) for (const l of j.output) console.log("  \u2502 " + l);
    from += j.output.length;
    if (["done", "failed", "cancelled"].includes(j.status)) {
      const full = await get(`/api/jobs/${job.id}?from=0`);
      if (!JSON_OUT) console.log(`${j.status === "done" ? "\u2714" : "\u2718"} ${j.title} \u2014 ${j.status}${j.error ? "\uFF1A" + j.error : ""}`);
      return full;
    }
    await sleep(900);
  }
}
async function maybeWait(job) {
  if (flags["no-wait"]) return out(job, () => console.log(`\u5DF2\u63D0\u4EA4\u4EFB\u52A1 ${job.id}\uFF1A${job.title}\uFF08wb job ${job.id} --wait \u67E5\u770B\uFF09`));
  const r = await waitJob(job);
  if (JSON_OUT) out({ ...r, output: r.output?.slice(-200) });
  if (r.status !== "done") process.exitCode = 1;
  return r;
}
function toRootRel(p) {
  const abs = import_node_path.default.resolve(p);
  const rel = import_node_path.default.relative(ROOT, abs);
  if (rel.startsWith("..") || import_node_path.default.isAbsolute(rel)) die(`\u8DEF\u5F84\u4E0D\u5728\u5DE5\u4F5C\u53F0\u6839\u76EE\u5F55\u5185\uFF1A${abs}`);
  return rel.split(import_node_path.default.sep).join("/");
}
var isRef = (s) => /^[^/\\]+\/[^/\\]+\/T\d{2}[A-Z]?\/r\d+$/.test(s);
async function resolveRef(s) {
  if (isRef(s)) return s;
  const abs = import_node_path.default.resolve(s);
  const rel = import_node_path.default.relative(import_node_path.default.join(ROOT, "model"), abs).split(import_node_path.default.sep).join("/");
  const m = /^([^/]+\/[^/]+\/T\d{2}[A-Z]?\/r\d+)(\/|$)/.exec(rel);
  if (m) return m[1];
  die(`\u4E0D\u662F\u5DE5\u4F5C\u533A\u5F15\u7528\uFF1A${s}\uFF08\u683C\u5F0F \u4F9B\u5E94\u5546/\u6A21\u578B/\u9898\u53F7/rN\uFF0C\u4F8B\u5982 OpenAI/GPT-6.1-Sol/T05/r1\uFF09`);
}
var HELP = `wb \u2014 Bench Workbench CLI\uFF08\u5DE5\u4F5C\u53F0 http://127.0.0.1:41873\uFF09

\u670D\u52A1      wb status | wb serve [--open] | wb start | wb stop | wb open [\u89C6\u56FE]
\u9898\u5E93      wb tasks | wb prompt <T05> [--for \u4F9B\u5E94\u5546/\u6A21\u578B] [--variant A]   \u5E26\u7EDF\u4E00\u8FD0\u884C\u7EA6\u5B9A\uFF08\u5DE5\u4F5C\u76EE\u5F55\u7EDD\u5BF9\u8DEF\u5F84\u3001\u4EA4\u4ED8\u6587\u4EF6\u5939\u540D\uFF09
\u6A21\u578B      wb models | wb model add <\u6A21\u578B\u540D|\u4F9B\u5E94\u5546/\u6A21\u578B> [--vendor X] [--harness "Claude Code"]   \u53EA\u5199\u6A21\u578B\u540D\u65F6\u81EA\u52A8\u8BC6\u522B\u4F9B\u5E94\u5546
Harness   wb harness [--refresh] | wb harness open <id> [--ref \u4F9B\u5E94\u5546/\u6A21\u578B/\u9898\u53F7/rN]
\u4EA4\u4ED8      wb detect   \u5404\u8FD0\u884C\u7684\u4EA4\u4ED8\u6E05\u5355\u8FDB\u5EA6\u3001FINAL_MESSAGE.md \u662F\u5426\u51FA\u73B0
AI \u8BC4\u5BA1   wb ai-prompt [run_id|ref]   \u7ED9\u8BC4\u5206 Agent \u7684\u63D0\u793A\u8BCD\uFF08skills \u8DEF\u5F84 + \u6B65\u9AA4\uFF09\uFF1B\u4E0D\u5E26\u53C2\u6570 = \u5168\u90E8\u5F85\u8BC4 Agent \u9879
Skills    wb skills sync   \u628A skills/ \u955C\u50CF\u5230 .agents/skills/\uFF08\u4E0D\u542B hidden/\uFF09
\u5BA0\u7269      wb pet | wb pet quit   \u684C\u9762\u5BA0\u7269\uFF08\u5C4F\u5E55\u53F3\u4E0B\u89D2\u7684\u72B6\u6001\u7CBE\u7075\uFF1A\u4EA4\u4ED8\u63D0\u9192\u3001\u767B\u8BB0\u8BC4\u5206\u3001\u622A\u5C4F\u5B58\u8BC1\uFF09
\u8FD0\u884C      wb run new <\u4F9B\u5E94\u5546>/<\u6A21\u578B> <T05> [--variant A|C] [--harness X]
          wb run list [--model \u4F9B\u5E94\u5546/\u6A21\u578B] [--task T05]
          wb run start <ref> | wb run finish <ref> [--final-file f.md|--final "\u2026"] [--wall-min 30 --cost-usd 1.2 \u2026] [--timed-out] [--register] [--no-grade]
          wb run register <ref> [--no-grade] [--fast]
\u56DE\u6536\u7AD9    wb run stop <ref> [--reason \u2026]   \u5F7B\u5E95\u505C\u6B62\u5E76\u4F5C\u5E9F\uFF08\u5173\u6389\u8BE5\u76EE\u5F55\u7684\u5F00\u53D1\u670D\u52A1\u5668 / \u9884\u89C8\uFF1B\u5916\u90E8 Agent \u4F1A\u8BDD\u9700\u5728 harness \u91CC\u624B\u52A8\u505C\uFF09
          wb run discard <ref|run_id> [--reason \u2026] | wb run restore <ref|run:run_id> | wb trash
          wb trash purge <id>\u2026 --yes | wb trash purge --all --yes   \u6C38\u4E45\u5220\u9664\uFF08\u4EC5\u56DE\u6536\u7AD9\u5185\u6761\u76EE\uFF0C\u65E0\u6CD5\u6062\u590D\uFF09
\u8BC4\u5206      wb grade [run_id\u2026|--all] [--task T05] [--fast] [--skip-graded] | wb review [--task T05]
          wb pending [--method agent|human] [--task T05] | wb score <run_id> <item_id> <0-3> --note "\u8BC1\u636E" [--by agent]
          wb show <run_id> | wb sync
\u7ED3\u679C      wb board | wb compare <\u5173\u952E\u8BCD> <\u5173\u952E\u8BCD>\u2026 | wb report <\u4F9B\u5E94\u5546>/<\u6A21\u578B> | wb export [--formats csv,md,xlsx,png,html]
\u9884\u89C8      wb preview <\u6587\u4EF6|\u76EE\u5F55|ref|URL> [--show] [--no-inject] | wb sessions | wb close <session>
          wb logs <session> [--errors|--warnings] [--since N] [--follow]
          wb dev <ref|\u76EE\u5F55> [--cmd "npm run dev"] [--sub \u5B50\u76EE\u5F55] | wb procs | wb proc-log <id> | wb proc-stop <id>
          wb check <\u6587\u4EF6|ref|URL> [--viewport 390x844] [--mobile] [--wait 3000] [--full]   \u65E0\u5934\u52A0\u8F7D \u2192 \u62A5\u9519 + \u622A\u56FE
\u4EFB\u52A1      wb jobs | wb job <id> [--wait] | wb doctor | wb materials | wb validate
\u5B58\u50A8      wb store export <\u6587\u4EF6> | wb store import <\u6587\u4EF6>
\u754C\u9762      wb ui <open|preview|run|compare> [key=value\u2026]
\u901A\u7528      --json \u673A\u5668\u53EF\u8BFB\u8F93\u51FA\uFF1Bref = \u4F9B\u5E94\u5546/\u6A21\u578B/\u9898\u53F7/rN\uFF0C\u4F8B\u5982 OpenAI/GPT-6.1-Sol/T05/r1
`;
async function main() {
  const [cmd, sub, ...rest] = pos;
  if (!cmd || flags.help || cmd === "help") {
    console.log(HELP);
    return;
  }
  switch (cmd) {
    case "serve": {
      const serverJs = import_node_path.default.join(ROOT, "workbench", "dist-node", "server.cjs");
      const p = (0, import_node_child_process.spawn)(process.execPath, [serverJs, ...flags.open ? ["--open"] : []], { cwd: ROOT, stdio: "inherit" });
      p.on("exit", (c) => process.exit(c ?? 0));
      return;
    }
    case "start": {
      const s = await ensureServer();
      return out({ ok: true, url: s.url }, () => console.log(`\u2714 \u670D\u52A1\u8FD0\u884C\u4E2D\uFF1A${s.url}`));
    }
    case "stop": {
      const cur = readRuntime();
      if (!cur || !await alive(cur.url)) return out({ ok: true, running: false }, () => console.log("\u670D\u52A1\u672A\u8FD0\u884C"));
      await fetch(cur.url + "/api/shutdown", { method: "POST", headers: { "x-wb-token": cur.token } }).catch(() => {
      });
      return out({ ok: true }, () => console.log("\u2714 \u5DF2\u505C\u6B62"));
    }
    case "status": {
      const s = await get("/api/session");
      const st = await get("/api/store");
      const agg = await get("/api/aggregate");
      const data = { url: rt.url, version: s.version, root: s.root, python: s.python, models: st.models.length, workspaces: st.workspaces.length, runs: st.runs.length, graded: st.runs.filter((r) => r.graded).length, pending: agg.pending, store: s.paths.store, updated_at: st.updated_at };
      return out(data, () => {
        console.log(`Bench Workbench ${s.version} \xB7 ${rt.url}
\u6839\u76EE\u5F55 ${s.root}
Python ${s.python || "\u672A\u627E\u5230"}`);
        console.log(`\u6A21\u578B ${data.models} \xB7 \u5DE5\u4F5C\u533A ${data.workspaces} \xB7 \u767B\u8BB0\u8FD0\u884C ${data.runs}\uFF08\u5DF2\u8BC4\u5206 ${data.graded}\uFF09`);
        console.log(`\u5F85\u529E\uFF1A\u672A\u8BC4\u5206 ${agg.pending.ungraded} \xB7 \u4EBA\u5DE5\u5F85\u8BC4 ${agg.pending.human} \xB7 agent \u5F85\u8BC4 ${agg.pending.agent} \xB7 \u7F3A\u7528\u91CF ${agg.pending.usage_missing} \xB7 \u4F4E\u53EF\u4FE1 ${agg.pending.low_confidence}`);
        console.log(`\u5B58\u50A8\u6587\u4EF6 ${s.paths.store}\uFF08\u66F4\u65B0\u4E8E ${st.updated_at}\uFF09`);
      });
    }
    case "open": {
      const s = await ensureServer();
      const view = sub || "";
      const r = await post("/api/ui", { action: "open", params: { view } });
      if (!r.clients || flags.open) {
        const url = s.url + (view ? `/#/${view}` : "");
        (0, import_node_child_process.spawn)(process.platform === "win32" ? "cmd" : "xdg-open", process.platform === "win32" ? ["/c", "start", "", url] : [url], { detached: true, stdio: "ignore" }).unref();
      }
      return out({ ok: true, clients: r.clients }, () => console.log(r.clients ? `\u2714 \u5DF2\u901A\u77E5 ${r.clients} \u4E2A\u754C\u9762\u5207\u6362\u5230 ${view || "\u603B\u89C8"}` : `\u2714 \u5DF2\u5728\u6D4F\u89C8\u5668\u6253\u5F00 ${s.url}`));
    }
    case "sync": {
      const r = await post("/api/sync");
      return out(r, () => console.log(`\u2714 \u540C\u6B65\u5B8C\u6210\uFF1A${r.runs} \u6B21\u8FD0\u884C \xB7 ${r.models} \u4E2A\u6A21\u578B \xB7 ${r.workspaces} \u4E2A\u5DE5\u4F5C\u533A`));
    }
    case "tasks": {
      const s = await get("/api/spec");
      const rows = s.tasks.map((t) => ({ id: t.id, name: t.name, deliverable: t.deliverable, variants: Object.keys(t.variants || {}), items: t.items.length, human: t.items.filter((i) => i.method === "human").length, agent: t.items.filter((i) => i.method === "agent").length, time_limit: t.time_limit, dims: t.dims, missing_materials: s.materials_state?.[t.id]?.missing || [] }));
      return out(rows, () => table([["\u9898\u53F7", "\u540D\u79F0", "\u4EA4\u4ED8\u76EE\u5F55", "\u53D8\u4F53", "\u68C0\u67E5\u9879", "\u4EBA\u5DE5", "agent", "\u65F6\u9650"], ...rows.map((r) => [r.id, r.name, r.deliverable + "/", r.variants.join("/") || "\u2014", r.items, r.human, r.agent, (r.time_limit ?? "\u2014") + "\u2032"])]));
    }
    case "prompt": {
      if (!sub) die("\u7528\u6CD5\uFF1Awb prompt <T05> [--for \u4F9B\u5E94\u5546/\u6A21\u578B] [--variant A]");
      const r = await get(`/api/ws/prompt?task=${encodeURIComponent(sub.toUpperCase())}&variant=${encodeURIComponent(str("variant") || "")}&for=${encodeURIComponent(str("for") || "")}`);
      return out(r, () => {
        for (const w of r.warnings) console.error("\u26A0 " + w);
        if (r.workspace) console.error(`\xB7 \u5DE5\u4F5C\u76EE\u5F55 ${r.workspace}${r.exists ? "\uFF08\u590D\u7528\u672A\u5F00\u59CB\u7684\u8FD0\u884C\uFF09" : "\uFF08\u5C1A\u672A\u521B\u5EFA\uFF0Cwb run new \u4F1A\u521B\u5EFA\uFF09"}`);
        process.stdout.write(r.text);
      });
    }
    case "ai-prompt": {
      const q = !sub ? "" : sub.includes("/") ? `?ref=${encodeURIComponent(sub)}` : `?run_id=${encodeURIComponent(sub)}`;
      const r = await get(`/api/review-prompt${q}`);
      return out(r, () => process.stdout.write(r.text));
    }
    case "detect": {
      const rows = await get("/api/ws/detect");
      return out(rows, () => table([["ref", "\u4EA4\u4ED8", "FINAL_MESSAGE", "\u7ED3\u675F", "\u5165\u53E3"], ...rows.map((r) => [r.ref, r.detect ? `${r.detect.done}/${r.detect.total}` : "\u2014", r.detect?.final ? "\u2714" : "", r.ended_at ? "\u2714" : "", r.entry || "\u2014"])]));
    }
    case "harness": {
      if (sub === "open") {
        if (!rest[0]) die("\u7528\u6CD5\uFF1Awb harness open <id> [--ref \u4F9B\u5E94\u5546/\u6A21\u578B/\u9898\u53F7/rN]");
        const r = await post("/api/harness/open", { id: rest[0], ref: str("ref") });
        return out(r, () => console.log("\u2714 " + r.how));
      }
      const rows = await get(`/api/harness${flags.refresh ? "?refresh=1" : ""}`);
      return out(rows, () => table([["id", "\u540D\u79F0", "\u7C7B\u578B", "\u5DF2\u5B89\u88C5", "\u8DEF\u5F84"], ...rows.map((h) => [h.id, h.name, h.kind, h.installed ? "\u2714" : "", h.path || "\u2014"])]));
    }
    case "pet": {
      const r = await post("/api/pet", { action: sub === "quit" ? "quit" : "start" });
      return out(r, () => console.log(sub === "quit" ? "\u2714 \u684C\u9762\u5BA0\u7269\u5DF2\u9000\u51FA" : r.already ? "\u2714 \u684C\u9762\u5BA0\u7269\u5DF2\u5728\u8FD0\u884C" : "\u2714 \u5DF2\u53EC\u5524\u684C\u9762\u5BA0\u7269\uFF08\u5C4F\u5E55\u53F3\u4E0B\u89D2\uFF09"));
    }
    case "skills": {
      if (sub !== "sync") die("\u7528\u6CD5\uFF1Awb skills sync   \uFF08\u628A skills/ \u955C\u50CF\u5230 .agents/skills/\uFF0C\u4E0D\u542B hidden/\uFF09");
      const r = await post("/api/skills/sync");
      return out(r, () => console.log(`\u2714 \u5DF2\u540C\u6B65\u5230 ${r.dir}\uFF08\u66F4\u65B0 ${r.copied} \u4E2A\u6587\u4EF6\uFF09`));
    }
    case "models": {
      const st = await get("/api/store");
      return out(st.models, () => table([["\u4F9B\u5E94\u5546", "\u6A21\u578B", "\u9ED8\u8BA4 harness", "\u5DE5\u4F5C\u533A\u8FD0\u884C", "\u5DF2\u767B\u8BB0"], ...st.models.map((m) => [m.vendor, m.name, m.harness || "\u2014", st.workspaces.filter((w) => w.vendor === m.vendor && w.model === m.name).length, st.runs.filter((r) => r.model === m.name).length])]));
    }
    case "model": {
      if (sub !== "add" || !rest[0]) die("\u7528\u6CD5\uFF1Awb model add <\u6A21\u578B\u540D> \u6216 <\u4F9B\u5E94\u5546>/<\u6A21\u578B> [--harness X] [--notes \u2026]");
      const hasVendor = rest[0].includes("/");
      const [vendor, ...n] = rest[0].split("/");
      const m = await post("/api/models", hasVendor ? { vendor, name: n.join("/"), harness: str("harness"), notes: str("notes"), family: str("family") } : { input: rest[0], vendor: str("vendor"), harness: str("harness"), notes: str("notes"), family: str("family") });
      return out(m, () => console.log(`\u2714 \u6A21\u578B ${m.vendor}/${m.name}
  \u5DE5\u4F5C\u533A ${import_node_path.default.join(ROOT, "model", m.vendor, m.name)}`));
    }
    case "run":
      return runCmd(sub, rest);
    case "grade": {
      const ids = [sub, ...rest].filter(Boolean);
      const job = await post("/api/jobs", { kind: "grade", runs: ids, all: !!flags.all || !ids.length, task: str("task"), fast: !!flags.fast, skip_graded: !!flags["skip-graded"] });
      await maybeWait(job);
      return;
    }
    case "review": {
      await maybeWait(await post("/api/jobs", { kind: "review", task: sub || str("task") }));
      return;
    }
    case "export": {
      const j = await post("/api/jobs", { kind: "export", formats: str("formats"), label: str("label") });
      await maybeWait(j);
      if (!flags["no-wait"]) {
        const jobs = await get("/api/jobs");
        const ex = jobs.find((x) => x.kind === "export");
        if (ex) await waitJob(ex, true).then((r) => !JSON_OUT && console.log(`\u8F93\u51FA\u76EE\u5F55\uFF1A${r.result?.dir ?? ""}`));
      }
      return;
    }
    case "doctor":
    case "materials":
    case "validate": {
      await maybeWait(await post("/api/jobs", { kind: cmd }));
      return;
    }
    case "pending": {
      const st = await get("/api/store");
      const s = await get("/api/spec");
      const method = str("method");
      const rows = [];
      for (const r of st.runs) {
        if (!r.score || str("task") && r.tkey !== str("task") && r.task !== str("task")) continue;
        const task = s.tasks.find((t) => t.id === r.task);
        for (const it of r.score.items) {
          if (it.status !== "pending" || method && it.method !== method) continue;
          const si = task?.items.find((x) => x.id === it.id);
          rows.push({ run_id: r.run_id, alias: r.alias, task: r.tkey, item_id: it.id, method: it.method, dim: it.dim, tier: it.tier, desc: it.desc, evidence: si?.evidence, anchors: si?.anchors, open: r.dir ? `${r.dir}/output` : null, ws_ref: r.ws_ref });
        }
      }
      return out(rows, () => {
        if (!rows.length) return console.log("\u6CA1\u6709\u5F85\u8BC4\u9879 \u2714");
        for (const r of rows) console.log(`${r.run_id}  ${r.alias || ""}  ${r.item_id} [${r.method}\xB7${r.tier}]  ${r.desc}
    \u4EA7\u51FA ${r.open}
    \u951A\u70B9 ${(r.anchors || []).map((a, i) => `${i}=${a}`).join(" | ")}`);
        console.log(`
\u5171 ${rows.length} \u9879\u3002\u6253\u5206\uFF1Awb score <run_id> <item_id> <0-3> --note "\u6587\u4EF6:\u884C\u53F7 / \u73B0\u8C61" --by agent`);
      });
    }
    case "score": {
      const [itemId, score] = rest;
      if (!sub || !itemId || score == null) die('\u7528\u6CD5\uFF1Awb score <run_id> <item_id> <0-3|clear> --note "\u8BC1\u636E" [--by agent|human]');
      const by = str("by") || "agent";
      if (by === "agent" && !str("note") && score !== "clear") die('agent \u8BC4\u5206\u5FC5\u987B\u9644\u8BC1\u636E\uFF1A--note "\u6587\u4EF6:\u884C\u53F7 \u6216 \u53EF\u590D\u73B0\u7684\u73B0\u8C61"\uFF08bench-grader \u89C4\u5219 2\uFF09');
      const r = await post(`/api/runs/${encodeURIComponent(sub)}/manual`, { item: itemId, score: score === "clear" ? "" : Number(score), note: str("note") || "", by });
      return out(r, () => console.log(`\u2714 ${sub} ${itemId} = ${score}\uFF08by ${by}\uFF09\u2192 \u8FD0\u884C\u603B\u5206 ${fmt(r.score?.total, 2)}\uFF0C\u5269\u4F59\u5F85\u8BC4 ${r.score?.pending?.length ?? "?"}`));
    }
    case "show": {
      if (!sub) die("\u7528\u6CD5\uFF1Awb show <run_id>");
      const r = await get(`/api/runs/${encodeURIComponent(sub)}`);
      return out(r, () => {
        const run = r.run;
        const s = run.score;
        console.log(`${run.run_id}  ${run.entrant}  ${run.tkey} #${run.run_index}  \u522B\u540D ${run.alias || "\u2014"}  \u5DE5\u4F5C\u533A ${run.ws_ref || "\u2014"}`);
        if (!s) return console.log("\u5C1A\u672A\u8BC4\u5206");
        console.log(`\u603B\u5206 ${fmt(s.total, 2)}  \u95E8\u69DB ${s.gate_pass ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7 " + s.gate_fail.map((g) => g.id).join(",")}  \u8FBE\u6807 ${s.passed ? "\u662F" : "\u5426"}  N/A ${fmt(s.na_ratio * 100, 0)}%  \u5F85\u8BC4 ${s.pending.length}${s.low_confidence ? "  \u26A0\u4F4E\u53EF\u4FE1" : ""}`);
        console.log("\u7EF4\u5EA6 " + Object.entries(s.dims).map(([k, v]) => `${k}=${fmt(v)}`).join("  "));
        table([["\u68C0\u67E5\u9879", "\u7EF4\u5EA6", "\u5C42\u7EA7", "\u65B9\u5F0F", "\u72B6\u6001", "\u5F97\u5206", "\u503C"], ...s.items.map((i) => [i.id, i.dim, i.tier, i.method, i.status, i.s == null ? "\u2014" : fmt(i.s * 100, 0), i.value == null ? "" : String(typeof i.value === "object" ? JSON.stringify(i.value) : i.value).slice(0, 40)])]);
        if (run.notes?.length) console.log("\u63A2\u9488\u5907\u6CE8\uFF1A\n  " + run.notes.join("\n  "));
      });
    }
    case "board": {
      const agg = await get("/api/aggregate");
      return out(agg.board, () => {
        if (!agg.board.length) return console.log("\u8FD8\u6CA1\u6709\u5DF2\u8BC4\u5206\u7684\u8FD0\u884C\u3002");
        table([["\u540D\u6B21", "\u53C2\u8D5B\u8005", "\u8D28\u91CF", "95% CI", "3D", "\u52A8\u753B", "UI", "\u540E\u7AEF", "\u5DE5\u7A0B", "\u9700\u6C42", "Agent", "\u6210\u672C", "\u901F\u5EA6", "\u8FBE\u6807\u7387", "\u8FD0\u884C", "\u5B8C\u6574"], ...agg.board.map((b) => [b.rank, b.entrant, fmt(b.quality, 2), `${fmt(b.ci_low)}\u2013${fmt(b.ci_high)}`, ...["3d", "anim", "ui", "be", "eng", "req", "agent", "cost", "speed"].map((d) => fmt(b.dims[d], 0)), fmt(b.pass_rate * 100, 0) + "%", b.runs, b.complete ? "\u662F" : "\u5426"])]);
      });
    }
    case "compare": {
      const agg = await get("/api/aggregate");
      const keys = [sub, ...rest].filter(Boolean).map((k) => k.toLowerCase());
      const sel = keys.length ? agg.board.filter((b) => keys.some((k) => b.entrant.toLowerCase().includes(k))) : agg.board;
      const tks = agg.tkeys;
      const data = { entrants: sel, tasks: agg.tasks.filter((t) => sel.some((b) => b.entrant === t.entrant)) };
      return out(data, () => {
        if (!sel.length) return console.log("\u6CA1\u6709\u5339\u914D\u7684\u53C2\u8D5B\u8005");
        table([
          ["\u7EF4\u5EA6", ...sel.map((b) => b.entrant)],
          ["\u8D28\u91CF\u603B\u5206", ...sel.map((b) => fmt(b.quality, 2))],
          ...["3d", "anim", "ui", "be", "eng", "req", "agent", "cost", "speed"].map((d) => [d, ...sel.map((b) => fmt(b.dims[d]))]),
          ...tks.map((t) => [t, ...sel.map((b) => {
            const r = agg.tasks.find((x) => x.entrant === b.entrant && x.task === t);
            return r ? `${fmt(r.mean)}\xB1${fmt(r.sd)}` : "\u2014";
          })])
        ]);
      });
    }
    case "report": {
      if (!sub) die("\u7528\u6CD5\uFF1Awb report <\u4F9B\u5E94\u5546>/<\u6A21\u578B>");
      const [vendor, ...n] = sub.split("/");
      const r = await post("/api/models/report", { vendor, name: n.join("/") });
      return out({ file: r.file }, () => console.log(`\u2714 \u62A5\u544A\u5DF2\u5199\u5165 ${import_node_path.default.join(ROOT, r.file)}`));
    }
    case "preview": {
      if (!sub) die("\u7528\u6CD5\uFF1Awb preview <\u6587\u4EF6|\u76EE\u5F55|ref|URL> [--show]");
      const s = await createPreview(sub);
      if (flags.show) await post("/api/ui", { action: "preview", params: { session: s.id } });
      return out(s, () => console.log(`\u2714 \u9884\u89C8\u4F1A\u8BDD ${s.id}\uFF08${s.kind}\uFF09
  ${s.url}
  \u65E5\u5FD7\uFF1Awb logs ${s.id} --errors`));
    }
    case "sessions": {
      const ss = await get("/api/preview");
      return out(ss, () => ss.length ? table([["\u4F1A\u8BDD", "\u7C7B\u578B", "\u6807\u7B7E", "\u5730\u5740", "\u9519\u8BEF", "\u8B66\u544A"], ...ss.map((s) => [s.id, s.kind, s.label, s.url, s.counts.error, s.counts.warn])]) : console.log("\u6CA1\u6709\u9884\u89C8\u4F1A\u8BDD"));
    }
    case "close": {
      if (!sub) die("\u7528\u6CD5\uFF1Awb close <session>");
      return out(await api("DELETE", `/api/preview/${sub}`), () => console.log("\u2714 \u5DF2\u5173\u95ED"));
    }
    case "logs": {
      if (!sub) die("\u7528\u6CD5\uFF1Awb logs <session> [--errors] [--follow]");
      const levels = flags.errors ? "error,resource,network" : flags.warnings ? "error,resource,network,warn" : "";
      let since = num("since") || 0;
      const print = (ls) => {
        const show = flags.errors ? ls.filter((l) => l.level !== "network" || !l.status || l.status >= 400) : ls;
        if (JSON_OUT) {
          if (show.length) console.log(JSON.stringify(show));
          return;
        }
        for (const l of show) console.log(`${new Date(l.ts).toLocaleTimeString("zh-CN", { hour12: false })} ${pad(l.level.toUpperCase(), 8)} ${l.text}${l.url && l.level !== "network" ? `  (${l.url}${l.line ? ":" + l.line : ""})` : ""}${l.count ? ` \xD7${l.count}` : ""}`);
      };
      for (; ; ) {
        const ls = await get(`/api/preview/${sub}/logs?since=${since}${levels ? "&levels=" + levels : ""}`);
        print(ls);
        if (ls.length) since = ls[ls.length - 1].seq;
        if (!flags.follow) break;
        await sleep(1e3);
      }
      return;
    }
    case "dev": {
      if (!sub) die('\u7528\u6CD5\uFF1Awb dev <ref|\u76EE\u5F55> [--cmd "npm run dev"]');
      const body = isRef(sub) ? { ref: sub, sub: str("sub") || "" } : { cwd: toRootRel(sub) };
      let cmdline = str("cmd");
      if (!cmdline) {
        const q = isRef(sub) ? `ref=${encodeURIComponent(sub)}&sub=${encodeURIComponent(str("sub") || "")}` : `cwd=${encodeURIComponent(body.cwd)}`;
        const sc = await get(`/api/scripts?${q}`);
        const pkg = sc.packages[0];
        if (pkg) {
          const name = ["dev", "start", "preview", "serve"].find((k) => pkg.scripts[k]);
          if (!name) die(`${pkg.dir}/package.json \u6CA1\u6709 dev/start/preview \u811A\u672C\uFF0C\u8BF7\u7528 --cmd \u6307\u5B9A`);
          cmdline = `${pkg.has_modules ? "" : "npm install --no-audit --no-fund && "}npm run ${name}`;
          if (isRef(sub)) body.sub = import_node_path.default.relative(import_node_path.default.join("model", ...sub.split("/")), pkg.dir).split(import_node_path.default.sep).join("/");
          else body.cwd = pkg.dir;
        } else if (sc.python.length) cmdline = `python ${sc.python[0]}`;
        else die("\u6CA1\u6709\u627E\u5230 package.json \u6216 app.py\uFF0C\u8BF7\u7528 --cmd \u6307\u5B9A\u542F\u52A8\u547D\u4EE4");
      }
      body.cmd = cmdline;
      body.name = str("name") || cmdline;
      const p = await post("/api/procs", body);
      if (!JSON_OUT) console.log(`\u2714 \u8FDB\u7A0B ${p.id} \u5DF2\u542F\u52A8\uFF1A${cmdline}
  \u7B49\u5F85\u672C\u5730\u5730\u5740\u2026`);
      for (let i = 0; i < 180; i++) {
        await sleep(1e3);
        const all = await get("/api/procs");
        const cur = all.find((x) => x.id === p.id);
        if (cur?.session_id) {
          const s = await get(`/api/preview/${cur.session_id}`);
          if (flags.show) await post("/api/ui", { action: "preview", params: { session: s.id } });
          return out({ proc: cur, session: s }, () => console.log(`\u2714 \u5F00\u53D1\u670D\u52A1\u5668 ${cur.url}
  \u9884\u89C8\uFF08\u5DF2\u6CE8\u5165\u63A7\u5236\u53F0\u63A2\u9488\uFF09${s.url}
  \u4F1A\u8BDD ${s.id} \xB7 \u65E5\u5FD7 wb logs ${s.id} --errors \xB7 \u8F93\u51FA wb proc-log ${p.id}`));
        }
        if (cur && cur.status !== "running") {
          const o = await get(`/api/procs/${p.id}/output`);
          die(`\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF08${cur.code}\uFF09\uFF1A
${o.slice(-30).map((x) => x.line).join("\n")}`);
        }
      }
      die("3 \u5206\u949F\u5185\u6CA1\u6709\u5728\u8F93\u51FA\u4E2D\u53D1\u73B0\u672C\u5730\u5730\u5740\uFF1Bwb proc-log " + p.id);
    }
    case "procs": {
      const ps = await get("/api/procs");
      return out(ps, () => ps.length ? table([["id", "\u72B6\u6001", "pid", "\u5730\u5740", "\u4F1A\u8BDD", "\u547D\u4EE4", "\u76EE\u5F55"], ...ps.map((p) => [p.id, p.status, p.pid ?? "", p.url || "", p.session_id || "", p.cmd, p.cwd])]) : console.log("\u6CA1\u6709\u8FDB\u7A0B"));
    }
    case "proc-log": {
      const o = await get(`/api/procs/${sub}/output?from=${num("from") || 0}`);
      return out(o, () => o.forEach((l) => console.log((l.stream === "stderr" ? "! " : "  ") + l.line)));
    }
    case "proc-stop": {
      return out(await post(`/api/procs/${sub}/stop`), () => console.log("\u2714 \u5DF2\u505C\u6B62"));
    }
    case "check": {
      if (!sub) die("\u7528\u6CD5\uFF1Awb check <\u6587\u4EF6|ref|URL> [--viewport 390x844] [--mobile]");
      let url = sub;
      if (!/^https?:/.test(sub)) url = (await createPreview(sub)).url;
      if (!JSON_OUT) console.error(`\xB7 \u65E0\u5934 Chromium \u52A0\u8F7D ${url} \u2026`);
      const r = await post("/api/probe", { url, viewport: str("viewport") || (flags.mobile ? "390x844" : "1440x900"), mobile: !!flags.mobile, wait: num("wait") ?? 2500, full: !!flags.full });
      return out(r, () => {
        console.log(`${r.loaded ? "\u2714" : "\u2718"} ${r.title || "(\u65E0\u6807\u9898)"}  ${r.viewport.join("\xD7")}${r.mobile ? " \u79FB\u52A8\u7AEF" : ""}  ${r.ms}ms`);
        if (r.load_error) console.log("  \u52A0\u8F7D\u5931\u8D25\uFF1A" + r.load_error);
        console.log(`  \u9519\u8BEF ${r.counts.error} \xB7 \u8B66\u544A ${r.counts.warning} \xB7 \u8BF7\u6C42\u5931\u8D25 ${r.counts.failed_requests} \xB7 HTTP\u2265400 ${r.counts.http_errors}`);
        for (const e of r.page_errors) console.log("  \u2718 " + e.text.split("\n")[0]);
        for (const l of r.console.filter((x) => x.level === "error" || x.level === "warning").slice(0, 30)) console.log(`  ${l.level === "error" ? "\u2718" : "\u26A0"} ${l.text.split("\n")[0]}${l.url ? `  (${l.url}:${l.line ?? ""})` : ""}`);
        for (const f of r.failed_requests.slice(0, 20)) console.log(`  \u2718 \u8BF7\u6C42\u5931\u8D25 ${f.method} ${f.url} ${f.error}`);
        for (const h of r.http_errors.slice(0, 20)) console.log(`  \u2718 HTTP ${h.status} ${h.url}`);
        if (r.screenshot) console.log(`  \u622A\u56FE ${import_node_path.default.join(ROOT, r.screenshot)}`);
      });
    }
    case "jobs": {
      const js = await get("/api/jobs");
      return out(js, () => js.length ? table([["id", "\u72B6\u6001", "\u7C7B\u578B", "\u6807\u9898", "\u5F00\u59CB"], ...js.map((j) => [j.id, j.status, j.kind, j.title, new Date(j.started_at).toLocaleTimeString("zh-CN", { hour12: false })])]) : console.log("\u6CA1\u6709\u4EFB\u52A1"));
    }
    case "job": {
      if (!sub) die("\u7528\u6CD5\uFF1Awb job <id> [--wait]");
      if (flags.wait) {
        await maybeWait({ id: sub });
        return;
      }
      const j = await get(`/api/jobs/${sub}`);
      return out(j, () => {
        console.log(`${j.title} \u2014 ${j.status}`);
        j.output.slice(-80).forEach((l) => console.log("  \u2502 " + l));
      });
    }
    case "store": {
      const file = rest[0];
      if (sub === "export") {
        if (!file) die("\u7528\u6CD5\uFF1Awb store export <\u6587\u4EF6>");
        const s = await ensureServer();
        const r = await fetch(s.url + "/api/store/export");
        import_node_fs.default.writeFileSync(import_node_path.default.resolve(file), Buffer.from(await r.arrayBuffer()));
        return out({ ok: true, file: import_node_path.default.resolve(file) }, () => console.log(`\u2714 \u5DF2\u5BFC\u51FA ${import_node_path.default.resolve(file)}`));
      }
      if (sub === "import") {
        if (!file) die("\u7528\u6CD5\uFF1Awb store import <\u6587\u4EF6>");
        const r = await post("/api/store/import", JSON.parse(import_node_fs.default.readFileSync(import_node_path.default.resolve(file), "utf8")));
        return out(r, () => console.log(`\u2714 \u5DF2\u5408\u5E76\uFF1A\u8FD0\u884C ${r.runs} \xB7 \u6A21\u578B ${r.models} \xB7 \u5DE5\u4F5C\u533A ${r.workspaces} \xB7 \u7B14\u8BB0 ${r.notes}`));
      }
      die("\u7528\u6CD5\uFF1Awb store export|import <\u6587\u4EF6>");
    }
    case "trash": {
      const list = await get("/api/trash");
      if (!sub || sub === "list") {
        return out(list, () => list.length ? (table([["id", "\u9636\u6BB5", "\u65B9\u5F0F", "\u4F5C\u5E9F\u65F6\u95F4", "\u5F97\u5206", "\u539F\u56E0"], ...list.map((t) => [t.id, t.from, t.stopped ? "\u5F7B\u5E95\u505C\u6B62" : "\u5220\u9664", t.at.slice(5, 16).replace("T", " "), t.total == null ? "\u2014" : fmt(t.total), t.reason || "\u2014"])]), console.log(`
\u56DE\u6536\u7AD9\u91CC\u7684\u8FD0\u884C\u4E0D\u53C2\u4E0E\u6392\u884C\u3001\u5BF9\u6BD4\u3001\u5F85\u8BC4\u6E05\u5355\u3001\u5BFC\u51FA\u548C\u62A5\u544A\u3002\u6062\u590D\uFF1Awb run restore <id>\uFF1B\u6C38\u4E45\u5220\u9664\uFF1Awb trash purge <id>\u2026 --yes`)) : console.log("\u56DE\u6536\u7AD9\u662F\u7A7A\u7684"));
      }
      if (sub === "purge") {
        const ids = flags.all ? list.map((t) => t.id) : rest;
        if (!ids.length) die("\u7528\u6CD5\uFF1Awb trash purge <id>\u2026 --yes   \u6216   wb trash purge --all --yes");
        const miss = ids.filter((id) => !list.some((t) => t.id === id));
        if (miss.length) die(`\u56DE\u6536\u7AD9\u91CC\u6CA1\u6709\uFF1A${miss.join(", ")}\uFF08\u53EA\u80FD\u6C38\u4E45\u5220\u9664\u56DE\u6536\u7AD9\u91CC\u7684\u6761\u76EE\uFF09`);
        if (!flags.yes) die(`\u5C06\u6C38\u4E45\u5220\u9664 ${ids.length} \u6B21\u8FD0\u884C\u7684\u5168\u90E8\u6587\u4EF6\uFF08\u5DE5\u4F5C\u76EE\u5F55\u3001\u63D0\u793A\u8BCD\u7559\u6863\u3001\u6700\u540E\u56DE\u590D\u3001\u8BC4\u5206\u76EE\u5F55\uFF09\uFF0C\u65E0\u6CD5\u6062\u590D\u3002\u786E\u8BA4\u8BF7\u52A0 --yes`);
        const r = await post("/api/trash/purge", { ids, confirm: "purge" });
        return out(r, () => console.log(`\u2714 \u5DF2\u6C38\u4E45\u5220\u9664 ${r.purged.length} \u6B21\u8FD0\u884C`));
      }
      die("\u7528\u6CD5\uFF1Awb trash [list] | wb trash purge <id>\u2026 --yes | wb trash purge --all --yes");
    }
    case "ui": {
      const params = Object.fromEntries(rest.map((kv) => kv.split("=", 2)));
      const r = await post("/api/ui", { action: sub || "open", params });
      return out(r, () => console.log(r.clients ? `\u2714 \u5DF2\u53D1\u9001\u5230 ${r.clients} \u4E2A\u754C\u9762` : "\u26A0 \u6CA1\u6709\u6253\u5F00\u7684\u754C\u9762\uFF08wb open \u6253\u5F00\uFF09"));
    }
    default:
      die(`\u672A\u77E5\u547D\u4EE4\uFF1A${cmd}

${HELP}`);
  }
}
async function createPreview(target) {
  if (/^https?:\/\//.test(target)) {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?/.test(target);
    return post("/api/preview", local ? { kind: "proxy", target } : { kind: "url", url: target });
  }
  if (isRef(target)) {
    const st = await get("/api/store");
    const w = st.workspaces.find((x) => x.ref === target);
    return post("/api/preview", { ref: target, entry: str("entry") || w?.entry || "", inject: !flags["no-inject"] });
  }
  return post("/api/preview", { path: toRootRel(target), inject: !flags["no-inject"] });
}
async function runCmd(sub, rest) {
  switch (sub) {
    case "new": {
      const [mv, task] = rest;
      if (!mv || !task) die("\u7528\u6CD5\uFF1Awb run new <\u4F9B\u5E94\u5546>/<\u6A21\u578B> <T05> [--variant A] [--harness X]");
      const [vendor, ...n] = mv.split("/");
      const r = await post("/api/ws/create", { vendor, model: n.join("/"), task: task.toUpperCase().replace(/[AC]$/, ""), variant: str("variant") || (/^T\d{2}([AC])$/i.exec(task)?.[1]?.toUpperCase() ?? null), harness: str("harness") || "" });
      return out(r, () => {
        console.log(`\u2714 \u5DE5\u4F5C\u533A ${r.run.ref}
  \u76EE\u5F55     ${r.workspace}
  \u4EA4\u4ED8\u76EE\u5F55 ${r.run.deliverable_dir}/
  \u63D0\u793A\u8BCD   ${r.workspace}.prompt.md`);
        for (const w of r.warnings) console.log("  \u26A0 " + w);
        console.log(`
\u4E0B\u4E00\u6B65\uFF1A\u5728\u8BE5\u76EE\u5F55\u542F\u52A8\u88AB\u6D4B Agent \u5E76\u53D1\u9001\u63D0\u793A\u8BCD \u2192 wb run start ${r.run.ref} \u2192 \u5B8C\u6210\u540E wb run finish ${r.run.ref} --final-file <\u6700\u540E\u56DE\u590D.md> --register`);
      });
    }
    case "list": {
      const st = await get("/api/store");
      let ws = st.workspaces;
      if (str("model")) ws = ws.filter((w) => `${w.vendor}/${w.model}` === str("model") || w.model === str("model"));
      if (str("task")) ws = ws.filter((w) => w.tkey === str("task") || w.task === str("task"));
      return out(ws, () => ws.length ? table([["ref", "\u72B6\u6001", "harness", "\u5F00\u59CB", "\u7ED3\u675F", "\u4EA4\u4ED8", "\u56DE\u590D", "bench \u8FD0\u884C", "\u5165\u53E3"], ...ws.map((w) => [w.ref, w.status || "", w.harness || "\u2014", w.started_at?.slice(5, 16) || "\u2014", w.ended_at?.slice(5, 16) || "\u2014", w.has_deliverable ? "\u2714" : "\u2718", w.has_final ? "\u2714" : "\u2718", w.grader_run_id || "\u2014", w.entry || "\u2014"])]) : console.log("\u6CA1\u6709\u5DE5\u4F5C\u533A"));
    }
    case "start": {
      const ref = await resolveRef(rest[0] || "");
      const r = await post("/api/ws/start", { ref, at: str("at") });
      return out(r, () => console.log(`\u2714 ${ref} \u5F00\u59CB\u8BA1\u65F6 ${r.started_at}`));
    }
    case "finish": {
      const ref = await resolveRef(rest[0] || "");
      const final = str("final-file") ? import_node_fs.default.readFileSync(import_node_path.default.resolve(str("final-file")), "utf8") : str("final");
      const usage = {};
      for (const k of ["wall-min", "active-min", "input-tokens", "output-tokens", "cache-read-tokens", "cache-write-tokens", "cost-usd"]) if (num(k) != null) usage[k.replace(/-/g, "_")] = num(k);
      const transcript = str("transcript") ? JSON.parse(import_node_fs.default.readFileSync(import_node_path.default.resolve(str("transcript")), "utf8")) : void 0;
      const r = await post("/api/ws/finish", { ref, final_message: final, at: str("at"), usage: Object.keys(usage).length ? usage : void 0, timed_out: flags["timed-out"] ? true : void 0, transcript, register: !!flags.register, grade: !flags["no-grade"], fast: !!flags.fast });
      if (!JSON_OUT) console.log(`\u2714 ${ref} \u7ED3\u675F ${r.run.ended_at}${final ? " \xB7 \u5DF2\u4FDD\u5B58\u6700\u540E\u56DE\u590D" : " \xB7 \u26A0 \u672A\u63D0\u4F9B\u6700\u540E\u56DE\u590D\uFF08\u8BDA\u4FE1\u95E8\u69DB\u5C06\u8BB0 N/A\uFF09"}`);
      if (r.job) await maybeWait(r.job);
      else out(r, () => console.log(`\u4E0B\u4E00\u6B65\uFF1Awb run register ${ref}`));
      return;
    }
    case "register": {
      const ref = await resolveRef(rest[0] || "");
      const job = await post("/api/ws/register", { ref, grade: !flags["no-grade"], fast: !!flags.fast });
      const r = await maybeWait(job);
      if (r && !flags["no-grade"] && !flags["no-wait"]) {
        const jobs = await get("/api/jobs");
        const g = jobs.find((j) => j.kind === "grade" && j.status !== "done" && j.status !== "failed");
        if (g) await maybeWait(g);
      }
      return;
    }
    case "stop":
    case "discard": {
      const arg = rest[0] || "";
      if (!arg) die(`\u7528\u6CD5\uFF1Awb run ${sub} <ref|run_id> [--reason "\u539F\u56E0"]`);
      const body = isRef(arg) || /[\\/]/.test(arg) ? { ref: await resolveRef(arg) } : { run_id: arg };
      const r = await post("/api/runs/discard", { ...body, stop: sub === "stop", reason: str("reason") });
      return out(r, () => {
        console.log(r.already ? `\xB7 ${r.id} \u5DF2\u7ECF\u5728\u56DE\u6536\u7AD9\u91CC` : `\u2714 ${r.id} \u5DF2${sub === "stop" ? "\u5F7B\u5E95\u505C\u6B62\u5E76" : ""}\u79FB\u5165\u56DE\u6536\u7AD9\uFF08\u4E0D\u53C2\u4E0E\u4EFB\u4F55\u8BC4\u4F30\uFF0C\u53EF wb run restore ${r.id} \u6062\u590D\uFF09`);
        if (r.released?.procs || r.released?.previews) console.log(`  \u5DF2\u5173\u95ED ${r.released.procs} \u4E2A\u5F00\u53D1\u670D\u52A1\u5668\u3001${r.released.previews} \u4E2A\u9884\u89C8`);
        if (sub === "stop") console.log("  \u26A0 \u5DE5\u4F5C\u53F0\u5173\u4E0D\u6389\u5916\u90E8 Agent \u8F6F\u4EF6\u91CC\u7684\u4F1A\u8BDD\uFF1A\u8BF7\u5728 harness \u91CC\u624B\u52A8\u505C\u6B62\u5B83\uFF0C\u514D\u5F97\u7EE7\u7EED\u6D88\u8017\u989D\u5EA6");
      });
    }
    case "restore": {
      const arg = rest[0] || "";
      if (!arg) die("\u7528\u6CD5\uFF1Awb run restore <ref|run:run_id>   \uFF08wb trash \u67E5\u770B\u56DE\u6536\u7AD9\uFF09");
      const r = await post("/api/runs/restore", { id: isRef(arg) || arg.startsWith("run:") ? arg : /[\\/]/.test(arg) ? await resolveRef(arg) : "run:" + arg });
      return out(r, () => console.log(`\u2714 \u5DF2\u6062\u590D ${r.id}`));
    }
    default:
      die("\u7528\u6CD5\uFF1Awb run new|list|start|finish|register|stop|discard|restore \u2026");
  }
}
main().catch((e) => die(e?.message || String(e)));
