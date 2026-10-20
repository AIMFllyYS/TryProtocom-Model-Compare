// 真实工作区生命周期回归：只用临时目录，不接触正式模型或启动 harness。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspaces } from '../server/workspaces';
import { StoreFile } from '../server/store';
import { TASK_DIR, WORKSPACE_REF, WORKSPACE_REF_PREFIX } from '../shared/workspace-ref';
import { customHarnessNames, harnessByName, harnessName, normalizeHarnessName, suggestHarness } from '../shared/vendors';
import type { SpecTask } from '../shared/types';

test('v1/v2 引用、创建、提示词留档、扫描和修改均支持 B1–B8 / V01–V08，含空格模型名', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-v2-workspaces-'));
  try {
    const ws = new Workspaces(path.join(tmp, 'model'));
    const ids = ['T01', 'T03', ...Array.from({ length: 8 }, (_, i) => `B${i + 1}`), ...Array.from({ length: 8 }, (_, i) => `V0${i + 1}`)];
    for (const id of ids) {
      const variant = id === 'T03' ? 'C' : null;
      const task = { id, variants: variant ? { C: {} } : {}, deliverable: 'output' } as SpecTask;
      const run = ws.createRun({ vendor: 'MiniMax', model: 'MiniMax M3.1 Flash', task, variant, harness: 'MiniMax Code', taskDir: path.join(tmp, 'task'), prompt: (dir) => `工作目录：${dir}\n原始题目 ${id}` });
      assert.equal(WORKSPACE_REF.test(run.ref), true, run.ref);
      assert.equal(WORKSPACE_REF_PREFIX.exec(`${run.ref}/output/index.html`)?.[1], run.ref);
      const parsed = ws.parseRef(run.ref);
      assert.equal(parsed.task, id);
      assert.equal(parsed.variant, variant);
      assert.equal(fs.existsSync(ws.files(run.ref).run), true);
      assert.match(fs.readFileSync(ws.files(run.ref).prompt, 'utf8'), /MiniMax M3.1 Flash/);
      assert.equal(ws.patchRun(run.ref, { harness: '私有 Agent' }).harness, '私有 Agent');
      assert.equal(ws.nextIndex('MiniMax', 'MiniMax M3.1 Flash', run.tkey), 2);
    }
    assert.equal(ws.listRuns().length, ids.length);
    assert.equal(ws.parseRef('MiniMax/MiniMax M3.1 Flash/B1/r2').task, 'B1');
    for (const tkey of ['B0', 'B9', 'B01', 'V1', 'T1', '../B1', 'B1/..']) {
      assert.equal(TASK_DIR.test(tkey), false);
      assert.throws(() => ws.parseRef(`MiniMax/M/B1/${tkey}`));
      assert.throws(() => ws.createRun({ vendor: 'Bad', model: 'Untouched', task: { id: tkey, variants: {} } as SpecTask, variant: null, harness: '', taskDir: tmp, prompt: '' }));
    }
    assert.equal(fs.existsSync(path.join(tmp, 'model', 'Bad')), false, '非法题号不能留下模型或运行目录');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('旧失败的空 r1/r2 不当成运行，不回收编号；正常历史目录仍可发现', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-v2-orphans-'));
  try {
    const ws = new Workspaces(path.join(tmp, 'model'));
    ws.upsertModel({ vendor: 'MiniMax', name: 'MiniMax M3.1 Flash' });
    const base = path.join(tmp, 'model', 'MiniMax', 'MiniMax M3.1 Flash', 'B1');
    fs.mkdirSync(path.join(base, 'r1', '.git'), { recursive: true });
    fs.mkdirSync(path.join(base, 'r2', '.git'), { recursive: true });
    assert.deepEqual(ws.listRuns(), []);
    assert.equal(ws.nextIndex('MiniMax', 'MiniMax M3.1 Flash', 'B1'), 3);
    fs.writeFileSync(path.join(base, 'r2', 'README.md'), '历史产物');
    assert.deepEqual(ws.listRuns().map((r) => r.ref), ['MiniMax/MiniMax M3.1 Flash/B1/r2']);
    assert.equal(fs.existsSync(path.join(base, 'r1', '.git')), true);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('MiniMax Code 桌面版/CLI 能区分，安装后可按供应商推荐', () => {
  const app = harnessByName('MiniMax Code')!, cli = harnessByName('MiniMax Code CLI')!;
  assert.equal(app.kind, 'app');
  assert.equal(app.appId?.test('com.minimax.agent.cn'), true);
  assert.equal(cli.kind, 'cli');
  assert.equal(cli.cmd, 'mcode');
  assert.equal(suggestHarness('MiniMax', ['deepseek-harness', app.id, cli.id])?.id, app.id);
  assert.equal(suggestHarness('MiniMax', [cli.id])?.id, cli.id);
});

test('自定义 harness 去重、规范化、校验并随设置持久化；名称不解释为启动命令', () => {
  const names = customHarnessNames([' 私有 Agent ', '私有 agent', 'claude-code', 'MiniMax Code', 'Web Chat + relay', '']);
  assert.deepEqual(names, ['私有 Agent', 'Web Chat + relay']);
  assert.equal(harnessName('minimax-code'), 'MiniMax Code');
  assert.equal(harnessName('私有 Agent'), '私有 Agent');
  assert.equal(normalizeHarnessName(' custom & tool '), 'custom & tool');
  assert.equal(harnessByName('custom & tool'), undefined);
  for (const value of ['', '   ', 'a\nb', 'a'.repeat(101), null, 1]) assert.throws(() => normalizeHarnessName(value));
  const tmp = fs.mkdtempSync(path.resolve('.runtime/wb-custom-harness-'));
  try {
    const file = path.join(tmp, 'store.json');
    const store = new StoreFile(file);
    store.data.settings.custom_harnesses = names;
    store.data.settings.default_harness = names[0];
    store.save();
    assert.deepEqual(new StoreFile(file).data.settings.custom_harnesses, names);
    assert.equal(new StoreFile(file).data.settings.default_harness, names[0]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
