// bench-workbench 本地服务：UI 静态资源 + REST API + SSE + 预览会话 + 进程/任务管理。
// 只监听 127.0.0.1；写操作需要 x-wb-token（启动时随机生成，写入 workbench/.runtime/runtime.json 供 CLI 使用）。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Aggregate, SessionInfo, SpecData, StoreRun } from '../shared/types';
import { aggregate } from '../shared/aggregate';
import { buildPrompt } from '../shared/prompt';
import { loadConfig, PREVIEW_PORT_RANGE, VERSION, type Config } from './config';
import { listDir, readText, resolveSafe, sendRaw, toRel } from './fsapi';
import { EventHub, HttpError, mimeOf, readJson, Router, sendJson, type Req, type Res } from './http';
import { Jobs } from './jobs';
import { Previews } from './preview';
import { Procs } from './procs';
import { callBridge } from './python';
import { listReports, modelReport, writeModelReport } from './report';
import { StoreFile } from './store';
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

  const graderJob = (kind: Parameters<Jobs['submit']>[0]['kind'], title: string, args: string[], after?: Parameters<Jobs['submit']>[0]['after']) =>
    jobs.submit({ kind, title, cmd: py(), args: [bench, '--data', cfg.benchData, ...args], cwd: cfg.graderDir, after });

  function gradeRuns(runDirs: string[] | 'all', opts: { fast?: boolean; skip?: boolean; task?: string } = {}) {
    const args = ['grade', ...(runDirs === 'all' ? ['--all'] : runDirs)];
    if (opts.fast) args.push('--fast');
    if (opts.skip) args.push('--skip-graded');
    if (opts.task) args.push('--task', opts.task);
    return graderJob('grade', runDirs === 'all' ? `评分：全部运行${opts.task ? ' · ' + opts.task : ''}` : `评分：${runDirs.map((d) => path.basename(d)).join(', ')}`, args, async () => sync());
  }

  function registerWs(ref: string, opts: { grade?: boolean; fast?: boolean }) {
    const pr = ws.parseRef(ref);
    const w = ws.readRun(pr.vendor, pr.model, pr.tkey, pr.index);
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
      if (opts.grade) gradeRuns([path.join(cfg.benchData, 'runs', rid)], { fast: opts.fast });
      else await sync();
      return { run_id: rid };
    });
  }

  const openFolder = (p: string) => {
    const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [p], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  };

  // ======================= 路由 =======================
  R.get('/api/session', (): SessionInfo => ({
    version: VERSION, token: cfg.token, port: cfg.port, preview_ports: PREVIEW_PORT_RANGE, root: cfg.root, python: cfg.python, desktop: cfg.desktop, started_at: startedAt,
    paths: { model: cfg.modelDir, bench_data: cfg.benchData, store: cfg.storeFile, reports: cfg.reportsDir, grader: cfg.graderDir, skill: cfg.skillDir },
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
    const s = await loadSpec();
    const task = s.tasks.find((t) => t.id === req.query.get('task'));
    if (!task) throw new HttpError(404, '题目不存在');
    return buildPrompt(task.prompt, task.id, req.query.get('variant') || null, { tts: store.data.settings.tts_command });
  });
  R.post('/api/ws/create', async (req) => {
    const b = await readJson(req);
    const s = await loadSpec();
    const task = s.tasks.find((t) => t.id === b.task);
    if (!task) throw new HttpError(400, `题目不存在：${b.task}`);
    const pr = buildPrompt(task.prompt, task.id, b.variant || null, { tts: store.data.settings.tts_command });
    const taskDir = s.materials_state?.[task.id]?.dir || path.join(cfg.graderDir, 'tasks', fs.readdirSync(path.join(cfg.graderDir, 'tasks')).find((d) => d.startsWith(task.id + '-')) || task.id);
    const run = ws.createRun({ vendor: b.vendor, model: b.model, task, variant: b.variant || null, harness: b.harness || '', taskDir, prompt: pr.text });
    const warnings = [...pr.warnings, ...(s.materials_state?.[task.id]?.missing || []).map((m) => `素材缺失：${m}（先在「系统」运行“生成素材”）`)];
    if (task.id === 'T02') warnings.push('T02 需要把用户提供的 minecraft-stop-motion-director skill 复制到工作目录的 skills/ 下。');
    if (task.id === 'T06') warnings.push('T06 为有人值守：按 hidden/intent.md 回答模型提问，并在完成时填写 transcript_notes。');
    store.log('ws-create', run.ref);
    refreshWorkspaces();
    return { run, prompt: pr.text, warnings, workspace: run.workspace };
  });
  R.post('/api/ws/start', async (req) => {
    const b = await readJson(req);
    const r = ws.patchRun(b.ref, { started_at: b.at || new Date().toISOString(), ended_at: null });
    refreshWorkspaces();
    return r;
  });
  R.post('/api/ws/finish', async (req) => {
    const b = await readJson(req);
    if (typeof b.final_message === 'string' && b.final_message.trim()) ws.writeFinal(b.ref, b.final_message);
    if (b.transcript) ws.writeTranscript(b.ref, b.transcript);
    const patch: any = { ended_at: b.at || new Date().toISOString() };
    if (b.usage) patch.usage = b.usage;
    if (b.timed_out != null) patch.timed_out = !!b.timed_out;
    const r = ws.patchRun(b.ref, patch);
    refreshWorkspaces();
    let job = null;
    if (b.register) job = registerWs(b.ref, { grade: b.grade !== false, fast: !!b.fast });
    return { run: r, job };
  });
  R.post('/api/ws/patch', async (req) => {
    const b = await readJson(req);
    if (typeof b.final_message === 'string') ws.writeFinal(b.ref, b.final_message);
    const r = ws.patchRun(b.ref, b);
    refreshWorkspaces();
    return r;
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
