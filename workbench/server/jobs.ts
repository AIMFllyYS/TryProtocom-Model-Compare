import type { ChildProcess } from 'node:child_process';
import type { JobInfo, JobKind } from '../shared/types';
import type { EventHub } from './http';
import { killTree, spawnStream } from './python';

interface JobSpec {
  kind: JobKind; title: string; cmd: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; shell?: boolean;
  subject?: JobInfo['subject'];
  /** 进程结束后执行（如：评分后同步存储），返回值写入 result */
  after?: (code: number, lines: string[]) => Promise<unknown> | unknown;
}
interface Job extends JobInfo { spec: JobSpec; out: string[]; child?: ChildProcess; waiters: ((j: JobInfo) => void)[] }

/** 串行任务队列：评分/导出等 Python 任务很吃内存，一次只跑一个。 */
export class Jobs {
  list: Job[] = [];
  private running = false;
  private seq = 0;
  constructor(private hub: EventHub) {}

  info(j: Job): JobInfo {
    const { spec: _s, out: _o, child: _c, waiters: _w, ...rest } = j;
    return rest;
  }
  submit(spec: JobSpec): JobInfo {
    const j: Job = { id: `j${Date.now().toString(36)}${(this.seq++).toString(36)}`, kind: spec.kind, title: spec.title, status: 'queued',
      started_at: Date.now(), queued_at: Date.now(), ended_at: null, code: null, lines: 0, subject: spec.subject, spec, out: [], waiters: [] };
    this.list.unshift(j);
    if (this.list.length > 60) this.list.splice(60).forEach((x) => x.child && killTree(x.child.pid));
    this.emitJob(j);
    void this.pump();
    return this.info(j);
  }
  /** 任务状态变化的服务端钩子（例如：登记 / 评分开始时自动召唤桌面宠物） */
  onChange: ((j: JobInfo) => void) | null = null;
  private emitJob(j: Job) {
    const info = this.info(j);
    this.hub.emit({ type: 'job', job: info });
    try { this.onChange?.(info); } catch { /* 钩子失败不影响任务 */ }
  }
  /** 是否还有进行中（运行 / 排队）的任务；kinds 限定种类 */
  busy(kinds?: JobKind[]) { return this.list.some((j) => (j.status === 'running' || j.status === 'queued') && (!kinds || kinds.includes(j.kind))); }
  get(id: string) { return this.list.find((j) => j.id === id); }
  output(id: string, from = 0) { const j = this.get(id); return j ? j.out.slice(from) : null; }
  wait(id: string): Promise<JobInfo> {
    const j = this.get(id);
    if (!j) return Promise.reject(new Error('任务不存在'));
    if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') return Promise.resolve(this.info(j));
    return new Promise((r) => j.waiters.push(r));
  }
  cancel(id: string) {
    const j = this.get(id);
    if (!j) return false;
    if (j.status === 'queued') { this.finish(j, 'cancelled', null); return true; }
    if (j.status === 'running' && j.child) { killTree(j.child.pid); j.status = 'cancelled'; return true; }
    return false;
  }
  private line(j: Job, l: string) {
    j.out.push(l);
    if (j.out.length > 8000) j.out.splice(0, j.out.length - 8000);
    j.lines++;
    this.hub.emit({ type: 'job-line', id: j.id, line: l });
  }
  private finish(j: Job, status: JobInfo['status'], code: number | null) {
    j.status = status; j.code = code; j.ended_at = Date.now();
    this.emitJob(j);
    j.waiters.splice(0).forEach((w) => w(this.info(j)));
  }
  private async pump() {
    if (this.running) return;
    const j = [...this.list].reverse().find((x) => x.status === 'queued');
    if (!j) return;
    this.running = true;
    j.status = 'running'; j.started_at = Date.now();
    this.emitJob(j);
    this.line(j, `$ ${j.spec.cmd} ${j.spec.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    try {
      const { child, done } = spawnStream(j.spec.cmd, j.spec.args, { cwd: j.spec.cwd, env: j.spec.env, shell: j.spec.shell, onLine: (l) => this.line(j, l) });
      j.child = child;
      const code = await done;
      const cancelled = (j.status as string) === 'cancelled';
      if (j.spec.after && !cancelled) {
        this.line(j, '[after] 写入结果…'); // 界面据此显示“写入结果”阶段
        try { j.result = await j.spec.after(code, j.out); } catch (e) { j.error = (e as Error).message; this.line(j, `[after] ${j.error}`); }
      }
      this.finish(j, cancelled ? 'cancelled' : code === 0 && !j.error ? 'done' : 'failed', code);
    } catch (e) {
      j.error = (e as Error).message;
      this.finish(j, 'failed', null);
    } finally {
      this.running = false;
      void this.pump();
    }
  }
}
