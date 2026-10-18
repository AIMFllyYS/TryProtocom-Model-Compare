// 一次性自测：node --test（由 esbuild 打包后运行，不启动任何服务）
import test from 'node:test';
import assert from 'node:assert/strict';
import { inferVendor, parseModelInput, iconFor, suggestHarness, harnessGroup } from '../shared/vendors';
import { runHeader, buildRunPrompt, reviewPrompt } from '../shared/prompt';
import { DELIVERABLES, evalDeliverable } from '../shared/deliverables';
import { settleQuota, unitPrice } from '../shared/quota';
import { activityOf, activityOfJob, isBusy, FAIL_WINDOW, parseProgress, petJobs } from '../shared/activity';
import type { JobInfo } from '../shared/types';
import type { StoreRun, WorkspaceRun, SpecTask } from '../shared/types';
import { bestArtifactRun, artifactTaskKeys, artifactChoices, workspaceForRun } from '../shared/artifact-selection';

test('产物对比：最高分、同分较早轮次、零分、未评分与 harness/变体隔离', () => {
  const run = (id: string, total: number | null, index: number, extra: Partial<StoreRun> = {}) => ({ run_id: id, entrant: 'M @ H', tkey: 'T03A', run_index: index, score: total == null ? null : { total }, ...extra } as StoreRun);
  const runs = [run('r3', 90, 3), run('r1', 70, 1), run('r2', 90, 2), run('other-harness', 100, 1, { entrant: 'M @ Other' }), run('variant-c', 100, 1, { tkey: 'T03C' })];
  assert.equal(bestArtifactRun(runs, 'M @ H', 'T03A')?.run_id, 'r2');
  assert.equal(bestArtifactRun([run('ungraded', null, 1), run('zero', 0, 2)], 'M @ H', 'T03A')?.run_id, 'zero');
  assert.equal(bestArtifactRun([run('ungraded', null, 1), run('invalid', NaN, 2)], 'M @ H', 'T03A'), undefined);
  assert.deepEqual(runs.map((r) => r.run_id), ['r3', 'r1', 'r2', 'other-harness', 'variant-c']);
});

test('产物目录：全部题目顺序、变体分行、工作区关联去重、作废排除', () => {
  const tasks = [{ id: 'T03', variants: { C: {}, A: {} } }, { id: 'T02', variants: {} }, { id: 'T01', variants: {} }] as SpecTask[];
  assert.deepEqual(artifactTaskKeys(tasks, ['T08', 'T02']), ['T01', 'T02', 'T03A', 'T03C', 'T08']);
  const ws = [{ ref: 'V/M/T01/r1', grader_run_id: 'one' }, { ref: 'V/M/T02/r1', grader_run_id: null }, { ref: 'discarded', discarded: { at: 'today' } }] as WorkspaceRun[];
  const runs = [{ run_id: 'one', ws_ref: null }, { run_id: 'two', ws_ref: 'V/M/T02/r1' }, { run_id: 'orphan' }] as StoreRun[];
  assert.equal(workspaceForRun(runs[0], ws), ws[0]);
  assert.equal(workspaceForRun(runs[1], ws), ws[1]);
  assert.deepEqual(artifactChoices(ws, runs).map((e) => e.key), ['ws:V/M/T01/r1', 'ws:V/M/T02/r1', 'run:orphan']);
});

test('供应商推断', () => {
  const cases: [string, string | null][] = [['GPT-6.1-Sol', 'OpenAI'], ['o4-mini', 'OpenAI'], ['claude-opus-5.5', 'Anthropic'], ['Gemini-3.5-Pro', 'Google'], ['DeepSeek-V4', 'DeepSeek'],
    ['Qwen4-Coder', 'Alibaba'], ['GLM-5', 'Zhipu'], ['Kimi-K3', 'Moonshot'], ['grok-5', 'xAI'], ['Doubao-Seed-2', 'ByteDance'], ['MiniMax-M3', 'MiniMax'], ['MiMo-2', 'Xiaomi'], ['foo-bar', null]];
  for (const [n, v] of cases) assert.equal(inferVendor(n)?.id ?? null, v, n);
  assert.deepEqual(parseModelInput('OpenAI/GPT-6.1-Sol'), { vendor: 'OpenAI', name: 'GPT-6.1-Sol', inferred: false });
  assert.deepEqual(parseModelInput('claude-opus-5.5'), { vendor: 'Anthropic', name: 'claude-opus-5.5', inferred: true });
  assert.equal(iconFor('Anthropic', 'claude-opus-5.5'), 'claude');
  assert.equal(iconFor('OpenAI', 'GPT-6.1-Sol'), 'openai');
});

