// Mutating operations always return a plan or pass through plan -> apply -> verify.
export { buildRegistryPlan } from '../catalog.mjs';
export { buildPlatformViewPlan, buildResourcePointerPlan } from '../plans.mjs';
export { buildDocumentPlan } from '../documents.mjs';
export { buildSoftwareLaunchPlan } from '../software.mjs';
export { buildGitPlan } from '../git.mjs';
export { buildIntegrationPlan } from '../integration.mjs';
export { applyPlan, verifyPlanTarget } from '../transactions.mjs';

