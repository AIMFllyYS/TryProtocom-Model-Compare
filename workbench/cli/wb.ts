#!/usr/bin/env node
// wb — Bench Workbench 命令行。所有命令都走本地服务的 HTTP API（未启动时自动后台启动），
// 因此 CLI、界面与 Agent 看到的是同一份状态。加 --json 输出机器可读结果。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Aggregate, BenchStore, JobInfo, LogEntry, PreviewSession, SpecData, StoreRun, WorkspaceRun } from '../shared/types';

const HERE = __dirname; // workbench/dist-node
const ROOT = findRoot();
const RUNTIME = path.join(ROOT, 'workbench', '.runtime', 'runtime.json');
const argv = process.argv.slice(2);

function findRoot(): string {
  for (const start of [process.env.WB_ROOT, HERE, process.cwd()].filter(Boolean) as string[]) {
    let d = path.resolve(start);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'skills', 'bench-grader', 'SKILL.md'))) return d;
      const up = path.dirname(d); if (up === d) break; d = up;
    }
  }
  return process.cwd();
}

// ---------- 参数 ----------
const BOOL = new Set(['json', 'all', 'fast', 'skip-graded', 'wait', 'no-wait', 'errors', 'follow', 'mobile', 'full', 'show', 'register', 'no-grade', 'timed-out', 'open', 'no-inject', 'warnings', 'help']);
const flags: Record<string, string | boolean> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--') && !BOOL.has(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else pos.push(a);
}
const JSON_OUT = !!flags.json;
const str = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
const num = (k: string) => (str(k) != null ? Number(str(k)) : undefined);

// ---------- HTTP ----------
let rt: { url: string; token: string } | null = null;
function readRuntime() { try { return JSON.parse(fs.readFileSync(RUNTIME, 'utf8')); } catch { return null; } }
async function alive(url: string) { try { const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }
async function ensureServer(): Promise<{ url: string; token: string }> {
  if (rt) return rt;
  const cur = readRuntime();
  if (cur && (await alive(cur.url))) return (rt = cur);
  const port = Number(process.env.WB_PORT || 41873);
  if (await alive(`http://127.0.0.1:${port}`)) {
    // 服务在运行但 runtime.json 丢失：取 session 拿 token
    const s = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json() as any;
    return (rt = { url: `http://127.0.0.1:${port}`, token: s.token });
  }
  const serverJs = path.join(ROOT, 'workbench', 'dist-node', 'server.cjs');
  if (!fs.existsSync(serverJs)) die(`找不到 ${serverJs}，请先在 workbench/ 运行 npm run build（或双击 Start-Workbench.cmd）`);
  if (!JSON_OUT) process.stderr.write('· 工作台服务未运行，正在后台启动…\n');
  const logFile = fs.openSync(path.join(ROOT, 'workbench', '.runtime', 'server.log'), 'a');
  spawn(process.execPath, [serverJs], { cwd: ROOT, detached: true, stdio: ['ignore', logFile, logFile], windowsHide: true }).unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const r = readRuntime();
    if (r && (await alive(r.url))) return (rt = r);
  }
  die('服务启动超时，查看 workbench/.runtime/server.log');
}
async function api<T = any>(method: string, p: string, body?: unknown): Promise<T> {
  const s = await ensureServer();
  const r = await fetch(s.url + p, { method, headers: { 'content-type': 'application/json', 'x-wb-token': s.token }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text, (_k, v) => (v === 'inf' ? Infinity : v)); } catch { j = text; }
  if (!r.ok) die(`${method} ${p} → ${r.status} ${j?.error || text}`);
  return j as T;
}
const get = <T = any>(p: string) => api<T>('GET', p);
const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);

// ---------- 输出 ----------
function die(msg: string): never { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg })); else console.error('✘ ' + msg); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function out(data: unknown, human?: () => void) { if (JSON_OUT || !human) console.log(JSON.stringify(data, (_k, v) => (v === Infinity ? 'inf' : v), 2)); else human(); }
const fmt = (v: number | null | undefined, d = 1) => (v == null ? '—' : v === Infinity ? '∞' : Number(v).toFixed(d));
const pad = (s: unknown, n: number) => { const t = String(s ?? ''); const w = [...t].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0); return t + ' '.repeat(Math.max(0, n - w)); };
function table(rows: (string | number)[][]) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => [...String(r[i] ?? '')].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0))));
  for (const r of rows) console.log(r.map((c, i) => pad(c, w[i])).join('  ').trimEnd());
}

