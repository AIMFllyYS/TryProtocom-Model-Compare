"use strict";

// desktop/pet-preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("wbPet", {
  setSize: (w, h) => import_electron.ipcRenderer.send("pet:size", w, h),
  moveBy: (dx, dy) => import_electron.ipcRenderer.send("pet:move", dx, dy),
  capture: () => import_electron.ipcRenderer.invoke("pet:capture"),
  open: (hash) => import_electron.ipcRenderer.send("pet:open", hash),
  quit: () => import_electron.ipcRenderer.send("pet:quit")
});
