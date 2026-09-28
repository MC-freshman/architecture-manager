const REPOSITORIES = new Set(['tool', 'agent', 'software']);
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function assertPublishedVersion(workspaceRoot, repository, resourceId, version) {
  if (!REPOSITORIES.has(repository) || !RESOURCE_ID.test(resourceId) || !SEMVER.test(version)) throw new Error('INVALID_RESOURCE_VERSION');
  const release = join(workspaceRoot, repository, resourceId, 'versions', version);
  const sums = join(release, 'SHA256SUMS');
  if (!existsSync(release) || !statSync(release).isDirectory() || !existsSync(sums) || !statSync(sums).isFile()) throw new Error('TARGET_VERSION_NOT_FROZEN');
}

export function validatePointerTransition({ workspaceRoot, repository, resourceId, currentVersion, targetVersion, availableVersions = [] }) {
  if (!REPOSITORIES.has(repository)) throw new Error('INVALID_SHARED_REPOSITORY');
  if (typeof resourceId !== 'string' || !RESOURCE_ID.test(resourceId)) throw new Error('INVALID_RESOURCE_ID');
  if (typeof currentVersion !== 'string' || !SEMVER.test(currentVersion)) throw new Error('INVALID_CURRENT_VERSION');
  if (typeof targetVersion !== 'string' || !SEMVER.test(targetVersion)) throw new Error('INVALID_TARGET_VERSION');
  if (currentVersion === targetVersion) throw new Error('NO_CHANGE');
  if (!Array.isArray(availableVersions) || !availableVersions.includes(targetVersion)) throw new Error('TARGET_VERSION_UNAVAILABLE');
  assertPublishedVersion(workspaceRoot, repository, resourceId, targetVersion);
}

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

export function buildPlatformViewPlan({ workspaceRoot, platformId, currentEnabled, desiredEnabled, directoryRelative = platformId, markers = [], now = new Date().toISOString() }) {
  if (typeof platformId !== 'string' || !RESOURCE_ID.test(platformId)) throw new Error('INVALID_PLATFORM_ID');
  if (typeof currentEnabled !== 'boolean' || typeof desiredEnabled !== 'boolean') throw new Error('INVALID_PLATFORM_STATE');
  const plan = basePlan('platform-view', workspaceRoot, now);
  plan.target = { platformId, currentEnabled, desiredEnabled, directoryRelative, markers };
  plan.steps.push({
    operation: 'update-local-view',
    target: `platform:${platformId}`,
    oldValue: currentEnabled,
    newValue: desiredEnabled,
    persistentStore: '%LOCALAPPDATA%/ArchitectureManager/views',
    markerCheck: markers
  });
  plan.verification.push('local view state is reversible and no platform directory is deleted');
  return plan;
}

export function buildResourcePointerPlan({ workspaceRoot, repository, resourceId, currentVersion, targetVersion, availableVersions = [], baselineSha256 = null, now = new Date().toISOString() }) {
  validatePointerTransition({ workspaceRoot, repository, resourceId, currentVersion, targetVersion, availableVersions });
  const plan = basePlan('resource-pointer', workspaceRoot, now);
  plan.target = { repository, resourceId, currentVersion, targetVersion, baselineSha256 };
  plan.steps.push({
    operation: 'replace-current-pointer',
    target: `${repository}/${resourceId}/current.json`,
    oldValue: { version: currentVersion },
    newValue: { version: targetVersion },
    ...(baselineSha256 ? { oldSha256: baselineSha256 } : {}),
    checkpoint: true
  });
  plan.verification.push('current pointer still contains the expected old version before apply');
  plan.verification.push('target version directory and SHA256SUMS pass after apply');
  return plan;
}
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

