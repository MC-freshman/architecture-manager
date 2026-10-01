import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOnboardingJob } from './core/onboarding-jobs.mjs';
import { cancelAllOnboardingJobs } from './core/onboarding-jobs.mjs';
import { cancelAllOnboardingChecks } from './onboarding-state.mjs';
import { taskLifecycle } from './core/task-lifecycle.mjs';
import { refreshPlatformInventory } from './inventory.mjs';
import {
  applyPlan,
  buildDefectBookEditPlan,
  buildDocumentPlan,
  buildGitPlan,
  buildIntegrationPlan,
  buildPlatformViewPlan,
  buildRegistryPlan,
  buildReleasePlan,
  buildResourcePointerPlan,
  buildSoftwareLaunchPlan,
  buildSoftwareImportPlan,
  buildSoftwareRecipePlan,
  buildSoftwareRevertPlan,
  buildSoftwareConnectorLaunchPlan,
  buildDocsSite,
  buildPlatformScaffoldPlan,
  buildOnboardingConfigPlan,
  readOnboardingConfig,
  detectRuntime,
  buildOnboardingRuntimePlan,
  buildOnboardingBackendPlan,
  buildOnboardingClientPlan,
  probeOnboardingClient,
  buildOnboardingProvidersPlan,
  probeOnboardingCapabilities,
  buildOnboardingAttestationPlan,
  buildOnboardingGovernancePlan,
  buildOnboardingFinalizePlan,
  buildAutomaticOnboardingPlan,
  executeOnboardingChecks,
  cancelOnboarding,
  readOnboardingState,
  markOnboardingRecorded,
  buildOnboardingCard,
  buildWorkspaceClonePlan,
  applyWorkspaceClone,
  governanceOnboardingDraft,
  runOnboardingPipeline,
  checkDocsLinks,
  diffDocument,
  parseImplementationTables,
  healthSoftware,
  inspectGit,
  inspectPlatformDirectory,
  inspectPlatformConnection,
  inspectRegistration,
  listIntegrationTargets,
  listResourceReferences,
  listRunLedger,
  listSoftwareIntakes,
  listSoftwareRecoveries,
  readAuditEvents,
  readCatalogEntry,
  readDefectBook,
  readDocument,
  readIntegrationTarget,
  readSkillContent,
  readRegistryBaseline,
  scanSensitiveFiles,
  scanWorkspace,
  suggestPlatformBridge,
  runPlatformCheck,
  verifyDefectBook,
  verifyPlanTarget,
  inspectInbox
} from './app/api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultWorkspace = process.env.ARCHITECTURE_MANAGER_WORKSPACE || null;
const lifecycle = taskLifecycle(() => { cancelAllOnboardingJobs(); cancelAllOnboardingChecks(); });
let quitReady = false;
async function safeQuit() {
  await lifecycle.close(); quitReady = true; app.quit();
}
function preferences() {
  const path = join(app.getPath('userData'), 'workspace-preferences.json');
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}
function rememberWorkspace(root) {
  const directory = app.getPath('userData'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'workspace-preferences.json'), JSON.stringify({ lastWorkspace: root, recent: [root, ...(preferences().recent || []).filter((path) => path !== root)].slice(0, 8) }));
}

