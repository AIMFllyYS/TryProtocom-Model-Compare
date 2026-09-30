// 宠物预加载：只暴露尺寸、拖动、截屏、打开工作台页面、退出这几个动作。
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wbPet', {
  setSize: (w: number, h: number) => ipcRenderer.send('pet:size', w, h),
  moveBy: (dx: number, dy: number) => ipcRenderer.send('pet:move', dx, dy),
  capture: () => ipcRenderer.invoke('pet:capture') as Promise<string | null>,
  open: (hash: string) => ipcRenderer.send('pet:open', hash),
  quit: () => ipcRenderer.send('pet:quit'),
});
