const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('uploadAlarm', {
  get: () => ipcRenderer.invoke('alarm:get'), stop: () => ipcRenderer.invoke('alarm:stop'), start: () => ipcRenderer.invoke('alarm:start'),
  copy: () => ipcRenderer.invoke('alarm:copy'), folder: () => ipcRenderer.invoke('alarm:folder'),
  playback: data => ipcRenderer.send('alarm:playback', data), snapshot: () => ipcRenderer.send('alarm:snapshot'),
  subscribe: handler => ipcRenderer.on('alarm:state', (_event, state) => handler(state)),
});