test('harness 推荐', () => {
  assert.equal(suggestHarness('OpenAI', ['deepseek-harness', 'claude-code'])?.id, 'deepseek-harness');
  assert.equal(suggestHarness('Anthropic', ['deepseek-harness', 'claude-code'])?.id, 'claude-code');
  assert.equal(suggestHarness('Anthropic', ['deepseek-harness', 'claude-code'], 'deepseek-harness')?.id, 'deepseek-harness');
  assert.equal(suggestHarness('X', [])?.id ?? null, null);
});

test('运行约定头', () => {
  const h = runHeader({ bench: 'Coding Bench v1.0', taskId: 'T05', taskName: 'x', variant: null, runIndex: 2, workspace: 'D:\\m\\OpenAI\\GPT\\T05\\r2', deliverableDir: 'aether9-site', timeLimit: 120, materials: [] });
  assert.match(h, /D:\\m\\OpenAI\\GPT\\T05\\r2/);
  assert.match(h, /`aether9-site\/`/);
  assert.match(h, /aether9-site\/dist\/index\.html/);
  assert.match(h, /FINAL_MESSAGE\.md/);
  assert.match(h, /120 分钟/);
  const t8 = runHeader({ bench: 'b', taskId: 'T08', taskName: 'x', variant: null, runIndex: 1, workspace: 'W', deliverableDir: 'studyspot-legacy', timeLimit: 60, materials: ['materials/studyspot-legacy/'] });
  assert.match(t8, /直接修改工作目录中已有的 `studyspot-legacy\/`/);
  assert.match(t8, /预置素材/);
  const p = buildRunPrompt('原文\n【A 组】a\n【C 组】c\n', { bench: 'b', taskId: 'T03', taskName: 'x', variant: 'A', runIndex: 1, workspace: 'W', deliverableDir: 'tempo-promo', timeLimit: 60, materials: [] });
  assert.ok(p.text.includes('【A 组】a') && !p.text.includes('【C 组】c'));
  assert.ok(!buildRunPrompt('原文', { bench: 'b', taskId: 'T01', taskName: 'x', variant: null, runIndex: 1, workspace: 'W', deliverableDir: 'pelican-bike', timeLimit: 60, materials: [] }, { header: false }).text.includes('运行约定'));
});

test('运行约定头（v2）：契约 / 愿望、软时限、无聊天式输出约束；v1 保持不变', () => {
  const base = { bench: 'Coding Bench v2.0', taskId: 'T05', taskName: 'x', variant: null, runIndex: 1, workspace: 'W', deliverableDir: 'aether9-site', timeLimit: 90, materials: [] as string[] };
  const v2 = runHeader({ ...base, suite: 'v2' });
  assert.match(v2, /契约/); assert.match(v2, /愿望/);
  assert.match(v2, /软时限/); assert.doesNotMatch(v2, /时间上限/);
  assert.match(v2, /内容、长度和格式都不限/);
  assert.match(v2, /\n6\. \*\*自检\*\*/);
  const v1 = runHeader(base);
  assert.match(v1, /时间上限/); assert.doesNotMatch(v1, /软时限|愿望/);
  const withMat = runHeader({ ...base, suite: 'v2', materials: ['materials/assets/'] });
  assert.match(withMat, /\n7\. \*\*自检\*\*/);
});

test('harness 能力分组', () => {
  assert.equal(harnessGroup('Claude Code'), 'terminal');
  assert.equal(harnessGroup('Antigravity'), 'ide');
  assert.equal(harnessGroup('Codex 桌面版'), 'desktop');
  assert.equal(harnessGroup('Claude Web Chat + local command relay'), 'chat-relay');
  assert.equal(harnessGroup('某个没登记的'), 'other');
});

test('交付检测', () => {
  const files = new Set(['aether9-site', 'aether9-site/package.json', 'aether9-site/pnpm-lock.yaml']);
  const c = evalDeliverable(DELIVERABLES.T05, (p) => files.has(p), () => []);
  assert.deepEqual(c.map((x) => x.ok), [true, true, false]);
  assert.equal(c[1].found, 'pnpm-lock.yaml');
  const v = evalDeliverable(DELIVERABLES.T03, () => false, () => ['a.MP4']);
  assert.equal(v[1].ok, true);
});

