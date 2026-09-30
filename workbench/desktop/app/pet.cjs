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
if (!import_electron.app.requestSingleInstanceLock()) import_electron.app.quit();
import_electron.app.on("second-instance", () => {
  win?.showInactive();
});
import_electron.app.commandLine.appendSwitch("disable-renderer-backgrounding");
function anchorBounds(w, h, keep) {
  const wa = import_electron.screen.getDisplayMatching(keep || import_electron.screen.getPrimaryDisplay().bounds).workArea;
  const right = keep ? keep.x + keep.width : wa.x + wa.width - 16;
  const bottom = keep ? keep.y + keep.height : wa.y + wa.height - 16;
  const x = Math.max(wa.x, Math.min(right - w, wa.x + wa.width - w));
  const y = Math.max(wa.y, Math.min(bottom - h, wa.y + wa.height - h));
  return { x: Math.round(x), y: Math.round(y), width: w, height: h };
}
async function create() {
  win = new import_electron.BrowserWindow({
    ...anchorBounds(150, 150),
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
  if (!win) return;
  const W = Math.max(120, Math.min(480, Math.round(w))), H = Math.max(120, Math.min(720, Math.round(h)));
  win.setBounds(anchorBounds(W, H, win.getBounds()), true);
});
import_electron.ipcMain.on("pet:move", (_e, dx, dy) => {
  if (!win) return;
  const b = win.getBounds();
  win.setPosition(Math.round(b.x + dx), Math.round(b.y + dy));
});
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
