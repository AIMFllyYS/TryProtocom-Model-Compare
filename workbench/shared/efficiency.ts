// 速度与价格。两步：
// 1) 每次运行解析出“可用的用时 / 费用”与来源（手动修正 > 有效时间 > 日志墙钟 > 开始/结束时刻；直接估价 > 额度差 > 额度读数分摊 > 日志/单价）。
//    单次超过 5 小时（可配）进入“用时核实”：用户审批后可以不纳入时间统计，并计入相对不确定性。费用没有记录就是“未记录”，不补数。
// 2) 按题做相对比较：题基线 = 各参赛者该题平均的中位数；参赛者 = 各题 ln(平均 ÷ 基线) 的加权平均，再向基线收缩。
//    几何（对数）平均让“快一倍”和“慢一倍”对称，也不让长题主导；权重 = 题权重 × n/(n+1)，收缩防止只测一两题就冲到第一。
// 这一层只在工作台里（需要可移植存储里的工作区、额度读数与核实记录）；bench-grader 的 Python 报告仍是原来的期望值口径。
import { settleQuota, unitPrice } from './quota';
import type { CostSource, EffMetric, EffStore, EntrantEff, FullConfig, ModelProfile, QuotaReading, RunEff, SpecTask, StoreRun, TimeFlag, TimeSource, WorkspaceRun } from './types';

export interface EffContext { workspaces?: WorkspaceRun[]; models?: ModelProfile[]; eff?: EffStore }

export const TIME_DEFAULTS = { flag_minutes: 300, min_minutes: 0.5, pending: 'exclude' as 'exclude' | 'include' };
export const REL_DEFAULTS = { shrink: 1, span: 4, free_floor_usd: 0.01 };
/** 没有任何数据时的先验不确定性：约“差两倍” */
const PRIOR_LN = Math.log(2);

export function effSettings(cfg: Pick<FullConfig, 'efficiency'>) {
  const t = { ...TIME_DEFAULTS, ...(cfg.efficiency?.time || {}) };
  const r = { ...REL_DEFAULTS, ...(cfg.efficiency?.relative || {}) };
  return { time: t, rel: r };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = (v: unknown): number | null => { const n = num(v); return n != null && n > 0 ? n : null; };
export function minutesBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const m = (Date.parse(b) - Date.parse(a)) / 60000;
  return Number.isFinite(m) ? m : null;
}
const modelKey = (vendor: string | null | undefined, model: string) => `${vendor || ''}/${model}`;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** 运行的起止时刻：评分记录优先，工作区补齐 */
export function intervalOf(r: StoreRun, ws?: WorkspaceRun): [number, number] | null {
  const s = r.started_at || ws?.started_at, e = r.ended_at || ws?.ended_at;
  if (!s || !e) return null;
  const a = Date.parse(s), b = Date.parse(e);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null;
}

/** 解析一次运行的用时（不含费用） */
export function resolveTime(r: StoreRun, ws: WorkspaceRun | undefined, eff: EffStore | undefined, cfg: Pick<FullConfig, 'efficiency'>): Pick<RunEff, 'minutes' | 'raw_min' | 'time_source' | 'time_status' | 'flag' | 'suggest_min'> {
  const { time: T } = effSettings(cfg);
  const review = eff?.time_review?.[r.run_id];
  const active = pos(r.usage?.active_min) ?? pos(ws?.usage?.active_min);
  const log = pos(r.usage?.wall_min) ?? pos(ws?.usage?.wall_min);
  const ts = minutesBetween(r.started_at || ws?.started_at, r.ended_at || ws?.ended_at);
  let raw: number | null = null, source: TimeSource = 'none';
  if (active != null) { raw = active; source = 'active'; }
  else if (log != null) { raw = log; source = 'log'; }
  else if (ts != null) { raw = ts; source = 'timestamp'; }
  if (review?.status === 'corrected' && pos(review.minutes) != null) return { minutes: review.minutes!, raw_min: raw, time_source: 'corrected', time_status: 'corrected' };
  if (raw == null) return { minutes: null, raw_min: null, time_source: 'none', time_status: 'none' };
  const flag = raw > T.flag_minutes ? `超过 ${+(T.flag_minutes / 60).toFixed(1)} 小时` : raw < T.min_minutes ? `不足 ${T.min_minutes} 分钟` : undefined;
  if (review?.status === 'exclude') return { minutes: null, raw_min: raw, time_source: source, time_status: 'excluded', flag };
  if (!flag) return { minutes: raw, raw_min: raw, time_source: source, time_status: 'ok' };
  if (review?.status === 'include') return { minutes: raw, raw_min: raw, time_source: source, time_status: 'included', flag };
  // 建议值：开跑 → 模型写出 FINAL_MESSAGE.md。明显短于记录值时（结束时间是很晚登记 / 归档时补的），给用户一键修正
  const ev = minutesBetween(r.started_at || ws?.started_at, ws?.final_at);
  const suggest = ev != null && ev >= T.min_minutes && ev < raw * 0.9 ? Math.round(ev * 10) / 10 : null;
  return { minutes: T.pending === 'include' ? raw : null, raw_min: raw, time_source: source, time_status: 'pending', flag, suggest_min: suggest };
}

