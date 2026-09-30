// 可移植存储文件 data/bench-store.json：模型档案、全部运行的评分与用量、工作区登记、笔记与操作历史。
// 复制这一个文件到另一台电脑，工作台即可恢复全部对比数据（产物文件可选）。
import fs from 'node:fs';
import path from 'node:path';
import type { BenchStore, DiscardInfo, ModelProfile, SpecData, StoreRun, TrashEntry, WorkspaceRun, WsStatus } from '../shared/types';
import { entrantOf } from '../shared/aggregate';
import { machineName } from './config';

export function emptyStore(): BenchStore {
  const now = new Date().toISOString();
  return { schema: 'bench-store/1', created_at: now, updated_at: now, machine: machineName(), benchmark: {}, settings: {}, models: [], runs: [], workspaces: [], notes: [], history: [], spec: null, trash: [] };
}

/** 作废前所处阶段（给回收站显示“从哪一列删掉的”） */
export function stageLabel(w: WorkspaceRun | undefined, run: StoreRun | undefined): string {
  if (run) return run.graded ? (run.score?.complete ? '已完成' : '待评分') : '待评分';
  if (!w) return '—';
  if (w.ended_at || w.detect?.final) return '已交付';
  if (w.started_at) return '进行中';
  return '未开始';
}

