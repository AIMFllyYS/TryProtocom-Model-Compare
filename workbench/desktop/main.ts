// Bench Workbench 桌面版（Electron）：在主进程内启动工作台服务（或连接已在运行的服务），
// 预览使用 <webview>（完整 Chromium 内核）：原生 DevTools、移动端 UA / 触摸 / DPR 模拟、截图。
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, webContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../server/index';
import { DEFAULT_PORT } from '../server/config';

let win: BrowserWindow | null = null;
let stopServer: (() => Promise<void>) | null = null;

async function alive(url: string) {
  try { const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

async function ensureServer(): Promise<string> {
  const port = Number(process.env.WB_PORT || DEFAULT_PORT);
  const url = `http://127.0.0.1:${port}`;
  if (await alive(url)) return url; // 已有服务（例如 Start-Workbench.cmd 启动的）直接复用
  const packagedWeb = app.isPackaged ? path.join(process.resourcesPath, 'web') : undefined;
  const s = await startServer({ desktop: true, webDist: packagedWeb && fs.existsSync(path.join(packagedWeb, 'index.html')) ? packagedWeb : undefined });
  stopServer = s.close;
  return s.url;
}

function isSafeExternal(u: string) { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } }

async function createWindow() {
  let url: string;
  try { url = await ensureServer(); }
  catch (e) {
    dialog.showErrorBox('Bench Workbench 启动失败', String((e as Error).message || e) + '\n\n请确认 exe 位于仓库目录内（含 skills/bench-grader），或设置环境变量 WB_ROOT。');
    app.quit();
    return;
  }
  win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 980, minHeight: 640, backgroundColor: '#0b0e14', title: 'Bench Workbench',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true, spellcheck: false },
  });
  const own = new URL(url).origin;
  // 主窗口只允许停留在工作台源；其他链接交给系统浏览器
  win.webContents.on('will-navigate', (e, target) => { if (new URL(target).origin !== own) { e.preventDefault(); if (isSafeExternal(target)) void shell.openExternal(target); } });
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (isSafeExternal(u)) void shell.openExternal(u); return { action: 'deny' }; });
  // webview 加固：不允许注入 preload / node，只加载 http(s)
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete (prefs as Record<string, unknown>).preload;
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    if (!/^https?:\/\//.test(params.src || '') && params.src !== 'about:blank') e.preventDefault();
  });
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url: u }) => { if (isSafeExternal(u)) void wc.loadURL(u); return { action: 'deny' }; });
    wc.on('before-input-event', (ev, input) => { if (input.type === 'keyDown' && input.key === 'F12') { ev.preventDefault(); if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'right' }); } });
  });
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' && input.shift) { ev.preventDefault(); win!.webContents.toggleDevTools(); }
    if (input.key === 'F11') { ev.preventDefault(); win!.setFullScreen(!win!.isFullScreen()); }
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r' && input.shift) { ev.preventDefault(); win!.webContents.reloadIgnoringCache(); }
  });
  await win.loadURL(url);
  win.on('closed', () => { win = null; });
}

// ---------- IPC（仅接受来自主窗口的调用，目标必须是 webview 内容） ----------
const target = (sender: Electron.WebContents, id: number) => {
  if (!win || sender !== win.webContents) throw new Error('拒绝：非主窗口调用');
  const wc = webContents.fromId(id);
  if (!wc || wc.getType() !== 'webview') throw new Error('目标不是预览 webview');
  return wc;
};
ipcMain.handle('wb:devtools', (e, id: number, mode: 'right' | 'bottom' | 'detach' | 'undocked' = 'right') => { const wc = target(e.sender, id); if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode }); });
ipcMain.handle('wb:devtools-close', (e, id: number) => { target(e.sender, id).closeDevTools(); });
const lastUa = new Map<number, string>();
ipcMain.handle('wb:emulate', (e, id: number, p: { width: number; height: number; mobile: boolean; dpr: number; ua?: string } | null) => {
  const wc = target(e.sender, id);
  const defUa = app.userAgentFallback;
  if (!p) { wc.disableDeviceEmulation(); if (lastUa.get(id) && lastUa.get(id) !== defUa) { wc.setUserAgent(defUa); lastUa.set(id, defUa); wc.reload(); } return; }
  wc.enableDeviceEmulation({ screenPosition: p.mobile ? 'mobile' : 'desktop', screenSize: { width: p.width, height: p.height }, viewSize: { width: p.width, height: p.height }, deviceScaleFactor: p.dpr, viewPosition: { x: 0, y: 0 }, scale: 1 });
  const ua = p.mobile && p.ua ? p.ua : defUa;
  if ((lastUa.get(id) || defUa) !== ua) { wc.setUserAgent(ua); lastUa.set(id, ua); wc.reload(); }
});
ipcMain.handle('wb:capture', async (e, id: number) => (await target(e.sender, id).capturePage()).toDataURL());
ipcMain.handle('wb:save', async (e, name: string, dataUrl: string) => {
  if (!win || e.sender !== win.webContents) return null;
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('pictures'), path.basename(name)), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  fs.writeFileSync(r.filePath, Buffer.from(m[1], 'base64'));
  return r.filePath;
});
ipcMain.handle('wb:external', (_e, u: string) => { if (isSafeExternal(u)) void shell.openExternal(u); });
ipcMain.handle('wb:fullscreen', () => { if (!win) return false; win.setFullScreen(!win.isFullScreen()); return win.isFullScreen(); });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  Menu.setApplicationMenu(null);
  void app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', (e) => {
    if (!stopServer) return;
    e.preventDefault();
    const s = stopServer; stopServer = null;
    void s().finally(() => app.quit());
  });
}
