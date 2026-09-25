const REPOSITORIES = new Set(['tool', 'agent', 'software']);
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function basePlan(kind, workspaceRoot, now) {
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `${kind}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind,
    workspaceRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    steps: [],
    verification: []
  };
}

export function buildPlatformViewPlan({ workspaceRoot, platformId, currentEnabled, desiredEnabled, now = new Date().toISOString() }) {
  if (typeof platformId !== 'string' || !RESOURCE_ID.test(platformId)) throw new Error('INVALID_PLATFORM_ID');
  if (typeof currentEnabled !== 'boolean' || typeof desiredEnabled !== 'boolean') throw new Error('INVALID_PLATFORM_STATE');
  const plan = basePlan('platform-view', workspaceRoot, now);
  plan.target = { platformId, currentEnabled, desiredEnabled };
  plan.steps.push({
    operation: 'update-local-view',
    target: `platform:${platformId}`,
    oldValue: currentEnabled,
    newValue: desiredEnabled,
    persistentStore: '%LOCALAPPDATA%/ArchitectureManager'
  });
  plan.verification.push('local view state is reversible and no platform directory is deleted');
  return plan;
}

export function buildResourcePointerPlan({ workspaceRoot, repository, resourceId, currentVersion, targetVersion, availableVersions = [], now = new Date().toISOString() }) {
  if (!REPOSITORIES.has(repository)) throw new Error('INVALID_SHARED_REPOSITORY');
  if (typeof resourceId !== 'string' || !RESOURCE_ID.test(resourceId)) throw new Error('INVALID_RESOURCE_ID');
  if (typeof currentVersion !== 'string' || !SEMVER.test(currentVersion)) throw new Error('INVALID_CURRENT_VERSION');
  if (typeof targetVersion !== 'string' || !SEMVER.test(targetVersion)) throw new Error('INVALID_TARGET_VERSION');
  if (currentVersion === targetVersion) throw new Error('NO_CHANGE');
  if (!Array.isArray(availableVersions) || !availableVersions.includes(targetVersion)) throw new Error('TARGET_VERSION_UNAVAILABLE');
  const plan = basePlan('resource-pointer', workspaceRoot, now);
  plan.target = { repository, resourceId, currentVersion, targetVersion };
  plan.steps.push({
    operation: 'replace-current-pointer',
    target: `${repository}/${resourceId}/current.json`,
    oldValue: { version: currentVersion },
    newValue: { version: targetVersion },
    checkpoint: true
  });
  plan.verification.push('current pointer still contains the expected old version before apply');
  plan.verification.push('target version directory and SHA256SUMS pass after apply');
  return plan;
}
