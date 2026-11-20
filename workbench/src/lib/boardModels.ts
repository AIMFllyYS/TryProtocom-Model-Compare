import type { BoardRow, BoardView, ModelProfile, SpecTask, StoreRun } from '../../shared/types';
import { suiteOfRun } from '../../shared/v2';

export type ModelSelection = string[] | null;
export const modelKey = (vendor: string | null | undefined, name: string) => `${vendor || ''}/${name}`;

export interface BoardModel {
  key: string;
  vendor: string;
  name: string;
  created: number;
}

export function boardModelIndex(profiles: ModelProfile[], rows: BoardRow[], runs: StoreRun[], tasks: SpecTask[], view: BoardView) {
  const models = new Map<string, BoardModel>();
  const vendors = new Map<string, Set<string>>();
  const add = (vendor: string, name: string, created = 0) => {
    const key = modelKey(vendor, name);
    if (!models.has(key)) models.set(key, { key, vendor, name, created });
    if (vendor) {
      const known = vendors.get(name) ?? new Set<string>();
      known.add(vendor);
      vendors.set(name, known);
    }
  };
  for (const m of profiles) add(m.vendor, m.name, Date.parse(m.created_at) || 0);
  for (const r of [...rows, ...runs]) if (r.vendor) add(r.vendor, r.model);
  const keyFor = (r: Pick<BoardRow, 'vendor' | 'model'>) => {
    const known = vendors.get(r.model);
    return modelKey(r.vendor || (known?.size === 1 ? [...known][0] : ''), r.model);
  };
  const entrantKeys = new Map<string, string | null>();
  const suiteRuns = tasks.length ? runs.filter((r) => r.graded && r.score && suiteOfRun(r, tasks) === (view === 'history' ? 'v1' : 'v2')) : runs;
  for (const r of [...rows, ...suiteRuns]) {
    const key = keyFor(r);
    if (!models.has(key)) add('', r.model);
    // Historical aggregation keys omit vendor. A combined row cannot be split by the UI.
    if (!entrantKeys.has(r.entrant)) entrantKeys.set(r.entrant, key);
    else if (entrantKeys.get(r.entrant) !== key) entrantKeys.set(r.entrant, null);
  }
  const ordered = [...models.values()].sort((a, b) => b.created - a.created || a.name.localeCompare(b.name) || a.vendor.localeCompare(b.vendor));
  return { models: ordered, entrantKeys };
}
