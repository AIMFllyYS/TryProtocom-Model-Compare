// bench-workbench 本地服务：UI 静态资源 + REST API + SSE + 预览会话 + 进程/任务管理。
// 只监听 127.0.0.1；写操作需要 x-wb-token（启动时随机生成，写入 workbench/.runtime/runtime.json 供 CLI 使用）。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import type { Aggregate, SessionInfo, SpecData, SpecTask, StoreRun, WorkspaceRun } from '../shared/types';
import { aggregate } from '../shared/aggregate';
import { buildRunPrompt, reviewPrompt } from '../shared/prompt';
import { settleQuota } from '../shared/quota';
import { parseModelInput, suggestHarness, harnessByName, harnessById, iconFor } from '../shared/vendors';
import { detectHarnesses, openHarness, scanShell } from './harness';
import { loadConfig, PREVIEW_PORT_RANGE, VERSION, type Config } from './config';
import { listDir, readText, resolveSafe, sendRaw, toRel } from './fsapi';
import { EventHub, HttpError, mimeOf, readJson, Router, sendJson, type Req, type Res } from './http';
import { Jobs } from './jobs';
import { Previews } from './preview';
import { Procs } from './procs';
import { callBridge } from './python';
import { listReports, modelReport, writeModelReport } from './report';
import { StoreFile, stageLabel, trashEntryOf } from './store';
import { Workspaces } from './workspaces';

export interface StartedServer { cfg: Config; server: http.Server; url: string; close: () => Promise<void> }

