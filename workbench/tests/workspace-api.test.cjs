// 先 npm run build:node，再 node --test tests/workspace-api.test.cjs。
// 使用独立存储、独立模型目录和随机端口；不启动被测模型或真实 harness。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../dist-node/server.cjs');

test('复制提示词 API：v2 空壳恢复、创建/复用、切换 harness、自定义持久化和默认推荐', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-api-'));
  let server;
  try {
    fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
    const tasks = ['B1', 'V01'].map((id) => ({ id, name: id, short: id, suite: 'v2', variants: {}, condition: '', materials: [], time_limit: 30, deliverable: 'output', prompt: `原始题目 ${id}`, dims: {}, items: [], gates: [], hidden: [], probes: [] }));
    const cfg = { name: '隔离 API 回归', version: 'v2.0', runs_per_task: 1, pass_threshold: 60, efficiency: { cost: { best: 0, worst: 1 }, speed: { best: 0, worst: 1 } } };
    const spec = { tasks, cfg, config_full: cfg, dims: [], relations: [], materials_state: Object.fromEntries(tasks.map((t) => [t.id, { dir: path.join(root, 'tasks', t.id), files: [], missing: [] }])) };
    for (const t of tasks) fs.mkdirSync(spec.materials_state[t.id].dir, { recursive: true });
    const modelDir = path.join(root, 'model');
    const md = path.join(modelDir, 'MiniMax', 'MiniMax M3.1 Flash');
    fs.mkdirSync(path.join(md, 'B1', 'r1', '.git'), { recursive: true });
    fs.mkdirSync(path.join(md, 'B1', 'r2', '.git'), { recursive: true });
    const existing = { schema: 1, vendor: 'MiniMax', name: 'MiniMax M3.1 Flash', harness: 'DeepSeek Harness' };
    fs.writeFileSync(path.join(md, 'model.json'), JSON.stringify(existing));
    const storeFile = path.join(root, 'store.json');
    fs.writeFileSync(storeFile, JSON.stringify({ schema: 'bench-store/1', settings: {}, models: [existing], runs: [], workspaces: [], spec }));
    server = await startServer({ root, modelDir, storeFile, port: 0, python: null, runtimeDir: root, scratchDir: path.join(root, 'scratch'), benchData: path.join(root, 'bench-data'), graderDir: path.join(root, 'grader') });
    const url = `http://127.0.0.1:${server.server.address().port}`;
    const api = async (route, body, expected = 200) => {
      const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-wb-token': server.cfg.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    };
    await api('/api/spec');
    const auditDir = path.join(root, 'bench-data', 'context-audits');
    assert.deepEqual(await api('/api/context'), []);
    assert.equal(fs.existsSync(auditDir), false, 'GET 不能扫描或生成审计报告');
    const p = await api('/api/ws/prompt?' + new URLSearchParams({ task: 'B1', for: 'MiniMax/MiniMax M3.1 Flash' }));
    assert.equal(p.index, 3);
    assert.equal(p.exists, false);
    assert.match(p.text, /原始题目 B1/);
    const first = await api('/api/ws/claim', { vendor: 'MiniMax', model: 'MiniMax M3.1 Flash', task: 'B1', index: p.index, harness: 'MiniMax Code', start: false, open: false });
    assert.equal(first.run.ref, 'MiniMax/MiniMax M3.1 Flash/B1/r3');
    assert.equal(first.run.started_at, null);
    assert.equal(first.text, p.text);
    assert.equal(first.run.context_policy.version, 'context-boundary/v1');
    // 模拟旧 prepared 档案；改变设置也不能静默重算。
    const archived = '旧版原始提示词\r\n  空白保持\r\n';
    const base = path.join(md, 'B1', 'r3');
    fs.writeFileSync(base + '.prompt.md', archived);
    const oldMeta = JSON.parse(fs.readFileSync(base + '.run.json', 'utf8'));
    delete oldMeta.context_policy;
    fs.writeFileSync(base + '.run.json', JSON.stringify(oldMeta));
    await api('/api/settings', { prompt_header: false });
    const oldPreview = await api('/api/ws/prompt?' + new URLSearchParams({ task: 'B1', for: 'MiniMax/MiniMax M3.1 Flash' }));
    assert.equal(oldPreview.text, archived);
    assert.equal(oldPreview.policy_version, 'legacy');
    assert.match(oldPreview.warnings.join(' '), /旧版约束/);
    const custom = await api('/api/harness/custom', { name: ' 私有 Agent ' });
    assert.equal(custom.name, '私有 Agent');
    assert.equal((await api('/api/harness/custom', { name: '私有 agent' })).name, '私有 Agent');
    await api('/api/harness/custom', { name: 'bad\nname' }, 400);
    const reused = await api('/api/ws/claim', { vendor: 'MiniMax', model: 'MiniMax M3.1 Flash', task: 'B1', index: 3, harness: custom.name, start: false, open: false });
    assert.equal(reused.run.ref, first.run.ref);
    assert.equal(reused.text, archived);
    assert.equal(reused.run.context_policy, undefined);
    assert.equal(fs.readFileSync(base + '.prompt.md', 'utf8'), archived);
    assert.equal(reused.run.harness, custom.name);
    await api('/api/settings', { default_harness: custom.name });
    await api('/api/settings', { custom_harnesses: ['bad\nname'] }, 400);
    const inferred = await api('/api/models/infer?' + new URLSearchParams({ name: 'MiniMax API Fixture' }));
    assert.equal(inferred.harness.name, custom.name);
    const model = await api('/api/models', { vendor: 'MiniMax', name: 'MiniMax API Fixture', create: true });
    assert.equal(model.harness, custom.name);
    const visual = await api('/api/ws/claim', { vendor: 'MiniMax', model: model.name, task: 'V01', start: false, open: false });
    assert.equal(visual.run.task, 'V01');
    assert.equal(visual.run.harness, custom.name);
    const store = await api('/api/store');
    assert.equal(store.workspaces.length, 2);
    assert.deepEqual(store.settings.custom_harnesses, [custom.name]);
    assert.deepEqual(JSON.parse(fs.readFileSync(storeFile, 'utf8')).settings.custom_harnesses, [custom.name]);
    assert.ok(store.workspaces.every((w) => !w.started_at && !w.grader_run_id));
    const crypto = require('node:crypto');
    const folder = path.join(auditDir, crypto.createHash('sha256').update(first.run.ref).digest('hex'));
    fs.mkdirSync(folder, { recursive: true });
    const report = { schema: 'context-audit/1', ref: first.run.ref, policy_version: 'legacy', sources: [], findings: [{ id: 'one', evidence_id: 'e1', review_state: 'pending' }], coverage: { tools: 'missing' }, prompt_provenance: { sent: 'unknown' } };
    fs.writeFileSync(path.join(folder, 'report-abc.json'), JSON.stringify(report));
    fs.writeFileSync(path.join(folder, 'current.json'), JSON.stringify({ report: 'report-abc.json' }));
    fs.writeFileSync(path.join(folder, 'review-abc.json'), JSON.stringify({ finding_id: 'one', evidence_id: 'e1', decision: 'dismissed', note: '测试依据', at: 'now' }));
    const detail = await api('/api/context?' + new URLSearchParams({ ref: first.run.ref }));
    assert.equal(detail.findings[0].review_state, 'dismissed');
    assert.equal(detail.pending_count, 0);
    assert.equal((await api('/api/context')).length, 1);
  } finally {
    if (server) await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('登记后的上下文审计失败不阻塞登记与自动评分', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-audit-failure-'));
  let server;
  try {
    const graderDir = path.join(root, 'grader');
    const scripts = path.join(graderDir, 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'bench-workbench'), { recursive: true });
    const tasks = [{ id: 'B1', name: 'B1', short: 'B1', suite: 'v2', variants: {}, condition: '', materials: [], time_limit: 30, deliverable: 'output', prompt: '原始题目 B1', dims: {}, items: [], gates: [], hidden: [], probes: [] }];
    const cfg = { name: '隔离审计故障回归', version: 'v2.0', runs_per_task: 1, pass_threshold: 60, efficiency: { cost: { best: 0, worst: 1 }, speed: { best: 0, worst: 1 } } };
    const spec = { tasks, cfg, config_full: cfg, dims: [], relations: [], materials_state: { B1: { dir: path.join(root, 'tasks', 'B1'), files: [], missing: [] } } };
    fs.mkdirSync(spec.materials_state.B1.dir, { recursive: true });
    fs.writeFileSync(path.join(root, 'fixture-spec.json'), JSON.stringify(spec));
    const bridgePy = path.join(root, 'bridge.py');
    fs.writeFileSync(bridgePy, `
import json, sys
from pathlib import Path
if sys.argv[1] == 'spec':
    data = json.loads((Path(__file__).parent / 'fixture-spec.json').read_text(encoding='utf-8'))
else:
    data = {'runs': []}
print('\\n@@WB@@' + json.dumps({'ok': True, 'data': data}))
`, 'utf8');
    fs.writeFileSync(path.join(scripts, 'bench.py'), `
import json, sys
from pathlib import Path
args = sys.argv[1:]
pos = args.index('--data')
data = Path(args[pos + 1])
command = args[pos + 2]
if command == 'init-run':
    rid = 'fixture-run'
    run = data / 'runs' / rid
    run.mkdir(parents=True, exist_ok=True)
    extra = json.loads(args[args.index('--extra') + 1])
    workspace = args[args.index('--workspace') + 1]
    (run / 'meta.json').write_text(json.dumps({'run_id': rid, 'task': 'B1', 'model': 'Context Model', 'harness': 'fixture', 'workspace': workspace, 'extra': extra}), encoding='utf-8')
    print(run)
elif command == 'grade':
    run = Path(args[pos + 3])
    (run / 'score.json').write_text(json.dumps({'total': 0, 'fixture': True}), encoding='utf-8')
    (run / 'grade-ran.txt').write_text('done', encoding='utf-8')
    print('fixture grade complete')
else:
    raise SystemExit('unexpected command: ' + command)
`, 'utf8');
    fs.writeFileSync(path.join(scripts, 'audit_context.py'), `
import sys
from pathlib import Path
args = sys.argv[1:]
root = Path(args[args.index('--root') + 1])
(root / 'audit-attempted.txt').write_text('intentional failure', encoding='utf-8')
sys.stderr.write('intentional audit failure\\n')
raise SystemExit(23)
`, 'utf8');

    const modelDir = path.join(root, 'model');
    const existing = { schema: 1, vendor: 'Fixture', name: 'Context Model', harness: 'fixture' };
    const md = path.join(modelDir, existing.vendor, existing.name);
    fs.mkdirSync(md, { recursive: true });
    fs.writeFileSync(path.join(md, 'model.json'), JSON.stringify(existing));
    const storeFile = path.join(root, 'store.json');
    fs.writeFileSync(storeFile, JSON.stringify({ schema: 'bench-store/1', settings: {}, models: [existing], runs: [], workspaces: [], spec }));
    const python = process.env.WB_PYTHON || 'python';
    server = await startServer({ root, modelDir, storeFile, port: 0, python, bridgePy, runtimeDir: root, scratchDir: path.join(root, 'scratch'), benchData: path.join(root, 'bench-data'), graderDir });
    const url = `http://127.0.0.1:${server.server.address().port}`;
    const api = async (route, body, expected = 200) => {
      const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-wb-token': server.cfg.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    };
    const claimed = await api('/api/ws/claim', { vendor: existing.vendor, model: existing.name, task: 'B1', harness: 'fixture', start: false, open: false });
    const ref = claimed.run.ref;
    fs.mkdirSync(path.join(md, 'B1', 'r1', 'output'), { recursive: true });
    const registration = await api('/api/ws/register', { ref, grade: true, fast: true });
    const registered = await api(`/api/jobs/${registration.id}/wait`);
    assert.equal(registered.status, 'done', JSON.stringify(registered));
    assert.equal(registered.result.run_id, 'fixture-run');
    const jobs = await api('/api/jobs');
    const grade = jobs.find((j) => j.kind === 'grade');
    assert.ok(grade, JSON.stringify(jobs));
    const graded = await api(`/api/jobs/${grade.id}/wait`);
    assert.equal(graded.status, 'done', JSON.stringify(graded));
    const runDir = path.join(root, 'bench-data', 'runs', 'fixture-run');
    assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'score.json'), 'utf8')).fixture, true);
    assert.equal(fs.readFileSync(path.join(runDir, 'grade-ran.txt'), 'utf8'), 'done');
    assert.equal(JSON.parse(fs.readFileSync(path.join(md, 'B1', 'r1.run.json'), 'utf8')).grader_run_id, 'fixture-run');
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(path.join(root, 'audit-attempted.txt')) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(fs.readFileSync(path.join(root, 'audit-attempted.txt'), 'utf8'), 'intentional failure');
  } finally {
    if (server) await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
