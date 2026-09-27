import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const RESOURCE_KINDS = new Set(['tool', 'agent', 'software']);
const PLATFORM_IDS = new Set(['codex', 'dsh', 'workbuddy', 'zcode', 'doubao', 'qoder']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SECRET_KEYS = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)/i;

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function rootPath(workspaceRoot) {
  const root = resolve(workspaceRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('WORKSPACE_NOT_FOUND');
  return root;
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_INTEGRATION_TARGET');
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error('INTEGRATION_TARGET_OUTSIDE_WORKSPACE');
  return normalized;
}

function pathFor(root, relativePath) {
  const safe = safeRelative(relativePath);
  const target = resolve(root, safe);
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || /^[A-Za-z]:/i.test(rel)) throw new Error('INTEGRATION_TARGET_OUTSIDE_WORKSPACE');
  return target;
}

function relativePath(root, target) {
  return relative(root, target).split(sep).join('/');
}

function assertId(id, code = 'INVALID_INTEGRATION_ID') {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error(code);
}

function readText(root, path) {
  const target = pathFor(root, path);
  if (!existsSync(target)) return { path, exists: false, content: '', sha256: null };
  if (!statSync(target).isFile()) throw new Error('INTEGRATION_TARGET_NOT_FILE');
  const content = readFileSync(target, 'utf8');
  return { path, exists: true, content, sha256: sha256(content) };
}

function platformCandidates(root, platformId) {
  assertId(platformId, 'INVALID_PLATFORM_ID');
  if (!PLATFORM_IDS.has(platformId)) throw new Error('UNKNOWN_PLATFORM_ID');
  const platformRoot = join(root, platformId);
  const bridge = join(platformRoot, 'bridge');
  const paths = [];
  if (existsSync(bridge) && statSync(bridge).isDirectory()) {
    for (const entry of readdirSync(bridge, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) paths.push(relativePath(root, join(bridge, entry.name)));
    }
  }
  const legacy = join(platformRoot, 'bridge.json');
  if (existsSync(legacy) && statSync(legacy).isFile()) paths.push(relativePath(root, legacy));
  if (!paths.length && existsSync(bridge) && statSync(bridge).isDirectory()) paths.push(`${platformId}/bridge/bridge.json`);
  if (existsSync(bridge) && statSync(bridge).isDirectory() && !paths.includes(`${platformId}/bridge/runner-config.json`)) paths.push(`${platformId}/bridge/runner-config.json`);
  return [...new Set(paths)].sort();
}

function resourceCandidates(root, kind, id) {
  assertId(id, 'INVALID_RESOURCE_ID');
  if (!RESOURCE_KINDS.has(kind)) throw new Error('INVALID_SHARED_REPOSITORY');
  const current = `${kind}/${id}/current.json`;
  const registry = `${kind}/registry.json`;
  return [current, registry].filter((path) => existsSync(pathFor(root, path)));
}

function targetPathFor(root, kind, targetId, path) {
  if (kind === 'platform') {
    const candidates = platformCandidates(root, targetId);
    const selected = path ? safeRelative(path) : candidates[0];
    if (!selected || !candidates.includes(selected)) throw new Error('PLATFORM_CONFIG_TARGET_NOT_ALLOWED');
    return selected;
  }
  if (!RESOURCE_KINDS.has(kind)) throw new Error('INVALID_INTEGRATION_KIND');
  if (targetId === '__registry__') {
    const registry = `${kind}/registry.json`;
    if (path && safeRelative(path) !== registry) throw new Error('RESOURCE_TARGET_NOT_ALLOWED');
    if (!existsSync(pathFor(root, registry))) throw new Error('RESOURCE_REGISTRY_NOT_FOUND');
    return registry;
  }
  assertId(targetId, 'INVALID_RESOURCE_ID');
  const selected = path ? safeRelative(path) : `${kind}/${targetId}/current.json`;
  const expectedCurrent = `${kind}/${targetId}/current.json`;
  const expectedRegistry = `${kind}/registry.json`;
  if (selected !== expectedCurrent && selected !== expectedRegistry) throw new Error('RESOURCE_TARGET_NOT_ALLOWED');
  if (selected === expectedCurrent && !existsSync(pathFor(root, selected))) throw new Error('RESOURCE_CURRENT_NOT_FOUND');
  if (selected === expectedRegistry && !existsSync(pathFor(root, selected))) throw new Error('RESOURCE_REGISTRY_NOT_FOUND');
  return selected;
}

function assertNoSecrets(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.test(key) && typeof item === 'string' && item.trim() && !item.startsWith('reference:') && !item.startsWith('${')) throw new Error(`RAW_SECRET_NOT_ALLOWED:${path}.${key}`);
    assertNoSecrets(item, `${path}.${key}`);
  }
}

function parseJson(text) {
  if (typeof text !== 'string') throw new Error('INTEGRATION_JSON_REQUIRED');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('INTEGRATION_JSON_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INTEGRATION_JSON_OBJECT_REQUIRED');
  assertNoSecrets(parsed);
  return parsed;
}