export async function startServer(over: Partial<Config> = {}): Promise<StartedServer> {
  const cfg = loadConfig(over);
  const hub = new EventHub();
  const jobs = new Jobs(hub);
  const previews = new Previews(hub, PREVIEW_PORT_RANGE);
  const procs = new Procs(hub, previews);
  const ws = new Workspaces(cfg.modelDir);
  const store = new StoreFile(cfg.storeFile);
  const R = new Router();
  const startedAt = Date.now();
  const bench = path.join(cfg.graderDir, 'scripts', 'bench.py');
  const py = () => { if (!cfg.python) throw new HttpError(500, '未找到 Python 3'); return cfg.python; };

  // ---------- 规范数据 ----------
  let spec: SpecData | null = null;
  async function loadSpec(refresh = false): Promise<SpecData> {
    if (spec && !refresh) return spec;
    try {
      spec = { ...(await callBridge<SpecData>(cfg, ['spec'], 90000)), _source: 'python' };
      store.setSpec(spec);
      store.save();
    } catch (e) {
      if (store.data.spec) spec = { ...store.data.spec, _source: 'cache' };
      else {
        // 最后的退路：从旧版 benchmark-spec.html 中取出内嵌 JSON
        const html = fs.readFileSync(path.join(cfg.root, 'benchmark-spec.html'), 'utf8');
        const m = /<script id="spec" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
        if (!m) throw e;
        const d = JSON.parse(m[1].replace(/<\\\//g, '</'));
        spec = { ...d, config_full: d.cfg, _source: 'html' };
      }
    }
    return spec!;
  }

  // ---------- 汇总缓存 ----------
  let aggCache: { key: string; agg: Aggregate } | null = null;
  async function getAgg(): Promise<Aggregate> {
    const key = store.data.updated_at + ':' + store.data.runs.length;
    if (aggCache?.key === key) return aggCache.agg;
    const agg = aggregate(store.data.runs, await loadSpec());
    aggCache = { key, agg };
    return agg;
  }

  // ---------- 同步 ----------
  let syncing: Promise<unknown> | null = null;
  async function sync(): Promise<{ runs: number; models: number; workspaces: number }> {
    if (syncing) await syncing.catch(() => {});
    const p = (async () => {
      let snap: { runs: any[] } = { runs: [] };
      if (fs.existsSync(path.join(cfg.benchData, 'runs'))) snap = await callBridge(cfg, ['snapshot', '--data', cfg.benchData, '--root', cfg.root], 600000);
      store.syncFrom(snap.runs, ws.listModels(), ws.listRuns());
      store.log('sync', `同步 ${snap.runs.length} 次运行`);
      store.save();
      hub.emit({ type: 'store', updated_at: store.data.updated_at });
      return { runs: snap.runs.length, models: store.data.models.length, workspaces: store.data.workspaces.length };
    })();
    syncing = p;
    try { return await p; } finally { syncing = null; }
  }
  const refreshWorkspaces = () => {
    store.syncFrom([], ws.listModels(), ws.listRuns());
    store.save();
    hub.emit({ type: 'store', updated_at: store.data.updated_at });
  };

  const graderJob = (kind: Parameters<Jobs['submit']>[0]['kind'], title: string, args: string[], after?: Parameters<Jobs['submit']>[0]['after'], subject?: Parameters<Jobs['submit']>[0]['subject']) =>
    jobs.submit({ kind, title, cmd: py(), args: [bench, '--data', cfg.benchData, ...args], cwd: cfg.graderDir, after, subject });

  function gradeRuns(runDirs: string[] | 'all', opts: { fast?: boolean; skip?: boolean; task?: string; refs?: string[] } = {}) {
    const args = ['grade', ...(runDirs === 'all' ? ['--all'] : runDirs)];
    if (opts.fast) args.push('--fast');
    if (opts.skip) args.push('--skip-graded');
    if (opts.task) args.push('--task', opts.task);
    // 标出作用的运行，界面据此在卡片 / 详情页上显示“自动评分中”
    const ids = runDirs === 'all' ? store.data.runs.filter((r) => !opts.task || r.task === opts.task).map((r) => r.run_id) : runDirs.map((d) => path.basename(d));
    const refs = [...new Set([...(opts.refs || []), ...store.data.workspaces.filter((w) => w.grader_run_id && ids.includes(w.grader_run_id)).map((w) => w.ref)])];
    return graderJob('grade', runDirs === 'all' ? `评分：全部运行${opts.task ? ' · ' + opts.task : ''}` : `评分：${runDirs.map((d) => path.basename(d)).join(', ')}`, args, async () => sync(), { run_ids: ids, refs });
  }

  function registerWs(ref: string, opts: { grade?: boolean; fast?: boolean }) {
    const pr = ws.parseRef(ref);
    const w = ws.readRun(pr.vendor, pr.model, pr.tkey, pr.index);
    if (w.discarded) throw new HttpError(409, `${ref} 在回收站里，不参与评估；先恢复再登记`);
    if (w.grader_run_id && fs.existsSync(path.join(cfg.benchData, 'runs', w.grader_run_id))) throw new HttpError(409, `已登记为 ${w.grader_run_id}；如需重新登记请先在 run.json 清空 grader_run_id`);
    if (!w.harness) throw new HttpError(400, '请先填写 harness（例如 Claude Code / Codex CLI / Kiro）');
    const f = ws.files(ref);
    const src = w.deliverable_dir ? path.join(f.ws, w.deliverable_dir) : f.ws;
    if (!fs.existsSync(src)) throw new HttpError(400, `交付目录不存在：${toRel(cfg.root, src)}（模型应在工作目录下新建 ${w.deliverable_dir}/）`);
    const extra: Record<string, unknown> = { vendor: w.vendor, ws_ref: w.ref };
    if (w.usage && Object.keys(w.usage).length) extra.usage = w.usage;
    if (w.timed_out) extra.timed_out = true;
    const args = ['init-run', '--task', w.task, '--model', w.model, '--harness', w.harness, '--src', src, '--workspace', f.ws, '--run-index', String(w.index), '--extra', JSON.stringify(extra)];
    if (w.variant) args.push('--variant', w.variant);
    if (fs.existsSync(f.final)) args.push('--final-message', f.final);
    if (w.task === 'T06' && fs.existsSync(f.transcript)) args.push('--transcript', f.transcript);
    if (w.started_at) args.push('--started-at', w.started_at);
    if (w.ended_at) args.push('--ended-at', w.ended_at);
    return graderJob('register', `登记：${ref}`, args, async (code, lines) => {
      if (code !== 0) throw new Error('init-run 失败');
      const last = [...lines].reverse().find((l) => /runs[\\/][^\\/\s]+\s*$/.test(l.trim()));
      const rid = last ? path.basename(last.trim()) : null;
      if (!rid) throw new Error('无法从输出中解析运行 id');
      ws.patchRun(ref, { grader_run_id: rid });
      store.log('register', `${ref} → ${rid}`);
      // 登记期间被移进了回收站：刚生成的评分目录也一起放进回收站，不评分
      const now = ws.readRun(pr.vendor, pr.model, pr.tkey, pr.index);
      if (now.discarded) { moveGrader(rid, 'trash'); refreshWorkspaces(); return { run_id: rid, discarded: true }; }
      if (opts.grade) gradeRuns([path.join(cfg.benchData, 'runs', rid)], { fast: opts.fast, refs: [ref] });
      else await sync();
      return { run_id: rid };
    }, { refs: [ref] });
  }

  const openFolder = (p: string) => {
    const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [p], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  };

  // ---------- 提示词（统一运行约定） ----------
  const taskDirOf = (task: SpecTask) => spec?.materials_state?.[task.id]?.dir
    || path.join(cfg.graderDir, 'tasks', fs.readdirSync(path.join(cfg.graderDir, 'tasks')).find((d) => d.startsWith(task.id + '-')) || task.id);
  const findTask = async (id: unknown) => {
    const s = await loadSpec();
    const t = s.tasks.find((x) => x.id === String(id || '').toUpperCase());
    if (!t) throw new HttpError(404, `题目不存在：${id}`);
    return { s, t };
  };
  const settings = () => store.data.settings;
  const renderPrompt = (s: SpecData, t: SpecTask, variant: string | null, wsAbs: string | null, index: number | null) => buildRunPrompt(t.prompt, {
    bench: `${s.cfg.name} ${s.cfg.version}`, taskId: t.id, taskName: t.name, variant, runIndex: index, workspace: wsAbs,
    deliverableDir: t.deliverable, timeLimit: t.time_limit, materials: t.materials, condition: t.condition,
  }, { tts: settings().tts_command, header: settings().prompt_header !== false });
  /** 可以直接拿来用的运行：已创建、没开始、没交付、没登记 */
  const claimable = (vendor: string, model: string, tkey: string): WorkspaceRun | undefined => ws.listRuns().find((w) =>
    w.vendor === vendor && w.model === model && w.tkey === tkey && !w.discarded && !w.started_at && !w.grader_run_id && !w.detect?.dir_exists && !w.detect?.final);
  async function promptFor(q: { vendor?: string | null; model?: string | null; task: string; variant?: string | null }) {
    const { s, t } = await findTask(q.task);
    const variant = q.variant || null;
    if (Object.keys(t.variants || {}).length && !variant) throw new HttpError(400, `${t.id} 需要选择变体（${Object.keys(t.variants).join(' / ')}）`);
    if (!q.vendor || !q.model) return { ...renderPrompt(s, t, variant, null, null), ref: null, workspace: null, index: null, exists: false };
    const tkey = t.id + (variant || '');
    const cur = claimable(q.vendor, q.model, tkey);
    const index = cur ? cur.index : ws.nextIndex(q.vendor, q.model, tkey);
    const wsAbs = cur?.workspace || ws.wsPath(q.vendor, q.model, tkey, index);
    return { ...renderPrompt(s, t, variant, wsAbs, index), ref: `${q.vendor}/${q.model}/${tkey}/r${index}`, workspace: wsAbs, index, exists: !!cur };
  }
  // ---------- 预置素材：发车前保证齐全 ----------
  // 素材在“每次运行创建时”复制进 rN/（而不是新增模型时）：每次运行都要一份没被动过的副本（T08 会就地修改种子仓库）。
  // T03/T04 的音频由 build_materials.py 确定性生成，缺了就自动生成；仍然缺就拒绝发车，免得白跑一次。
  const buildScript = path.join(cfg.graderDir, 'scripts', 'build_materials.py');
  const GENERATED_TASKS = new Set(['T03', 'T04']);
  function missingMaterials(t: SpecTask): string[] {
    const dir = taskDirOf(t);
    const out: string[] = [];
    for (const raw of t.materials || []) {
      if (!raw.startsWith('materials/')) continue;
      const m = raw.split('（')[0].split('(')[0].trim();
      if (m.includes('*')) {
        const cut = m.lastIndexOf('/');
        const re = new RegExp('^' + m.slice(cut + 1).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
        let ok = false;
        try { ok = fs.readdirSync(path.join(dir, m.slice(0, cut))).some((f) => re.test(f)); } catch { /* 目录不存在 */ }
        if (!ok) out.push(m);
      } else if (!fs.existsSync(path.join(dir, m))) out.push(m);
    }
    return out;
  }
  let building: Promise<void> | null = null;
  async function ensureMaterials(t: SpecTask) {
    let miss = missingMaterials(t);
    if (!miss.length) return;
    let genErr = '';
    if (GENERATED_TASKS.has(t.id) && fs.existsSync(buildScript) && cfg.python) {
      building ||= new Promise<void>((resolve) => {
        execFile(cfg.python!, [buildScript], { cwd: cfg.graderDir, timeout: 180000, windowsHide: true, encoding: 'utf8' }, (err, _o, stderr) => {
          if (err) genErr = String(stderr || err.message).trim().split(/\r?\n/).slice(-2).join(' ');
          building = null;
          resolve();
        });
      });
      await building;
      miss = missingMaterials(t);
      store.log('materials', miss.length ? `生成素材后仍缺：${miss.join('、')}` : `已自动生成 ${t.id} 素材`);
      void loadSpec(true);
    }
    if (!miss.length) return;
    const where = path.join(taskDirOf(t), 'materials');
    const hint = GENERATED_TASKS.has(t.id)
      ? `自动生成没有成功${genErr ? `（${genErr}）` : ''}：请确认 Python 装了 numpy，再到「设置 → 评测机」点“生成素材”。`
      : `请把素材放进 ${where} 对应位置后再发车。`;
    throw new HttpError(409, `${t.id} 的预置素材不齐，已停止发车（缺素材的运行会作废）：${miss.join('、')}。${hint}`);
  }

  async function claimRun(b: { vendor: string; model: string; task: string; variant?: string | null; index?: number; start?: boolean; harness?: string; open?: boolean; quota_before?: number | null; quota_unit?: string }) {
    const { s, t } = await findTask(b.task);
    const variant = b.variant || null;
    const tkey = t.id + (variant || '');
    const prof = store.data.models.find((m) => m.vendor === b.vendor && m.name === b.model);
    const harness = b.harness || prof?.harness || harnessById(settings().default_harness)?.name || '';
    let run = claimable(b.vendor, b.model, tkey);
    if (!run || (b.index && run.index !== b.index)) {
      await ensureMaterials(t);
      run = ws.createRun({ vendor: b.vendor, model: b.model, task: t, variant, harness, taskDir: taskDirOf(t), index: b.index, prompt: (wsAbs, n) => renderPrompt(s, t, variant, wsAbs, n).text });
      store.log('ws-create', run.ref);
    } else if (harness && !run.harness) run = ws.patchRun(run.ref, { harness });
    if (b.start !== false && !run.started_at) run = ws.patchRun(run.ref, { started_at: new Date().toISOString(), ended_at: null });
    if (b.quota_before != null) run = applyQuota(run.ref, { before: Number(b.quota_before), unit: b.quota_unit });
    const text = fs.readFileSync(ws.files(run.ref).prompt, 'utf8');
    let opened: string | null = null;
    if (b.open) {
      await scanShell();
      const h = harnessByName(harness) || harnessById(settings().default_harness);
      if (h) { try { opened = openHarness(h.id, run.workspace || null).how; } catch (e) { opened = `未能打开：${(e as Error).message}`; } }
    }
    refreshWorkspaces();
    return { run, text, opened };
  }

  // ---------- skills 镜像到 .agents/skills（Agent 软件的约定位置；不含 hidden/） ----------
  const agentsSkills = path.join(cfg.root, '.agents', 'skills');
  function mirrorSkills(): { copied: number; dir: string } {
    let copied = 0;
    for (const name of ['bench-grader', 'bench-workbench']) {
      const src = path.join(cfg.root, 'skills', name);
      const dst = path.join(agentsSkills, name);
      if (!fs.existsSync(src)) continue;
      const walk = (a: string, b: string) => {
        fs.mkdirSync(b, { recursive: true });
        for (const e of fs.readdirSync(a, { withFileTypes: true })) {
          if (e.name === 'hidden' || e.name === '__pycache__' || e.name.endsWith('.pyc')) continue;
          const sa = path.join(a, e.name), sb = path.join(b, e.name);
          if (e.isDirectory()) walk(sa, sb);
          else {
            const st = fs.statSync(sa);
            let same = false;
            try { const tb = fs.statSync(sb); same = tb.size === st.size && tb.mtimeMs >= st.mtimeMs; } catch { /* */ }
            if (!same) { fs.copyFileSync(sa, sb); copied++; }
          }
        }
      };
      walk(src, dst);
    }
    fs.writeFileSync(path.join(agentsSkills, 'README.md'), '# .agents/skills\n\n由 Bench Workbench 自动从 `skills/` 镜像（不含 `hidden/`）。请修改 `skills/` 下的源文件，不要直接改这里。\n', 'utf8');
    return { copied, dir: agentsSkills };
  }
  try { mirrorSkills(); } catch (e) { console.error('[wb] skills 镜像失败：', (e as Error).message); }

  // ---------- 交付检测：轮询未登记运行的工作目录 ----------
  const fp = new Map<string, string>();
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
      } catch { /* 目录被删 */ changed = true; }
    }
    if (changed) refreshWorkspaces();
  };
  const detectTimer = setInterval(detectTick, 3000);
  detectTimer.unref();

  // ---------- 回收站：作废（彻底停止 / 删除）→ 不参与任何评估；可恢复；永久删除要单独确认 ----------
  // 工作区运行：作废标记写进 rN.run.json（文件夹原地保留，便于恢复）；
  // 已登记的 bench-grader 运行目录从 bench-data/runs/ 挪到 bench-data/trash/，Python 侧的汇总 / 导出 / 评分包也就看不到它。
  const graderTrash = path.join(cfg.benchData, 'trash');
  const RID = /^[\w.-]+$/;
  function moveGrader(rid: string, to: 'trash' | 'runs') {
    if (!RID.test(rid)) throw new HttpError(400, `运行 id 不合法：${rid}`);
    const live = path.join(cfg.benchData, 'runs', rid), bin = path.join(graderTrash, rid);
    const [src, dst] = to === 'trash' ? [live, bin] : [bin, live];
    if (!fs.existsSync(src)) return false;
    if (fs.existsSync(dst)) throw new HttpError(409, `目标已存在：${toRel(cfg.root, dst)}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { fs.renameSync(src, dst); } catch (e) { throw new HttpError(409, `评分目录被占用，暂时挪不动（${(e as NodeJS.ErrnoException).code || 'EBUSY'}）：关掉正在预览它的窗口后再试`); }
    return true;
  }
  const busyJob = (keys: (string | null | undefined)[]) => jobs.list.find((j) => (j.status === 'running' || j.status === 'queued') && keys.some((k) => k && jobs.info(j).title.includes(k)));
  /** 关掉工作目录里的开发服务器和预览窗口（它们会占着文件，也没必要再跑） */
  function releaseFolder(dir: string): { procs: number; previews: number } {
    const base = path.resolve(dir).toLowerCase();
    const inside = (p?: string | null) => !!p && (path.resolve(p).toLowerCase() + path.sep).startsWith(base + path.sep);
    let np = 0, nv = 0;
    for (const p of procs.all()) if (p.status === 'running' && inside(p.cwd)) { try { procs.stop(p.id); np++; } catch { /* 已退出 */ } }
    for (const s of previews.list()) if (s.kind === 'static' && inside(s.root)) { if (previews.close(s.id)) nv++; }
    return { procs: np, previews: nv };
  }

  async function discardRun(b: { ref?: string; run_id?: string; stop?: boolean; reason?: string }) {
    const at = new Date().toISOString();
    const stop = !!b.stop;
    let ref = b.ref || store.data.runs.find((r) => r.run_id === b.run_id)?.ws_ref || null;
    if (ref && !fs.existsSync(ws.files(ref).run) && !fs.existsSync(ws.files(ref).ws)) ref = null; // 工作区不在本机
    if (ref) {
      const pr = ws.parseRef(ref);
      const w = ws.readRun(pr.vendor, pr.model, pr.tkey, pr.index);
      if (w.discarded) return { ok: true, id: ref, already: true, released: { procs: 0, previews: 0 } };
      const j = busyJob([ref, w.grader_run_id]);
      if (j) throw new HttpError(409, `“${jobs.info(j).title}”还在进行，等它结束再作废`);
      const run = w.grader_run_id ? store.data.runs.find((r) => r.run_id === w.grader_run_id) : undefined;
      const released = releaseFolder(ws.files(ref).ws);
      if (w.grader_run_id) moveGrader(w.grader_run_id, 'trash');
      const setEnded = stop && !!w.started_at && !w.ended_at;
      ws.patchRun(ref, {
        discarded: { at, reason: b.reason || (stop ? '手动彻底停止' : '移入回收站'), stopped: stop, from: stageLabel(w, run), set_ended: setEnded || undefined },
        ...(setEnded ? { ended_at: at } : {}),
      });
      store.log(stop ? 'run-stop' : 'run-discard', `${ref}${b.reason ? ' · ' + b.reason : ''}`);
      refreshWorkspaces();
      return { ok: true, id: ref, released };
    }
    const run = store.data.runs.find((r) => r.run_id === b.run_id);
    if (!run) throw new HttpError(404, `运行不存在：${b.run_id || b.ref}`);
    const j = busyJob([run.run_id]);
    if (j) throw new HttpError(409, `“${jobs.info(j).title}”还在进行，等它结束再作废`);
    moveGrader(run.run_id, 'trash');
    const w = run.ws_ref ? store.data.workspaces.find((x) => x.ref === run.ws_ref) : undefined;
    const entry = trashEntryOf(w, run, { at, reason: b.reason || '移入回收站', stopped: false, from: stageLabel(w, run) });
    if (!w) entry.id = 'run:' + run.run_id;
    store.trashStoreOnly(entry);
    store.log('run-discard', `run ${run.run_id}`);
    store.save();
    hub.emit({ type: 'store', updated_at: store.data.updated_at });
    return { ok: true, id: entry.id, released: { procs: 0, previews: 0 } };
  }

  function restoreRun(id: string) {
    const t = (store.data.trash || []).find((x) => x.id === id);
    if (!t) throw new HttpError(404, `回收站里没有：${id}`);
    if (t.run_id) moveGrader(t.run_id, 'runs');
    if (t.ref && fs.existsSync(ws.files(t.ref).run)) {
      const pr = ws.parseRef(t.ref);
      const w = ws.readRun(pr.vendor, pr.model, pr.tkey, pr.index);
      ws.patchRun(t.ref, { discarded: null, ...(w.discarded?.set_ended ? { ended_at: null } : {}) });
    } else store.restoreStoreOnly(id);
    store.log('run-restore', id);
    refreshWorkspaces();
    return { ok: true, id };
  }

  function purgeTrash(ids: string[]) {
    const out: { id: string; removed: number }[] = [];
    for (const id of ids) {
      const t = (store.data.trash || []).find((x) => x.id === id);
      if (!t) continue; // 只能永久删除回收站里的条目：进行中 / 已评分的运行不会被这个接口误删
      let removed = 0;
      if (t.ref) { releaseFolder(ws.files(t.ref).ws); removed += ws.purgeRun(t.ref).length; }
      if (t.run_id && RID.test(t.run_id)) {
        const bin = path.join(graderTrash, t.run_id);
        if (fs.existsSync(bin)) { fs.rmSync(bin, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }); removed++; }
      }
      store.dropTrash([id]);
      store.log('run-purge', `${id}（${removed} 个文件/目录）`);
      out.push({ id, removed });
    }
    refreshWorkspaces();
    return { ok: true, purged: out };
  }

  // ======================= 路由 =======================
  R.get('/api/session', (): SessionInfo => ({
    version: VERSION, token: cfg.token, port: cfg.port, preview_ports: PREVIEW_PORT_RANGE, root: cfg.root, python: cfg.python, desktop: cfg.desktop, started_at: startedAt,
    paths: { model: cfg.modelDir, bench_data: cfg.benchData, store: cfg.storeFile, reports: cfg.reportsDir, grader: cfg.graderDir, skill: cfg.skillDir, agents_skills: agentsSkills },
    github: settings().github || 'https://github.com/AIMFllyYS/TryProtocom-Model-Compare',
  }));
  R.get('/api/health', () => ({ ok: true, version: VERSION, port: cfg.port, pid: process.pid }));
  R.get('/api/events', (req, res) => { hub.attach(res); return undefined; });
  R.get('/api/spec', async (req) => loadSpec(req.query.get('refresh') === '1'));
  R.get('/api/store', () => store.data);
  R.get('/api/aggregate', () => getAgg());
  R.post('/api/sync', () => sync());

  // 模型
  R.get('/api/models', () => store.data.models);
  R.post('/api/models', async (req) => {
    const b = await readJson(req);
    if (b.input && !b.name) {
      const p = parseModelInput(String(b.input));
      b.vendor = b.vendor || p.vendor;
      b.name = p.name;
    }
    if (!b.vendor) throw new HttpError(400, `无法从“${b.name}”推断供应商，请手动选择或输入“供应商/模型”`);
    if (!b.harness && !store.data.models.some((m) => m.vendor === b.vendor && m.name === b.name)) {
      await scanShell();
      const installed = detectHarnesses().filter((h) => h.installed).map((h) => h.id);
      b.harness = suggestHarness(b.vendor, installed, settings().default_harness)?.name || '';
    }
    const m = ws.upsertModel(b);
    store.log('model', `新增/更新模型 ${m.vendor}/${m.name}`);
    refreshWorkspaces();
    return m;
  });
  R.post('/api/models/report', async (req) => {
    const { vendor, name } = await readJson(req);
    const md = modelReport(store.data, await getAgg(), await loadSpec(), vendor, name);
    const agg = await getAgg();
    const dir = writeModelReport(cfg.modelDir, vendor, name, md, { board: agg.board.filter((b) => b.model === name), tasks: agg.tasks.filter((t) => t.entrant.startsWith(name + ' @ ')), generated_at: agg.generated_at });
    return { dir: toRel(cfg.root, dir), file: toRel(cfg.root, path.join(dir, 'REPORT.md')), markdown: md };
  });

  // 工作区
  R.get('/api/ws', () => store.data.workspaces);
  R.post('/api/ws/scan', () => { refreshWorkspaces(); return store.data.workspaces; });
  R.get('/api/ws/prompt', async (req) => {
    const q = req.query;
    const model = q.get('for') ? parseModelInput(q.get('for')!) : null;
    return promptFor({ task: q.get('task') || '', variant: q.get('variant'), vendor: model?.vendor || q.get('vendor'), model: model?.name || q.get('model') });
  });
  R.post('/api/ws/claim', async (req) => claimRun(await readJson(req)));
  R.post('/api/ws/create', async (req) => {
    const b = await readJson(req);
    const { s, t: task } = await findTask(b.task);
    const variant = b.variant || null;
    await ensureMaterials(task);
    const run = ws.createRun({ vendor: b.vendor, model: b.model, task, variant, harness: b.harness || '', taskDir: taskDirOf(task), prompt: (wsAbs, n) => renderPrompt(s, task, variant, wsAbs, n).text });
    const pr = { text: fs.readFileSync(ws.files(run.ref).prompt, 'utf8'), warnings: renderPrompt(s, task, variant, null, null).warnings };
    const warnings = [...pr.warnings];
    if (task.id === 'T06') warnings.push('T06 为有人值守：按 hidden/intent.md 回答模型提问，并在完成时填写 transcript_notes。');
    store.log('ws-create', run.ref);
    refreshWorkspaces();
    return { run, prompt: pr.text, warnings, workspace: run.workspace };
  });
  R.get('/api/ws/detect', () => { detectTick(); return store.data.workspaces.filter((w) => !w.grader_run_id).map((w) => ({ ref: w.ref, detect: w.detect, ended_at: w.ended_at, has_final: w.has_final, entry: w.entry })); });

  // 额度记录：开跑前 / 结束后剩余额度；结束时按模型计费方式折算费用写入用量（未手填费用时）
  const applyQuota = (ref: string, q: { before?: number | null; after?: number | null; unit?: string }) => {
    const pr = ws.parseRef(ref);
    const cur = ws.readRun(pr.vendor, pr.model, pr.tkey, pr.index);
    const now = new Date().toISOString();
    const quota = { ...(cur.quota || {}) };
    if (q.unit) quota.unit = q.unit;
    if (q.before !== undefined) { quota.before = q.before; quota.at_before = now; }
    if (q.after !== undefined) { quota.after = q.after; quota.at_after = now; }
    const prof = store.data.models.find((m) => m.vendor === cur.vendor && m.name === cur.model);
    const s = settleQuota(quota, prof?.billing);
    quota.used = s.used; quota.cost_usd = s.cost_usd;
    const patch: Partial<WorkspaceRun> = { quota };
    if (s.cost_usd != null && cur.usage?.cost_usd == null) patch.usage = { ...(cur.usage || {}), cost_usd: s.cost_usd, cost_estimated: true, source: 'quota' };
    return ws.patchRun(ref, patch);
  };
  R.post('/api/ws/quota', async (req) => { const b = await readJson(req); const r = applyQuota(b.ref, b); refreshWorkspaces(); return r; });

  // 截图（桌面宠物 / 桌面版）：保存到运行旁的 rN.shots/，作为评审证据
  R.post('/api/shots', async (req) => {
    const b = await readJson(req);
    const m = /^data:image\/png;base64,(.+)$/.exec(String(b.data || ''));
    if (!m) throw new HttpError(400, '需要 PNG data URL');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = b.ref ? `${ws.files(b.ref).ws}.shots` : path.join(cfg.runtimeDir, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${stamp}${b.label ? '-' + String(b.label).replace(/[^\w.-]+/g, '-').slice(0, 40) : ''}.png`);
    fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
    store.log('shot', toRel(cfg.root, file));
    return { path: toRel(cfg.root, file) };
  });

  // 桌面宠物：精简状态（避免宠物窗口拉取整个存储文件）+ 启动 / 退出
  R.get('/api/pet/feed', async () => {
    const agg = await getAgg();
    const s = await loadSpec();
    const cur = settings().current_model || '';
    const [cv, ...cm] = cur.split('/');
    const model = cm.join('/');
    const mine = store.data.workspaces.filter((w) => w.vendor === cv && w.model === model);
    const graded = new Set(store.data.runs.filter((r) => r.graded).map((r) => r.run_id));
    const brief = (w: WorkspaceRun) => ({ ref: w.ref, tkey: w.tkey, index: w.index, name: s.tasks.find((t) => t.id === w.task)?.name || w.task, vendor: w.vendor, model: w.model, harness: w.harness, started_at: w.started_at, ended_at: w.ended_at, detect: w.detect ? { done: w.detect.done, total: w.detect.total, final: w.detect.final } : null, quota: w.quota || null });
    const open = store.data.workspaces.filter((w) => !w.grader_run_id);
    return {
      at: Date.now(),
      current: cur ? { key: cur, vendor: cv, model, harness: store.data.models.find((m) => m.vendor === cv && m.name === model)?.harness || '', tasks: s.tasks.length, runs_per_task: s.cfg.runs_per_task, delivered: new Set(mine.filter((w) => w.grader_run_id || w.detect?.final || w.ended_at).map((w) => w.tkey + '/' + w.index)).size, graded: mine.filter((w) => w.grader_run_id && graded.has(w.grader_run_id)).length } : null,
      running: open.filter((w) => w.started_at && !w.ended_at && !w.detect?.final).map(brief),
      delivered: open.filter((w) => w.ended_at || w.detect?.final).map(brief),
      grading: store.data.runs.filter((r) => !r.graded).length,
      pending: agg.pending,
      jobs: jobs.list.filter((j) => j.status === 'running' || j.status === 'queued').map((j) => jobs.info(j).title),
      top: agg.board.slice(0, 3).map((b) => ({ entrant: b.entrant, quality: b.quality, rank: b.rank })),
    };
  });
  let petProc: ReturnType<typeof spawn> | null = null;
  const electronExe = () => {
    const p = path.join(cfg.root, 'workbench', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
    return fs.existsSync(p) ? p : null;
  };
  const petMain = path.join(cfg.root, 'workbench', 'desktop', 'app', 'pet.cjs');
  R.get('/api/pet', () => ({ available: !!electronExe() && fs.existsSync(petMain), running: !!petProc && petProc.exitCode == null }));
  R.post('/api/pet', async (req) => {
    const b = await readJson(req);
    if (b.action === 'quit') { petProc?.kill(); petProc = null; return { ok: true, running: false }; }
    if (petProc && petProc.exitCode == null) return { ok: true, running: true, already: true };
    const exe = electronExe();
    if (!exe) throw new HttpError(404, '未安装 Electron：在 workbench/ 下运行 npm install 后再召唤桌面宠物');
    if (!fs.existsSync(petMain)) throw new HttpError(404, '桌面宠物尚未构建：在 workbench/ 下运行 npm run build');
    // 宠物是独立的轻量进程（透明置顶小窗），只连接 127.0.0.1 上的本服务
    const env = { ...process.env, WB_URL: `http://127.0.0.1:${cfg.port}` } as NodeJS.ProcessEnv;
    delete env.ELECTRON_RUN_AS_NODE;
    petProc = spawn(exe, [petMain], { cwd: path.dirname(petMain), env, detached: true, stdio: 'ignore', windowsHide: false });
    petProc.on('exit', () => { petProc = null; });
    petProc.unref();
    return { ok: true, running: true };
  });

  // harness（Agent 软件）
  R.get('/api/harness', async (req) => { const force = req.query.get('refresh') === '1'; await scanShell(force); return detectHarnesses(force); });
  R.post('/api/harness/open', async (req) => {
    const b = await readJson(req);
    const cwd = b.ref ? ws.files(b.ref).ws : null;
    const id = b.id || harnessByName(b.name)?.id;
    await scanShell();
    return openHarness(id, cwd);
  });
  R.get('/api/models/infer', (req) => {
    const p = parseModelInput(req.query.get('name') || '');
    const installed = detectHarnesses().filter((h) => h.installed).map((h) => h.id);
    const h = suggestHarness(p.vendor, installed, settings().default_harness);
    const exists = store.data.models.some((m) => m.vendor === p.vendor && m.name === p.name);
    return { ...p, icon: iconFor(p.vendor, p.name), harness: h ? { id: h.id, name: h.name } : null, exists, vendors: ws.vendors() };
  });

  // AI 评审提示词（给评分 Agent）
  R.get('/api/review-prompt', async (req) => {
    const s = await loadSpec();
    const rid = req.query.get('run_id');
    const ref = req.query.get('ref');
    const agg = await getAgg();
    if (!rid && !ref) return { text: reviewPrompt({ root: cfg.root, bench: `${s.cfg.name} ${s.cfg.version}`, scope: 'all', pendingAgent: agg.pending.agent }) };
    const w = ref ? store.data.workspaces.find((x) => x.ref === ref) : store.data.workspaces.find((x) => x.grader_run_id === rid);
    const run = rid ? store.data.runs.find((r) => r.run_id === rid) : w?.grader_run_id ? store.data.runs.find((r) => r.run_id === w.grader_run_id) : undefined;
    const task = run?.task || w?.task || null;
    return { text: reviewPrompt({ root: cfg.root, bench: `${s.cfg.name} ${s.cfg.version}`, scope: { run_id: run?.run_id || w?.grader_run_id || rid, ref: w?.ref || ref, task, taskName: s.tasks.find((t) => t.id === task)?.name } }) };
  });

  // skills 镜像 / 源码下载
  R.post('/api/skills/sync', () => mirrorSkills());
  R.get('/api/source.zip', (req, res) => {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: cfg.root, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new HttpError(500, '当前目录不是 git 仓库，无法打包源码');
    const rev = r.stdout.trim();
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="TryProtocom-Model-Compare-${rev}.zip"` });
    // git archive 只打包已提交的文件：hidden/ 已被 .gitignore 排除，不会进入源码包
    const p = spawn('git', ['archive', '--format=zip', `--prefix=TryProtocom-Model-Compare/`, 'HEAD'], { cwd: cfg.root, windowsHide: true });
    p.stdout.pipe(res);
    p.on('error', () => res.end());
    return undefined;
  });
  const liveRun = (ref: string) => {
    const pr = ws.parseRef(ref);
    const w = ws.readRun(pr.vendor, pr.model, pr.tkey, pr.index);
    if (w.discarded) throw new HttpError(409, `${ref} 在回收站里；先在「运行 → 回收站」恢复它`);
    return w;
  };
  R.post('/api/ws/start', async (req) => {
    const b = await readJson(req);
    liveRun(b.ref);
    const r = ws.patchRun(b.ref, { started_at: b.at || new Date().toISOString(), ended_at: null });
    refreshWorkspaces();
    return r;
  });
  R.post('/api/ws/finish', async (req) => {
    const b = await readJson(req);
    liveRun(b.ref);
    if (typeof b.final_message === 'string' && b.final_message.trim()) ws.writeFinal(b.ref, b.final_message);
    if (b.transcript) ws.writeTranscript(b.ref, b.transcript);
    const patch: any = { ended_at: b.at || new Date().toISOString() };
    if (b.usage) patch.usage = b.usage;
    if (b.timed_out != null) patch.timed_out = !!b.timed_out;
    const r = ws.patchRun(b.ref, patch);
    if (b.quota_after != null) applyQuota(b.ref, { after: Number(b.quota_after), unit: b.quota_unit });
    refreshWorkspaces();
    let job = null;
    if (b.register) job = registerWs(b.ref, { grade: b.grade !== false, fast: !!b.fast });
    return { run: r, job };
  });
  R.post('/api/ws/patch', async (req) => {
    const { discarded: _d, ...b } = await readJson(req); // 作废 / 恢复只走回收站接口（要同时挪动评分目录）
    if (typeof b.final_message === 'string') ws.writeFinal(b.ref, b.final_message);
    const r = ws.patchRun(b.ref, b);
    refreshWorkspaces();
    return r;
  });

  // 回收站
  R.get('/api/trash', () => store.data.trash || []);
  R.post('/api/runs/discard', async (req) => {
    const b = await readJson(req);
    if (!b.ref && !b.run_id) throw new HttpError(400, '需要 ref（供应商/模型/题号/rN）或 run_id');
    return discardRun({ ref: b.ref, run_id: b.run_id, stop: !!b.stop, reason: typeof b.reason === 'string' ? b.reason.slice(0, 200) : undefined });
  });
  R.post('/api/runs/restore', async (req) => { const b = await readJson(req); return restoreRun(String(b.id || b.ref || (b.run_id ? 'run:' + b.run_id : ''))); });
  R.post('/api/trash/purge', async (req) => {
    const b = await readJson(req);
    // 永久删除必须显式确认：界面在二次确认后才发送 confirm: 'purge'
    if (b.confirm !== 'purge') throw new HttpError(400, '永久删除需要 confirm: "purge"（删除后无法恢复）');
    const ids: string[] = b.all ? (store.data.trash || []).map((t) => t.id) : Array.isArray(b.ids) ? b.ids.map(String) : [];
    if (!ids.length) throw new HttpError(400, '没有要删除的条目');
    return purgeTrash(ids);
  });
  R.get('/api/ws/final', (req) => {
    const f = ws.files(req.query.get('ref') || '');
    return { text: fs.existsSync(f.final) ? fs.readFileSync(f.final, 'utf8') : '', prompt: fs.existsSync(f.prompt) ? fs.readFileSync(f.prompt, 'utf8') : '' };
  });
  R.post('/api/ws/register', async (req) => {
    const b = await readJson(req);
    return registerWs(b.ref, { grade: b.grade !== false, fast: !!b.fast });
  });
  R.post('/api/open-folder', async (req) => {
    const b = await readJson(req);
    const p = b.ref ? ws.files(b.ref).ws : resolveSafe(cfg.root, b.path || '');
    if (!fs.existsSync(p)) throw new HttpError(404, '目录不存在');
    openFolder(p);
    return { ok: true, path: p };
  });

  // 运行（bench-grader）
  R.get('/api/runs', () => store.data.runs);
  R.get('/api/runs/:id', async (req) => {
    const run = store.data.runs.find((r) => r.run_id === req.params.id);
    if (!run) throw new HttpError(404, '运行不存在');
    const rd = path.join(cfg.benchData, 'runs', run.run_id);
    const metrics = fs.existsSync(path.join(rd, 'metrics.json')) ? JSON.parse(fs.readFileSync(path.join(rd, 'metrics.json'), 'utf8')) : null;
    const final = fs.existsSync(path.join(rd, 'final_message.md')) ? fs.readFileSync(path.join(rd, 'final_message.md'), 'utf8') : null;
    return { run, metrics, final_message: final, local: fs.existsSync(rd) };
  });
  R.post('/api/runs/:id/manual', async (req) => {
    const b = await readJson(req);
    const rid = req.params.id;
    const items: { item: string; score: number | '' | null; note?: string }[] = Array.isArray(b.items) ? b.items : [{ item: b.item, score: b.score, note: b.note }];
    let last: any = null;
    for (const it of items) {
      last = await callBridge(cfg, ['set-manual', '--data', cfg.benchData, '--root', cfg.root, '--run', rid, '--item', it.item, '--score', it.score == null ? '' : String(it.score), '--note', it.note || '', '--by', b.by || 'human']);
    }
    const cur = store.data.runs.find((r) => r.run_id === rid);
    if (cur && last) {
      store.updateRun({ ...cur, score: last.score, manual: last.manual, graded: last.graded, synced_at: new Date().toISOString() } as StoreRun);
      store.save();
      hub.emit({ type: 'store', updated_at: store.data.updated_at });
    }
    return { ok: true, score: last?.score, manual: last?.manual };
  });

  // 任务
  R.get('/api/jobs', () => jobs.list.map((j) => jobs.info(j)));
  R.get('/api/jobs/:id', (req) => {
    const j = jobs.get(req.params.id);
    if (!j) throw new HttpError(404, '任务不存在');
    return { ...jobs.info(j), output: jobs.output(j.id, Number(req.query.get('from') || 0)) };
  });
  R.get('/api/jobs/:id/wait', async (req) => {
    const info = await jobs.wait(req.params.id);
    return { ...info, output: jobs.output(info.id, Number(req.query.get('from') || 0)) };
  });
  R.post('/api/jobs/:id/cancel', (req) => ({ ok: jobs.cancel(req.params.id) }));
  R.post('/api/jobs', async (req) => {
    const b = await readJson(req);
    switch (b.kind) {
      case 'grade': {
        const ids: string[] = b.runs || [];
        if (b.all || !ids.length) return gradeRuns('all', { fast: b.fast, skip: b.skip_graded, task: b.task });
        return gradeRuns(ids.map((id) => path.join(cfg.benchData, 'runs', id)), { fast: b.fast, skip: b.skip_graded });
      }
      case 'review': return graderJob('review', '生成评分包（人工/agent/用量）', ['review', ...(b.task ? ['--task', b.task] : [])], async () => sync());
      case 'export': {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
        const out = path.join(cfg.reportsDir, `${stamp}-${(b.label || 'leaderboard').replace(/[^\w.-]+/g, '-')}`);
        return graderJob('aggregate', 'bench-grader 汇总', ['aggregate'], () => {
          graderJob('export', `导出报表 → ${toRel(cfg.root, out)}`, ['export', '--formats', b.formats || 'csv,md,xlsx,png,html', '--out', out], () => {
            fs.mkdirSync(out, { recursive: true });
            fs.copyFileSync(cfg.storeFile, path.join(out, 'bench-store.snapshot.json'));
            return { dir: toRel(cfg.root, out) };
          });
          return null;
        });
      }
      case 'doctor': return jobs.submit({ kind: 'doctor', title: '评测机依赖检查（doctor）', cmd: py(), args: [bench, 'doctor'], cwd: cfg.graderDir });
      case 'validate': return jobs.submit({ kind: 'validate', title: 'rubric 自检', cmd: py(), args: [bench, 'validate-rubrics'], cwd: cfg.graderDir });
      case 'materials': return jobs.submit({ kind: 'materials', title: '生成 T03/T04 统一素材', cmd: py(), args: [path.join(cfg.graderDir, 'scripts', 'build_materials.py')], cwd: cfg.graderDir, after: async () => { await loadSpec(true); return null; } });
      case 'build-spec': return jobs.submit({ kind: 'build-spec', title: '重新生成 benchmark-spec.html', cmd: py(), args: [bench, 'build-spec', '--out', path.join(cfg.root, 'benchmark-spec.html')], cwd: cfg.graderDir, after: async () => { await loadSpec(true); return null; } });
      case 'npm-install': {
        const cwd = resolveSafe(cfg.root, b.cwd);
        return jobs.submit({ kind: 'npm-install', title: `npm install · ${toRel(cfg.root, cwd)}`, cmd: 'npm install --no-audit --no-fund', args: [], cwd, shell: true });
      }
      case 'sync': { const r = await sync(); return { id: 'sync', kind: 'sync', status: 'done', result: r }; }
      default: throw new HttpError(400, `未知任务类型：${b.kind}`);
    }
  });

  // 预览
  R.get('/api/preview', () => previews.list());
  R.post('/api/preview', async (req) => {
    const b = await readJson(req);
    if (b.kind === 'proxy' || b.target) return previews.createProxy({ target: b.target, label: b.label });
    if (b.kind === 'url' || b.url) return previews.createUrl({ url: b.url, label: b.label });
    // static：path = 仓库内文件或目录（相对根目录），或 ref + entry（工作区内）
    let abs: string;
    if (b.ref) abs = path.join(ws.files(b.ref).ws, b.entry || '');
    else abs = resolveSafe(cfg.root, b.path || '');
    if (!fs.existsSync(abs)) throw new HttpError(404, `不存在：${toRel(cfg.root, abs)}`);
    const isDirP = fs.statSync(abs).isDirectory();
    const root = b.root ? resolveSafe(cfg.root, b.root) : isDirP ? abs : path.dirname(abs);
    const entry = isDirP ? '' : path.relative(root, abs).split(path.sep).join('/');
    return previews.createStatic({ root, entry, label: b.label || toRel(cfg.root, abs), inject: b.inject !== false });
  });
  R.del('/api/preview/:id', (req) => ({ ok: previews.close(req.params.id) }));
  R.get('/api/preview/:id', (req) => previews.public(previews.get(req.params.id)));
  R.get('/api/preview/:id/logs', (req) => {
    const lv = req.query.get('levels');
    return previews.logs(req.params.id, Number(req.query.get('since') || 0), lv ? lv.split(',') : undefined);
  });
  R.get('/api/preview/:id/requests', (req) => previews.requests(req.params.id, Number(req.query.get('since') || 0)));
  R.post('/api/preview/:id/logs', async (req) => { previews.addLogs(req.params.id, (await readJson(req)).entries || []); return { ok: true }; });
  R.post('/api/preview/:id/clear', (req) => { previews.clear(req.params.id); return { ok: true }; });

  // 开发服务器进程
  R.get('/api/procs', () => procs.all());
  R.post('/api/procs', async (req) => {
    const b = await readJson(req);
    const cwd = b.ref ? path.join(ws.files(b.ref).ws, b.sub || '') : resolveSafe(cfg.root, b.cwd || '');
    return procs.start({ cwd, cmd: b.cmd, name: b.name, env: b.env, autoPreview: b.autoPreview });
  });
  R.get('/api/procs/:id/output', (req) => procs.output(req.params.id, Number(req.query.get('from') || 0)));
  R.post('/api/procs/:id/stop', (req) => procs.stop(req.params.id));
  R.del('/api/procs/:id', (req) => { procs.remove(req.params.id); return { ok: true }; });
  R.get('/api/scripts', (req) => {
    // 读取目录下 package.json 的 scripts，给“启动开发服务器”用
    const dir = req.query.get('ref') ? path.join(ws.files(req.query.get('ref')!).ws, req.query.get('sub') || '') : resolveSafe(cfg.root, req.query.get('cwd') || '');
    const found: { dir: string; scripts: Record<string, string>; has_modules: boolean }[] = [];
    const scan = (d: string, depth: number) => {
      if (depth > 2 || !fs.existsSync(d)) return;
      const pj = path.join(d, 'package.json');
      if (fs.existsSync(pj)) {
        try { found.push({ dir: toRel(cfg.root, d), scripts: JSON.parse(fs.readFileSync(pj, 'utf8')).scripts || {}, has_modules: fs.existsSync(path.join(d, 'node_modules')) }); } catch { /* */ }
      }
      for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !['node_modules', '.git', 'dist'].includes(e.name) && !e.name.startsWith('.')) scan(path.join(d, e.name), depth + 1);
    };
    scan(dir, 0);
    const pyApps = ['app.py', 'server.py', 'main.py'].filter((f) => fs.existsSync(path.join(dir, f)));
    return { packages: found, python: pyApps, bench_json: fs.existsSync(path.join(dir, 'bench.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'bench.json'), 'utf8')) : null };
  });

  // 无头探测（CLI / Agent 读取页面报错 + 截图）
  R.post('/api/probe', async (req) => {
    const b = await readJson(req);
    let url: string = b.url;
    if (b.session) url = previews.public(previews.get(b.session)).url;
    if (!url) throw new HttpError(400, '需要 url 或 session');
    const shot = path.join(cfg.runtimeDir, 'shots', `shot-${Date.now()}.png`);
    const args = ['probe-page', '--url', url, '--viewport', b.viewport || '1440x900', '--wait', String(b.wait ?? 2500), '--shot', shot];
    if (b.mobile) args.push('--mobile');
    if (b.full) args.push('--full');
    const r: any = await callBridge(cfg, args, 120000);
    if (r.screenshot) r.screenshot = toRel(cfg.root, r.screenshot);
    return r;
  });

  // UI 遥控（CLI → 界面）
  R.post('/api/ui', async (req) => { const b = await readJson(req); hub.emit({ type: 'ui', action: b.action, params: b.params || {} }); return { ok: true, clients: hub.clients.size }; });

  // 存储导入导出 / 设置 / 笔记
  R.get('/api/store/export', (req, res) => {
    store.save();
    const name = `bench-store-${new Date().toISOString().slice(0, 10)}.json`;
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` });
    fs.createReadStream(cfg.storeFile).pipe(res);
    return undefined;
  });
  R.post('/api/store/import', async (req) => {
    const b = await readJson(req);
    const stat = store.importFrom(b);
    store.save();
    hub.emit({ type: 'store', updated_at: store.data.updated_at });
    return stat;
  });
  R.post('/api/settings', async (req) => {
    const b = await readJson(req);
    store.data.settings = { ...store.data.settings, ...b };
    store.save();
    hub.emit({ type: 'store', updated_at: store.data.updated_at });
    return store.data.settings;
  });
  R.post('/api/notes', async (req) => {
    const b = await readJson(req);
    const n = { id: `n${Date.now().toString(36)}`, target: String(b.target || ''), text: String(b.text || ''), at: new Date().toISOString() };
    store.data.notes.unshift(n);
    store.save();
    hub.emit({ type: 'store', updated_at: store.data.updated_at });
    return n;
  });
  R.del('/api/notes/:id', (req) => {
    store.data.notes = store.data.notes.filter((n) => n.id !== req.params.id);
    store.save();
    hub.emit({ type: 'store', updated_at: store.data.updated_at });
    return { ok: true };
  });
  R.get('/api/reports', () => listReports(cfg.reportsDir));

  // 文件
  R.get('/api/fs/list', (req) => listDir(cfg.root, req.query.get('path') || ''));
  R.get('/api/fs/read', (req) => readText(cfg.root, req.query.get('path') || ''));
  R.get('/api/fs/raw', (req, res) => { sendRaw(cfg.root, req.query.get('path') || '', req, res, req.query.get('download') === '1'); return undefined; });

  R.post('/api/shutdown', () => { setTimeout(() => { void close().then(() => process.exit(0)); }, 50); return { ok: true }; });

  // ======================= HTTP =======================
  const ownOrigins = new Set([`http://127.0.0.1:${cfg.port}`, `http://localhost:${cfg.port}`]);
  const server = http.createServer(async (rq, res) => {
    const req = rq as Req;
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    req.query = u.searchParams; req.pathname = u.pathname;
    try {
      if (u.pathname.startsWith('/api/')) {
        const host = String(req.headers.host || '').toLowerCase();
        if (host && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) throw new HttpError(403, '拒绝非本机 Host');
        const origin = req.headers.origin;
        if (origin && !ownOrigins.has(origin) && origin !== 'null' && !origin.startsWith('file://')) throw new HttpError(403, '拒绝跨源请求');
        const m = R.match(req.method || 'GET', u.pathname);
        if (!m) throw new HttpError(404, `接口不存在：${req.method} ${u.pathname}`);
        if (!m.route.open && req.headers['x-wb-token'] !== cfg.token) throw new HttpError(401, '缺少或错误的 x-wb-token');
        req.params = m.params;
        const out = await m.route.fn(req, res);
        if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
        return;
      }
      serveWeb(u.pathname, res);
    } catch (e) {
      const err = e as HttpError;
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message || String(e) });
      else res.end();
    }
  });

  function serveWeb(pathname: string, res: Res) {
    const dist = cfg.webDist;
    let p = path.resolve(dist, '.' + decodeURIComponent(pathname));
    if (!p.startsWith(path.resolve(dist)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dist, 'index.html');
    if (!fs.existsSync(p)) {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<meta charset="utf-8"><p style="font:15px system-ui;padding:30px">前端尚未构建：在 workbench/ 下运行 <code>npm run build</code>，或双击根目录 Start-Workbench.cmd。</p>');
      return;
    }
    const immutable = p.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, { 'content-type': mimeOf(p), 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-frame-options': 'SAMEORIGIN' });
    fs.createReadStream(p).pipe(res);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  const url = `http://127.0.0.1:${cfg.port}`;
  fs.writeFileSync(path.join(cfg.runtimeDir, 'runtime.json'), JSON.stringify({ url, port: cfg.port, token: cfg.token, pid: process.pid, started_at: startedAt, version: VERSION }, null, 2));
  // 启动后后台同步一次（Python 首次导入较慢，不阻塞启动）
  void loadSpec().then(() => sync()).catch((e) => console.error('[wb] 初次同步失败：', e.message));

  async function close() {
    procs.stopAll();
    previews.closeAll();
    for (const c of hub.clients) c.end();
    try { fs.unlinkSync(path.join(cfg.runtimeDir, 'runtime.json')); } catch { /* */ }
    await new Promise<void>((r) => server.close(() => r()));
  }
  return { cfg, server, url, close };
}

// 作为独立进程运行：node dist-node/server.cjs [--open]（被桌面版打包进 Electron 主进程时不自动启动）
if (require.main === module && !process.versions.electron) {
  startServer().then(({ url, cfg, close }) => {
    console.log(`\n  Bench Workbench ${VERSION}\n  ▶ ${url}\n  根目录  ${cfg.root}\n  Python  ${cfg.python || '未找到'}\n  按 Ctrl+C 退出\n`);
    if (process.argv.includes('--open')) {
      const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    }
    const bye = () => { void close().then(() => process.exit(0)); };
    process.on('SIGINT', bye); process.on('SIGTERM', bye);
  }).catch((e) => {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') console.error(`端口已被占用：可能工作台已在运行（打开 http://127.0.0.1:${process.env.WB_PORT || 41873}），或设置 WB_PORT 换端口。`);
    else console.error(e);
    process.exit(1);
  });
}
