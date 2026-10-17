import type { SpecTask, StoreRun, WorkspaceRun } from './types';

export function workspaceForRun(run: StoreRun, workspaces: WorkspaceRun[]) {
  return workspaces.find((w) => w.ref === run.ws_ref) || workspaces.find((w) => w.grader_run_id === run.run_id);
}

/** 展示用最高分样本；不影响首轮代表或聚合统计。零分有效，未评分不参与。 */
export function bestArtifactRun(runs: StoreRun[], entrant: string, tkey: string) {
  return runs.filter((r) => r.entrant === entrant && r.tkey === tkey && r.score && Number.isFinite(r.score.total))
    .sort((a, b) => b.score!.total - a.score!.total || (a.run_index ?? Infinity) - (b.run_index ?? Infinity) || a.run_id.localeCompare(b.run_id))[0];
}

export function artifactTaskKeys(tasks: SpecTask[], extra: string[] = []) {
  return [...new Set([...tasks.flatMap((t) => Object.keys(t.variants).length ? Object.keys(t.variants).map((v) => t.id + v) : [t.id]), ...extra])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export interface ArtifactChoice { key: string; model: string; vendor: string | null; tkey: string; index: number | null; harness: string; ws?: WorkspaceRun; run?: StoreRun }
export function artifactChoices(workspaces: WorkspaceRun[], runs: StoreRun[]): ArtifactChoice[] {
  const active = workspaces.filter((w) => !w.discarded);
  return [
    ...active.map((w) => ({ key: 'ws:' + w.ref, model: w.model, vendor: w.vendor, tkey: w.tkey, index: w.index, harness: w.harness, ws: w, run: runs.find((r) => r.run_id === w.grader_run_id || r.ws_ref === w.ref) })),
    ...runs.filter((r) => !workspaceForRun(r, workspaces)).map((r) => ({ key: 'run:' + r.run_id, model: r.model, vendor: r.vendor, tkey: r.tkey, index: r.run_index, harness: r.harness, run: r })),
  ];
}