/**
 * 额度读数分摊：同一模型相邻两条读数之间用掉的额度（剩余额度只减不增；增加视为周期重置，那一段不算），
 * 按时间重叠比例分给这段时间里的运行。只有整段运行都落在有效读数区间里，才给出费用；否则写明原因、记为未记录。
 */
export function allocateLedger(runs: StoreRun[], ctx: EffContext): Map<string, { usd: number | null; note: string }> {
  const out = new Map<string, { usd: number | null; note: string }>();
  const log = ctx.eff?.quota_log || {};
  const wsByRef = new Map((ctx.workspaces || []).map((w) => [w.ref, w]));
  for (const [key, readings0] of Object.entries(log)) {
    const readings = [...(readings0 || [])].filter((x) => num(x.remaining) != null && Number.isFinite(Date.parse(x.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (readings.length < 2) continue;
    const prof = (ctx.models || []).find((m) => modelKey(m.vendor, m.name) === key);
    const mine = runs.filter((r) => modelKey(r.vendor, r.model) === key || (!r.vendor && key.endsWith('/' + r.model)));
    if (!mine.length) continue;
    const unit = readings[readings.length - 1].unit || prof?.billing?.unit;
    const price = unit === '美元' ? 1 : unitPrice(prof?.billing);
    const segs: { a: number; b: number; used: number }[] = [];
    for (let i = 0; i + 1 < readings.length; i++) {
      const x: QuotaReading = readings[i], y: QuotaReading = readings[i + 1];
      if (y.reset || y.remaining > x.remaining || (x.unit && y.unit && x.unit !== y.unit)) continue;
      segs.push({ a: Date.parse(x.at), b: Date.parse(y.at), used: x.remaining - y.remaining });
    }
    const iv = new Map(mine.map((r) => [r.run_id, intervalOf(r, r.ws_ref ? wsByRef.get(r.ws_ref) : undefined)]));
    const share = new Map<string, number>(), covered = new Map<string, number>();
    for (const s of segs) {
      const ov = mine.map((r) => { const v = iv.get(r.run_id); return v ? Math.max(0, Math.min(v[1], s.b) - Math.max(v[0], s.a)) : 0; });
      const tot = ov.reduce((p, q) => p + q, 0);
      if (!tot) continue;
      mine.forEach((r, i) => {
        if (!ov[i]) return;
        share.set(r.run_id, (share.get(r.run_id) || 0) + (s.used * ov[i]) / tot);
        covered.set(r.run_id, (covered.get(r.run_id) || 0) + ov[i]);
      });
    }
    for (const r of mine) {
      const v = iv.get(r.run_id);
      if (!v || !covered.has(r.run_id)) continue;
      if (covered.get(r.run_id)! < 0.98 * (v[1] - v[0])) { out.set(r.run_id, { usd: null, note: '额度读数没有覆盖整段运行（缺开跑前或结束后的读数，或中间周期重置）' }); continue; }
      if (price == null) { out.set(r.run_id, { usd: null, note: '模型没有填写订阅周期费用与额度，无法把额度换算成美元' }); continue; }
      out.set(r.run_id, { usd: r4(share.get(r.run_id)! * price), note: `按额度读数分摊：${+share.get(r.run_id)!.toFixed(3)} ${unit || ''}` });
    }
  }
  return out;
}

/** 解析一批运行的用时与费用 */
export function resolveRuns(runs: StoreRun[], ctx: EffContext, cfg: Pick<FullConfig, 'efficiency'>): Map<string, RunEff> {
  const wsByRef = new Map((ctx.workspaces || []).map((w) => [w.ref, w]));
  const wsByRid = new Map((ctx.workspaces || []).filter((w) => w.grader_run_id).map((w) => [w.grader_run_id!, w]));
  const models = new Map((ctx.models || []).map((m) => [modelKey(m.vendor, m.name), m]));
  const ledger = allocateLedger(runs, ctx);
  const out = new Map<string, RunEff>();
  for (const r of runs) {
    const ws = (r.ws_ref ? wsByRef.get(r.ws_ref) : undefined) || wsByRid.get(r.run_id);
    const t = resolveTime(r, ws, ctx.eff, cfg);
    const bill = models.get(modelKey(r.vendor || ws?.vendor, r.model))?.billing;
    let cost: number | null = null, source: CostSource = 'none', est = false, note: string | undefined;
    const ov = ctx.eff?.cost?.[r.run_id];
    const usage = num(r.usage?.cost_usd) != null ? r.usage : ws?.usage;
    const lg = ledger.get(r.run_id);
    // 额度差按“现在的”计费设置重新换算：周期费用 / 额度改了，历史运行跟着更新
    const q = ws?.quota && ws.quota.before != null && ws.quota.after != null ? settleQuota(ws.quota, bill) : null;
    if (ov && num(ov.cost_usd) != null && ov.cost_usd >= 0) { cost = ov.cost_usd; source = 'manual'; est = true; note = ov.note || '直接填写的估算价'; }
    else if (q?.cost_usd != null) { cost = q.cost_usd; source = 'quota'; est = true; note = `额度差 ${+(q.used ?? 0).toFixed(3)} ${ws!.quota!.unit || ''}`; }
    else if (lg?.usd != null) { cost = lg.usd; source = 'ledger'; est = true; note = lg.note; }
    else if (num(usage?.cost_usd) != null) { cost = usage!.cost_usd!; source = usage!.source === 'quota' ? 'quota' : usage!.cost_estimated ? 'token' : 'log'; est = !!usage!.cost_estimated || source === 'quota'; }
    else if (bill?.mode === 'free') { cost = 0; source = 'free'; }
    else if (lg) note = lg.note;
    out.set(r.run_id, { ...t, cost_usd: cost, cost_source: source, cost_estimated: est, cost_note: note });
  }
  return out;
}

export function timeFlags(runs: StoreRun[], resolved: Map<string, RunEff>, eff?: EffStore): TimeFlag[] {
  const out: TimeFlag[] = [];
  for (const r of runs) {
    const x = resolved.get(r.run_id);
    const rv = eff?.time_review?.[r.run_id];
    if (!x || x.raw_min == null || (!x.flag && !rv)) continue;
    out.push({
      run_id: r.run_id, entrant: r.entrant, tkey: r.tkey, ws_ref: r.ws_ref, raw_min: Math.round(x.raw_min * 10) / 10, source: x.time_source === 'corrected' ? 'timestamp' : x.time_source,
      flag: x.flag || '手动核实', status: rv?.status || 'pending', minutes: x.minutes, reason: rv?.reason, at: rv?.at, started_at: r.started_at ?? null, ended_at: r.ended_at ?? null, suggest_min: x.suggest_min ?? null,
    });
  }
  return out.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.raw_min - a.raw_min);
}

const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); const n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null; };

