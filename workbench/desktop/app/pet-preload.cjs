"use strict";

// desktop/pet-preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("wbPet", {
  setSize: (w, h) => import_electron.ipcRenderer.send("pet:size", w, h),
  dragStart: () => import_electron.ipcRenderer.send("pet:drag-start"),
  resizeStart: (edge, minW, minH) => import_electron.ipcRenderer.send("pet:resize-start", edge, minW, minH),
  gestureEnd: () => import_electron.ipcRenderer.invoke("pet:gesture-end"),
  capture: () => import_electron.ipcRenderer.invoke("pet:capture"),
  open: (hash) => import_electron.ipcRenderer.send("pet:open", hash),
  quit: () => import_electron.ipcRenderer.send("pet:quit")
});