async function waitJob(job: JobInfo, quiet = false): Promise<JobInfo & { output?: string[] }> {
  let from = 0;
  for (;;) {
    const j = await get<JobInfo & { output: string[] }>(`/api/jobs/${job.id}?from=${from}`);
    if (!quiet && !JSON_OUT) for (const l of j.output) console.log('  │ ' + l);
    from += j.output.length;
    if (['done', 'failed', 'cancelled'].includes(j.status)) {
      const full = await get<JobInfo & { output: string[] }>(`/api/jobs/${job.id}?from=0`);
      if (!JSON_OUT) console.log(`${j.status === 'done' ? '✔' : '✘'} ${j.title} — ${j.status}${j.error ? '：' + j.error : ''}`);
      return full;
    }
    await sleep(900);
  }
}
async function maybeWait(job: JobInfo) {
  if (flags['no-wait']) return out(job, () => console.log(`已提交任务 ${job.id}：${job.title}（wb job ${job.id} --wait 查看）`));
  const r = await waitJob(job);
  if (JSON_OUT) out({ ...r, output: r.output?.slice(-200) });
  if (r.status !== 'done') process.exitCode = 1;
  return r;
}

function toRootRel(p: string) {
  const abs = path.resolve(p);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) die(`路径不在工作台根目录内：${abs}`);
  return rel.split(path.sep).join('/');
}
const isRef = (s: string) => /^[^/\\]+\/[^/\\]+\/T\d{2}[A-Z]?\/r\d+$/.test(s);
async function resolveRef(s: string): Promise<string> {
  if (isRef(s)) return s;
  const abs = path.resolve(s);
  const rel = path.relative(path.join(ROOT, 'model'), abs).split(path.sep).join('/');
  const m = /^([^/]+\/[^/]+\/T\d{2}[A-Z]?\/r\d+)(\/|$)/.exec(rel);
  if (m) return m[1];
  die(`不是工作区引用：${s}（格式 供应商/模型/题号/rN，例如 OpenAI/GPT-6.1-Sol/T05/r1）`);
}

// ======================= 命令 =======================
const HELP = `wb — Bench Workbench CLI（工作台 http://127.0.0.1:41873）

服务      wb status | wb serve [--open] | wb start | wb stop | wb open [视图]
题库      wb tasks | wb prompt <T05> [--variant A]
模型      wb models | wb model add <供应商>/<模型> [--harness "Claude Code"]
运行      wb run new <供应商>/<模型> <T05> [--variant A|C] [--harness X]
          wb run list [--model 供应商/模型] [--task T05]
          wb run start <ref> | wb run finish <ref> [--final-file f.md|--final "…"] [--wall-min 30 --cost-usd 1.2 …] [--timed-out] [--register] [--no-grade]
          wb run register <ref> [--no-grade] [--fast]
评分      wb grade [run_id…|--all] [--task T05] [--fast] [--skip-graded] | wb review [--task T05]
          wb pending [--method agent|human] [--task T05] | wb score <run_id> <item_id> <0-3> --note "证据" [--by agent]
          wb show <run_id> | wb sync
结果      wb board | wb compare <关键词> <关键词>… | wb report <供应商>/<模型> | wb export [--formats csv,md,xlsx,png,html]
预览      wb preview <文件|目录|ref|URL> [--show] [--no-inject] | wb sessions | wb close <session>
          wb logs <session> [--errors|--warnings] [--since N] [--follow]
          wb dev <ref|目录> [--cmd "npm run dev"] [--sub 子目录] | wb procs | wb proc-log <id> | wb proc-stop <id>
          wb check <文件|ref|URL> [--viewport 390x844] [--mobile] [--wait 3000] [--full]   无头加载 → 报错 + 截图
任务      wb jobs | wb job <id> [--wait] | wb doctor | wb materials | wb validate
存储      wb store export <文件> | wb store import <文件>
界面      wb ui <open|preview|run|compare> [key=value…]
通用      --json 机器可读输出；ref = 供应商/模型/题号/rN，例如 OpenAI/GPT-6.1-Sol/T05/r1
`;

