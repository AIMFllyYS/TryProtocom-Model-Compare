"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// desktop/pet.ts
var import_electron = require("electron");
var import_node_path = __toESM(require("node:path"), 1);
var BASE = process.env.WB_URL || `http://127.0.0.1:${process.env.WB_PORT || 41873}`;
var win = null;
var want = { w: 176, h: 176 };
if (!import_electron.app.requestSingleInstanceLock()) import_electron.app.quit();
import_electron.app.on("second-instance", () => {
  win?.showInactive();
});
import_electron.app.commandLine.appendSwitch("disable-renderer-backgrounding");
var areaAt = (p) => import_electron.screen.getDisplayNearestPoint(p).workArea;
var clampTo = (wa, w, h) => ({ w: Math.max(120, Math.min(Math.round(w), wa.width)), h: Math.max(120, Math.min(Math.round(h), wa.height)) });
function anchorBounds(w, h, keep) {
  const wa = keep ? areaAt({ x: keep.x + keep.width / 2, y: keep.y + keep.height / 2 }) : import_electron.screen.getPrimaryDisplay().workArea;
  const s = clampTo(wa, w, h);
  const right = keep ? keep.x + keep.width : wa.x + wa.width - 8;
  const bottom = keep ? keep.y + keep.height : wa.y + wa.height - 8;
  const x = Math.max(wa.x, Math.min(right - s.w, wa.x + wa.width - s.w));
  const y = Math.max(wa.y, Math.min(bottom - s.h, wa.y + wa.height - s.h));
  return { x: Math.round(x), y: Math.round(y), width: s.w, height: s.h };
}
function place(b) {
  if (!win) return;
  want.w = b.width;
  want.h = b.height;
  win.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: b.width, height: b.height }, false);
}
async function create() {
  win = new import_electron.BrowserWindow({
    ...anchorBounds(want.w, want.h),
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: "Bench \u5C0F\u7CBE\u7075",
    show: false,
    webPreferences: { preload: import_node_path.default.join(__dirname, "pet-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: true }
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true);
  const own = new URL(BASE).origin;
  win.webContents.on("will-navigate", (e, u) => {
    if (new URL(u).origin !== own) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => win?.showInactive());
  const hash = process.env.WB_PET_OPEN === "jobs" ? "#jobs" : "";
  await win.loadURL(`${BASE}/pet.html${hash}`).catch(() => win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body style="margin:0;background:transparent;font:13px system-ui;color:#999;display:grid;place-items:end;height:100vh">\u5DE5\u4F5C\u53F0\u672A\u8FD0\u884C</body>')}`));
}
import_electron.ipcMain.on("pet:size", (_e, w, h) => {
  if (!win || gesture) return;
  place(anchorBounds(Number(w) || want.w, Number(h) || want.h, win.getBounds()));
});
var gesture = null;
function endGesture() {
  if (!gesture) return null;
  clearInterval(gesture.timer);
  gesture = null;
  return win ? { w: want.w, h: want.h } : null;
}
function startGesture(edge, min) {
  if (!win) return;
  endGesture();
  const b0 = { ...win.getBounds(), width: want.w, height: want.h };
  const c0 = import_electron.screen.getCursorScreenPoint();
  const g = { edge, c0, b0, until: Date.now() + 3e4, min: { w: Math.max(260, min?.w || 320), h: Math.max(300, min?.h || 380) }, timer: void 0 };
  g.timer = setInterval(() => {
    if (!win || !gesture || Date.now() > gesture.until) {
      endGesture();
      return;
    }
    const c = import_electron.screen.getCursorScreenPoint();
    const dx = c.x - g.c0.x, dy = c.y - g.c0.y;
    if (g.edge === "move") {
      const wa2 = areaAt(c);
      const x = Math.max(wa2.x - g.b0.width + 60, Math.min(g.b0.x + dx, wa2.x + wa2.width - 60));
      const y = Math.max(wa2.y, Math.min(g.b0.y + dy, wa2.y + wa2.height - 60));
      place({ x, y, width: g.b0.width, height: g.b0.height });
      return;
    }
    const wa = areaAt({ x: g.b0.x + g.b0.width, y: g.b0.y + g.b0.height });
    const right = g.b0.x + g.b0.width, bottom = g.b0.y + g.b0.height;
    const w = g.edge === "t" ? g.b0.width : Math.max(g.min.w, Math.min(g.b0.width - dx, right - wa.x));
    const h = g.edge === "l" ? g.b0.height : Math.max(g.min.h, Math.min(g.b0.height - dy, bottom - wa.y));
    place({ x: right - w, y: bottom - h, width: Math.round(w), height: Math.round(h) });
  }, 16);
  gesture = g;
}
import_electron.ipcMain.on("pet:drag-start", () => startGesture("move"));
import_electron.ipcMain.on("pet:resize-start", (_e, edge, minW, minH) => {
  if (edge === "l" || edge === "t" || edge === "tl") startGesture(edge, { w: Number(minW) || 0, h: Number(minH) || 0 });
});
import_electron.ipcMain.handle("pet:gesture-end", () => endGesture());
import_electron.ipcMain.handle("pet:capture", async () => {
  if (!win) return null;
  const b = win.getBounds();
  const d = import_electron.screen.getDisplayMatching(b);
  win.setOpacity(0);
  await new Promise((r) => setTimeout(r, 120));
  try {
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const src = (await import_electron.desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size })).find((s) => s.display_id === String(d.id));
    const all = src || (await import_electron.desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size }))[0];
    return all ? all.thumbnail.toDataURL() : null;
  } finally {
    win.setOpacity(1);
  }
});
import_electron.ipcMain.on("pet:open", (_e, hash) => {
  const safe = String(hash || "").replace(/[^\w\-/.%?=&]/g, "");
  void import_electron.shell.openExternal(`${BASE}/#/${safe}`);
});
import_electron.ipcMain.on("pet:quit", () => import_electron.app.quit());
import_electron.app.whenReady().then(create);
import_electron.app.on("window-all-closed", () => import_electron.app.quit());
