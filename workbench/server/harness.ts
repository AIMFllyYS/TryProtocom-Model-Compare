// 检测本机已安装的 harness（Agent 软件），并按需启动：桌面应用直接启动，IDE 带上工作目录，命令行程序在工作目录打开新终端。
// 只会启动 HARNESSES 目录里登记、且在本机检测到的程序；参数不经过 shell 拼接。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { HARNESSES, type HarnessDef } from '../shared/vendors';
import { HttpError } from './http';

export interface HarnessInfo { id: string; name: string; kind: HarnessDef['kind']; icon: string | null; path: string | null; installed: boolean }

let cache: { at: number; list: HarnessInfo[] } | null = null;

function winRoots(): string[] {
  const e = process.env;
  return [e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, 'Programs'), e.ProgramFiles, e['ProgramFiles(x86)'], e.LOCALAPPDATA].filter(Boolean) as string[];
}

function findExe(h: HarnessDef): string | null {
  if (!h.win || process.platform !== 'win32') return null;
  for (const root of winRoots()) {
    for (const d of h.win.dirs) {
      const dir = path.join(root, d);
      try {
        const hit = fs.readdirSync(dir).find((f) => h.win!.exe.test(f));
        if (hit) return path.join(dir, hit);
      } catch { /* 不存在 */ }
    }
  }
  return null;
}

function findCmd(cmd: string): string | null {
  const probe = process.platform === 'win32' ? spawnSync('where', [cmd], { encoding: 'utf8', timeout: 4000, windowsHide: true }) : spawnSync('which', [cmd], { encoding: 'utf8', timeout: 4000 });
  if (probe.status !== 0) return null;
  const first = probe.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // Windows 上优先 .cmd/.exe（.ps1 需要 PowerShell 执行策略）
  return first.find((p) => /\.(exe|cmd|bat)$/i.test(p)) || first[0] || null;
}

export function detectHarnesses(force = false): HarnessInfo[] {
  if (cache && !force && Date.now() - cache.at < 60_000) return cache.list;
  const list = HARNESSES.map((h) => {
    const p = h.kind === 'cli' ? (h.cmd ? findCmd(h.cmd) : null) : findExe(h);
    return { id: h.id, name: h.name, kind: h.kind, icon: h.icon, path: p, installed: !!p };
  });
  cache = { at: Date.now(), list };
  return list;
}

/** 启动 harness。cwd 为工作目录（绝对路径，由调用方保证在仓库内）。 */
export function openHarness(id: string, cwd: string | null): { ok: true; how: string } {
  const def = HARNESSES.find((h) => h.id === id);
  if (!def) throw new HttpError(400, `未知 harness：${id}`);
  const info = detectHarnesses().find((h) => h.id === id);
  if (!info?.path) throw new HttpError(404, `本机未检测到 ${def.name}`);
  const dir = cwd && fs.existsSync(cwd) ? cwd : undefined;
  if (def.kind === 'cli') {
    if (process.platform !== 'win32') throw new HttpError(501, '命令行 harness 自动打开目前只支持 Windows；请在终端进入工作目录后手动运行');
    // 新开一个 cmd 窗口，在工作目录里运行该命令行程序（start 的第一个引号参数是窗口标题）
    spawn('cmd.exe', ['/c', 'start', def.name, '/D', dir || process.cwd(), 'cmd.exe', '/k', info.path], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return { ok: true, how: `已在新终端中启动 ${def.name}` };
  }
  const args = def.folderArg && dir ? [dir] : [];
  spawn(info.path, args, { detached: true, stdio: 'ignore', cwd: dir, windowsHide: false }).unref();
  return { ok: true, how: def.folderArg && dir ? `已用 ${def.name} 打开工作目录` : `已启动 ${def.name}` };
}
