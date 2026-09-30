// 宠物预加载：只暴露尺寸、拖动 / 拖边改尺寸、截屏、打开工作台页面、退出这几个动作。
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wbPet', {
  setSize: (w: number, h: number) => ipcRenderer.send('pet:size', w, h),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  resizeStart: (edge: 'l' | 't' | 'tl', minW: number, minH: number) => ipcRenderer.send('pet:resize-start', edge, minW, minH),
  gestureEnd: () => ipcRenderer.invoke('pet:gesture-end') as Promise<{ w: number; h: number } | null>,
  capture: () => ipcRenderer.invoke('pet:capture') as Promise<string | null>,
  open: (hash: string) => ipcRenderer.send('pet:open', hash),
  quit: () => ipcRenderer.send('pet:quit'),
});
