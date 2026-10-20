// 先 npm run build:node，再 node --test tests/workspace-api.test.cjs。
// 使用独立存储、独立模型目录和随机端口；不启动被测模型或真实 harness。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('../dist-node/server.cjs');

test('复制提示词 API：v2 空壳恢复、创建/复用、切换 harness、自定义持久化和默认推荐', async () => {
  const root = fs.mkdtempSync(path.resolve('.runtime/wb-api-'));
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
    fs.writeFileSync(path.join(md, 'model.json'), JSON.stringify({ schema: 1, vendor: 'MiniMax', name: 'MiniMax M3.1 Flash', harness: 'DeepSeek Harness' }));
    const storeFile = path.join(root, 'store.json');
    fs.writeFileSync(storeFile, JSON.stringify({ schema: 'bench-store/1', settings: {}, models: [], runs: [], workspaces: [], spec }));
    server = await startServer({ root, modelDir, storeFile, port: 0, python: null, runtimeDir: root, scratchDir: path.join(root, 'scratch'), benchData: path.join(root, 'bench-data'), graderDir: path.join(root, 'grader') });
    const url = `http://127.0.0.1:${server.server.address().port}`;
    const api = async (route, body, expected = 200) => {
      const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-wb-token': server.cfg.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    };
    await api('/api/spec');
    const p = await api('/api/ws/prompt?' + new URLSearchParams({ task: 'B1', for: 'MiniMax/MiniMax M3.1 Flash' }));
    assert.equal(p.index, 3);
    assert.equal(p.exists, false);
    assert.match(p.text, /原始题目 B1/);
    const first = await api('/api/ws/claim', { vendor: 'MiniMax', model: 'MiniMax M3.1 Flash', task: 'B1', index: p.index, harness: 'MiniMax Code', start: false, open: false });
    assert.equal(first.run.ref, 'MiniMax/MiniMax M3.1 Flash/B1/r3');
    assert.equal(first.run.started_at, null);
    assert.equal(first.text, p.text);
    const custom = await api('/api/harness/custom', { name: ' 私有 Agent ' });
    assert.equal(custom.name, '私有 Agent');
    assert.equal((await api('/api/harness/custom', { name: '私有 agent' })).name, '私有 Agent');
    await api('/api/harness/custom', { name: 'bad\nname' }, 400);
    const reused = await api('/api/ws/claim', { vendor: 'MiniMax', model: 'MiniMax M3.1 Flash', task: 'B1', index: 3, harness: custom.name, start: false, open: false });
    assert.equal(reused.run.ref, first.run.ref);
    assert.equal(reused.run.harness, custom.name);
    await api('/api/settings', { default_harness: custom.name });
    await api('/api/settings', { custom_harnesses: ['bad\nname'] }, 400);
    const inferred = await api('/api/models/infer?' + new URLSearchParams({ name: 'MiniMax API Fixture' }));
    assert.equal(inferred.harness.name, custom.name);
    const model = await api('/api/models', { vendor: 'MiniMax', name: 'MiniMax API Fixture' });
    assert.equal(model.harness, custom.name);
    const visual = await api('/api/ws/claim', { vendor: 'MiniMax', model: model.name, task: 'V01', start: false, open: false });
    assert.equal(visual.run.task, 'V01');
    assert.equal(visual.run.harness, custom.name);
    const store = await api('/api/store');
    assert.equal(store.workspaces.length, 2);
    assert.deepEqual(store.settings.custom_harnesses, [custom.name]);
    assert.deepEqual(JSON.parse(fs.readFileSync(storeFile, 'utf8')).settings.custom_harnesses, [custom.name]);
    assert.ok(store.workspaces.every((w) => !w.started_at && !w.grader_run_id));
  } finally {
    if (server) await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
