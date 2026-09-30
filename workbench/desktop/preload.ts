// 预加载：只向工作台页面暴露有限的桌面能力（window.wbDesktop），不暴露 Node / ipcRenderer 本身。
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wbDesktop', {
  version: process.versions.electron,
  openDevTools: (id: number, mode?: string) => ipcRenderer.invoke('wb:devtools', id, mode),
  closeDevTools: (id: number) => ipcRenderer.invoke('wb:devtools-close', id),
  emulate: (id: number, p: unknown) => ipcRenderer.invoke('wb:emulate', id, p),
  capture: (id: number) => ipcRenderer.invoke('wb:capture', id),
  saveFile: (name: string, dataUrl: string) => ipcRenderer.invoke('wb:save', name, dataUrl),
  openExternal: (url: string) => ipcRenderer.invoke('wb:external', url),
  toggleFullscreen: () => ipcRenderer.invoke('wb:fullscreen'),
});
