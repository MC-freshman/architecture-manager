import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('architectureManager', Object.freeze({
  getDefaultWorkspace: () => ipcRenderer.invoke('workspace:default'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  scanWorkspace: (root) => ipcRenderer.invoke('workspace:scan', root)
}));

