// 报告：单模型 REPORT.md（model/<供应商>/<模型>/_report/）与全局对比快照（reports/<日期>-<标签>/）。
import fs from 'node:fs';
import path from 'node:path';
import type { Aggregate, BenchStore, SpecData } from '../shared/types';

const f = (v: number | null | undefined, d = 1) => (v == null ? '—' : v === Infinity ? '∞' : Number(v).toFixed(d));

export function modelReport(store: BenchStore, agg: Aggregate, spec: SpecData, vendor: string, name: string): string {
  const dims = spec.dims;
  const rows = agg.board.filter((b) => b.model === name && (b.vendor === vendor || b.vendor == null));
  const runs = store.runs.filter((r) => r.model === name && (r.vendor === vendor || r.vendor == null));
  const wss = store.workspaces.filter((w) => w.vendor === vendor && w.model === name);
  const L: string[] = [];
  L.push(`# ${vendor} / ${name} — 评测报告`, '');
  L.push(`> ${spec.cfg.name} ${spec.cfg.version} · 生成于 ${new Date().toLocaleString('zh-CN', { hour12: false })} · 由 bench-workbench 汇总 bench-grader 评分`, '');
  if (!rows.length) L.push('尚无已评分运行。', '');
  for (const b of rows) {
    const total = agg.board.length;
    L.push(`## ${b.entrant}`, '');
    L.push(`- 名次：**${b.rank}** / ${total}　质量总分：**${f(b.quality, 2)}**（95% CI ${f(b.ci_low, 2)}–${f(b.ci_high, 2)}）`);
    L.push(`- 达标率 ${f(b.pass_rate * 100, 0)}%　运行 ${b.runs} 次 / 覆盖 ${b.tasks} 题　整套期望成本 $${f(b.suite_exp_cost_usd, 2)}　期望用时 ${f(b.suite_exp_min, 0)} 分钟`);
    L.push(`- 评分完整：${b.complete ? '是' : '否（仍有待评项）'}　平均 N/A 占比 ${f(b.na_ratio * 100, 0)}%`, '');
    L.push('| 维度 | 得分 |', '|---|---:|');
    for (const d of dims) L.push(`| ${d.name} | ${f(b.dims[d.id])} |`);
    L.push('', '### 各题', '', '| 题目 | 运行 | 均值 | 标准差 | 最低 | 最高 | 达标率 | 期望成本 | 期望用时 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const t of agg.tasks.filter((t) => t.entrant === b.entrant)) {
      L.push(`| ${t.task} | ${t.runs} | ${f(t.mean, 2)} | ${f(t.sd, 2)} | ${f(t.min, 1)} | ${f(t.max, 1)} | ${f(t.pass_rate * 100, 0)}% | ${t.exp_cost_usd == null ? '—' : '$' + f(t.exp_cost_usd, 2)} | ${f(t.exp_min, 0)} |`);
    }
    const fails = agg.failures.filter((x) => x.entrant === b.entrant);
    if (fails.length) {
      L.push('', '### 未达标 / 失败归因', '', '| 运行 | 题目 | 总分 | 归因 |', '|---|---|---:|---|');
      for (const x of fails) L.push(`| ${x.run_id} | ${x.task} | ${f(x.total, 1)} | ${x.tags} |`);
    }
    // 该参赛者相对全体的强弱项（按检查项）
    const strong = agg.items.filter((i) => i.by_entrant[b.entrant] != null && Object.keys(i.by_entrant).length > 1)
      .map((i) => ({ i, d: i.by_entrant[b.entrant] - i.mean })).sort((a, c) => c.d - a.d);
    if (strong.length) {
      L.push('', '### 相对强项（高于全体均值最多的检查项）', '');
      for (const { i, d } of strong.slice(0, 5)) L.push(`- ${i.task} ${i.item_id}（${i.desc}）：${f(i.by_entrant[b.entrant] * 100, 0)}%，高出 ${f(d * 100, 0)} 个百分点`);
      L.push('', '### 相对弱项', '');
      for (const { i, d } of strong.slice(-5).reverse()) L.push(`- ${i.task} ${i.item_id}（${i.desc}）：${f(i.by_entrant[b.entrant] * 100, 0)}%，低 ${f(-d * 100, 0)} 个百分点`);
    }
    L.push('');
  }
  L.push('## 运行明细', '', '| 运行 id | 题目 | 次序 | harness | 总分 | 门槛 | 达标 | 待评 | 用时(分) | 费用($) | 用量来源 | 工作区 |', '|---|---|---:|---|---:|---|---|---:|---:|---:|---|---|');
  for (const r of runs) {
    const s = r.score;
    L.push(`| ${r.run_id} | ${r.tkey} | ${r.run_index ?? ''} | ${r.harness} | ${s ? f(s.total, 1) : '未评分'} | ${s ? (s.gate_pass ? '通过' : '未通过') : '—'} | ${s ? (s.passed ? '是' : '否') : '—'} | ${s ? s.pending.length : '—'} | ${f(r.usage.active_min ?? r.usage.wall_min, 0)} | ${f(r.usage.cost_usd, 2)} | ${r.usage.source || '—'} | ${r.ws_ref || ''} |`);
  }
  const unreg = wss.filter((w) => !w.grader_run_id);
  if (unreg.length) {
    L.push('', '## 未登记的工作区', '');
    for (const w of unreg) L.push(`- ${w.ref}（${w.status || 'prepared'}）${w.has_deliverable ? '' : ' — 尚无交付目录'}`);
  }
  L.push('', '---', '评分口径见 skills/bench-grader/references/scoring-model.md。未完成的人工/agent 项不计入分母，正式发布前应清零。', '');
  return L.join('\n');
}

export function writeModelReport(modelDir: string, vendor: string, name: string, md: string, summary: unknown) {
  const dir = path.join(modelDir, vendor, name, '_report');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'REPORT.md'), md, 'utf8');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, (_k, v) => (v === Infinity ? 'inf' : v), 2), 'utf8');
  return dir;
}

export function listReports(reportsDir: string) {
  fs.mkdirSync(reportsDir, { recursive: true });
  return fs.readdirSync(reportsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const p = path.join(reportsDir, d.name);
    const files = fs.readdirSync(p).sort();
    return { name: d.name, files, mtime: fs.statSync(p).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
}
