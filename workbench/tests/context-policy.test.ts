import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildPrompt, buildRunPrompt, runHeader, reviewPrompt } from '../shared/prompt';
import { Workspaces } from '../server/workspaces';
import type { SpecTask } from '../shared/types';

import { addContextPolicy, stripContextPolicy, contextPolicyVersion, copyAuthoritativePrompt, CONTEXT_POLICY_BLOCK } from '../shared/context-policy';
import { declaredSkills, snapshotSkills } from '../server/context-policy';

const START = '<!-- benchmark-context-boundary:v1:start -->';
const END = '<!-- benchmark-context-boundary:v1:end -->\n\n';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

test('约束只增加固定前缀：全部题型、变体、header、CRLF和TTS保持旧生成字节', () => {
  const ids = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', ...Array.from({ length: 8 }, (_, i) => `B${i + 1}`), ...Array.from({ length: 8 }, (_, i) => `V0${i + 1}`)];
  for (const taskId of ids) for (const variant of [null, 'A', 'C']) for (const header of [true, false]) {
    const raw = '  原文：金额、愿望与空白不变\r\n---\r\n正文 {TTS_COMMAND}\r\n【A 组】a\r\n【C 组】c\r\n';
    const h = { bench: 'b', taskId, taskName: '题', variant, runIndex: 1, workspace: 'D:\\中文 空格\\r1', deliverableDir: 'output', timeLimit: 60, materials: [], suite: 'v2' as const };
    const opts = { header, tts: 'python tts.py' };
    const body = buildPrompt(raw, taskId, variant, opts);
    const baseline = header ? runHeader(h) + body.text.replace(/^\s+/, '') : body.text;
    const actual = buildRunPrompt(raw, h, opts);
    assert.ok(actual.text.startsWith(START), taskId);
    const end = actual.text.indexOf(END) + END.length;
    assert.ok(end >= END.length);
    assert.deepEqual(Buffer.from(actual.text.slice(end)), Buffer.from(baseline));
    assert.equal(actual.text.split(START).length, 2);
    assert.deepEqual(actual.warnings, body.warnings);
  }
  assert.doesNotMatch(reviewPrompt({ root: 'D:\\repo', bench: 'b', scope: 'all' }), /benchmark-context-boundary/);
});

test('前缀幂等、损坏与重复拒绝；剪贴板失败不冒充成功', async () => {
  const text = addContextPolicy('  原文\r\n');
  assert.equal(addContextPolicy(text), text);
  assert.equal(stripContextPolicy(text), '  原文\r\n');
  assert.throws(() => stripContextPolicy(text + CONTEXT_POLICY_BLOCK));
  assert.equal(contextPolicyVersion(text.replace('独立完成', '修改')), 'unknown');
  assert.equal(await copyAuthoritativePrompt('预览', '最终', true, async () => false), false);
  assert.equal(await copyAuthoritativePrompt('最终', '最终', false, async () => true), true);
  assert.equal(await copyAuthoritativePrompt('预览', '最终', true, async () => { throw Error('拒绝'); }), false);
});

test('只在发车前记录指定技能；开始后不伪造新快照', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-context-skills-'));
  try {
    const ws = new Workspaces(path.join(root, 'model'));
    const task = { id: 'V07', prompt: '原题', variants: { C: {} }, deliverable: 'output', materials: [] } as unknown as SpecTask;
    const run = ws.createRun({ vendor: 'Test', model: 'Model', task, variant: 'C', harness: 'test', taskDir: root, prompt: addContextPolicy('原题') });
    assert.equal(run.context_policy?.skills.status, 'pending');
    const skill = path.join(run.workspace!, '.agents', 'skills', 'hyperframes');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '固定技能');
    const started = ws.patchRun(run.ref, { started_at: new Date().toISOString() });
    assert.equal(started.context_policy?.skills.status, 'recorded');
    const before = started.context_policy?.skills;
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '运行后修改');
    assert.deepEqual(ws.patchRun(run.ref, { notes: '交付后' }).context_policy?.skills, before);
    ws.patchRun(run.ref, { started_at: null });
    assert.deepEqual(ws.patchRun(run.ref, { started_at: new Date().toISOString() }).context_policy?.skills, before, '重置计时不能回填新快照');
    assert.equal(declaredSkills('V07', 'A').mode, 'none');
    assert.equal(snapshotSkills(root, declaredSkills('B1', null)).status, 'not_applicable');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('新运行记录提示词来源；不在rN旁边创建被旧boundary误扫的侧文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-context-'));
  try {
    const ws = new Workspaces(path.join(root, 'model'));
    ws.upsertModel({ vendor: 'Test', name: '中文 Model' });
    fs.mkdirSync(path.join(root, 'materials', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'materials', 'assets', 'fixture.txt'), '虚构素材');
    const task = { id: 'B1', prompt: '原始题目', variants: {}, deliverable: 'output', materials: [] } as unknown as SpecTask;
    const run = ws.createRun({ vendor: 'Test', model: '中文 Model', task, variant: null, harness: 'test', taskDir: root,
      prompt: (dir) => buildRunPrompt(task.prompt, { bench: 'b', taskId: 'B1', taskName: '题', variant: null, runIndex: 1, workspace: dir, deliverableDir: 'output', timeLimit: null, materials: [] }).text });
    const f = ws.files(run.ref);
    const meta = JSON.parse(fs.readFileSync(f.run, 'utf8'));
    const text = fs.readFileSync(f.prompt, 'utf8');
    assert.equal(meta.context_policy?.version, 'context-boundary/v1');
    assert.equal(meta.context_policy.prompt_sha256, sha(text));
    assert.equal(meta.context_policy.task_prompt_sha256, sha(task.prompt));
    assert.equal(meta.context_policy.base_prompt_sha256, sha(text.slice(text.indexOf(END) + END.length)));
    assert.equal(meta.context_policy.skills.mode, 'none');
    assert.equal(meta.context_policy.materials?.files['assets/fixture.txt'], sha('虚构素材'));
    assert.deepEqual(fs.readdirSync(f.taskDir).sort(), ['r1', 'r1.prompt.md', 'r1.run.json']);
    ws.patchRun(run.ref, { notes: '不丢失元数据' });
    assert.deepEqual(JSON.parse(fs.readFileSync(f.run, 'utf8')).context_policy, meta.context_policy);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
