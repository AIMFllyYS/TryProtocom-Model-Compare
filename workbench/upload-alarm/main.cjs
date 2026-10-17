const { app, BrowserWindow, ipcMain, clipboard, shell, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeNotification, nextState, stopState } = require('./alarm-state.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME = path.join(__dirname, 'runtime');
fs.mkdirSync(RUNTIME, { recursive: true });
app.setPath('userData', path.join(RUNTIME, 'profile'));
app.setPath('logs', path.join(RUNTIME, 'logs'));
app.setPath('crashDumps', path.join(RUNTIME, 'crashes'));
app.setName('上传提醒');
const at = process.argv.indexOf('--handoff');
const HANDOFF = at >= 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1])
  : path.join(ROOT, 'reports', '2026-10-08-haiku-5.5-web', 'upload-handoff.json');
if (path.relative(ROOT, HANDOFF).startsWith('..') || path.isAbsolute(path.relative(ROOT, HANDOFF))) throw Error('Handoff must be in this project');
const RECORD = path.join(RUNTIME, 'alarm-state.json');
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
let saved = readJson(RECORD) || {};
let stoppedId = saved.stoppedId || null;
let state = { active: false, task: '等待上传任务', file: '', name: '', bytes: 0 };
let win, timer, loaded = false;
function record(extra = {}) {
  const data = { ...state, stoppedId, ...extra, updatedAt: new Date().toISOString(), pid: process.pid };
  fs.writeFileSync(RECORD + '.tmp', JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(RECORD + '.tmp', RECORD);
}
function publish() { record(); if (loaded && win && !win.isDestroyed()) win.webContents.send('alarm:state', state); }
function stop() { if (state.id) stoppedId = state.id; state = stopState(state); publish(); }
function refresh() {
  const notification = normalizeNotification(readJson(HANDOFF), ROOT);
  if (notification && !fs.existsSync(notification.file)) return;
  const next = nextState(state, notification, stoppedId);
  if (next !== state && (next.id !== state.id || next.active !== state.active)) {
    state = next; publish();
    if (state.active && win) { win.show(); win.setAlwaysOnTop(true); }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { refresh(); if (win) win.show(); });
  app.whenReady().then(() => {
    const area = screen.getPrimaryDisplay().workArea;
    win = new BrowserWindow({ width: 448, height: 446, x: area.x + Math.max(0, area.width - 468), y: area.y + Math.max(0, area.height - 466),
      title: '上传提醒', backgroundColor: '#fff9ed', show: false, resizable: false, maximizable: false, alwaysOnTop: true,
      autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' } });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('did-finish-load', () => { loaded = true; refresh(); publish(); win.show(); });
    win.on('close', () => { stop(); clearInterval(timer); });
    win.on('closed', () => { win = null; app.quit(); });
    ipcMain.handle('alarm:get', () => state);
    ipcMain.handle('alarm:stop', () => { stop(); return state; });
    ipcMain.handle('alarm:start', () => { if (state.file && fs.existsSync(state.file)) { state = { ...state, active: true }; publish(); } return state; });
    ipcMain.handle('alarm:copy', () => { if (state.file) clipboard.writeText(state.file); return !!state.file; });
    ipcMain.handle('alarm:folder', () => { if (state.file && fs.existsSync(state.file)) shell.showItemInFolder(state.file); });
    ipcMain.on('alarm:playback', (_event, data) => {
      record({ playback: { paused: !!data.paused, loop: !!data.loop, error: data.error || null, at: new Date().toISOString() } });
    });
    ipcMain.on('alarm:snapshot', () => {
      win.webContents.capturePage().then(img => fs.writeFileSync(path.join(RUNTIME, 'window.png'), img.toPNG())).catch(() => {});
    });
    win.loadFile(path.join(__dirname, 'index.html'));
    timer = setInterval(refresh, 800);
  });
  app.on('window-all-closed', () => app.quit());
}
