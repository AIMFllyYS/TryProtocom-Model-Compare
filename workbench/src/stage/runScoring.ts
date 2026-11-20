import type { BenchStore, StoreRun } from '../../shared/types';

export interface StageSidebar {
  treeOpen: boolean;
  treeMount: HTMLDivElement | null;
  scoreId: string | null;
  toggleTree: () => void;
  openScore: (runId: string) => void;
}

interface RunMatch { run?: StoreRun; ambiguous?: boolean }

export function hasHumanScore(run?: StoreRun) {
  return !!run?.score?.items.some((item) => item.method === 'human');
}

export function stageRunLookup(store: BenchStore | null, repoRoot: string) {
  const runs = store?.runs ?? [];
  const byId = new Map(runs.map((run) => [run.run_id, run]));
  const windows = /^[a-z]:|^\\\\/i.test(repoRoot);
  const normalize = (value: string) => {
    const clean = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
    return windows ? clean.toLowerCase() : clean;
  };
  const root = normalize(repoRoot);
  const relative = (value: string) => {
    const clean = normalize(value);
    if (clean.split('/').some((part) => part === '.' || part === '..')) return '';
    if (root && clean.startsWith(`${root}/`)) return clean.slice(root.length + 1);
    if (clean === root || /^(?:[a-z]:|\/)/i.test(clean)) return '';
    return clean;
  };
  const byWorkspace = new Map<string, RunMatch>();
  const runsByWorkspace = new Map<string, StoreRun[]>();
  for (const run of runs) {
    if (!run.ws_ref) continue;
    const linked = runsByWorkspace.get(run.ws_ref);
    if (linked) linked.push(run);
    else runsByWorkspace.set(run.ws_ref, [run]);
  }
  const locations = new Map<string, { match: RunMatch; directory: boolean }[]>();
  const add = (path: string, match: RunMatch, directory: boolean) => {
    const key = relative(path);
    if (!key) return;
    const known = locations.get(key);
    if (known) known.push({ match, directory });
    else locations.set(key, [{ match, directory }]);
  };
  for (const workspace of store?.workspaces ?? []) {
    if (workspace.discarded) continue;
    const direct = workspace.grader_run_id ? byId.get(workspace.grader_run_id) : undefined;
    const linked = new Set(runsByWorkspace.get(workspace.ref));
    if (direct) linked.add(direct);
    const match = linked.size > 1 ? { ambiguous: true } : { run: linked.values().next().value };
    byWorkspace.set(workspace.ref, match);
    add(`model/${workspace.ref}`, match, true);
  }
  for (const run of runs) {
    if (run.dir) add(run.dir, { run }, true);
    for (const artifact of Object.values(run.artifacts ?? {})) {
      if (/\.(mp4|webm|mov|m4v|mkv)$/i.test(artifact)) add(artifact, { run }, false);
    }
  }

  const byPath = (path: string): RunMatch | undefined => {
    const key = relative(path);
    const parts = key.split('/');
    const found: RunMatch[] = [];
    for (let size = parts.length; size > 0; size--) {
      for (const entry of locations.get(parts.slice(0, size).join('/')) ?? []) {
        if (entry.directory || size === parts.length) found.push(entry.match);
      }
    }
    if (!found.length) return undefined;
    if (found.some((ref) => ref.ambiguous) || new Set(found.map((ref) => ref.run?.run_id)).size > 1) return { ambiguous: true };
    return found[0];
  };
  return (ref?: string, path?: string): RunMatch | undefined => {
    const fromPath = path ? byPath(path) : undefined;
    const run = ref?.startsWith('run:') ? byId.get(ref.slice(4)) : undefined;
    const fromRef = run ? { run } : ref?.startsWith('ws:') ? byWorkspace.get(ref.slice(3)) : undefined;
    if (fromPath?.ambiguous || fromRef?.ambiguous || (fromPath && fromRef && fromPath.run?.run_id !== fromRef.run?.run_id)) return undefined;
    return fromPath ?? fromRef;
  };
}
