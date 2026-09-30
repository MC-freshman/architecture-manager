// Mutating operations always return a plan or pass through plan -> apply -> verify.
export { buildRegistryPlan } from '../catalog.mjs';
export { buildDefectBookEditPlan } from '../defects.mjs';
export { buildPlatformViewPlan, buildResourcePointerPlan } from '../plans.mjs';
export { buildDocumentPlan } from '../documents.mjs';
export { buildSoftwareLaunchPlan } from '../software.mjs';
export { buildGitPlan } from '../git.mjs';
export { buildIntegrationPlan } from '../integration.mjs';
export { applyPlan, verifyPlanTarget } from '../transactions.mjs';
export { runPlatformCheck } from '../platform-check.mjs';
export { buildSoftwareImportPlan } from '../software-intake.mjs';
export { buildSoftwareRecipePlan } from '../software-publish.mjs';
export { buildSoftwareRevertPlan } from '../software-recovery.mjs';
export { buildReleasePlan } from '../releases.mjs';
export { buildSoftwareConnectorLaunchPlan } from '../software-launch.mjs';
export { buildDocsSite, checkDocsLinks } from '../docs-ops.mjs';

