const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer } = require('../dist-node/server.cjs');

test('model deletion checks ownership, retries safely, and rejects revival', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-model-delete-'));
  const modelDir = path.join(root, 'model');
  const storeFile = path.join(root, 'store.json');
  const benchData = path.join(root, 'bench-data');
  const vendor = 'Tencent', name = 'Hy4%20Flash', key = `${vendor}/${name}`;
  const dir = path.join(modelDir, vendor, name);
  const profile = { schema: 1, vendor, name, created_at: '2026-10-01T00:00:00Z' };
  const sibling = { ...profile, name: 'Hy4 Flash' };
  const storeOnly = { ...profile, name: 'Store Only' };
  const linked = { ...profile, name: 'Linked Directory' };
  const active = { ...profile, name: 'Active Model' };
  const orphan = { ...profile, name: 'Orphan Folder' };
  const ref = key + '/B1/r1';
  const rdir = path.join(dir, 'B1', 'r1');
  const graderPath = path.join(benchData, 'trash', 'B1-keep');
  const note = { id: 'deleted-note', target: ref, text: 'fixture', at: profile.created_at };
  const task = { id: 'B1', name: 'Fixture', suite: 'v2', variants: {}, prompt: 'Fixture task', materials: [], deliverable: 'output' };
  const cfg = { name: 'Fixture', version: 'v2.0', runs_per_task: 1, pass_threshold: 60, efficiency: { cost: { best: 0, worst: 1 }, speed: { best: 0, worst: 1 } } };
  const taskDir = path.join(root, 'task');
  const spec = { tasks: [task], cfg, config_full: cfg, dims: [], relations: [], materials_state: { B1: { dir: taskDir, files: [], missing: [] } } };
  const store = { schema: 'bench-store/1', models: [profile, sibling, storeOnly, linked, active], settings: { current_model: key }, runs: [], workspaces: [], notes: [note], history: [], eff: { quota_log: { [key]: [] } }, spec };
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  for (const part of [rdir, graderPath, taskDir, path.join(root, '.agents', 'skills'), ...[sibling, orphan].map((m) => path.join(modelDir, vendor, m.name))]) fs.mkdirSync(part, { recursive: true });
  write(path.join(modelDir, vendor, orphan.name, 'model.json'), orphan);
  write(path.join(graderPath, 'meta.json'), { vendor, model: sibling.name });
  write(path.join(dir, 'B1', 'r1.run.json'), { vendor, model: name, discarded: { at: profile.created_at } });
  fs.writeFileSync(path.join(rdir, 'sample.txt'), 'fixture');
  const linkedPath = path.join(modelDir, vendor, linked.name);
  fs.symlinkSync(path.join(modelDir, vendor, sibling.name), linkedPath, 'junction');
  write(storeFile, store);
  const start = () => startServer({ root, modelDir, storeFile, benchData, webDist: path.resolve('dist'), port: 0, python: null, runtimeDir: root });
  let server;
  const api = async (route, { method = 'GET', body, status = 200, token = true } = {}) => {
    const origin = `http://127.0.0.1:${server.server.address().port}`;
    const response = await fetch(origin + route, {
      method, body: body ? JSON.stringify(body) : undefined, headers: token ? { 'x-wb-token': server.cfg.token } : {},
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const post = (route, body, status = 200) => api(route, { method: 'POST', body, status });
  const remove = (m, status = 200) => post('/api/models/delete', { vendor, name: m.name, confirm: `${vendor}/${m.name}` }, status);
  try {
    server = await start();
    await post('/api/ws/scan', {});
    const before = await api('/api/store');
    assert.equal(before.trash.length, 1);
    assert.ok(!before.models.some((m) => m.name === orphan.name));
    await post('/api/ws/create', { vendor, model: 'Wrong Name', task: 'B1' }, 404);
    await post('/api/ws/claim', { vendor, model: 'Wrong Name', task: 'B1' }, 404);
    await post('/api/models', { vendor, name: 'Wrong Name' }, 404);
    await post('/api/models/report', { vendor, name: 'Wrong Name' }, 404);
    assert.ok(!fs.existsSync(path.join(modelDir, vendor, 'Wrong Name')));
    await post('/api/models', { vendor, name: 'HY4　Flash', harness: '', create: true }, 409);
    await post('/api/models', { vendor, name: 'Other%20Model', harness: '', create: true }, 400);
    await post('/api/ws/claim', { vendor, model: active.name, task: 'B1', start: true });
    await remove(active, 409);
    await remove(sibling, 409);
    await remove(linked, 409);
    const preview = await api('/api/models/delete?' + new URLSearchParams({ vendor, name }));
    assert.equal(preview.directory, dir);
    assert.equal(preview.trash, 1);
    await post('/api/models/delete', { vendor, name, confirm: 'wrong' }, 400);
    await api('/api/models/delete', { method: 'POST', body: { vendor, name, confirm: key }, token: false, status: 401 });
    assert.ok(fs.existsSync(rdir));

    const rm = fs.rmSync;
    fs.rmSync = (target, options) => {
      if (target === dir) throw Object.assign(new Error('fixture: directory busy'), { code: 'EBUSY' });
      return rm(target, options);
    };
    try { await remove(profile, 409); } finally { fs.rmSync = rm; }
    assert.equal(JSON.parse(fs.readFileSync(storeFile)).model_deletions[key].pending, true);
    await post('/api/ws/claim', { vendor, model: name, task: 'B1' }, 409);
    await api('/api/models', { method: 'PATCH', body: { vendor, name, harness: 'stale' }, status: 409 });
    await post('/api/models/report', { vendor, name }, 409);

    await server.close();
    server = await start();
    assert.ok((await api('/api/store')).model_deletions[key].pending);
    await remove(profile);
    await remove(storeOnly);
    assert.ok(!fs.existsSync(dir));
    assert.ok(fs.existsSync(path.join(modelDir, vendor, sibling.name)));
    await post('/api/store/import', before);
    await post('/api/ws/scan', {});
    const after = await api('/api/store');
    assert.deepEqual(after.models.map((m) => m.name), [sibling.name, linked.name, active.name]);
    assert.equal(after.settings.current_model, '');
    assert.deepEqual(after.trash, []);
    assert.deepEqual(after.notes, []);
    assert.equal(after.eff.quota_log[key], undefined);
    assert.equal(after.model_deletions[key].pending, undefined);
    await post('/api/models', { vendor, name, create: true }, 409);
  } finally {
    if (server) await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI rejects a multiword model name without quotes before contacting the workbench', () => {
  const result = spawnSync(process.execPath, ['dist-node/wb.cjs', 'model', 'add', 'GPT', '5.6', 'Sol'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /引号/);
});
