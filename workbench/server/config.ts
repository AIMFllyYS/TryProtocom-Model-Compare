import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const VERSION = '1.0.0';
export const DEFAULT_PORT = 41873;
export const PREVIEW_PORT_RANGE: [number, number] = [41901, 41999];

/** 仓库根目录：WB_ROOT → 便携版 exe 所在目录 → 自当前文件向上查找含 skills/bench-grader 的目录。 */
export function findRoot(): string {
  const cands = [process.env.WB_ROOT, process.env.PORTABLE_EXECUTABLE_DIR, process.cwd(), __dirnameSafe()].filter(Boolean) as string[];
  for (const c of cands) {
    let d = path.resolve(c);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'skills', 'bench-grader', 'SKILL.md'))) return d;
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return path.resolve(process.env.WB_ROOT || process.cwd());
}

function __dirnameSafe(): string {
  // esbuild 以 cjs 输出，__dirname 可用；ts 类型检查时同样声明
  try { return __dirname; } catch { return process.cwd(); }
}

export interface Config {
  root: string; port: number; host: string;
  modelDir: string; benchData: string; storeFile: string; reportsDir: string; graderDir: string; skillDir: string;
  bridgePy: string; runtimeDir: string; scratchDir: string; webDist: string; python: string | null; desktop: boolean;
  token: string;
}

function detectPython(): string | null {
  const cands = [process.env.WB_PYTHON, 'python', 'python3', 'py'].filter(Boolean) as string[];
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['-c', 'import sys;print(sys.version_info[0])'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      if (r.status === 0 && r.stdout.trim() === '3') return c;
    } catch { /* 下一个 */ }
  }
  return null;
}

export function loadConfig(over: Partial<Config> = {}): Config {
  const root = over.root || findRoot();
  const env = process.env;
  const rel = (v: string | undefined, def: string) => path.resolve(root, v || def);
  const runtimeDir = path.join(root, 'workbench', '.runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const webDist = [over.webDist, env.WB_WEB_DIST, path.join(root, 'workbench', 'dist')].find((p) => p && fs.existsSync(path.join(p, 'index.html'))) || path.join(root, 'workbench', 'dist');
  const cfg: Config = {
    root, port: Number(env.WB_PORT || over.port || DEFAULT_PORT), host: '127.0.0.1',
    modelDir: rel(env.WB_MODEL_DIR, 'model'), benchData: rel(env.WB_BENCH_DATA, 'bench-data'),
    storeFile: rel(env.WB_STORE, path.join('data', 'bench-store.json')), reportsDir: rel(env.WB_REPORTS, 'reports'),
    graderDir: path.join(root, 'skills', 'bench-grader'), skillDir: path.join(root, 'skills', 'bench-workbench'),
    bridgePy: path.join(root, 'workbench', 'py', 'wbbridge.py'), runtimeDir,
    scratchDir: path.join(runtimeDir, 'scratch'), webDist, python: detectPython(), desktop: !!over.desktop,
    token: crypto.randomBytes(18).toString('base64url'), ...over,
  };
  fs.mkdirSync(cfg.scratchDir, { recursive: true });
  return cfg;
}

export const machineName = () => os.hostname();
