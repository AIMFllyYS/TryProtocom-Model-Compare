// 模型工作区：model/<供应商>/<模型>/
//   model.json                 模型档案
//   <题号[变体]>/r<N>/          第 N 次运行的干净工作目录（被测 Agent 在这里工作）
//   <题号[变体]>/r<N>.run.json  运行登记（评测方写入：计时、harness、bench-grader 运行 id…）
//   <题号[变体]>/r<N>.prompt.md 本次发给模型的提示词（评测方留档）
//   <题号[变体]>/r<N>.final.md  模型最后一条回复
//   <题号[变体]>/r<N>.transcript.json  T06 有人值守记录
//   _report/                   该模型的汇总报告（工作台生成）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ModelProfile, SpecTask, WorkspaceRun } from '../shared/types';
import { deliverableFor, evalDeliverable, FINAL_FILE, type Deliverable, type DetectResult } from '../shared/deliverables';
import { HttpError } from './http';

const BAD = /[<>:"/\\|?*\u0000-\u001f]/;
export function checkName(kind: string, s: unknown): string {
  const v = String(s ?? '').trim();
  if (!v || v === '.' || v === '..' || BAD.test(v) || v.length > 80 || /[. ]$/.test(v)) throw new HttpError(400, `${kind}名称不合法：“${v}”（不能含 <>:"/\\|?* ，不能以点或空格结尾）`);
  return v;
}

const readJson = <T>(p: string): T | null => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const writeJson = (p: string, d: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n', 'utf8'); };
const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const TASK_DIR = /^(T\d{2})([A-Z])?$/;
const RUN_DIR = /^r(\d+)$/;

export class Workspaces {
  constructor(public modelDir: string) { fs.mkdirSync(modelDir, { recursive: true }); }

  modelPath(vendor: string, name: string) { return path.join(this.modelDir, vendor, name); }

  listModels(): ModelProfile[] {
    const out: ModelProfile[] = [];
    for (const v of this.dirs(this.modelDir)) {
      if (v.startsWith('.') || v.startsWith('_')) continue;
      for (const m of this.dirs(path.join(this.modelDir, v))) {
        if (m.startsWith('.') || m.startsWith('_')) continue;
        const p = path.join(this.modelDir, v, m, 'model.json');
        const prof = readJson<ModelProfile>(p);
        if (prof) out.push({ ...prof, vendor: v, name: m });
        else {
          const created: ModelProfile = { schema: 1, vendor: v, name: m, created_at: this.mtime(path.join(this.modelDir, v, m)) };
          writeJson(p, created);
          out.push(created);
        }
      }
    }
    return out.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
  }
  vendors(): string[] { return this.dirs(this.modelDir).filter((v) => !v.startsWith('.') && !v.startsWith('_')); }

  upsertModel(input: Partial<ModelProfile> & { vendor: string; name: string }): ModelProfile {
    const vendor = checkName('供应商', input.vendor), name = checkName('模型', input.name);
    const dir = this.modelPath(vendor, name);
    const cur = readJson<ModelProfile>(path.join(dir, 'model.json'));
    const prof: ModelProfile = { schema: 1, created_at: cur?.created_at || new Date().toISOString(), ...(cur || {}), ...input, vendor, name } as ModelProfile;
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, 'model.json'), prof);
    return prof;
  }

  listRuns(): WorkspaceRun[] {
    const out: WorkspaceRun[] = [];
    for (const m of this.listModels()) {
      const md = this.modelPath(m.vendor, m.name);
      for (const t of this.dirs(md)) {
        const tm = TASK_DIR.exec(t);
        if (!tm) continue;
        const td = path.join(md, t);
        const seen = new Set<number>();
        for (const f of fs.readdirSync(td)) {
          const rm = /^r(\d+)\.run\.json$/.exec(f) || (isDir(path.join(td, f)) ? RUN_DIR.exec(f) : null);
          if (!rm) continue;
          const n = Number(rm[1]);
          if (seen.has(n)) continue;
          seen.add(n);
          out.push(this.readRun(m.vendor, m.name, t, n));
        }
      }
    }
    return out.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }

  parseRef(ref: string) {
    const parts = ref.split('/');
    if (parts.length !== 4) throw new HttpError(400, `工作区引用应为 供应商/模型/题号/rN：${ref}`);
    const [vendor, model, tkey, r] = parts;
    checkName('供应商', vendor); checkName('模型', model);
    const tm = TASK_DIR.exec(tkey), rm = RUN_DIR.exec(r);
    if (!tm || !rm) throw new HttpError(400, `工作区引用不合法：${ref}`);
    return { vendor, model, tkey, task: tm[1], variant: tm[2] || null, index: Number(rm[1]) };
  }
  files(ref: string) {
    const { vendor, model, tkey, index } = this.parseRef(ref);
    const td = path.join(this.modelPath(vendor, model), tkey);
    const b = path.join(td, `r${index}`);
    return { taskDir: td, ws: b, run: `${b}.run.json`, prompt: `${b}.prompt.md`, final: `${b}.final.md`, transcript: `${b}.transcript.json` };
  }

  readRun(vendor: string, model: string, tkey: string, index: number): WorkspaceRun {
    const ref = `${vendor}/${model}/${tkey}/r${index}`;
    const f = this.files(ref);
    const tm = TASK_DIR.exec(tkey)!;
    const cur = readJson<WorkspaceRun>(f.run);
    const run: WorkspaceRun = {
      schema: 1, vendor, model, task: tm[1], variant: tm[2] || null, tkey, index, harness: '', created_at: this.mtime(f.ws),
      started_at: null, ended_at: null, deliverable_dir: '', grader_run_id: null, ...(cur || {}), ref,
    };
    run.workspace = f.ws;
    run.has_final = fs.existsSync(f.final);
    const droot = run.deliverable_dir ? path.join(f.ws, run.deliverable_dir) : f.ws;
    run.has_deliverable = !!run.deliverable_dir && isDir(droot);
    const d = deliverableFor(run.task, run.deliverable_dir);
    const pv = d.preview && run.has_deliverable ? path.join(droot, d.preview) : null;
    run.entry = pv && fs.existsSync(pv) ? path.relative(f.ws, pv).split(path.sep).join('/') : this.detectEntry(run.has_deliverable ? droot : f.ws, f.ws);
    run.detect = this.detect(f.ws, d, run.deliverable_dir);
    return run;
  }

  /** 交付检测：按清单逐项检查 + 最近修改时间 + FINAL_MESSAGE.md 是否出现。 */
  detect(ws: string, d: Deliverable, dirName: string): DetectResult {
    const dd = { ...d, dir: d.dir || dirName };
    const exists = (rel: string, dir?: boolean) => { try { const s = fs.statSync(path.join(ws, rel)); return dir ? s.isDirectory() : true; } catch { return false; } };
    const list = (rel: string) => { try { return fs.readdirSync(path.join(ws, rel)); } catch { return []; } };
    const checks = evalDeliverable(dd, exists, list);
    const req = checks.filter((c) => !c.optional);
    let last: number | null = null;
    const walk = (p: string, depth: number) => {
      if (depth > 3) return;
      let es: fs.Dirent[] = [];
      try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const fp = path.join(p, e.name);
        try { const m = fs.statSync(fp).mtimeMs; if (!last || m > last) last = m; } catch { /* */ }
        if (e.isDirectory()) walk(fp, depth + 1);
      }
    };
    if (dd.dir && isDir(path.join(ws, dd.dir))) walk(path.join(ws, dd.dir), 0);
    return { dir_exists: !!dd.dir && isDir(path.join(ws, dd.dir)), checks, done: req.filter((c) => c.ok).length, total: req.length, final: fs.existsSync(path.join(ws, FINAL_FILE)), last_change: last };
  }

  /** 模型写出 FINAL_MESSAGE.md 后：导入为 rN.final.md，并以文件时间结束计时。返回是否有变化。 */
  absorbFinal(ref: string): boolean {
    const f = this.files(ref);
    const src = path.join(f.ws, FINAL_FILE);
    if (!fs.existsSync(src)) return false;
    let changed = false;
    const txt = fs.readFileSync(src, 'utf8');
    const cur = fs.existsSync(f.final) ? fs.readFileSync(f.final, 'utf8') : null;
    if (cur == null) { fs.writeFileSync(f.final, txt, 'utf8'); changed = true; }
    const p = this.parseRef(ref);
    const run = this.readRun(p.vendor, p.model, p.tkey, p.index);
    if (!run.ended_at && !run.grader_run_id) {
      run.ended_at = new Date(fs.statSync(src).mtimeMs).toISOString();
      if (!run.started_at) run.started_at = run.created_at;
      run.auto_finished = true;
      this.saveRun(run);
      changed = true;
    }
    return changed;
  }

  /** 与 benchlib/review._entry 一致的入口优先级，另外识别视频 */
  detectEntry(root: string, ws: string): string | null {
    if (!isDir(root)) return null;
    for (const c of ['dist/index.html', 'index.html', 'final.mp4', 'renders/final.mp4', 'FIXES.md', 'README.md']) {
      const p = path.join(root, c);
      if (fs.existsSync(p)) return path.relative(ws, p).split(path.sep).join('/');
    }
    try {
      const v = fs.readdirSync(root).find((x) => /\.(mp4|webm|mov)$/i.test(x));
      if (v) return path.relative(ws, path.join(root, v)).split(path.sep).join('/');
    } catch { /* ignore */ }
    return null;
  }

  /** 下一个可用的运行序号（题目页据此预先生成带绝对路径的提示词）。 */
  nextIndex(vendor: string, model: string, tkey: string): number {
    const td = path.join(this.modelPath(vendor, model), tkey);
    let n = 1;
    while (fs.existsSync(path.join(td, `r${n}`)) || fs.existsSync(path.join(td, `r${n}.run.json`))) n++;
    return n;
  }
  wsPath(vendor: string, model: string, tkey: string, n: number) { return path.join(this.modelPath(vendor, model), tkey, `r${n}`); }

  createRun(input: { vendor: string; model: string; task: SpecTask; variant: string | null; harness: string; taskDir: string; prompt: string | ((ws: string, n: number) => string); index?: number }): WorkspaceRun {
    const { vendor, model, task } = input;
    checkName('供应商', vendor); checkName('模型', model);
    if (Object.keys(task.variants || {}).length && !input.variant) throw new HttpError(400, `${task.id} 需要选择变体（${Object.keys(task.variants).join(' / ')}）`);
    if (input.variant && !(task.variants || {})[input.variant]) throw new HttpError(400, `${task.id} 没有变体 ${input.variant}`);
    if (!this.listModels().some((m) => m.vendor === vendor && m.name === model)) this.upsertModel({ vendor, name: model, harness: input.harness });
    const tkey = task.id + (input.variant || '');
    const td = path.join(this.modelPath(vendor, model), tkey);
    fs.mkdirSync(td, { recursive: true });
    let n = input.index && input.index > 0 ? input.index : this.nextIndex(vendor, model, tkey);
    if (fs.existsSync(path.join(td, `r${n}`)) || fs.existsSync(path.join(td, `r${n}.run.json`))) n = this.nextIndex(vendor, model, tkey);
    const ws = path.join(td, `r${n}`);
    fs.mkdirSync(ws, { recursive: true });
    // 预置素材：复制 materials/ 下的全部内容到工作目录根（assets/、studyspot-legacy/ …）；hidden/ 永不复制
    const mat = path.join(input.taskDir, 'materials');
    if (isDir(mat)) for (const e of fs.readdirSync(mat)) fs.cpSync(path.join(mat, e), path.join(ws, e), { recursive: true });
    // 让工作目录成为独立的项目根：Codex / Claude Code / Cursor 等按 git 根向上查找 skills 与规则，
    // 这样被测 Agent 不会发现仓库根目录 .agents/skills 里的评分 skill（防止评分细则泄露给被测模型）。
    try { spawnSync('git', ['init', '-q'], { cwd: ws, timeout: 10000, windowsHide: true }); } catch { /* 没装 git 时跳过 */ }
    const run: WorkspaceRun = {
      schema: 1, ref: `${vendor}/${model}/${tkey}/r${n}`, vendor, model, task: task.id, variant: input.variant, tkey, index: n,
      harness: input.harness, created_at: new Date().toISOString(), started_at: null, ended_at: null, deliverable_dir: task.deliverable,
      grader_run_id: null, usage: {}, notes: '',
    };
    this.saveRun(run);
    fs.writeFileSync(`${ws}.prompt.md`, typeof input.prompt === 'function' ? input.prompt(ws, n) : input.prompt, 'utf8');
    return this.readRun(vendor, model, tkey, n);
  }

  saveRun(run: WorkspaceRun) {
    const { workspace: _w, has_final: _h, has_deliverable: _d, entry: _e, status: _s, detect: _t, ...persist } = run;
    writeJson(this.files(run.ref).run, persist);
  }

  patchRun(ref: string, patch: Partial<WorkspaceRun>): WorkspaceRun {
    const p = this.parseRef(ref);
    const cur = this.readRun(p.vendor, p.model, p.tkey, p.index);
    const allowed: (keyof WorkspaceRun)[] = ['harness', 'started_at', 'ended_at', 'timed_out', 'notes', 'usage', 'grader_run_id', 'deliverable_dir'];
    for (const k of allowed) if (k in patch) (cur as any)[k] = (patch as any)[k];
    this.saveRun(cur);
    return this.readRun(p.vendor, p.model, p.tkey, p.index);
  }

  writeFinal(ref: string, text: string) { fs.writeFileSync(this.files(ref).final, text, 'utf8'); }
  writeTranscript(ref: string, data: unknown) { writeJson(this.files(ref).transcript, data); }

  private dirs(p: string): string[] {
    try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  }
  private mtime(p: string) { try { return fs.statSync(p).mtime.toISOString(); } catch { return new Date().toISOString(); } }
}
