const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitorApi', {
  getConfig: () => ipcRenderer.invoke('monitor:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('monitor:save-config', config),
  run: (config) => ipcRenderer.invoke('monitor:run', config),
  pause: () => ipcRenderer.invoke('monitor:pause'),
  pickSelector: (pageId) => ipcRenderer.invoke('monitor:pick-selector', pageId),
  listCaptured: () => ipcRenderer.invoke('db:list-captured'),
  onLog: (callback) => ipcRenderer.on('monitor:log', (_, msg) => callback(msg)),
  onCountdown: (callback) => ipcRenderer.on('monitor:countdown', (_, n) => callback(n)),
});