test('额度换算', () => {
  const b = { mode: 'subscription' as const, unit: '%', monthly_fee: 200, monthly_quota: 100 };
  assert.equal(unitPrice(b), 2);
  assert.deepEqual(settleQuota({ unit: '%', before: 80, after: 65 }, b), { used: 15, cost_usd: 30 });
  assert.deepEqual(settleQuota({ unit: '美元', before: 10, after: 7.5 }, null), { used: 2.5, cost_usd: 2.5 });
  assert.deepEqual(settleQuota({ unit: '次', before: 50 }, b), { used: null, cost_usd: null });
  assert.equal(unitPrice({ mode: 'token' }), null);
});

test('AI 评审提示词', () => {
  const t = reviewPrompt({ root: 'D:\\r', bench: 'b', scope: { run_id: null, ref: 'OpenAI/G/T05/r1', task: 'T05' } });
  assert.match(t, /\.agents\/skills\/bench-workbench\/SKILL\.md/);
  assert.match(t, /D:\\r\\skills\\bench-grader\\SKILL\.md/);
  assert.match(t, /wb run register OpenAI\/G\/T05\/r1/);
  assert.match(reviewPrompt({ root: '/r', bench: 'b', scope: 'all', pendingAgent: 5 }), /当前 5 项/);
});


