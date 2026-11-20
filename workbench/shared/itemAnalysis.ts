import type { ItemAnalysisRow, StoreRun } from './types';

const itemMean = (xs: number[]) => xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : 0;
const itemStd = (xs: number[]) => {
  const mu = itemMean(xs);
  return Math.sqrt(itemMean(xs.map((x) => (x - mu) ** 2)));
};
const roundItem = (x: number) => Math.round(x * 1000) / 1000;

/** Item statistics over the sample already admitted by the board's view. */
export function analyzeItems(runs: StoreRun[]): ItemAnalysisRow[] {
  const perItem = new Map<string, Map<string, number[]>>();
  const itemMeta = new Map<string, { dim: string; tier: string; method: string; desc: string; tk: string; id: string }>();
  for (const r of runs) for (const it of r.score?.items ?? []) {
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
    const means = [...byE.values()].map(itemMean);
    const mu = itemMean(allv);
    const within = itemMean([...byE.values()].map(itemStd));
    const m = itemMeta.get(key)!;
    items.push({
      task: m.tk, item_id: m.id, dim: m.dim, tier: m.tier, method: m.method, desc: m.desc, mean: roundItem(mu), between_sd: roundItem(itemStd(means)),
      within_sd: roundItem(within), n: allv.length,
      flag: mu >= 0.95 ? '天花板' : mu <= 0.05 ? '地板' : means.length > 1 && itemStd(means) < 0.05 ? '区分度低' : '',
      by_entrant: Object.fromEntries([...byE.entries()].map(([en, vs]) => [en, roundItem(itemMean(vs))])),
    });
  }
  return items;
}
