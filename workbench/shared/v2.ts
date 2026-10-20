// v2 榜单视图：历史版 / 简化版（每题取最高）/ 完整版（测满 3 次 + 稳定性）。
// 逐行对应 bench-grader/scripts/benchlib/v2.py，输入只依赖可移植存储里的 StoreRun。
import type { BoardView, FullConfig, SpecTask, StoreRun } from './types';

export const V1_VERSION = 'v1.0';

export const versionOf = (r: Pick<StoreRun, 'benchmark_version'>) => r.benchmark_version || V1_VERSION;
export const isV2 = (r: Pick<StoreRun, 'benchmark_version'>) => versionOf(r).toLowerCase().startsWith('v2');
export const suiteOf = (t: Pick<SpecTask, 'suite'>) => t.suite || 'v1';

/** 一次运行属于哪套题库。以题目的 suite 为准，不看分数上的版本号：旧提示词的分数不能进 v2 榜。认不出的题一律算历史版。 */
export function suiteOfRun(r: Pick<StoreRun, 'task' | 'tkey'>, tasks: SpecTask[]): 'v1' | 'v2' {
  const hit = tasks.find((t) => r.task === t.id || r.tkey === t.id || Object.keys(t.variants || {}).some((v) => r.tkey === t.id + v));
  return hit && suiteOf(hit) === 'v2' ? 'v2' : 'v1';
}

/** 某题库要求测满的 tkey（带 A/C 变体的题展开成 T03A / T03C） */
export function requiredTkeys(tasks: SpecTask[], suite = 'v2'): string[] {
  const keys: string[] = [];
  for (const t of tasks) {
    if (suiteOf(t) !== suite) continue;
    const vs = Object.keys(t.variants || {});
    if (vs.length) keys.push(...vs.map((v) => t.id + v)); else keys.push(t.id);
  }
  return keys;
}

const psd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const r1 = (x: number) => Math.round(x * 10) / 10;

const tier0Ok = (r: StoreRun) => {
  const s = r.score!;
  if (s.tier0_pass == null) return !!s.gate_pass && (s.total || 0) > 0;
  return !!s.tier0_pass && !!s.gate_pass;
};

export interface Stability { stability: number | null; availability: number | null; consistency: number | null; incidents: number }

export function stability(byTask: Map<string, StoreRun[]>, cfg: FullConfig): Stability {
  const sc = cfg.v2?.stability || {};
  const wa = sc.availability_weight ?? 0.5, wc = sc.consistency_weight ?? 0.5, k = sc.consistency_k ?? 2;
  const all = [...byTask.values()].flat();
  if (!all.length) return { stability: null, availability: null, consistency: null, incidents: 0 };
  const avail = (100 * all.filter(tier0Ok).length) / all.length;
  const sds = [...byTask.values()].filter((rs) => rs.length >= 2).map((rs) => psd(rs.map((r) => r.score!.total)));
  const cons = sds.length ? Math.max(0, Math.min(100, 100 - k * (sds.reduce((a, b) => a + b, 0) / sds.length))) : null;
  return {
    stability: cons == null ? null : r1((wa * avail + wc * cons) / (wa + wc)),
    availability: r1(avail), consistency: cons == null ? null : r1(cons), incidents: all.filter((r) => r.incident).length,
  };
}

export interface ViewInfo {
  entrants: Record<string, Partial<Stability> & { n_min?: number; n_max?: number; star?: boolean; incident_retries?: number }>;
  excluded: { entrant: string; missing: string[] }[];
}

/** runs 必须已是“已评分”的运行。简化版里被选中的运行带 n_used（用了几次）。 */
export function applyView(runs: StoreRun[], view: BoardView, cfg: FullConfig, tasks: SpecTask[]): { runs: (StoreRun & { n_used?: number })[]; info: ViewInfo } {
  const info: ViewInfo = { entrants: {}, excluded: [] };
  const inV2 = (r: StoreRun) => suiteOfRun(r, tasks) === 'v2';
  if (view === 'history') return { runs: runs.filter((r) => !inV2(r)), info };
  const v2runs = runs.filter(inV2);
  const by = new Map<string, StoreRun[]>();
  const key = (e: string, t: string) => `${e}\u0000${t}`;
  for (const r of v2runs) {
    const kk = key(r.entrant, r.tkey);
    if (!by.has(kk)) by.set(kk, []);
    by.get(kk)!.push(r);
  }
  for (const rs of by.values()) rs.sort((a, b) => (a.run_index ?? 0) - (b.run_index ?? 0) || a.run_id.localeCompare(b.run_id));
  const entrants = [...new Set(v2runs.map((r) => r.entrant))].sort();
  if (view === 'simple') {
    const out: (StoreRun & { n_used?: number })[] = [];
    for (const e of entrants) {
      const ns: number[] = [];
      let retries = 0;
      for (const kk of [...by.keys()].sort()) {
        const [ee] = kk.split('\u0000');
        if (ee !== e) continue;
        const rs = by.get(kk)!;
        // 最高分；同分取更早的一次
        const best = rs.reduce((a, b) => (b.score!.total > a.score!.total ? b : a));
        out.push({ ...best, n_used: rs.length });
        ns.push(rs.length);
        retries += rs.filter((r) => r.incident).length;
      }
      info.entrants[e] = { n_min: Math.min(...ns), n_max: Math.max(...ns), star: Math.max(...ns) > 1, incident_retries: retries };
    }
    return { runs: out, info };
  }
  const need = cfg.v2?.full_runs ?? 3;
  const req = requiredTkeys(tasks, 'v2');
  const required = req.length ? req : [...new Set(v2runs.map((r) => r.tkey))].sort();
  const out: StoreRun[] = [];
  for (const e of entrants) {
    const missing = required.filter((tk) => (by.get(key(e, tk))?.length ?? 0) < need).map((tk) => `${tk}（${by.get(key(e, tk))?.length ?? 0}/${need}）`);
    if (missing.length) { info.excluded.push({ entrant: e, missing }); continue; }
    const picked = new Map<string, StoreRun[]>();
    for (const tk of required) picked.set(tk, by.get(key(e, tk))!.slice(0, need)); // 只取前 need 次，避免“多测挑好的”
    for (const rs of picked.values()) out.push(...rs);
    info.entrants[e] = stability(picked, cfg);
  }
  return { runs: out, info };
}