async function main() {
  const [cmd, sub, ...rest] = pos;
  if (!cmd || flags.help || cmd === 'help') { console.log(HELP); return; }
  switch (cmd) {
    case 'serve': {
      const serverJs = path.join(ROOT, 'workbench', 'dist-node', 'server.cjs');
      const p = spawn(process.execPath, [serverJs, ...(flags.open ? ['--open'] : [])], { cwd: ROOT, stdio: 'inherit' });
      p.on('exit', (c) => process.exit(c ?? 0));
      return;
    }
    case 'start': { const s = await ensureServer(); return out({ ok: true, url: s.url }, () => console.log(`✔ 服务运行中：${s.url}`)); }
    case 'stop': {
      const cur = readRuntime();
      if (!cur || !(await alive(cur.url))) return out({ ok: true, running: false }, () => console.log('服务未运行'));
      await fetch(cur.url + '/api/shutdown', { method: 'POST', headers: { 'x-wb-token': cur.token } }).catch(() => {});
      return out({ ok: true }, () => console.log('✔ 已停止'));
    }
    case 'status': {
      const s = await get('/api/session');
      const st = await get<BenchStore>('/api/store');
      const agg = await get<Aggregate>('/api/aggregate');
      const data = { url: rt!.url, version: s.version, root: s.root, python: s.python, models: st.models.length, workspaces: st.workspaces.length, runs: st.runs.length, graded: st.runs.filter((r) => r.graded).length, pending: agg.pending, store: s.paths.store, updated_at: st.updated_at };
      return out(data, () => {
        console.log(`Bench Workbench ${s.version} · ${rt!.url}\n根目录 ${s.root}\nPython ${s.python || '未找到'}`);
        console.log(`模型 ${data.models} · 工作区 ${data.workspaces} · 登记运行 ${data.runs}（已评分 ${data.graded}）`);
        console.log(`待办：未评分 ${agg.pending.ungraded} · 人工待评 ${agg.pending.human} · agent 待评 ${agg.pending.agent} · 缺用量 ${agg.pending.usage_missing} · 低可信 ${agg.pending.low_confidence}`);
        console.log(`存储文件 ${s.paths.store}（更新于 ${st.updated_at}）`);
      });
    }
    case 'open': {
      const s = await ensureServer();
      const view = sub || '';
      const r = await post('/api/ui', { action: 'open', params: { view } });
      if (!r.clients || flags.open) {
        const url = s.url + (view ? `/#/${view}` : '');
        spawn(process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { detached: true, stdio: 'ignore' }).unref();
      }
      return out({ ok: true, clients: r.clients }, () => console.log(r.clients ? `✔ 已通知 ${r.clients} 个界面切换到 ${view || '总览'}` : `✔ 已在浏览器打开 ${s.url}`));
    }
    case 'sync': { const r = await post('/api/sync'); return out(r, () => console.log(`✔ 同步完成：${r.runs} 次运行 · ${r.models} 个模型 · ${r.workspaces} 个工作区`)); }
    case 'tasks': {
      const s = await get<SpecData>('/api/spec');
      const rows = s.tasks.map((t) => ({ id: t.id, name: t.name, deliverable: t.deliverable, variants: Object.keys(t.variants || {}), items: t.items.length, human: t.items.filter((i) => i.method === 'human').length, agent: t.items.filter((i) => i.method === 'agent').length, time_limit: t.time_limit, dims: t.dims, missing_materials: s.materials_state?.[t.id]?.missing || [] }));
      return out(rows, () => table([['题号', '名称', '交付目录', '变体', '检查项', '人工', 'agent', '时限'], ...rows.map((r) => [r.id, r.name, r.deliverable + '/', r.variants.join('/') || '—', r.items, r.human, r.agent, (r.time_limit ?? '—') + '′'])]));
    }
    case 'prompt': {
      if (!sub) die('用法：wb prompt <T05> [--variant A]');
      const r = await get(`/api/ws/prompt?task=${encodeURIComponent(sub.toUpperCase())}&variant=${encodeURIComponent(str('variant') || '')}`);
      return out(r, () => { for (const w of r.warnings) console.error('⚠ ' + w); process.stdout.write(r.text); });
    }
    case 'models': {
      const st = await get<BenchStore>('/api/store');
      return out(st.models, () => table([['供应商', '模型', '默认 harness', '工作区运行', '已登记'], ...st.models.map((m) => [m.vendor, m.name, m.harness || '—', st.workspaces.filter((w) => w.vendor === m.vendor && w.model === m.name).length, st.runs.filter((r) => r.model === m.name).length])]));
    }
    case 'model': {
      if (sub !== 'add' || !rest[0]) die('用法：wb model add <供应商>/<模型> [--harness X] [--notes …]');
      const [vendor, ...n] = rest[0].split('/');
      const m = await post('/api/models', { vendor, name: n.join('/'), harness: str('harness'), notes: str('notes'), family: str('family') });
      return out(m, () => console.log(`✔ 模型 ${m.vendor}/${m.name}\n  工作区 ${path.join(ROOT, 'model', m.vendor, m.name)}`));
    }
    case 'run': return runCmd(sub, rest);
    case 'grade': {
      const ids = [sub, ...rest].filter(Boolean);
      const job = await post<JobInfo>('/api/jobs', { kind: 'grade', runs: ids, all: !!flags.all || !ids.length, task: str('task'), fast: !!flags.fast, skip_graded: !!flags['skip-graded'] });
      await maybeWait(job); return;
    }
    case 'review': { await maybeWait(await post<JobInfo>('/api/jobs', { kind: 'review', task: sub || str('task') })); return; }
    case 'export': { const j = await post<JobInfo>('/api/jobs', { kind: 'export', formats: str('formats'), label: str('label') }); await maybeWait(j); if (!flags['no-wait']) { const jobs = await get<JobInfo[]>('/api/jobs'); const ex = jobs.find((x) => x.kind === 'export'); if (ex) await waitJob(ex, true).then((r) => !JSON_OUT && console.log(`输出目录：${(r.result as any)?.dir ?? ''}`)); } return; }
    case 'doctor': case 'materials': case 'validate': { await maybeWait(await post<JobInfo>('/api/jobs', { kind: cmd })); return; }
    case 'pending': {
      const st = await get<BenchStore>('/api/store');
      const s = await get<SpecData>('/api/spec');
      const method = str('method');
      const rows: any[] = [];
      for (const r of st.runs) {
        if (!r.score || (str('task') && r.tkey !== str('task') && r.task !== str('task'))) continue;
        const task = s.tasks.find((t) => t.id === r.task);
        for (const it of r.score.items) {
          if (it.status !== 'pending' || (method && it.method !== method)) continue;
          const si = task?.items.find((x) => x.id === it.id);
          rows.push({ run_id: r.run_id, alias: r.alias, task: r.tkey, item_id: it.id, method: it.method, dim: it.dim, tier: it.tier, desc: it.desc, evidence: si?.evidence, anchors: si?.anchors, open: r.dir ? `${r.dir}/output` : null, ws_ref: r.ws_ref });
        }
      }
      return out(rows, () => {
        if (!rows.length) return console.log('没有待评项 ✔');
        for (const r of rows) console.log(`${r.run_id}  ${r.alias || ''}  ${r.item_id} [${r.method}·${r.tier}]  ${r.desc}\n    产出 ${r.open}\n    锚点 ${(r.anchors || []).map((a: string, i: number) => `${i}=${a}`).join(' | ')}`);
        console.log(`\n共 ${rows.length} 项。打分：wb score <run_id> <item_id> <0-3> --note "文件:行号 / 现象" --by agent`);
      });
    }
    case 'score': {
      const [itemId, score] = rest;
      if (!sub || !itemId || score == null) die('用法：wb score <run_id> <item_id> <0-3|clear> --note "证据" [--by agent|human]');
      const by = str('by') || 'agent';
      if (by === 'agent' && !str('note') && score !== 'clear') die('agent 评分必须附证据：--note "文件:行号 或 可复现的现象"（bench-grader 规则 2）');
      const r = await post(`/api/runs/${encodeURIComponent(sub)}/manual`, { item: itemId, score: score === 'clear' ? '' : Number(score), note: str('note') || '', by });
      return out(r, () => console.log(`✔ ${sub} ${itemId} = ${score}（by ${by}）→ 运行总分 ${fmt(r.score?.total, 2)}，剩余待评 ${r.score?.pending?.length ?? '?'}`));
    }
    case 'show': {
      if (!sub) die('用法：wb show <run_id>');
      const r = await get(`/api/runs/${encodeURIComponent(sub)}`);
      return out(r, () => {
        const run: StoreRun = r.run; const s = run.score;
        console.log(`${run.run_id}  ${run.entrant}  ${run.tkey} #${run.run_index}  别名 ${run.alias || '—'}  工作区 ${run.ws_ref || '—'}`);
        if (!s) return console.log('尚未评分');
        console.log(`总分 ${fmt(s.total, 2)}  门槛 ${s.gate_pass ? '通过' : '未通过 ' + s.gate_fail.map((g) => g.id).join(',')}  达标 ${s.passed ? '是' : '否'}  N/A ${fmt(s.na_ratio * 100, 0)}%  待评 ${s.pending.length}${s.low_confidence ? '  ⚠低可信' : ''}`);
        console.log('维度 ' + Object.entries(s.dims).map(([k, v]) => `${k}=${fmt(v)}`).join('  '));
        table([['检查项', '维度', '层级', '方式', '状态', '得分', '值'], ...s.items.map((i) => [i.id, i.dim, i.tier, i.method, i.status, i.s == null ? '—' : fmt(i.s * 100, 0), i.value == null ? '' : String(typeof i.value === 'object' ? JSON.stringify(i.value) : i.value).slice(0, 40)])]);
        if (run.notes?.length) console.log('探针备注：\n  ' + run.notes.join('\n  '));
      });
    }
    case 'board': {
      const agg = await get<Aggregate>('/api/aggregate');
      return out(agg.board, () => {
        if (!agg.board.length) return console.log('还没有已评分的运行。');
        table([['名次', '参赛者', '质量', '95% CI', '3D', '动画', 'UI', '后端', '工程', '需求', 'Agent', '成本', '速度', '达标率', '运行', '完整'], ...agg.board.map((b) => [b.rank, b.entrant, fmt(b.quality, 2), `${fmt(b.ci_low)}–${fmt(b.ci_high)}`, ...['3d', 'anim', 'ui', 'be', 'eng', 'req', 'agent', 'cost', 'speed'].map((d) => fmt(b.dims[d], 0)), fmt(b.pass_rate * 100, 0) + '%', b.runs, b.complete ? '是' : '否'])]);
      });
    }
    case 'compare': {
      const agg = await get<Aggregate>('/api/aggregate');
      const keys = [sub, ...rest].filter(Boolean).map((k) => k.toLowerCase());
      const sel = keys.length ? agg.board.filter((b) => keys.some((k) => b.entrant.toLowerCase().includes(k))) : agg.board;
      const tks = agg.tkeys;
      const data = { entrants: sel, tasks: agg.tasks.filter((t) => sel.some((b) => b.entrant === t.entrant)) };
      return out(data, () => {
        if (!sel.length) return console.log('没有匹配的参赛者');
        table([['维度', ...sel.map((b) => b.entrant)], ['质量总分', ...sel.map((b) => fmt(b.quality, 2))], ...['3d', 'anim', 'ui', 'be', 'eng', 'req', 'agent', 'cost', 'speed'].map((d) => [d, ...sel.map((b) => fmt(b.dims[d]))]),
          ...tks.map((t) => [t, ...sel.map((b) => { const r = agg.tasks.find((x) => x.entrant === b.entrant && x.task === t); return r ? `${fmt(r.mean)}±${fmt(r.sd)}` : '—'; })])]);
      });
    }
    case 'report': {
      if (!sub) die('用法：wb report <供应商>/<模型>');
      const [vendor, ...n] = sub.split('/');
      const r = await post('/api/models/report', { vendor, name: n.join('/') });
      return out({ file: r.file }, () => console.log(`✔ 报告已写入 ${path.join(ROOT, r.file)}`));
    }
    case 'preview': {
      if (!sub) die('用法：wb preview <文件|目录|ref|URL> [--show]');
      const s = await createPreview(sub);
      if (flags.show) await post('/api/ui', { action: 'preview', params: { session: s.id } });
      return out(s, () => console.log(`✔ 预览会话 ${s.id}（${s.kind}）\n  ${s.url}\n  日志：wb logs ${s.id} --errors`));
    }
    case 'sessions': {
      const ss = await get<PreviewSession[]>('/api/preview');
      return out(ss, () => ss.length ? table([['会话', '类型', '标签', '地址', '错误', '警告'], ...ss.map((s) => [s.id, s.kind, s.label, s.url, s.counts.error, s.counts.warn])]) : console.log('没有预览会话'));
    }
    case 'close': { if (!sub) die('用法：wb close <session>'); return out(await api('DELETE', `/api/preview/${sub}`), () => console.log('✔ 已关闭')); }
    case 'logs': {
      if (!sub) die('用法：wb logs <session> [--errors] [--follow]');
      const levels = flags.errors ? 'error,resource,network' : flags.warnings ? 'error,resource,network,warn' : '';
      let since = num('since') || 0;
      const print = (ls: LogEntry[]) => {
        const show = flags.errors ? ls.filter((l) => l.level !== 'network' || !l.status || l.status >= 400) : ls;
        if (JSON_OUT) { if (show.length) console.log(JSON.stringify(show)); return; }
        for (const l of show) console.log(`${new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false })} ${pad(l.level.toUpperCase(), 8)} ${l.text}${l.url && l.level !== 'network' ? `  (${l.url}${l.line ? ':' + l.line : ''})` : ''}${l.count ? ` ×${l.count}` : ''}`);
      };
      for (;;) {
        const ls = await get<LogEntry[]>(`/api/preview/${sub}/logs?since=${since}${levels ? '&levels=' + levels : ''}`);
        print(ls);
        if (ls.length) since = ls[ls.length - 1].seq;
        if (!flags.follow) break;
        await sleep(1000);
      }
      return;
    }
    case 'dev': {
      if (!sub) die('用法：wb dev <ref|目录> [--cmd "npm run dev"]');
      const body: any = isRef(sub) ? { ref: sub, sub: str('sub') || '' } : { cwd: toRootRel(sub) };
      let cmdline = str('cmd');
      if (!cmdline) {
        const q = isRef(sub) ? `ref=${encodeURIComponent(sub)}&sub=${encodeURIComponent(str('sub') || '')}` : `cwd=${encodeURIComponent(body.cwd)}`;
        const sc = await get(`/api/scripts?${q}`);
        const pkg = sc.packages[0];
        if (pkg) {
          const name = ['dev', 'start', 'preview', 'serve'].find((k) => pkg.scripts[k]);
          if (!name) die(`${pkg.dir}/package.json 没有 dev/start/preview 脚本，请用 --cmd 指定`);
          cmdline = `${pkg.has_modules ? '' : 'npm install --no-audit --no-fund && '}npm run ${name}`;
          if (isRef(sub)) body.sub = path.relative(path.join('model', ...sub.split('/')), pkg.dir).split(path.sep).join('/');
          else body.cwd = pkg.dir;
        } else if (sc.python.length) cmdline = `python ${sc.python[0]}`;
        else die('没有找到 package.json 或 app.py，请用 --cmd 指定启动命令');
      }
      body.cmd = cmdline; body.name = str('name') || cmdline;
      const p = await post('/api/procs', body);
      if (!JSON_OUT) console.log(`✔ 进程 ${p.id} 已启动：${cmdline}\n  等待本地地址…`);
      for (let i = 0; i < 180; i++) {
        await sleep(1000);
        const all = await get<any[]>('/api/procs');
        const cur = all.find((x) => x.id === p.id);
        if (cur?.session_id) {
          const s = await get<PreviewSession>(`/api/preview/${cur.session_id}`);
          if (flags.show) await post('/api/ui', { action: 'preview', params: { session: s.id } });
          return out({ proc: cur, session: s }, () => console.log(`✔ 开发服务器 ${cur.url}\n  预览（已注入控制台探针）${s.url}\n  会话 ${s.id} · 日志 wb logs ${s.id} --errors · 输出 wb proc-log ${p.id}`));
        }
        if (cur && cur.status !== 'running') { const o = await get<any[]>(`/api/procs/${p.id}/output`); die(`进程已退出（${cur.code}）：\n${o.slice(-30).map((x) => x.line).join('\n')}`); }
      }
      die('3 分钟内没有在输出中发现本地地址；wb proc-log ' + p.id);
    }
    case 'procs': { const ps = await get<any[]>('/api/procs'); return out(ps, () => ps.length ? table([['id', '状态', 'pid', '地址', '会话', '命令', '目录'], ...ps.map((p) => [p.id, p.status, p.pid ?? '', p.url || '', p.session_id || '', p.cmd, p.cwd])]) : console.log('没有进程')); }
    case 'proc-log': { const o = await get<any[]>(`/api/procs/${sub}/output?from=${num('from') || 0}`); return out(o, () => o.forEach((l) => console.log((l.stream === 'stderr' ? '! ' : '  ') + l.line))); }
    case 'proc-stop': { return out(await post(`/api/procs/${sub}/stop`), () => console.log('✔ 已停止')); }
    case 'check': {
      if (!sub) die('用法：wb check <文件|ref|URL> [--viewport 390x844] [--mobile]');
      let url = sub;
      if (!/^https?:/.test(sub)) url = (await createPreview(sub)).url;
      if (!JSON_OUT) console.error(`· 无头 Chromium 加载 ${url} …`);
      const r = await post('/api/probe', { url, viewport: str('viewport') || (flags.mobile ? '390x844' : '1440x900'), mobile: !!flags.mobile, wait: num('wait') ?? 2500, full: !!flags.full });
      return out(r, () => {
        console.log(`${r.loaded ? '✔' : '✘'} ${r.title || '(无标题)'}  ${r.viewport.join('×')}${r.mobile ? ' 移动端' : ''}  ${r.ms}ms`);
        if (r.load_error) console.log('  加载失败：' + r.load_error);
        console.log(`  错误 ${r.counts.error} · 警告 ${r.counts.warning} · 请求失败 ${r.counts.failed_requests} · HTTP≥400 ${r.counts.http_errors}`);
        for (const e of r.page_errors) console.log('  ✘ ' + e.text.split('\n')[0]);
        for (const l of r.console.filter((x: any) => x.level === 'error' || x.level === 'warning').slice(0, 30)) console.log(`  ${l.level === 'error' ? '✘' : '⚠'} ${l.text.split('\n')[0]}${l.url ? `  (${l.url}:${l.line ?? ''})` : ''}`);
        for (const f of r.failed_requests.slice(0, 20)) console.log(`  ✘ 请求失败 ${f.method} ${f.url} ${f.error}`);
        for (const h of r.http_errors.slice(0, 20)) console.log(`  ✘ HTTP ${h.status} ${h.url}`);
        if (r.screenshot) console.log(`  截图 ${path.join(ROOT, r.screenshot)}`);
      });
    }
    case 'jobs': { const js = await get<JobInfo[]>('/api/jobs'); return out(js, () => js.length ? table([['id', '状态', '类型', '标题', '开始'], ...js.map((j) => [j.id, j.status, j.kind, j.title, new Date(j.started_at).toLocaleTimeString('zh-CN', { hour12: false })])]) : console.log('没有任务')); }
    case 'job': {
      if (!sub) die('用法：wb job <id> [--wait]');
      if (flags.wait) { await maybeWait({ id: sub } as JobInfo); return; }
      const j = await get(`/api/jobs/${sub}`);
      return out(j, () => { console.log(`${j.title} — ${j.status}`); j.output.slice(-80).forEach((l: string) => console.log('  │ ' + l)); });
    }
    case 'store': {
      const file = rest[0];
      if (sub === 'export') {
        if (!file) die('用法：wb store export <文件>');
        const s = await ensureServer();
        const r = await fetch(s.url + '/api/store/export');
        fs.writeFileSync(path.resolve(file), Buffer.from(await r.arrayBuffer()));
        return out({ ok: true, file: path.resolve(file) }, () => console.log(`✔ 已导出 ${path.resolve(file)}`));
      }
      if (sub === 'import') {
        if (!file) die('用法：wb store import <文件>');
        const r = await post('/api/store/import', JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
        return out(r, () => console.log(`✔ 已合并：运行 ${r.runs} · 模型 ${r.models} · 工作区 ${r.workspaces} · 笔记 ${r.notes}`));
      }
      die('用法：wb store export|import <文件>');
    }
    case 'ui': {
      const params = Object.fromEntries(rest.map((kv) => kv.split('=', 2)));
      const r = await post('/api/ui', { action: sub || 'open', params });
      return out(r, () => console.log(r.clients ? `✔ 已发送到 ${r.clients} 个界面` : '⚠ 没有打开的界面（wb open 打开）'));
    }
    default: die(`未知命令：${cmd}\n\n${HELP}`);
  }
}

async function createPreview(target: string): Promise<PreviewSession> {
  if (/^https?:\/\//.test(target)) {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?/.test(target);
    return post<PreviewSession>('/api/preview', local ? { kind: 'proxy', target } : { kind: 'url', url: target });
  }
  if (isRef(target)) {
    const st = await get<BenchStore>('/api/store');
    const w = st.workspaces.find((x) => x.ref === target);
    return post<PreviewSession>('/api/preview', { ref: target, entry: str('entry') || w?.entry || '', inject: !flags['no-inject'] });
  }
  return post<PreviewSession>('/api/preview', { path: toRootRel(target), inject: !flags['no-inject'] });
}

async function runCmd(sub: string | undefined, rest: string[]) {
  switch (sub) {
    case 'new': {
      const [mv, task] = rest;
      if (!mv || !task) die('用法：wb run new <供应商>/<模型> <T05> [--variant A] [--harness X]');
      const [vendor, ...n] = mv.split('/');
      const r = await post('/api/ws/create', { vendor, model: n.join('/'), task: task.toUpperCase().replace(/[AC]$/, ''), variant: str('variant') || (/^T\d{2}([AC])$/i.exec(task)?.[1]?.toUpperCase() ?? null), harness: str('harness') || '' });
      return out(r, () => {
        console.log(`✔ 工作区 ${r.run.ref}\n  目录     ${r.workspace}\n  交付目录 ${r.run.deliverable_dir}/\n  提示词   ${r.workspace}.prompt.md`);
        for (const w of r.warnings) console.log('  ⚠ ' + w);
        console.log(`\n下一步：在该目录启动被测 Agent 并发送提示词 → wb run start ${r.run.ref} → 完成后 wb run finish ${r.run.ref} --final-file <最后回复.md> --register`);
      });
    }
    case 'list': {
      const st = await get<BenchStore>('/api/store');
      let ws: WorkspaceRun[] = st.workspaces;
      if (str('model')) ws = ws.filter((w) => `${w.vendor}/${w.model}` === str('model') || w.model === str('model'));
      if (str('task')) ws = ws.filter((w) => w.tkey === str('task') || w.task === str('task'));
      return out(ws, () => ws.length ? table([['ref', '状态', 'harness', '开始', '结束', '交付', '回复', 'bench 运行', '入口'], ...ws.map((w) => [w.ref, w.status || '', w.harness || '—', w.started_at?.slice(5, 16) || '—', w.ended_at?.slice(5, 16) || '—', w.has_deliverable ? '✔' : '✘', w.has_final ? '✔' : '✘', w.grader_run_id || '—', w.entry || '—'])]) : console.log('没有工作区'));
    }
    case 'start': {
      const ref = await resolveRef(rest[0] || '');
      const r = await post('/api/ws/start', { ref, at: str('at') });
      return out(r, () => console.log(`✔ ${ref} 开始计时 ${r.started_at}`));
    }
    case 'finish': {
      const ref = await resolveRef(rest[0] || '');
      const final = str('final-file') ? fs.readFileSync(path.resolve(str('final-file')!), 'utf8') : str('final');
      const usage: Record<string, number> = {};
      for (const k of ['wall-min', 'active-min', 'input-tokens', 'output-tokens', 'cache-read-tokens', 'cache-write-tokens', 'cost-usd']) if (num(k) != null) usage[k.replace(/-/g, '_')] = num(k)!;
      const transcript = str('transcript') ? JSON.parse(fs.readFileSync(path.resolve(str('transcript')!), 'utf8')) : undefined;
      const r = await post('/api/ws/finish', { ref, final_message: final, at: str('at'), usage: Object.keys(usage).length ? usage : undefined, timed_out: flags['timed-out'] ? true : undefined, transcript, register: !!flags.register, grade: !flags['no-grade'], fast: !!flags.fast });
      if (!JSON_OUT) console.log(`✔ ${ref} 结束 ${r.run.ended_at}${final ? ' · 已保存最后回复' : ' · ⚠ 未提供最后回复（诚信门槛将记 N/A）'}`);
      if (r.job) await maybeWait(r.job); else out(r, () => console.log(`下一步：wb run register ${ref}`));
      return;
    }
    case 'register': {
      const ref = await resolveRef(rest[0] || '');
      const job = await post<JobInfo>('/api/ws/register', { ref, grade: !flags['no-grade'], fast: !!flags.fast });
      const r = await maybeWait(job);
      if (r && !flags['no-grade'] && !flags['no-wait']) {
        // 登记后会自动排队评分任务：等待它完成
        const jobs = await get<JobInfo[]>('/api/jobs');
        const g = jobs.find((j) => j.kind === 'grade' && j.status !== 'done' && j.status !== 'failed');
        if (g) await maybeWait(g);
      }
      return;
    }
    default: die('用法：wb run new|list|start|finish|register …');
  }
}

main().catch((e) => die(e?.message || String(e)));
