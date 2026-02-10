const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inventoryApi', {
  listCaptured: () => ipcRenderer.invoke('db:list-captured'),
});