export function trashEntryOf(w: WorkspaceRun | undefined, run: StoreRun | undefined, d: DiscardInfo): TrashEntry {
  const ref = w?.ref || run?.ws_ref || null;
  return {
    id: w?.ref || 'run:' + run!.run_id, ref, run_id: run?.run_id || w?.grader_run_id || null,
    vendor: w?.vendor || run?.vendor || null, model: w?.model || run!.model, task: w?.task || run!.task, variant: w?.variant ?? run?.variant ?? null,
    tkey: w?.tkey || run!.tkey, index: w?.index ?? run?.run_index ?? null, harness: w?.harness || run?.harness || '',
    at: d.at, reason: d.reason || '', stopped: !!d.stopped, from: d.from || stageLabel(w, run),
    started_at: w?.started_at ?? run?.started_at ?? null, ended_at: w?.ended_at ?? run?.ended_at ?? null,
    total: run?.score?.total ?? null, graded: !!run?.graded,
    ws: w ? { ...w, discarded: d } : undefined, run,
  };
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
    // 模型档案：本机扫描为准，导入的其他模型保留
    const mm = new Map(this.data.models.map((x) => [`${x.vendor}/${x.name}`, x]));
    for (const x of models) mm.set(`${x.vendor}/${x.name}`, x);
    this.data.models = [...mm.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
    const wm = new Map(this.data.workspaces.map((x) => [x.ref, x]));
    for (const w of wss) wm.set(w.ref, w);
    // 本机已删除的工作区：如果属于本机模型目录则移除
    const local = new Set(wss.map((w) => w.ref));
    const localModels = new Set(models.map((x) => `${x.vendor}/${x.name}`));
    const isLocalModel = (ref: string) => { const [v, n] = ref.split('/'); return localModels.has(`${v}/${n}`); };
    for (const ref of [...wm.keys()]) if (isLocalModel(ref) && !local.has(ref)) wm.delete(ref);

    // ---- 回收站：rN.run.json 里带 discarded 的运行移出 workspaces / runs，所有评估入口天然看不到 ----
    const trash = new Map((this.data.trash || []).map((t) => [t.id, t]));
    for (const [id, t] of trash) {
      if (!t.ref) continue;
      const w = wm.get(t.ref);
      if (w && !w.discarded) {
        // 已恢复（磁盘上的作废标记被清除）：把快照里的评分记录放回来
        trash.delete(id);
        if (t.run && !byId.has(t.run.run_id)) byId.set(t.run.run_id, t.run);
      } else if (!w && isLocalModel(t.ref) && !local.has(t.ref)) trash.delete(id); // 文件夹已被手动删除
    }
    for (const w of [...wm.values()]) {
      if (!w.discarded) continue;
      wm.delete(w.ref);
      const prev = trash.get(w.ref);
      const rid = w.grader_run_id || prev?.run_id || null;
      const run = (rid ? byId.get(rid) : undefined) || prev?.run || [...byId.values()].find((r) => r.ws_ref === w.ref);
      trash.set(w.ref, trashEntryOf(w, run, w.discarded));
    }
    for (const t of trash.values()) if (t.run_id) byId.delete(t.run_id);
    this.data.trash = [...trash.values()].sort((a, b) => b.at.localeCompare(a.at));

    this.data.runs = [...byId.values()].sort((a, b) => a.tkey.localeCompare(b.tkey) || a.entrant.localeCompare(b.entrant) || (a.run_index ?? 0) - (b.run_index ?? 0));
    for (const [k, w] of wm) wm.set(k, { ...w, status: this.wsStatus(w) });
    this.data.workspaces = [...wm.values()].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }

  /** 只有存储记录的运行（没有本机工作区）直接移入回收站。 */
  trashStoreOnly(entry: TrashEntry) {
    const trash = this.data.trash || [];
    this.data.trash = [entry, ...trash.filter((t) => t.id !== entry.id)];
    if (entry.run_id) this.data.runs = this.data.runs.filter((r) => r.run_id !== entry.run_id);
    if (entry.ref) this.data.workspaces = this.data.workspaces.filter((w) => w.ref !== entry.ref);
  }
  /** 恢复只有存储记录的条目：快照放回 runs / workspaces。 */
  restoreStoreOnly(id: string): TrashEntry | null {
    const t = (this.data.trash || []).find((x) => x.id === id);
    if (!t) return null;
    this.data.trash = (this.data.trash || []).filter((x) => x.id !== id);
    if (t.run && !this.data.runs.some((r) => r.run_id === t.run!.run_id)) this.data.runs.push({ ...t.run, synced_at: new Date().toISOString() });
    if (t.ws && !this.data.workspaces.some((w) => w.ref === t.ws!.ref)) { const { discarded: _d, ...w } = t.ws; this.data.workspaces.push(w); }
    return t;
  }
  dropTrash(ids: string[]) { const s = new Set(ids); this.data.trash = (this.data.trash || []).filter((t) => !s.has(t.id)); }

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
    // 回收站先合并：对方作废的运行在本机也不参与评估（本机已恢复 / 仍在用的不受影响）
    const trash = new Map((this.data.trash || []).map((t) => [t.id, t]));
    const liveRefs = new Set(this.data.workspaces.map((w) => w.ref));
    const liveIds = new Set(this.data.runs.map((r) => r.run_id));
    for (const t of other.trash || []) if (!trash.has(t.id) && !(t.ref && liveRefs.has(t.ref)) && !(t.run_id && liveIds.has(t.run_id))) trash.set(t.id, t);
    this.data.trash = [...trash.values()];
    const trashedIds = new Set(this.data.trash.map((t) => t.run_id).filter(Boolean) as string[]);
    const trashedRefs = new Set(this.data.trash.map((t) => t.ref).filter(Boolean) as string[]);
    const runs = new Map(this.data.runs.map((r) => [r.run_id, r]));
    for (const r of other.runs || []) {
      if (trashedIds.has(r.run_id)) continue;
      const cur = runs.get(r.run_id);
      if (!cur || (r.synced_at || '') > (cur.synced_at || '')) { runs.set(r.run_id, r); stat.runs++; }
    }
    this.data.runs = [...runs.values()];
    const models = new Map(this.data.models.map((m) => [`${m.vendor}/${m.name}`, m]));
    for (const m of other.models || []) if (!models.has(`${m.vendor}/${m.name}`)) { models.set(`${m.vendor}/${m.name}`, m); stat.models++; }
    this.data.models = [...models.values()];
    const wss = new Map(this.data.workspaces.map((w) => [w.ref, w]));
    for (const w of other.workspaces || []) if (!wss.has(w.ref) && !trashedRefs.has(w.ref)) { wss.set(w.ref, w); stat.workspaces++; }
    this.data.workspaces = [...wss.values()];
    const notes = new Set(this.data.notes.map((n) => n.id));
    for (const n of other.notes || []) if (!notes.has(n.id)) { this.data.notes.push(n); stat.notes++; }
    if (!this.data.spec && other.spec) this.data.spec = other.spec;
    this.log('import', `导入 ${stat.runs} 次运行、${stat.models} 个模型（来自 ${other.machine || '未知电脑'}）`);
    return stat;
  }
}
