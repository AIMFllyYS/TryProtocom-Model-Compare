// 汇总：运行 → 题目 → 维度 → 参赛者（模型 @ harness）。逐行移植自 bench-grader/scripts/benchlib/aggregate.py，
// 输入只依赖可移植存储文件中的 StoreRun，因此在没有 bench-data 的电脑上也能出榜。
// 与 Python 版的唯一差异：bootstrap 使用 mulberry32 随机数，置信区间数值会有极小抖动。
import type { Aggregate, BoardRow, Dimension, FullConfig, ItemAnalysisRow, SpecData, StoreRun, TaskRow } from './types';

const mean = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const psd = (xs: (number | null | undefined)[]): number => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};
const r2 = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const INF = Number.POSITIVE_INFINITY;

export function logScore(value: number | null, best: number, worst: number): number | null {
  if (value == null) return null;
  if (value === INF) return 0;
  const v = Math.max(value, 1e-9);
  const s = (Math.log10(worst) - Math.log10(v)) / (Math.log10(worst) - Math.log10(best));
  return r2(100 * Math.max(0, Math.min(1, s)), 1);
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const entrantOf = (r: Pick<StoreRun, 'model' | 'harness'>) => `${r.model} @ ${r.harness}`;

export function aggregate(allRuns: StoreRun[], spec: Pick<SpecData, 'dims' | 'config_full' | 'cfg' | 'tasks'>, opts: { bootstrap?: number } = {}): Aggregate {
  const cfg: FullConfig = { ...spec.cfg, ...(spec.config_full || {}) };
  const dims: Dimension[] = spec.dims;
  const qdims = dims.filter((d) => d.kind === 'quality');
  const runs = allRuns.filter((r) => r.graded && r.score);
  const byEt = new Map<string, StoreRun[]>();
  const k = (e: string, t: string) => `${e}\u0000${t}`;
  for (const r of runs) {
    const key = k(r.entrant, r.tkey);
    if (!byEt.has(key)) byEt.set(key, []);
    byEt.get(key)!.push(r);
  }
  const entrants = [...new Set(runs.map((r) => r.entrant))].sort();
  const tkeys = [...new Set(runs.map((r) => r.tkey))].sort();
  const eff = cfg.efficiency;
  const usageMin = (r: StoreRun) => r.usage?.active_min ?? r.usage?.wall_min ?? null;

  const taskRows: TaskRow[] = [];
  for (const key of [...byEt.keys()].sort()) {
    const rs = byEt.get(key)!;
    const [e, tk] = key.split('\u0000');
    const totals = rs.map((r) => r.score!.total);
    const passed = rs.map((r) => r.score!.passed);
    const pr = passed.filter(Boolean).length / passed.length;
    const mc = mean(rs.map((r) => r.usage?.cost_usd ?? null));
    const mm = mean(rs.map(usageMin));
    const row: TaskRow = {
      entrant: e, task: tk, runs: rs.length, mean: r2(mean(totals) ?? 0), sd: r2(psd(totals)), min: Math.min(...totals), max: Math.max(...totals),
      pass_rate: r2(pr, 3), pass_at_k: passed.some(Boolean), gate_fail_runs: rs.filter((r) => !r.score!.gate_pass).length,
      complete: rs.every((r) => r.score!.complete), low_confidence: rs.some((r) => r.score!.low_confidence),
      mean_cost_usd: mc != null ? r2(mc, 4) : null, mean_min: mm != null ? r2(mm) : null,
      exp_cost_usd: mc != null ? (pr > 0 ? r2(mc / pr, 4) : INF) : null, exp_min: mm != null ? (pr > 0 ? r2(mm / pr) : INF) : null,
      dims: {}, dim_weights: rs[0].score!.dim_weights,
      tiers: Object.fromEntries(['basic', 'advanced', 'excellent', 'clean'].map((t) => [t, mean(rs.map((r) => r.score!.tiers?.[t] ?? null))])),
      cost_score: null, speed_score: null,
    };
    for (const d of Object.keys(row.dim_weights)) {
      const v = mean(rs.map((r) => r.score!.dims[d] ?? null));
      row.dims[d] = v != null ? r2(v) : null;
    }
    row.cost_score = logScore(row.exp_cost_usd, eff.cost.best, eff.cost.worst);
    row.speed_score = logScore(row.exp_min, eff.speed.best, eff.speed.worst);
    taskRows.push(row);
  }

  const entrantScores = (e: string, sample?: Map<string, StoreRun[]>) => {
    const acc: Record<string, [number, number]> = {};
    for (const tk of tkeys) {
      const rs = sample ? sample.get(tk) : byEt.get(k(e, tk));
      if (!rs || !rs.length) continue;
      const w = rs[0].score!.dim_weights;
      for (const [d, wt] of Object.entries(w)) {
        const v = mean(rs.map((r) => r.score!.dims[d] ?? null));
        if (v != null) { acc[d] ??= [0, 0]; acc[d][0] += wt * v; acc[d][1] += wt; }
      }
    }
    const ds: Record<string, number> = {};
    for (const [d, [a, b]] of Object.entries(acc)) if (b) ds[d] = r2(a / b);
    let num = 0, den = 0;
    for (const qd of qdims) if (qd.id in ds) { num += (qd.weight ?? 1) * ds[qd.id]; den += qd.weight ?? 1; }
    return { dims: ds, quality: den ? r2(num / den) : null };
  };

  const rng = mulberry32(20261008);
  const B = opts.bootstrap ?? Number(cfg.statistics?.bootstrap_samples ?? 2000);
  const ci = Number(cfg.statistics?.ci ?? 0.95);
  const board: BoardRow[] = [];
  for (const e of entrants) {
    const base = entrantScores(e);
    const boots: number[] = [];
    for (let b = 0; b < B; b++) {
      const sample = new Map<string, StoreRun[]>();
      for (const tk of tkeys) {
        const rs = byEt.get(k(e, tk));
        if (rs) sample.set(tk, rs.map(() => rs[Math.floor(rng() * rs.length)]));
      }
      const q = entrantScores(e, sample).quality;
      if (q != null) boots.push(q);
    }
    boots.sort((a, b) => a - b);
    const lo = boots.length ? boots[Math.floor(((1 - ci) / 2) * boots.length)] : null;
    const hi = boots.length ? boots[Math.floor(((1 + ci) / 2) * boots.length) - 1] : null;
    const trs = taskRows.filter((t) => t.entrant === e);
    const costS = trs.map((t) => t.cost_score).filter((x): x is number => x != null);
    const speedS = trs.map((t) => t.speed_score).filter((x): x is number => x != null);
    const expC = trs.map((t) => t.exp_cost_usd).filter((x): x is number => x != null);
    const expM = trs.map((t) => t.exp_min).filter((x): x is number => x != null);
    const er = runs.filter((r) => r.entrant === e);
    const dimsFull: Record<string, number | null> = { ...base.dims };
    dimsFull.cost = costS.length ? r2(mean(costS)!, 1) : null;
    dimsFull.speed = speedS.length ? r2(mean(speedS)!, 1) : null;
    const suite = (xs: number[], d: number) => (xs.length ? (xs.every((x) => x !== INF) ? r2(xs.reduce((a, b) => a + b, 0), d) : INF) : null);
    const row: BoardRow = {
      rank: '', entrant: e, model: er[0].model, vendor: er[0].vendor, harness: er[0].harness, quality: base.quality, ci_low: lo, ci_high: hi,
      dims: dimsFull, runs: er.length, tasks: trs.length, pass_rate: r2(er.filter((r) => r.score!.passed).length / er.length, 3),
      suite_exp_cost_usd: suite(expC, 3), suite_exp_min: suite(expM, 1), cost_coverage: `${costS.length}/${trs.length}`,
      complete: er.every((r) => r.score!.complete), na_ratio: r2(mean(er.map((r) => r.score!.na_ratio)) ?? 0, 3),
    };
    const cc = cfg.composite;
    if (cc?.enabled && row.quality != null) row.composite = r2(cc.quality_weight * row.quality + cc.cost_weight * (dimsFull.cost ?? 0) + cc.speed_weight * (dimsFull.speed ?? 0));
    board.push(row);
  }
  board.sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
  // 并列：与本组首位置信区间重叠的记为并列
  let rank = 1, i = 0;
  while (i < board.length) {
    const lead = board[i];
    let j = i;
    while (j < board.length && board[j].ci_high != null && lead.ci_low != null && board[j].ci_high! >= lead.ci_low) j++;
    j = Math.max(j, i + 1);
    const tie = j - i > 1;
    for (let x = i; x < j; x++) board[x].rank = tie ? `${rank}=` : String(rank);
    rank += j - i; i = j;
  }

  // 题目分析
  const perItem = new Map<string, Map<string, number[]>>();
  const itemMeta = new Map<string, { dim: string; tier: string; method: string; desc: string; tk: string; id: string }>();
  for (const r of runs) for (const it of r.score!.items) {
    if ((it.status === 'scored' || it.status === 'missing') && it.s != null) {
      const key = `${r.tkey}\u0000${it.id}`;
      if (!perItem.has(key)) perItem.set(key, new Map());
      const m = perItem.get(key)!;
      if (!m.has(r.entrant)) m.set(r.entrant, []);
      m.get(r.entrant)!.push(it.s);
      itemMeta.set(key, { dim: it.dim, tier: it.tier, method: it.method, desc: it.desc, tk: r.tkey, id: it.id });
    }
  }
  const items: ItemAnalysisRow[] = [];
  for (const key of [...perItem.keys()].sort()) {
    const byE = perItem.get(key)!;
    const allv = [...byE.values()].flat();
    const means = [...byE.values()].map((vs) => vs.reduce((a, b) => a + b, 0) / vs.length);
    const mu = allv.reduce((a, b) => a + b, 0) / allv.length;
    const within = mean([...byE.values()].map(psd)) ?? 0;
    const m = itemMeta.get(key)!;
    items.push({
      task: m.tk, item_id: m.id, dim: m.dim, tier: m.tier, method: m.method, desc: m.desc, mean: r2(mu, 3), between_sd: r2(psd(means), 3),
      within_sd: r2(within, 3), n: allv.length,
      flag: mu >= 0.95 ? '天花板' : mu <= 0.05 ? '地板' : means.length > 1 && psd(means) < 0.05 ? '区分度低' : '',
      by_entrant: Object.fromEntries([...byE.entries()].map(([en, vs]) => [en, r2(vs.reduce((a, b) => a + b, 0) / vs.length, 3)])),
    });
  }

  // skill 增益
  const uplift: Aggregate['uplift'] = [];
  for (const t of spec.tasks.filter((t) => Object.keys(t.variants || {}).length)) {
    for (const e of entrants) {
      const a = taskRows.find((x) => x.entrant === e && x.task === t.id + 'A');
      const c = taskRows.find((x) => x.entrant === e && x.task === t.id + 'C');
      if (a && c) uplift.push({
        entrant: e, task: t.id, A_mean: a.mean, C_mean: c.mean, uplift: r2(c.mean - a.mean), A_anim: a.dims.anim ?? null, C_anim: c.dims.anim ?? null,
        anim_uplift: r2((c.dims.anim ?? 0) - (a.dims.anim ?? 0)), A_cost: a.mean_cost_usd, C_cost: c.mean_cost_usd, A_min: a.mean_min, C_min: c.mean_min,
      });
    }
  }

  // 失败归因
  const failures: Aggregate['failures'] = [];
  for (const r of runs) {
    const sc = r.score!;
    const tags: string[] = [];
    if (r.failure_tag) tags.push(r.failure_tag);
    for (const g of sc.gate_fail) {
      if (g.desc.includes('汇报')) tags.push('谎报完成');
      else if (/启动|加载|seek/.test(g.desc)) tags.push('无法运行');
      else tags.push('交付缺失');
    }
    if (r.timed_out) tags.push('超时');
    if (!sc.gate_pass || !sc.passed) failures.push({ entrant: r.entrant, task: r.tkey, run_id: r.run_id, total: sc.total, tags: [...new Set(tags)].join('|') || '能力不足（未达标）' });
  }

  const pending = { human: 0, agent: 0, usage_missing: 0, ungraded: 0, low_confidence: 0 };
  for (const r of allRuns) {
    if (!r.graded || !r.score) { pending.ungraded++; continue; }
    for (const it of r.score.items) if (it.status === 'pending') it.method === 'human' ? pending.human++ : pending.agent++;
    if ((r.usage?.missing || []).length) pending.usage_missing++;
    if (r.score.low_confidence) pending.low_confidence++;
  }
  return { board, tasks: taskRows, items, uplift, failures, entrants, tkeys, generated_at: new Date().toISOString(), pending };
}

export const isInf = (v: unknown) => v === INF || v === 'inf';