/** 题权重：带 A/C 变体的题，每个条件各占 1/变体数，整道题仍算 1 */
export function taskWeight(tkey: string, task: string, tasks: Pick<SpecTask, 'id' | 'variants'>[]): number {
  const t = tasks.find((x) => x.id === task);
  const nv = t ? Object.keys(t.variants || {}).length : 0;
  return nv > 1 && tkey !== task ? 1 / nv : 1;
}

export const levelOf = (u: number | null): EffMetric['level'] => (u == null ? null : u < 0.15 ? '低' : u < 0.35 ? '中' : '高');

/**
 * 相对统计。rows：每次运行一条（参赛者、题、解析值、该次运行用时的来源是否为时间戳推算）。
 * 不确定性 u（ln 尺度 1σ）= √(题间离散 + 题内多次离散 + 收缩先验) ÷ (Σw + k)，
 * 再按“排除 / 待核实的运行占比 q”和“靠开始/结束时刻推算的占比 f”放大：u × √(1 + q + 0.25 f)。显示为 e^u − 1。
 */
export function relativeStats(
  rows: { entrant: string; tkey: string; task: string; value: number | null; status: 'ok' | 'excluded' | 'pending' | 'none'; inferred?: boolean }[],
  tasks: Pick<SpecTask, 'id' | 'variants'>[], opts: { shrink: number; span: number; floor?: number },
): { by: Map<string, EffMetric>; baseline: Map<string, number> } {
  const floor = opts.floor ?? 0;
  const g = new Map<string, Map<string, typeof rows>>();
  for (const r of rows) {
    if (!g.has(r.entrant)) g.set(r.entrant, new Map());
    const m = g.get(r.entrant)!;
    if (!m.has(r.tkey)) m.set(r.tkey, []);
    m.get(r.tkey)!.push(r);
  }
  const cell = (rs: typeof rows) => {
    const v = rs.filter((r) => r.status === 'ok' && r.value != null).map((r) => Math.max(r.value!, floor));
    return { v, mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
  };
  const perTask = new Map<string, number[]>();
  for (const m of g.values()) for (const [tk, rs] of m) { const c = cell(rs); if (c.mean != null && c.mean > 0) { if (!perTask.has(tk)) perTask.set(tk, []); perTask.get(tk)!.push(c.mean); } }
  const baseline = new Map<string, number>();
  for (const [tk, xs] of perTask) baseline.set(tk, median(xs)!);
  const by = new Map<string, EffMetric>();
  for (const [e, m] of g) {
    let sw = 0, sx = 0, n = 0, excl = 0, pend = 0, inferred = 0, okRuns = 0;
    const parts: { w: number; x: number; vw: number }[] = [];
    const means: number[] = [];
    for (const [tk, rs] of m) {
      excl += rs.filter((r) => r.status === 'excluded').length;
      pend += rs.filter((r) => r.status === 'pending').length;
      const c = cell(rs);
      const b = baseline.get(tk);
      if (c.mean == null || !b || c.mean <= 0) continue;
      okRuns += c.v.length;
      inferred += rs.filter((r) => r.status === 'ok' && r.inferred).length;
      const w = taskWeight(tk, rs[0].task, tasks) * (c.v.length / (c.v.length + 1));
      const x = Math.log(c.mean / b);
      const lv = c.v.map((v) => Math.log(v));
      const lm = lv.reduce((a, q) => a + q, 0) / lv.length;
      const vw = lv.length > 1 ? lv.reduce((a, q) => a + (q - lm) ** 2, 0) / (lv.length - 1) / lv.length : 0;
      parts.push({ w, x, vw });
      sw += w; sx += w * x; n++; means.push(c.mean);
    }
    const tasksTotal = m.size;
    if (!n) {
      by.set(e, { mean: null, rel: null, score: null, unc: null, level: null, tasks: 0, tasks_total: tasksTotal, runs: 0, excluded: excl, pending: pend, inferred: 0, suite_est: null });
      continue;
    }
    const k = opts.shrink;
    const xe = sx / (sw + k);
    const xbar = sx / sw;
    const num2 = parts.reduce((a, p) => a + p.w * p.w * ((p.x - xbar) ** 2 + p.vw), 0) + k * PRIOR_LN * PRIOR_LN;
    const q = (excl + pend) / Math.max(1, okRuns + excl + pend);
    const f = inferred / Math.max(1, okRuns);
    const u = (Math.sqrt(num2) / (sw + k)) * Math.sqrt(1 + q + 0.25 * f);
    const rel = Math.exp(xe);
    const score = Math.max(0, Math.min(100, 50 - (50 * Math.log(rel)) / Math.log(opts.span)));
    let suite = 0;
    for (const b of baseline.values()) suite += b * rel;
    by.set(e, {
      mean: r4(means.reduce((a, b) => a + b, 0) / means.length), rel: r4(rel), score: Math.round(score * 10) / 10, unc: r4(Math.exp(u) - 1), level: levelOf(Math.exp(u) - 1),
      tasks: n, tasks_total: tasksTotal, runs: okRuns, excluded: excl, pending: pend, inferred, suite_est: r4(suite),
    });
  }
  return { by, baseline };
}

/** 汇总入口：给出每个参赛者的用时 / 费用相对统计 */
export function entrantEff(runs: StoreRun[], resolved: Map<string, RunEff>, tasks: Pick<SpecTask, 'id' | 'variants'>[], cfg: Pick<FullConfig, 'efficiency'>) {
  const { rel } = effSettings(cfg);
  const tRows = runs.map((r) => {
    const x = resolved.get(r.run_id)!;
    const status = x.time_status === 'excluded' ? 'excluded' as const : x.time_status === 'pending' ? (x.minutes != null ? 'ok' as const : 'pending' as const) : x.minutes != null ? 'ok' as const : 'none' as const;
    return { entrant: r.entrant, tkey: r.tkey, task: r.task, value: x.minutes, status, inferred: x.time_source === 'timestamp' || x.time_status === 'pending' };
  });
  const cRows = runs.map((r) => {
    const x = resolved.get(r.run_id)!;
    return { entrant: r.entrant, tkey: r.tkey, task: r.task, value: x.cost_usd, status: x.cost_usd != null ? 'ok' as const : 'none' as const, inferred: x.cost_estimated };
  });
  const T = relativeStats(tRows, tasks, { shrink: rel.shrink, span: rel.span });
  const C = relativeStats(cRows, tasks, { shrink: rel.shrink, span: rel.span, floor: rel.free_floor_usd });
  const empty = (e: string, m: Map<string, EffMetric>): EffMetric => m.get(e) || { mean: null, rel: null, score: null, unc: null, level: null, tasks: 0, tasks_total: 0, runs: 0, excluded: 0, pending: 0, inferred: 0, suite_est: null };
  const by: Record<string, EntrantEff> = {};
  for (const e of new Set(runs.map((r) => r.entrant))) by[e] = { time: empty(e, T.by), cost: empty(e, C.by) };
  return { by, baseline: { time: Object.fromEntries(T.baseline), cost: Object.fromEntries(C.baseline) } };
}
