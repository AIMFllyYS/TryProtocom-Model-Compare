// 开发服务器进程管理：在模型工作区里运行 npm run dev / python app.py 等命令，
// 采集输出、识别本地地址，并自动创建带 bridge 注入的反向代理预览会话。
import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { ProcInfo } from '../shared/types';
import { EventHub, HttpError } from './http';
import type { Previews } from './preview';
import { killTree, spawnStream } from './python';

interface Proc extends ProcInfo { child?: ChildProcess; out: { line: string; stream: 'stdout' | 'stderr'; ts: number }[] }
const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:\/[^\s'"`)]*)?/;

export class Procs {
  list = new Map<string, Proc>();
  private n = 0;
  constructor(private hub: EventHub, private previews: Previews) {}

  info(p: Proc): ProcInfo { const { child: _c, out: _o, ...rest } = p; return rest; }
  all() { return [...this.list.values()].map((p) => this.info(p)); }
  get(id: string) { const p = this.list.get(id); if (!p) throw new HttpError(404, `进程不存在：${id}`); return p; }
  output(id: string, from = 0) { return this.get(id).out.slice(from); }

  start(opts: { cwd: string; cmd: string; name?: string; env?: Record<string, string>; autoPreview?: boolean }): ProcInfo {
    if (!fs.existsSync(opts.cwd)) throw new HttpError(400, `目录不存在：${opts.cwd}`);
    if (!opts.cmd?.trim()) throw new HttpError(400, '命令不能为空');
    const id = `c${(++this.n).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const p: Proc = { id, name: opts.name || opts.cmd, cwd: opts.cwd, cmd: opts.cmd, pid: null, status: 'running', code: null, started_at: Date.now(), ended_at: null, url: null, session_id: null, out: [] };
    this.list.set(id, p);
    const { child, done } = spawnStream(opts.cmd, [], {
      cwd: opts.cwd, shell: true,
      env: { FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none', ...(opts.env || {}) },
      onLine: (raw, stream) => {
        const line = raw.replace(ANSI, '');
        p.out.push({ line, stream, ts: Date.now() });
        if (p.out.length > 5000) p.out.splice(0, p.out.length - 5000);
        this.hub.emit({ type: 'proc-line', id, line, stream });
        if (p.session_id) this.previews.addLogs(p.session_id, [{ level: stream === 'stderr' ? 'stderr' : 'stdout', src: 'proc', text: line }]);
        if (!p.url) {
          const m = URL_RE.exec(line);
          if (m) {
            p.url = m[0].replace('0.0.0.0', '127.0.0.1').replace(/[.,;]+$/, '');
            this.hub.emit({ type: 'proc', proc: this.info(p) });
            if (opts.autoPreview !== false) {
              this.previews.createProxy({ target: p.url, label: p.name, proc_id: id }).then((s) => {
                p.session_id = s.id;
                this.hub.emit({ type: 'proc', proc: this.info(p) });
              }).catch(() => { /* 代理失败时用户可手动创建 */ });
            }
          }
        }
      },
    });
    p.child = child;
    p.pid = child.pid ?? null;
    this.hub.emit({ type: 'proc', proc: this.info(p) });
    void done.then((code) => {
      p.code = code; p.ended_at = Date.now();
      if (p.status === 'running') p.status = code === 0 ? 'exited' : 'failed';
      this.hub.emit({ type: 'proc', proc: this.info(p) });
      if (p.session_id) this.previews.addLogs(p.session_id, [{ level: 'system', src: 'proc', text: `开发服务器进程已退出（代码 ${code}）` }]);
    });
    return this.info(p);
  }

  stop(id: string) {
    const p = this.get(id);
    if (p.status === 'running') { p.status = 'exited'; killTree(p.pid); }
    if (p.session_id) this.previews.close(p.session_id);
    this.hub.emit({ type: 'proc', proc: this.info(p) });
    return this.info(p);
  }
  remove(id: string) { this.stop(id); this.list.delete(id); }
  stopAll() { for (const p of this.list.values()) if (p.status === 'running') killTree(p.pid); }
}
