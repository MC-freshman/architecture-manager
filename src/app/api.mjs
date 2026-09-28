// Stable application boundary for the Electron entry point.
// Domain modules can evolve behind this file without changing IPC wiring.
export { inspectPlatformDirectory, scanWorkspace } from '../inventory.mjs';
export { buildRegistryPlan, inspectRegistration, readCatalogEntry, readSkillContent } from '../catalog.mjs';
export { buildPlatformViewPlan, buildResourcePointerPlan } from '../plans.mjs';
export { buildDocumentPlan, readDocument } from '../documents.mjs';
export { buildSoftwareLaunchPlan, healthSoftware } from '../software.mjs';
export { buildGitPlan, inspectGit, scanSensitiveFiles } from '../git.mjs';
export { buildIntegrationPlan, listIntegrationTargets, readIntegrationTarget } from '../integration.mjs';
export { applyPlan, verifyPlanTarget } from '../transactions.mjs';

