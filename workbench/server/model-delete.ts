import fs from 'node:fs';
import path from 'node:path';
import type { ModelProfile, WorkspaceRun } from '../shared/types';
import { HttpError } from './http';
import { referencedModelKeys, type StoreFile } from './store';
import type { Workspaces } from './workspaces';

function assertNoLinks(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || (entry.isDirectory() && path.relative(file, fs.realpathSync(file)))) {
      throw new HttpError(409, `模型目录包含链接或目录联接：${file}`);
    }
    if (entry.isDirectory()) assertNoLinks(file);
  }
}

export function inspectModelDeletion(store: StoreFile, ws: Workspaces, benchData: string, profile: ModelProfile) {
  const { vendor, name } = profile;
  const key = `${vendor}/${name}`;
  const folder = ws.checkedModelPath(vendor, name);
  if (folder.exists) assertNoLinks(folder.dir);

  const owns = (row: Parameters<typeof referencedModelKeys>[0], label: string) => {
    const keys = referencedModelKeys(row);
    if ((keys.includes(key) && keys.length > 1) || (!keys.length && row.model === name)) {
      throw new HttpError(409, `记录归属不明确：${label}`);
    }
    return keys.includes(key);
  };
  const registered = (id: string) => { throw new HttpError(409, `存在已登记的测评，无法删除模型：${id}`); };
  for (const run of store.data.runs) if (owns(run, run.run_id)) registered(run.run_id);
  for (const kind of ['runs', 'trash']) {
    const dir = path.join(benchData, kind);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const meta = path.join(dir, entry.name, 'meta.json');
      if (!fs.existsSync(meta)) continue;
      let record;
      try { record = JSON.parse(fs.readFileSync(meta, 'utf8')); }
      catch { throw new HttpError(409, `无法核查评分登记：${entry.name}`); }
      if (!record || typeof record.model !== 'string') throw new HttpError(409, `无法核查评分登记：${entry.name}`);
      if (owns(record, entry.name)) registered(entry.name);
    }
  }
  const refs = new Set<string>();
  const checkWorkspace = (w: WorkspaceRun) => {
    if (w.grader_run_id) registered(w.grader_run_id);
    if (!w.discarded && (w.started_at || w.ended_at || w.has_final || w.detect?.final || w.final_at)) {
      throw new HttpError(409, `运行已开始或有交付，无法删除模型：${w.ref}`);
    }
    refs.add(w.ref);
  };
  for (const w of store.data.workspaces) if (owns(w, w.ref)) checkWorkspace(w);
  if (folder.exists) for (const w of ws.listRuns([profile], true)) {
    if (!owns(w, w.ref)) throw new HttpError(409, `运行不属于该模型：${w.ref}`);
    checkWorkspace(w);
  }
  let trash = 0;
  for (const entry of store.data.trash || []) {
    const owned = owns(entry, entry.id);
    if ((entry.run && owns(entry.run, entry.id)) || (owned && (entry.run_id || entry.run || entry.graded || entry.total != null || entry.ws?.grader_run_id))) registered(entry.id);
    if (entry.ws && owns(entry.ws, entry.id) !== owned) throw new HttpError(409, `回收站记录归属不明确：${entry.id}`);
    if (owned) {
      trash++;
      if (entry.ref) refs.add(entry.ref);
    }
  }
  return { ...folder, refs, trash };
}
