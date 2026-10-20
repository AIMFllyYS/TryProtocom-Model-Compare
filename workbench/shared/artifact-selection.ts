import type { SpecTask, StoreRun, WorkspaceRun } from './types';
import { deliverableFor } from './deliverables';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv)$/i;
const ABS_PATH = /^[a-z]:[\\/]|^\//i;

export type PreviewChoice =
  | { kind: 'video'; path: string }
  | { kind: 'static'; body: Record<string, unknown> }
  | { kind: 'none'; reason: string };

/**
 * 预览打开什么，只看这道题的交付类型：
 * 视频题打开成片；网页题打开 HTML。评分器另存的评审视频、环绕录像不代替网页。
 */
export function choosePreview(p: {
  task?: string | null; ref?: string | null; entry?: string | null; deliverableDir?: string | null;
  artifacts?: Record<string, string> | null; runDir?: string | null;
}): PreviewChoice {
  const kind = deliverableFor(p.task || '').kind;
  const rel = (x: string) => !ABS_PATH.test(x);
  if (kind === 'video') {
    if (p.ref && p.entry && VIDEO_EXT.test(p.entry)) return { kind: 'video', path: `model/${p.ref}/${p.entry}` };
    const hit = Object.entries(p.artifacts || {}).find(([k, path]) => typeof path === 'string' && rel(path) && VIDEO_EXT.test(path)
      && (/^(video|final)$/i.test(k) || /(?:^|\/)final\.(mp4|webm|mov|m4v|mkv)$/i.test(path)));
    if (hit) return { kind: 'video', path: hit[1] };
  }
  if (p.ref && p.entry && !VIDEO_EXT.test(p.entry)) return { kind: 'static', body: { ref: p.ref, entry: p.entry } };
  if (p.ref) return { kind: 'static', body: { ref: p.ref, entry: p.deliverableDir || '' } };
  if (p.runDir && rel(p.runDir)) return { kind: 'static', body: { path: `${p.runDir}/output` } };
  if (kind === 'video') return { kind: 'none', reason: '没有找到成片视频' };
  return { kind: 'none', reason: '这台电脑上没有该运行的产物文件（仅有存储文件中的分数）' };
}

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
