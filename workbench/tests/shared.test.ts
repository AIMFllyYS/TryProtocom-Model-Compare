// 一次性自测：node --test（由 esbuild 打包后运行，不启动任何服务）
import test from 'node:test';
import assert from 'node:assert/strict';
import { inferVendor, parseModelInput, iconFor, suggestHarness } from '../shared/vendors';
import { runHeader, buildRunPrompt, reviewPrompt } from '../shared/prompt';
import { DELIVERABLES, evalDeliverable } from '../shared/deliverables';

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

test('交付检测', () => {
  const files = new Set(['aether9-site', 'aether9-site/package.json', 'aether9-site/pnpm-lock.yaml']);
  const c = evalDeliverable(DELIVERABLES.T05, (p) => files.has(p), () => []);
  assert.deepEqual(c.map((x) => x.ok), [true, true, false]);
  assert.equal(c[1].found, 'pnpm-lock.yaml');
  const v = evalDeliverable(DELIVERABLES.T03, () => false, () => ['a.MP4']);
  assert.equal(v[1].ok, true);
});

test('AI 评审提示词', () => {
  const t = reviewPrompt({ root: 'D:\\r', bench: 'b', scope: { run_id: null, ref: 'OpenAI/G/T05/r1', task: 'T05' } });
  assert.match(t, /\.agents\/skills\/bench-workbench\/SKILL\.md/);
  assert.match(t, /D:\\r\\skills\\bench-grader\\SKILL\.md/);
  assert.match(t, /wb run register OpenAI\/G\/T05\/r1/);
  assert.match(reviewPrompt({ root: '/r', bench: 'b', scope: 'all', pendingAgent: 5 }), /当前 5 项/);
});