function registerIpc() {
  const owned = async (input, operation) => {
    const control = startOnboardingJob(input.workspaceRoot, input.platformId);
    try { return await lifecycle.track(() => operation(control.registerCancel)); } finally { control.finish(); }
  };
  ipcMain.handle('ui:version', () => app.getVersion());
  ipcMain.handle('ui:confirm', async (_event, message) => {
    const result = await dialog.showMessageBox({ type: 'question', title: '确认操作', message: String(message), buttons: ['取消', '确认'], defaultId: 0, cancelId: 0 });
    return result.response === 1;
  });
  ipcMain.handle('workspace:default', () => defaultWorkspace || (existsSync(preferences().lastWorkspace || '') ? preferences().lastWorkspace : null));
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
  ipcMain.handle('workspace:scan', (_event, root) => { const result = scanWorkspace(root); rememberWorkspace(result.workspaceRoot); return result; });
  ipcMain.handle('platform:refresh', (_event, input) => refreshPlatformInventory(input));
  ipcMain.handle('platform:inspect', (_event, input) => inspectPlatformDirectory(input.workspaceRoot, input.platformId, input.directoryRelative));
  ipcMain.handle('platform:connection', (_event, input) => inspectPlatformConnection(input));
  ipcMain.handle('platform:check', (event, input) => owned(input, (registerCancel) => runPlatformCheck({ ...input, registerCancel, onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
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
  ipcMain.handle('plan:software-import', (_event, input) => buildSoftwareImportPlan(input));
  ipcMain.handle('software:intakes', (_event, input) => listSoftwareIntakes(input));
  ipcMain.handle('plan:software-recipe', (_event, input) => buildSoftwareRecipePlan(input));
  ipcMain.handle('software:recoveries', (_event, input) => listSoftwareRecoveries(input));
  ipcMain.handle('plan:software-revert', (_event, input) => buildSoftwareRevertPlan(input));
  ipcMain.handle('software:select-source', async (_event, kind) => {
    const result = await dialog.showOpenDialog({ title: kind === 'unpacked-directory' ? '选择已解压的软件目录' : '选择下载的软件文件', properties: [kind === 'unpacked-directory' ? 'openDirectory' : 'openFile'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('software:open-location', async (_event, input) => {
    const plan = buildSoftwareLaunchPlan({ workspaceRoot: input.workspaceRoot, softwareId: input.softwareId, platformId: input.platformId, mode: 'open-location' });
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
  ipcMain.handle('runs:ledger', (_event, root) => listRunLedger(root));
  ipcMain.handle('defects:read', (_event, root) => readDefectBook(root));
  ipcMain.handle('defects:verify', (_event, root) => verifyDefectBook(root));
  ipcMain.handle('inbox:inspect', (_event, root) => inspectInbox(root));
  ipcMain.handle('audit:events', (_event, input) => readAuditEvents({ limit: input?.limit }));
  ipcMain.handle('plan:defect-book-edit', (_event, input) => buildDefectBookEditPlan(input));
  ipcMain.handle('plan:release', (_event, input) => buildReleasePlan(input));
  ipcMain.handle('releases:references', (_event, input) => listResourceReferences(input.workspaceRoot, input.repository, input.resourceId));
  ipcMain.handle('releases:registry-baseline', (_event, input) => readRegistryBaseline(input.workspaceRoot, input.kind));
  ipcMain.handle('plan:software-launch', (_event, input) => buildSoftwareConnectorLaunchPlan(input));
  ipcMain.handle('plans:parse', (_event, root) => parseImplementationTables(root));
  ipcMain.handle('docs:build', (_event, root) => buildDocsSite(root));
  ipcMain.handle('docs:conform', (_event, root) => checkDocsLinks(root));
  ipcMain.handle('document:diff', (_event, input) => diffDocument(input.workspaceRoot, input.relativePath));
  ipcMain.handle('plan:platform-scaffold', (_event, input) => buildPlatformScaffoldPlan(input));
  ipcMain.handle('onboarding:config', (_event, input) => readOnboardingConfig(input));
  ipcMain.handle('plan:platform-configuration', (_event, input) => buildOnboardingConfigPlan(input));
  ipcMain.handle('onboarding:runtime-detect', (_event, input) => detectRuntime(input));
  ipcMain.handle('plan:platform-runtime', (_event, input) => buildOnboardingRuntimePlan(input));
  ipcMain.handle('plan:platform-backend', (_event, input) => buildOnboardingBackendPlan(input));
  ipcMain.handle('plan:platform-client', (_event, input) => buildOnboardingClientPlan(input));
  ipcMain.handle('plan:platform-providers', (_event, input) => buildOnboardingProvidersPlan(input));
  ipcMain.handle('onboarding:capability-probe', (event, input) => owned(input, (registerCancel) => probeOnboardingCapabilities(input, { registerCancel, onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
  ipcMain.handle('plan:platform-attestation', (_event, input) => buildOnboardingAttestationPlan(input));
  ipcMain.handle('onboarding:client-probe', (_event, input) => probeOnboardingClient(input));
  ipcMain.handle('onboarding:select-file', async () => {
    const result = await dialog.showOpenDialog({ title: '选择解释器、客户端入口或配置文件', properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('onboarding:draft', (_event, input) => governanceOnboardingDraft(input.workspaceRoot, input.platformId));
  ipcMain.handle('onboarding:card', (_event, input) => buildOnboardingCard(input.workspaceRoot, input.platformId));
  ipcMain.handle('onboarding:pipeline', (event, input) => lifecycle.track(() => executeOnboardingChecks(input, { onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
  ipcMain.handle('onboarding:state', (_event, input) => readOnboardingState(input));
  ipcMain.handle('onboarding:cancel', (_event, input) => cancelOnboarding(input));
  ipcMain.handle('onboarding:recorded', (_event, input) => markOnboardingRecorded(input));
  ipcMain.handle('plan:platform-governance', (_event, input) => buildOnboardingGovernancePlan(input));
  ipcMain.handle('plan:platform-finalize', (_event, input) => buildOnboardingFinalizePlan(input));
  ipcMain.handle('plan:platform-onboarding', (_event, input) => buildAutomaticOnboardingPlan(input));
  ipcMain.handle('plan:workspace-clone', (_event, input) => buildWorkspaceClonePlan(input));
  ipcMain.handle('workspace:clone', (_event, input) => applyWorkspaceClone({ plan: input.plan }, { actor: 'local-user', now: new Date().toISOString() }));
  ipcMain.handle('transaction:apply', (event, input) => lifecycle.track(() => applyPlan({ ...input, onProgress: (progress) => event.sender.send('transaction:progress', progress) })));
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
  window.on('close', (event) => {
    if (!quitReady && lifecycle.pending) { event.preventDefault(); void safeQuit(); }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  return window;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  if (!quitReady && lifecycle.pending) { event.preventDefault(); void safeQuit(); }
});
