// 检测本机已安装的 harness（Agent 软件），并按需启动：
//   桌面应用直接启动（商店 / MSIX 应用经 shell:AppsFolder），IDE 带上工作目录，
//   支持 URL 协议的应用（Codex 桌面版）直接在工作目录新建会话，命令行程序在工作目录打开新终端。
// 只会启动 HARNESSES 目录里登记、且在本机检测到的程序；参数不经过 shell 拼接。
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { HARNESSES, type HarnessDef } from '../shared/vendors';
import { HttpError } from './http';

/** via：exe = 找到了可执行文件；cmd = 命令行程序；appx = 只能经开始菜单 AppID 启动 */
export interface HarnessInfo {
  id: string; name: string; kind: HarnessDef['kind']; icon: string | null; path: string | null; installed: boolean;
  via?: 'exe' | 'cmd' | 'appx'; opens_dir?: boolean; note?: string;
}

let cache: { at: number; list: HarnessInfo[] } | null = null;

// ---------- 开始菜单扫描（一次 PowerShell 调用：Get-StartApps + 开始菜单 .lnk 目标），异步，缓存 10 分钟 ----------
interface ShellScan { apps: { n: string; id: string }[]; lnks: { n: string; t: string }[] }
let scan: { at: number; data: ShellScan } | null = null;
let scanning: Promise<ShellScan> | null = null;
const SCAN_TTL = 10 * 60_000;
const PS_SCAN = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
  '$ws=New-Object -ComObject WScript.Shell;',
  "$d=@([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'));",
  '$l=foreach($x in $d){Get-ChildItem -LiteralPath $x -Recurse -Filter *.lnk -ErrorAction SilentlyContinue|ForEach-Object{$t=$ws.CreateShortcut($_.FullName).TargetPath;if($t -like "*.exe"){[pscustomobject]@{n=$_.BaseName;t=$t}}}};',
  '$a=Get-StartApps|ForEach-Object{[pscustomobject]@{n=$_.Name;id=$_.AppID}};',
  '@{apps=@($a);lnks=@($l)}|ConvertTo-Json -Compress -Depth 3',
].join('');

export function scanShell(force = false): Promise<ShellScan> {
  const empty: ShellScan = { apps: [], lnks: [] };
  if (process.platform !== 'win32') return Promise.resolve(empty);
  if (scan && !force && Date.now() - scan.at < SCAN_TTL) return Promise.resolve(scan.data);
  if (scanning) return scanning;
  scanning = new Promise<ShellScan>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCAN], { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 8 << 20 }, (_err, stdout) => {
      let data = scan?.data || empty;
      try {
        const j = JSON.parse(String(stdout || '').trim() || '{}');
        const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v ? [v] : []) as T[];
        data = { apps: arr<{ n: string; id: string }>(j.apps).filter((x) => x && x.id), lnks: arr<{ n: string; t: string }>(j.lnks).filter((x) => x && x.t) };
        scan = { at: Date.now(), data };
        cache = null;   // 下次 detectHarnesses 用新结果
      } catch { /* 扫描失败时沿用旧结果 */ }
      scanning = null;
      resolve(data);
    });
  });
  return scanning;
}

function winRoots(): string[] {
  const e = process.env;
  return [e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, 'Programs'), e.ProgramFiles, e['ProgramFiles(x86)'], e.LOCALAPPDATA].filter(Boolean) as string[];
}

function findExe(h: HarnessDef, sc: ShellScan | null): string | null {
  if (process.platform !== 'win32') return null;
  if (h.win) {
    for (const root of winRoots()) {
      for (const d of h.win.dirs) {
        const dir = path.join(root, d);
        try {
          const hit = fs.readdirSync(dir).find((f) => h.win!.exe.test(f));
          if (hit) return path.join(dir, hit);
        } catch { /* 不存在 */ }
      }
    }
  }
  // 开始菜单快捷方式指向的 exe（跳过卸载程序）
  if (h.lnk && sc) {
    const hit = sc.lnks.find((l) => h.lnk!.test(l.n) && !/unins|uninstall|update/i.test(l.t) && fs.existsSync(l.t));
    if (hit) return hit.t;
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

/** 同步读取：用已有的开始菜单扫描结果；结果过期时在后台刷新（首次调用前请先 await scanShell()）。 */
export function detectHarnesses(force = false): HarnessInfo[] {
  if (force) cache = null;
  if (!scan || Date.now() - scan.at > SCAN_TTL) void scanShell();
  if (cache && Date.now() - cache.at < 60_000) return cache.list;
  const sc = scan?.data || null;
  const list = HARNESSES.map((h): HarnessInfo => {
    const base = { id: h.id, name: h.name, kind: h.kind, icon: h.icon, note: h.note };
    if (h.kind === 'cli') {
      const p = h.cmd ? findCmd(h.cmd) : null;
      return { ...base, path: p, installed: !!p, via: p ? 'cmd' : undefined, opens_dir: !!p };
    }
    const exe = findExe(h, sc);
    const app = h.appId && sc ? sc.apps.find((a) => h.appId!.test(a.id)) : undefined;
    if (!exe && !app) return { ...base, path: null, installed: false };
    const opensDir = !!h.deepLink || (!!exe && !!h.folderArg);
    return {
      ...base, installed: true,
      path: exe || `shell:AppsFolder\\${app!.id}`, via: exe ? 'exe' : 'appx', opens_dir: opensDir,
      note: opensDir ? undefined : h.note,
    };
  });
  cache = { at: Date.now(), list };
  return list;
}

/** 用系统默认处理程序打开 URL 协议（codex:// 等）。不经过 shell 解析。 */
function openUrl(url: string) {
  if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
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
  // 1) 支持 URL 协议的应用：直接在工作目录新建会话
  if (def.deepLink && dir) {
    openUrl(def.deepLink(dir));
    return { ok: true, how: `已用 ${def.name} 在工作目录中新建会话` };
  }
  // 2) 找到了 exe：IDE 带工作目录参数
  if (info.via === 'exe') {
    const args = def.folderArg && dir ? [dir] : [];
    spawn(info.path, args, { detached: true, stdio: 'ignore', cwd: dir, windowsHide: false }).unref();
    return { ok: true, how: def.folderArg && dir ? `已用 ${def.name} 打开工作目录` : `已启动 ${def.name}${dir ? '，请在应用里打开工作目录' : ''}` };
  }
  // 3) 商店 / MSIX 应用：经 shell:AppsFolder 启动（无法传工作目录）
  spawn('explorer.exe', [info.path], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  return { ok: true, how: `已启动 ${def.name}${dir ? '，请在应用里打开工作目录' : ''}` };
}
