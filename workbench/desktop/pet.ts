// Bench 小精灵（桌面宠物）主进程：一个透明、无边框、置顶的小窗，加载工作台服务的 /pet.html。
// 边界：只加载 WB_URL（127.0.0.1）上的页面；截屏只在渲染页请求时（用户点击）进行，截屏时先隐藏自身；
// 不注册全局快捷键、不监听键盘鼠标。唯一读取光标位置的时刻：你在宠物上按住拖动 / 拖边改尺寸期间（松手即停，最长 30 秒）。
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } from 'electron';
import path from 'node:path';

const BASE = process.env.WB_URL || `http://127.0.0.1:${process.env.WB_PORT || 41873}`;
let win: BrowserWindow | null = null;
// 期望尺寸（DIP）。Windows 缩放不是 100% 时，setPosition / 不带尺寸的 setBounds 会让窗口每次挪动都胖一两个像素，
// 拖一会儿面板就“莫名其妙变大 / 变形”。所以每次移动都用 setBounds 把这个尺寸原样写回去。
const want = { w: 176, h: 176 };

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.showInactive(); });
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const areaAt = (p: Electron.Point) => screen.getDisplayNearestPoint(p).workArea;
const clampTo = (wa: Electron.Rectangle, w: number, h: number) => ({ w: Math.max(120, Math.min(Math.round(w), wa.width)), h: Math.max(120, Math.min(Math.round(h), wa.height)) });

/** 右下角锚定：尺寸变化时保持右下角不动，并整体留在当前屏幕的工作区里 */
function anchorBounds(w: number, h: number, keep?: Electron.Rectangle) {
  const wa = keep ? areaAt({ x: keep.x + keep.width / 2, y: keep.y + keep.height / 2 }) : screen.getPrimaryDisplay().workArea;
  const s = clampTo(wa, w, h);
  const right = keep ? keep.x + keep.width : wa.x + wa.width - 8;
  const bottom = keep ? keep.y + keep.height : wa.y + wa.height - 8;
  const x = Math.max(wa.x, Math.min(right - s.w, wa.x + wa.width - s.w));
  const y = Math.max(wa.y, Math.min(bottom - s.h, wa.y + wa.height - s.h));
  return { x: Math.round(x), y: Math.round(y), width: s.w, height: s.h };
}
function place(b: { x: number; y: number; width: number; height: number }) {
  if (!win) return;
  want.w = b.width; want.h = b.height;
  win.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: b.width, height: b.height }, false);
}

async function create() {
  win = new BrowserWindow({
    ...anchorBounds(want.w, want.h), transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
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
  if (!win || gesture) return; // 拖动 / 改尺寸进行中时不接受渲染页的尺寸切换，避免两边抢
  place(anchorBounds(Number(w) || want.w, Number(h) || want.h, win.getBounds()));
});

// ---------- 拖动与拖边改尺寸：由主进程跟随光标（按绝对位置算，不累加增量，缩放屏上也不漂） ----------
type Edge = 'move' | 'l' | 't' | 'tl';
let gesture: { edge: Edge; timer: NodeJS.Timeout; until: number; c0: Electron.Point; b0: Electron.Rectangle; min: { w: number; h: number } } | null = null;
function endGesture() {
  if (!gesture) return null;
  clearInterval(gesture.timer);
  gesture = null;
  return win ? { w: want.w, h: want.h } : null;
}
function startGesture(edge: Edge, min?: { w: number; h: number }) {
  if (!win) return;
  endGesture();
  const b0 = { ...win.getBounds(), width: want.w, height: want.h };
  const c0 = screen.getCursorScreenPoint();
  const g: NonNullable<typeof gesture> = { edge, c0, b0, until: Date.now() + 30000, min: { w: Math.max(260, min?.w || 320), h: Math.max(300, min?.h || 380) }, timer: undefined as unknown as NodeJS.Timeout };
  g.timer = setInterval(() => {
    if (!win || !gesture || Date.now() > gesture.until) { endGesture(); return; }
    const c = screen.getCursorScreenPoint();
    const dx = c.x - g.c0.x, dy = c.y - g.c0.y;
    if (g.edge === 'move') {
      const wa = areaAt(c);
      // 允许拖到屏幕边缘，但至少留 60px 在屏幕里，免得找不回来
      const x = Math.max(wa.x - g.b0.width + 60, Math.min(g.b0.x + dx, wa.x + wa.width - 60));
      const y = Math.max(wa.y, Math.min(g.b0.y + dy, wa.y + wa.height - 60));
      place({ x, y, width: g.b0.width, height: g.b0.height });
      return;
    }
    // 右下角（宠物所在）固定，拖左边 / 上边 / 左上角
    const wa = areaAt({ x: g.b0.x + g.b0.width, y: g.b0.y + g.b0.height });
    const right = g.b0.x + g.b0.width, bottom = g.b0.y + g.b0.height;
    const w = g.edge === 't' ? g.b0.width : Math.max(g.min.w, Math.min(g.b0.width - dx, right - wa.x));
    const h = g.edge === 'l' ? g.b0.height : Math.max(g.min.h, Math.min(g.b0.height - dy, bottom - wa.y));
    place({ x: right - w, y: bottom - h, width: Math.round(w), height: Math.round(h) });
  }, 16);
  gesture = g;
}
ipcMain.on('pet:drag-start', () => startGesture('move'));
ipcMain.on('pet:resize-start', (_e, edge: string, minW?: number, minH?: number) => { if (edge === 'l' || edge === 't' || edge === 'tl') startGesture(edge, { w: Number(minW) || 0, h: Number(minH) || 0 }); });
ipcMain.handle('pet:gesture-end', () => endGesture());

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
