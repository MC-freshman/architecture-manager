import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('architectureManager', Object.freeze({
  getDefaultWorkspace: () => ipcRenderer.invoke('workspace:default'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  scanWorkspace: (root) => ipcRenderer.invoke('workspace:scan', root),
  previewPlatformPlan: (input) => ipcRenderer.invoke('plan:platform-view', input),
  previewResourcePlan: (input) => ipcRenderer.invoke('plan:resource-pointer', input),
  readDocument: (input) => ipcRenderer.invoke('document:read', input),
  previewDocumentPlan: (input) => ipcRenderer.invoke('plan:document', input),
  softwareHealth: (input) => ipcRenderer.invoke('software:health', input),
  previewSoftwarePlan: (input) => ipcRenderer.invoke('plan:software', input),
  inspectGit: (root) => ipcRenderer.invoke('git:inspect', root),
  scanSensitiveFiles: (root) => ipcRenderer.invoke('git:sensitive-scan', root),
  previewGitPlan: (input) => ipcRenderer.invoke('plan:git', input),
  applyPlan: (input) => ipcRenderer.invoke('transaction:apply', input),
  verifyPlan: (input) => ipcRenderer.invoke('transaction:verify', input)
}));
