import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanWorkspace } from './inventory.mjs';
import { buildPlatformViewPlan, buildResourcePointerPlan } from './plans.mjs';
import { buildDocumentPlan, readDocument } from './documents.mjs';
import { buildSoftwareLaunchPlan, healthSoftware } from './software.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultWorkspace = process.env.ARCHITECTURE_MANAGER_WORKSPACE || null;

function registerReadOnlyIpc() {
  ipcMain.handle('workspace:default', () => defaultWorkspace);
  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择架构工作区',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('workspace:scan', (_event, root) => scanWorkspace(root));
  ipcMain.handle('plan:platform-view', (_event, input) => buildPlatformViewPlan(input));
  ipcMain.handle('plan:resource-pointer', (_event, input) => buildResourcePointerPlan(input));
  ipcMain.handle('document:read', (_event, input) => readDocument(input.workspaceRoot, input.relativePath));
  ipcMain.handle('plan:document', (_event, input) => buildDocumentPlan(input));
  ipcMain.handle('software:health', (_event, input) => healthSoftware(input.workspaceRoot, input.softwareId));
  ipcMain.handle('plan:software', (_event, input) => buildSoftwareLaunchPlan(input));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  return window;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerReadOnlyIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
