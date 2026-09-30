// Bench 小精灵（桌面宠物）主进程：一个透明、无边框、置顶的小窗，加载工作台服务的 /pet.html。
// 边界：只加载 WB_URL（127.0.0.1）上的页面；截屏只在渲染页请求时（用户点击）进行，截屏时先隐藏自身；不注册全局快捷键、不监听输入。
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } from 'electron';
import path from 'node:path';

const BASE = process.env.WB_URL || `http://127.0.0.1:${process.env.WB_PORT || 41873}`;
let win: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.showInactive(); });
app.commandLine.appendSwitch('disable-renderer-backgrounding');

function anchorBounds(w: number, h: number, keep?: Electron.Rectangle) {
  const wa = screen.getDisplayMatching(keep || screen.getPrimaryDisplay().bounds).workArea;
  // 右下角锚定：尺寸变化时保持右下角不动
  const right = keep ? keep.x + keep.width : wa.x + wa.width - 16;
  const bottom = keep ? keep.y + keep.height : wa.y + wa.height - 16;
  const x = Math.max(wa.x, Math.min(right - w, wa.x + wa.width - w));
  const y = Math.max(wa.y, Math.min(bottom - h, wa.y + wa.height - h));
  return { x: Math.round(x), y: Math.round(y), width: w, height: h };
}

async function create() {
  win = new BrowserWindow({
    ...anchorBounds(150, 150), transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000', title: 'Bench 小精灵', show: false,
    webPreferences: { preload: path.join(__dirname, 'pet-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  const own = new URL(BASE).origin;
  win.webContents.on('will-navigate', (e, u) => { if (new URL(u).origin !== own) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win?.showInactive());
  // 由后台任务自动召唤时（WB_PET_OPEN=jobs）直接展开任务面板
  const hash = process.env.WB_PET_OPEN === 'jobs' ? '#jobs' : '';
  await win.loadURL(`${BASE}/pet.html${hash}`).catch(() => win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body style="margin:0;background:transparent;font:13px system-ui;color:#999;display:grid;place-items:end;height:100vh">工作台未运行</body>')}`));
}

ipcMain.on('pet:size', (_e, w: number, h: number) => {
  if (!win) return;
  const W = Math.max(120, Math.min(480, Math.round(w))), H = Math.max(120, Math.min(720, Math.round(h)));
  win.setBounds(anchorBounds(W, H, win.getBounds()), true);
});
ipcMain.on('pet:move', (_e, dx: number, dy: number) => {
  if (!win) return;
  const b = win.getBounds();
  win.setPosition(Math.round(b.x + dx), Math.round(b.y + dy));
});
ipcMain.handle('pet:capture', async () => {
  if (!win) return null;
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b);
  win.setOpacity(0); // 不把自己截进去
  await new Promise((r) => setTimeout(r, 120));
  try {
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })).find((s) => s.display_id === String(d.id)) ;
    const all = src || (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size }))[0];
    return all ? all.thumbnail.toDataURL() : null;
  } finally { win.setOpacity(1); }
});
ipcMain.on('pet:open', (_e, hash: string) => {
  const safe = String(hash || '').replace(/[^\w\-/.%?=&]/g, '');
  void shell.openExternal(`${BASE}/#/${safe}`);
});
ipcMain.on('pet:quit', () => app.quit());

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
