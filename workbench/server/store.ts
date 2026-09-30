// 可移植存储文件 data/bench-store.json：模型档案、全部运行的评分与用量、工作区登记、笔记与操作历史。
// 复制这一个文件到另一台电脑，工作台即可恢复全部对比数据（产物文件可选）。
import fs from 'node:fs';
import path from 'node:path';
import type { BenchStore, ModelProfile, SpecData, StoreRun, WorkspaceRun, WsStatus } from '../shared/types';
import { entrantOf } from '../shared/aggregate';
import { machineName } from './config';

export function emptyStore(): BenchStore {
  const now = new Date().toISOString();
  return { schema: 'bench-store/1', created_at: now, updated_at: now, machine: machineName(), benchmark: {}, settings: {}, models: [], runs: [], workspaces: [], notes: [], history: [], spec: null };
}

export class StoreFile {
  data: BenchStore;
  constructor(public file: string) {
    this.data = this.read(file) || emptyStore();
  }
  private read(file: string): BenchStore | null {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'), (_k, v) => (v === 'inf' ? Infinity : v));
      if (j && j.schema === 'bench-store/1') return { ...emptyStore(), ...j };
    } catch { /* 新建 */ }
    return null;
  }
  save() {
    this.data.updated_at = new Date().toISOString();
    this.data.machine = machineName();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, (_k, v) => (v === Infinity ? 'inf' : v), 1) + '\n', 'utf8');
    fs.renameSync(tmp, this.file);
  }
  log(action: string, detail?: string) {
    this.data.history.unshift({ at: new Date().toISOString(), action, detail });
    this.data.history.splice(300);
  }

  setSpec(spec: SpecData) {
    this.data.spec = spec;
    this.data.benchmark = { name: spec.cfg.name, version: spec.cfg.version };
  }

  /** 合并 bench-grader 快照 + 工作区扫描结果。本机不存在的历史运行（从别的电脑导入）保留不动。 */
  syncFrom(snapshot: any[], models: ModelProfile[], wss: WorkspaceRun[]) {
    const now = new Date().toISOString();
    const byId = new Map(this.data.runs.map((r) => [r.run_id, r]));
    const wsByGrader = new Map(wss.filter((w) => w.grader_run_id).map((w) => [w.grader_run_id!, w]));
    for (const row of snapshot) {
      if (row.error || !row.meta) continue;
      const m = row.meta;
      const ws = wsByGrader.get(row.run_id);
      const run: StoreRun = {
        run_id: row.run_id, task: m.task, variant: m.variant || null, tkey: m.task + (m.variant || ''), model: m.model,
        vendor: m.vendor || ws?.vendor || byId.get(row.run_id)?.vendor || null, harness: m.harness, entrant: entrantOf(m),
        run_index: m.run_index ?? null, date: m.date ?? null, alias: row.alias ?? null, ws_ref: m.ws_ref || ws?.ref || null,
        started_at: m.started_at ?? null, ended_at: m.ended_at ?? null, timed_out: !!m.timed_out, failure_tag: m.failure_tag ?? null,
        graded: !!row.graded, score: row.score || null, usage: row.usage || {}, manual: row.manual || {}, artifacts: row.artifacts || {},
        notes: row.notes || [], dir: row.dir, has_final_message: !!row.has_final_message, synced_at: now, origin: machineName(),
      };
      byId.set(run.run_id, run);
    }
    this.data.runs = [...byId.values()].sort((a, b) => a.tkey.localeCompare(b.tkey) || a.entrant.localeCompare(b.entrant) || (a.run_index ?? 0) - (b.run_index ?? 0));
    // 模型档案：本机扫描为准，导入的其他模型保留
    const mm = new Map(this.data.models.map((x) => [`${x.vendor}/${x.name}`, x]));
    for (const x of models) mm.set(`${x.vendor}/${x.name}`, x);
    this.data.models = [...mm.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
    const wm = new Map(this.data.workspaces.map((x) => [x.ref, x]));
    for (const w of wss) wm.set(w.ref, { ...w, status: this.wsStatus(w) });
    // 本机已删除的工作区：如果属于本机模型目录则移除
    const local = new Set(wss.map((w) => w.ref));
    const localModels = new Set(models.map((x) => `${x.vendor}/${x.name}`));
    for (const ref of [...wm.keys()]) {
      const [v, n] = ref.split('/');
      if (localModels.has(`${v}/${n}`) && !local.has(ref)) wm.delete(ref);
    }
    this.data.workspaces = [...wm.values()].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }

  wsStatus(w: WorkspaceRun): WsStatus {
    if (w.grader_run_id) {
      const r = this.data.runs.find((x) => x.run_id === w.grader_run_id);
      if (r?.graded) return r.score && r.score.pending.length === 0 ? 'reviewed' : 'graded';
      return 'registered';
    }
    if (w.ended_at) return 'finished';
    if (w.started_at) return 'running';
    return 'prepared';
  }

  updateRun(run: StoreRun) {
    const i = this.data.runs.findIndex((r) => r.run_id === run.run_id);
    if (i >= 0) this.data.runs[i] = { ...this.data.runs[i], ...run };
    else this.data.runs.push(run);
    for (const w of this.data.workspaces) if (w.grader_run_id === run.run_id) w.status = this.wsStatus(w);
  }

  /** 导入另一份存储文件：按 run_id / 模型 / 工作区 ref 合并，较新的 synced_at 覆盖。 */
  importFrom(other: BenchStore): { runs: number; models: number; workspaces: number; notes: number } {
    if (other?.schema !== 'bench-store/1') throw new Error('不是 bench-store/1 格式的存储文件');
    const stat = { runs: 0, models: 0, workspaces: 0, notes: 0 };
    const runs = new Map(this.data.runs.map((r) => [r.run_id, r]));
    for (const r of other.runs || []) {
      const cur = runs.get(r.run_id);
      if (!cur || (r.synced_at || '') > (cur.synced_at || '')) { runs.set(r.run_id, r); stat.runs++; }
    }
    this.data.runs = [...runs.values()];
    const models = new Map(this.data.models.map((m) => [`${m.vendor}/${m.name}`, m]));
    for (const m of other.models || []) if (!models.has(`${m.vendor}/${m.name}`)) { models.set(`${m.vendor}/${m.name}`, m); stat.models++; }
    this.data.models = [...models.values()];
    const wss = new Map(this.data.workspaces.map((w) => [w.ref, w]));
    for (const w of other.workspaces || []) if (!wss.has(w.ref)) { wss.set(w.ref, w); stat.workspaces++; }
    this.data.workspaces = [...wss.values()];
    const notes = new Set(this.data.notes.map((n) => n.id));
    for (const n of other.notes || []) if (!notes.has(n.id)) { this.data.notes.push(n); stat.notes++; }
    if (!this.data.spec && other.spec) this.data.spec = other.spec;
    this.log('import', `导入 ${stat.runs} 次运行、${stat.models} 个模型（来自 ${other.machine || '未知电脑'}）`);
    return stat;
  }
}
