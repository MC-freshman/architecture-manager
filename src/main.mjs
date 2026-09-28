import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPlan,
  buildDocumentPlan,
  buildGitPlan,
  buildIntegrationPlan,
  buildPlatformViewPlan,
  buildRegistryPlan,
  buildResourcePointerPlan,
  buildSoftwareLaunchPlan,
  healthSoftware,
  inspectGit,
  inspectPlatformDirectory,
  inspectRegistration,
  listIntegrationTargets,
  readCatalogEntry,
  readDocument,
  readIntegrationTarget,
  readSkillContent,
  scanSensitiveFiles,
  scanWorkspace,
  suggestPlatformBridge,
  verifyPlanTarget
} from './app/api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultWorkspace = process.env.ARCHITECTURE_MANAGER_WORKSPACE || null;

function registerReadOnlyIpc() {
  ipcMain.handle('ui:confirm', async (_event, message) => {
    const result = await dialog.showMessageBox({ type: 'question', title: '确认操作', message: String(message), buttons: ['取消', '确认'], defaultId: 0, cancelId: 0 });
    return result.response === 1;
  });
  ipcMain.handle('workspace:default', () => defaultWorkspace);
  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择架构工作区',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('workspace:select-directory', async () => {
    const result = await dialog.showOpenDialog({ title: '选择平台目录', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('workspace:scan', (_event, root) => scanWorkspace(root));
  ipcMain.handle('platform:inspect', (_event, input) => inspectPlatformDirectory(input.workspaceRoot, input.platformId, input.directoryRelative));
  ipcMain.handle('plan:platform-view', (_event, input) => buildPlatformViewPlan(input));
  ipcMain.handle('plan:resource-pointer', (_event, input) => buildResourcePointerPlan(input));
  ipcMain.handle('catalog:read', (_event, input) => readCatalogEntry(input));
  ipcMain.handle('skill:read', (_event, input) => readSkillContent(input));
  ipcMain.handle('catalog:select', async (_event, input) => {
    const result = await dialog.showOpenDialog({ title: input.kind === 'agent' ? '选择 agent 仓内的资源目录' : '选择 tool/_registry 下的技能目录 JSON', defaultPath: join(input.workspaceRoot, input.kind === 'agent' ? 'agent' : 'tool/_registry'), properties: [input.kind === 'agent' ? 'openDirectory' : 'openFile'], ...(input.kind === 'skill' ? { filters: [{ name: '技能目录', extensions: ['json'] }] } : {}) });
    return result.canceled ? null : inspectRegistration({ ...input, selectedPath: result.filePaths[0] });
  });
  ipcMain.handle('plan:registry', (_event, input) => buildRegistryPlan(input));
  ipcMain.handle('document:read', (_event, input) => readDocument(input.workspaceRoot, input.relativePath));
  ipcMain.handle('plan:document', (_event, input) => buildDocumentPlan(input));
  ipcMain.handle('software:health', (_event, input) => healthSoftware(input.workspaceRoot, input.softwareId));
  ipcMain.handle('plan:software', (_event, input) => buildSoftwareLaunchPlan(input));
  ipcMain.handle('software:open-location', async (_event, input) => {
    const plan = buildSoftwareLaunchPlan({ workspaceRoot: input.workspaceRoot, softwareId: input.softwareId, mode: 'open-location' });
    if (!plan.target.bodyPath || !existsSync(plan.target.bodyPath) || !statSync(plan.target.bodyPath).isDirectory()) throw new Error('SOFTWARE_BODY_PATH_NOT_FOUND');
    if (input.expectedPath !== plan.target.bodyPath) throw new Error('EXTERNAL_CHANGE_DETECTED');
    const error = await shell.openPath(plan.target.bodyPath);
    if (error) throw new Error(`SOFTWARE_LOCATION_OPEN_FAILED:${error}`);
    return { ...plan, status: 'opened', writePerformed: false };
  });
  ipcMain.handle('git:inspect', (_event, root) => inspectGit(root));
  ipcMain.handle('git:sensitive-scan', (_event, root) => scanSensitiveFiles(root));
  ipcMain.handle('plan:git', (_event, input) => buildGitPlan(input));
  ipcMain.handle('integration:targets', (_event, input) => listIntegrationTargets(input));
  ipcMain.handle('integration:read', (_event, input) => readIntegrationTarget(input));
  ipcMain.handle('platform:suggest-bridge', (_event, input) => suggestPlatformBridge(input));
  ipcMain.handle('plan:integration', (_event, input) => buildIntegrationPlan(input));
  ipcMain.handle('transaction:apply', (_event, input) => applyPlan(input));
  ipcMain.handle('transaction:verify', (_event, input) => verifyPlanTarget(input));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    webPreferences: {
      // Sandboxed Electron preload scripts must be CommonJS.  An ESM preload
      // is rejected by Electron before contextBridge can expose the API.
      preload: join(__dirname, 'preload.cjs'),
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