test('回收站：作废的运行移出所有评估入口，可恢复，永久删除只清理本次运行', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { Workspaces } = await import('../server/workspaces');
  const { StoreFile } = await import('../server/store');
  const { aggregate } = await import('../shared/aggregate');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-trash-'));
  try {
    const ws = new Workspaces(path.join(tmp, 'model'));
    const store = new StoreFile(path.join(tmp, 'store.json'));
    const task = { id: 'T01', variants: {}, deliverable: 'pelican-bike' } as any;
    const mk = () => ws.createRun({ vendor: 'OpenAI', model: 'GPT-X', task, variant: null, harness: 'Codex', taskDir: path.join(tmp, 'no-task'), prompt: 'p' });
    const r1 = mk(), r2 = mk();
    assert.equal(r2.index, 2);
    // r1 已登记评分（模拟 bench-grader 快照里的记录）
    ws.patchRun(r1.ref, { grader_run_id: 'T01-aaaa' });
    const storeRun = { run_id: 'T01-aaaa', task: 'T01', variant: null, tkey: 'T01', model: 'GPT-X', vendor: 'OpenAI', harness: 'Codex', entrant: 'GPT-X @ Codex', run_index: 1, date: null, alias: null, ws_ref: r1.ref, graded: true, score: null, usage: {}, manual: {}, artifacts: {}, notes: [], dir: '', has_final_message: false, synced_at: '' } as any;
    store.data.runs = [storeRun];
    store.syncFrom([], ws.listModels(), ws.listRuns());
    assert.equal(store.data.workspaces.length, 2);

    // 作废 r2（误点的第二次发车）和已登记的 r1
    ws.patchRun(r2.ref, { discarded: { at: '2026-09-30T12:40:00.000Z', stopped: true, from: '进行中', set_ended: true }, ended_at: '2026-09-30T12:40:00.000Z' });
    ws.patchRun(r1.ref, { discarded: { at: '2026-09-30T12:41:00.000Z', from: '已完成' } });
    store.syncFrom([], ws.listModels(), ws.listRuns());
    assert.deepEqual(store.data.workspaces.map((w) => w.ref), []);
    assert.equal(store.data.runs.length, 0, '评分记录也要移出 runs，排行榜看不到');
    assert.deepEqual(store.data.trash!.map((t) => t.id), [r1.ref, r2.ref]);
    assert.equal(store.data.trash![0].run?.run_id, 'T01-aaaa');
    assert.equal(store.data.trash![1].stopped, true);
    // 再同步一次（例如 Python 快照）也不会让它回到评估里
    store.syncFrom([], ws.listModels(), ws.listRuns());
    assert.equal(store.data.runs.length, 0);
    const spec = { dims: [], tasks: [], cfg: { runs_per_task: 3, pass_threshold: 60 }, config_full: { runs_per_task: 3, pass_threshold: 60, efficiency: { cost: { best: 0, worst: 1 }, speed: { best: 0, worst: 1 } } } } as any;
    assert.equal(aggregate(store.data.runs, spec).board.length, 0);
    // 下一次发车不会复用回收站里的编号
    assert.equal(ws.nextIndex('OpenAI', 'GPT-X', 'T01'), 3);

    // 恢复 r1：评分记录回到 runs
    ws.patchRun(r1.ref, { discarded: null });
    store.syncFrom([], ws.listModels(), ws.listRuns());
    assert.deepEqual(store.data.workspaces.map((w) => w.ref), [r1.ref]);
    assert.deepEqual(store.data.runs.map((r) => r.run_id), ['T01-aaaa']);
    assert.deepEqual(store.data.trash!.map((t) => t.id), [r2.ref]);
    assert.equal(fs.existsSync(path.join(tmp, 'model', 'OpenAI', 'GPT-X', 'T01', 'r1.run.json')), true);

    // 永久删除 r2：只删 r2 的文件夹和旁挂文件
    const removed = ws.purgeRun(r2.ref);
    assert.ok(removed.length >= 3);
    store.dropTrash([r2.ref]);
    store.syncFrom([], ws.listModels(), ws.listRuns());
    const left = fs.readdirSync(path.join(tmp, 'model', 'OpenAI', 'GPT-X', 'T01')).sort();
    assert.deepEqual(left, ['r1', 'r1.prompt.md', 'r1.run.json']);
    assert.equal(store.data.trash!.length, 0);
    assert.throws(() => ws.parseRef('OpenAI/GPT-X/T01/../../x'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('运行 ↔ 后台任务关联（登记 / 评分进度）', () => {
  const now = 1_000_000;
  const J = (id: string, kind: JobInfo['kind'], status: JobInfo['status'], qa: number, subject: JobInfo['subject'], ended: number | null = null): JobInfo =>
    ({ id, kind, title: id, status, started_at: qa, queued_at: qa, ended_at: ended, code: null, lines: 0, subject });
  const ref = 'OpenAI/GPT-6.1-Sol/T01/r1';
  // 登记排队中：前面还有一个别的评分在跑
  let jobs = [J('other', 'grade', 'running', now - 5000, { run_ids: ['X'] }), J('reg', 'register', 'queued', now - 1000, { refs: [ref] })];
  let a = activityOf(jobs, ref, null, now)!;
  assert.equal(a.phase, 'queued'); assert.equal(a.ahead, 1); assert.ok(isBusy(a));
  // 登记完成、接着评分：前端还不知道 run_id，也能靠 refs 找到评分任务
  jobs = [J('reg', 'register', 'done', now - 9000, { refs: [ref] }, now - 8000), J('g', 'grade', 'running', now - 8500, { refs: [ref], run_ids: ['T01-a'] })];
  assert.equal(activityOf(jobs, ref, null, now)!.phase, 'grade');
  assert.equal(activityOf(jobs, undefined, 'T01-a', now)!.job.id, 'g');
  // 失败：30 分钟内显示，之后不再显示；之后重试成功也不再显示
  jobs = [J('g', 'grade', 'failed', now - 9000, { run_ids: ['T01-a'] }, now - 1000)];
  assert.equal(activityOf(jobs, undefined, 'T01-a', now)!.phase, 'failed');
  assert.ok(!isBusy(activityOf(jobs, undefined, 'T01-a', now)));
  assert.equal(activityOf(jobs, undefined, 'T01-a', now + FAIL_WINDOW), null);
  jobs.push(J('g2', 'grade', 'done', now - 500, { run_ids: ['T01-a'] }, now - 100));
  assert.equal(activityOf(jobs, undefined, 'T01-a', now), null);
  // 无关任务（导出等）不挂到运行上
  assert.equal(activityOf([J('e', 'export', 'running', now, { refs: [ref] })], ref, null, now), null);
});

test('桌面宠物的任务列表与进度里程碑', () => {
  const now = 5_000_000;
  const J = (id: string, kind: JobInfo['kind'], status: JobInfo['status'], qa: number, ended: number | null = null): JobInfo =>
    ({ id, kind, title: id, status, started_at: qa, queued_at: qa, ended_at: ended, code: null, lines: 0 });
  const jobs = [
    J('old', 'grade', 'done', now - 40 * 60000, now - 30 * 60000),   // 超过 15 分钟：不显示
    J('exp', 'export', 'done', now - 60000, now - 30000),              // 已结束的非评测任务：不显示
    J('q2', 'grade', 'queued', now - 2000),
    J('run', 'register', 'running', now - 9000),
    J('q1', 'grade', 'queued', now - 3000),
    J('ok', 'grade', 'done', now - 9 * 60000, now - 5 * 60000),
    J('bad', 'register', 'failed', now - 3 * 60000, now - 2 * 60000),
  ];
  // 进行中在前（运行中 > 排队，排队按先后），然后是最近结束的（新的在前）
  assert.deepEqual(petJobs(jobs, now).map((j) => j.id), ['run', 'q1', 'q2', 'bad', 'ok']);
  assert.equal(petJobs(jobs, now, 15 * 60000, 2).length, 2);
  const by = (id: string) => activityOfJob(jobs.find((j) => j.id === id)!, jobs);
  assert.equal(by('q2').phase, 'queued'); assert.equal(by('q2').ahead, 2);
  assert.equal(by('run').phase, 'register');
  assert.equal(by('ok').phase, 'done'); assert.ok(!isBusy(by('ok')));
  assert.equal(by('bad').phase, 'failed');
  assert.equal(activityOfJob(J('x', 'export', 'running', now), []).phase, 'work');
  assert.ok(isBusy(activityOfJob(J('x', 'export', 'running', now), [])));
  // 评分器输出：最后一个探针、是否进入写入结果、最后一行有效输出
  const p = parseProgress(['$ python grade.py', '[probe 1/5] files', 'ok', '[probe 3/5] browser', 'fps 60']);
  assert.deepEqual(p.probe, { i: 3, n: 5, type: 'browser' }); assert.equal(p.syncing, false); assert.equal(p.last, 'fps 60');
  assert.equal(parseProgress(['[probe 5/5] claims', '[after] 写入结果…']).syncing, true);
  assert.equal(parseProgress(['$ python grade.py']).probe, null);
});

test('榜单三视图：历史版不含 v2、简化版取最高并标 n、完整版只收测满 3 次者并给出稳定性', async () => {
  const { aggregate } = await import('../shared/aggregate');
  const dims = [{ id: 'visual', name: 'v', kind: 'quality', desc: '' }, { id: 'stability', name: '稳定性', kind: 'quality', weight: 0, only_views: ['full'], desc: '' }] as any;
  const spec = {
    dims, cfg: { runs_per_task: 3, pass_threshold: 60 },
    config_full: { runs_per_task: 3, pass_threshold: 60, efficiency: { cost: { best: 0.01, worst: 10 }, speed: { best: 1, worst: 100 } }, statistics: { bootstrap_samples: 20 }, v2: { full_runs: 3 } },
    tasks: [{ id: 'T01', suite: 'v1', variants: {} }, { id: 'V01', suite: 'v2', variants: {} }, { id: 'V02', suite: 'v2', variants: {} }],
  } as any;
  const mk = (id: string, ent: string, tkey: string, idx: number, total: number, extra: Partial<StoreRun> = {}) => ({
    run_id: id, entrant: ent, model: ent, vendor: null, harness: 'H', task: tkey, variant: null, tkey, run_index: idx, graded: true, usage: {}, manual: {},
    benchmark_version: tkey.startsWith('V') ? 'v2.0-draft' : null,
    score: { gate_pass: true, total, dims: { visual: total }, dim_weights: { visual: 1 }, tiers: {}, items: [], na_ratio: 0, low_confidence: false, pending: [], complete: true, passed: total >= 60, tier0_pass: true, gate_fail: [] },
    ...extra,
  }) as unknown as StoreRun;
  const runs: StoreRun[] = [mk('h1', 'old', 'T01', 1, 80)];
  for (const i of [1, 2, 3]) runs.push(mk(`a${i}-1`, 'full', 'V01', i, [90, 30, 90][i - 1], i === 2 ? { score: { ...mk('x', 'x', 'V01', 1, 30).score!, tier0_pass: false } } : {}), mk(`a${i}-2`, 'full', 'V02', i, 70));
  runs.push(mk('p1', 'part', 'V01', 1, 50), mk('p2', 'part', 'V01', 2, 80), mk('p3', 'part', 'V02', 1, 60));

  const hist = aggregate(runs, spec, { bootstrap: 20, view: 'history' });
  assert.deepEqual(hist.entrants, ['old']);
  assert.equal(hist.board[0].dims.stability, undefined);

  const simple = aggregate(runs, spec, { bootstrap: 20, view: 'simple' });
  const part = simple.board.find((b) => b.entrant === 'part')!;
  assert.equal(part.n_max, 2); assert.equal(part.n_min, 1); assert.equal(part.star, true);
  assert.equal(simple.tasks.find((t) => t.entrant === 'part' && t.task === 'V01')!.mean, 80, '每题取最高');

  const full = aggregate(runs, spec, { bootstrap: 20, view: 'full' });
  assert.deepEqual(full.board.map((b) => b.entrant), ['full']);
  assert.equal(full.excluded![0].entrant, 'part');
  assert.match(full.excluded![0].missing.join(), /V01（2\/3）/);
  const f = full.board[0];
  assert.ok(f.availability! < 100 && f.dims.stability! < 100, '失误计入稳定性');
  assert.equal(f.runs, 6);
});