function basePlan(kind, root, now) {
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `integration-${kind}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: `integration-${kind}`,
    workspaceRoot: root,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    steps: [],
    verification: [
      're-read target baseline hash immediately before apply',
      'write through a checkpoint and atomic replacement',
      're-read the target and verify the new hash after apply'
    ]
  };
}

export function listIntegrationTargets({ workspaceRoot, kind, targetId }) {
  const root = rootPath(workspaceRoot);
  if (kind === 'platform') return { schema: 'architecture-manager-integration-targets/v1', kind, targetId, paths: platformCandidates(root, targetId), writePerformed: false };
  if (RESOURCE_KINDS.has(kind)) {
    const paths = targetId === '__registry__' ? resourceCandidates(root, kind, 'missing-id').filter((path) => path === `${kind}/registry.json`) : resourceCandidates(root, kind, targetId);
    return { schema: 'architecture-manager-integration-targets/v1', kind, targetId, paths, writePerformed: false };
  }
  throw new Error('INVALID_INTEGRATION_KIND');
}

export function readIntegrationTarget({ workspaceRoot, kind, targetId, relativePath = null }) {
  const root = rootPath(workspaceRoot);
  const path = targetPathFor(root, kind, targetId, relativePath);
  const data = readText(root, path);
  let parsed = null;
  if (data.exists) {
    try { parsed = JSON.parse(data.content); } catch { parsed = null; }
  }
  return { schema: 'architecture-manager-integration-target/v1', kind, targetId, path, ...data, parsed, writePerformed: false };
}

export function buildIntegrationPlan({ workspaceRoot, kind, targetId, mode = 'config', relativePath = null, beforeText = null, afterText = null, baselineSha256 = null, currentVersion = null, targetVersion = null, availableVersions = [], now = new Date().toISOString() }) {
  const root = rootPath(workspaceRoot);
  if (kind === 'platform') {
    if (mode !== 'config') throw new Error('PLATFORM_CONFIG_ONLY');
    const path = targetPathFor(root, kind, targetId, relativePath);
    const current = readText(root, path);
    const before = beforeText ?? current.content;
    if (current.sha256 !== (baselineSha256 ?? current.sha256) || current.content !== before) throw new Error('INTEGRATION_BASELINE_MISMATCH');
    const next = parseJson(afterText);
    if (next.platform && next.platform !== targetId) throw new Error('PLATFORM_ID_MISMATCH');
    if (before === afterText) throw new Error('NO_INTEGRATION_CHANGE');
    const plan = basePlan('config', root, now);
    plan.target = { kind, targetId, mode, path };
    plan.steps.push({ operation: 'replace-platform-config', target: path, oldSha256: current.sha256, newSha256: sha256(afterText), oldExists: current.exists, checkpoint: true });
    plan.payload = { afterText };
    return plan;
  }
  if (!RESOURCE_KINDS.has(kind)) throw new Error('INVALID_INTEGRATION_KIND');
  const path = targetPathFor(root, kind, targetId, relativePath);
  const current = readText(root, path);
  if (mode === 'pointer') {
    if (!path.endsWith('/current.json')) throw new Error('POINTER_TARGET_REQUIRED');
    const pointer = JSON.parse(current.content);
    const actualVersion = pointer?.version;
    if (!SEMVER.test(String(actualVersion)) || !SEMVER.test(String(targetVersion))) throw new Error('INVALID_RESOURCE_VERSION');
    if (actualVersion === targetVersion) throw new Error('NO_CHANGE');
    if (!Array.isArray(availableVersions) || !availableVersions.includes(targetVersion)) throw new Error('TARGET_VERSION_UNAVAILABLE');
    if (baselineSha256 !== current.sha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
    const versionRoot = join(root, kind, targetId, 'versions', targetVersion);
    if (!existsSync(versionRoot) || !statSync(versionRoot).isDirectory() || !existsSync(join(versionRoot, 'SHA256SUMS'))) throw new Error('TARGET_VERSION_NOT_FROZEN');
    const next = `${JSON.stringify({ ...pointer, version: targetVersion }, null, 2)}\n`;
    const plan = basePlan('pointer', root, now);
    plan.target = { kind, targetId, mode, path, currentVersion: actualVersion, targetVersion };
    plan.steps.push({ operation: 'replace-current-pointer', target: path, oldSha256: current.sha256, newSha256: sha256(next), checkpoint: true });
    return plan;
  }
  if (mode !== 'registry') throw new Error('RESOURCE_MODE_REQUIRED');
  if (!path.endsWith('/registry.json')) throw new Error('REGISTRY_TARGET_REQUIRED');
  if (current.sha256 !== baselineSha256) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  parseJson(afterText);
  if (current.content === afterText) throw new Error('NO_INTEGRATION_CHANGE');
  const plan = basePlan('registry', root, now);
  plan.target = { kind, targetId, mode, path };
  plan.steps.push({ operation: 'replace-resource-registry', target: path, oldSha256: current.sha256, newSha256: sha256(afterText), checkpoint: true });
  plan.payload = { afterText };
  return plan;
}

