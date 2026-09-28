// Read-only application operations. These functions must not mutate workspace files.
export { inspectPlatformDirectory, scanWorkspace } from '../inventory.mjs';
export { inspectRegistration, readCatalogEntry, readSkillContent } from '../catalog.mjs';
export { readDocument } from '../documents.mjs';
export { healthSoftware } from '../software.mjs';
export { inspectGit, scanSensitiveFiles } from '../git.mjs';
export { listIntegrationTargets, readIntegrationTarget } from '../integration.mjs';

