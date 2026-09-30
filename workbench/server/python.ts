import { spawn, type ChildProcess } from 'node:child_process';
import type { Config } from './config';

const PY_ENV = () => ({ ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });

/** 调用 workbench/py/wbbridge.py，解析 @@WB@@ 之后的 JSON。 */
export function callBridge<T = any>(cfg: Config, args: string[], timeoutMs = 180000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!cfg.python) return reject(new Error('未找到 Python 3（bench-grader 依赖 Python）。安装后重启工作台，或设置环境变量 WB_PYTHON。'));
    const p = spawn(cfg.python, [cfg.bridgePy, ...args], { cwd: cfg.root, env: PY_ENV(), windowsHide: true });
    const out: Buffer[] = [], err: Buffer[] = [];
    const t = setTimeout(() => { p.kill(); reject(new Error(`bridge ${args[0]} 超时`)); }, timeoutMs);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', () => {
      clearTimeout(t);
      const s = Buffer.concat(out).toString('utf8');
      const i = s.lastIndexOf('@@WB@@');
      if (i < 0) return reject(new Error(`bridge ${args[0]} 无输出：${Buffer.concat(err).toString('utf8').slice(-1200)}`));
      try {
        const j = JSON.parse(s.slice(i + 6), (_k, v) => (v === 'inf' ? Infinity : v));
        if (j.ok) resolve(j.data as T); else reject(new Error(j.error));
      } catch (e) { reject(e); }
    });
  });
}

/** 以流式输出运行命令（grade / review / export 等）。 */
export function spawnStream(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; onLine: (line: string, stream: 'stdout' | 'stderr') => void; shell?: boolean }): { child: ChildProcess; done: Promise<number> } {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...PY_ENV(), ...(opts.env || {}) }, windowsHide: true, shell: opts.shell ?? false });
  const pipe = (stream: NodeJS.ReadableStream | null, name: 'stdout' | 'stderr') => {
    if (!stream) return;
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (d: string) => {
      buf += d;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() || '';
      for (const l of parts) opts.onLine(l, name);
    });
    stream.on('end', () => { if (buf) opts.onLine(buf, name); });
  };
  pipe(child.stdout, 'stdout');
  pipe(child.stderr, 'stderr');
  const done = new Promise<number>((resolve) => {
    child.on('error', (e) => { opts.onLine(`[spawn error] ${e.message}`, 'stderr'); resolve(127); });
    child.on('close', (code) => resolve(code ?? 1));
  });
  return { child, done };
}

/** Windows 下结束整棵进程树（npm run dev 会派生子进程）。 */
export function killTree(pid: number | undefined | null) {
  if (!pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  else try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* 已结束 */ } }
}
