import { existsSync, readFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { buildRegistryPlan } from './catalog.mjs';
import { inspectPlatformDirectory } from './inventory.mjs';
import { buildIntegrationPlan } from './integration.mjs';
import { assertPublishedVersion } from './plans.mjs';
import { applySoftwareImport, verifySoftwareImport } from './software-intake.mjs';
import { resolve } from 'node:path';
import { defaultAuditRoot, localViewPath, safeRelative, targetPath } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { atomicWrite, makeId, output, requirePlan, saveCheckpoint, writeAudit } from './transactions/kernel.mjs';

export function applyPlan({ plan, afterText = null, actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString(), failAfterCheckpoint = false }) {
  requirePlan(plan);
  if (plan.kind === 'document-edit') return applyDocument(plan, afterText, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'resource-pointer') return applyPointer(plan, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'platform-view') return applyPlatformView(plan, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'registry-edit') return applyRegistry(plan, afterText || plan.payload?.afterText, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'integration-config' || plan.kind === 'integration-pointer' || plan.kind === 'integration-registry') return applyIntegration(plan, afterText || plan.payload?.afterText, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'software-import') return applySoftwareImport({ plan });
  throw new Error('TRANSACTION_KIND_UNSUPPORTED');
}

function applyPlatformView(plan, context) {
  const platformId = plan.target?.platformId;
  const desired = plan.target?.desiredEnabled;
  if (typeof platformId !== 'string' || typeof desired !== 'boolean') throw new Error('INVALID_PLATFORM_STATE');
  const inspected = inspectPlatformDirectory(plan.workspaceRoot, platformId, plan.target.directoryRelative || platformId);
  if (desired && !inspected.validForView) throw new Error('PLATFORM_MARKERS_MISSING');
  const target = localViewPath(plan.workspaceRoot);
  const before = existsSync(target) ? readFileSync(target, 'utf8') : JSON.stringify({ schema: 'architecture-manager-view/v1', workspaceRoot: resolve(plan.workspaceRoot), enabled: {} }, null, 2);
  let state;
  try { state = JSON.parse(before); } catch { throw new Error('LOCAL_VIEW_CORRUPT'); }
  state.enabled = state.enabled && typeof state.enabled === 'object' ? state.enabled : {};
  const current = state.enabled[platformId] !== false;
  const id = makeId(plan, context.now);
  if (current === desired) return output(writeAudit({ ...context, transactionId: id, plan, action: 'platform-view', status: 'already-applied', target: `platform:${platformId}` }));
  if (current !== plan.target.currentEnabled) throw new Error('EXTERNAL_CHANGE_DETECTED');
  state.enabled[platformId] = desired;
  const after = `${JSON.stringify(state, null, 2)}\n`;
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) throw Object.assign(new Error('SIMULATED_INTERRUPT'), { checkpointPath: saved.path });
  try {
    mkdirSync(resolve(target, '..'), { recursive: true });
    atomicWrite(target, after, id);
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'platform-view', status: 'applied', target: `platform:${platformId}`, oldSha256: sha256(before), newSha256: sha256(after), checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    return output(event, saved.path);
  } catch (error) {
    if (existsSync(saved.path)) atomicWrite(target, before, `${id}-restore`);
    throw Object.assign(new Error(String(error?.message ?? error)), { checkpointPath: saved.path });
  }
}

function applyRegistry(plan, afterText, context) {
  if (typeof afterText !== 'string') throw new Error('REGISTRY_PAYLOAD_REQUIRED');
  const relativeTarget = safeRelative(plan.target?.path);
  if (!(relativeTarget === 'agent/registry.json' || relativeTarget === 'tool/registry.json')) throw new Error('TRANSACTION_TARGET_NOT_ALLOWED');
  const target = targetPath(plan.workspaceRoot, relativeTarget);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error('TRANSACTION_TARGET_NOT_FOUND');
  const before = readFileSync(target, 'utf8');
  const expectedOld = plan.steps?.[0]?.oldSha256;
  const expectedNew = plan.steps?.[0]?.newSha256;
  const id = makeId(plan, context.now);
  if (sha256(before) === expectedNew) return output(writeAudit({ ...context, transactionId: id, plan, action: 'registry-edit', status: 'already-applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew }));
  if (sha256(before) !== expectedOld) throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: writeAudit({ ...context, transactionId: id, plan, action: 'registry-edit', status: 'blocked-external-change', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, error: 'EXTERNAL_CHANGE_DETECTED' }) });
  if (sha256(afterText) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const validated = buildRegistryPlan({ workspaceRoot: plan.workspaceRoot, kind: plan.target.catalogKind, action: plan.target.action, id: plan.target.id, entry: plan.target.entry, baselineSha256: expectedOld });
  if (validated.steps[0].newSha256 !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  JSON.parse(afterText);
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) throw Object.assign(new Error('SIMULATED_INTERRUPT'), { checkpointPath: saved.path });
  try {
    atomicWrite(target, afterText, id);
    const actual = sha256(readFileSync(target, 'utf8'));
    if (actual !== expectedNew) throw new Error('VERIFY_FAILED');
    return output(writeAudit({ ...context, transactionId: id, plan, action: 'registry-edit', status: 'applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true }), saved.path);
  } catch (error) {
    if (existsSync(saved.path)) atomicWrite(target, before, `${id}-restore`);
    throw Object.assign(new Error(String(error?.message ?? error)), { checkpointPath: saved.path });
  }
}

function applyDocument(plan, afterText, context) {
  if (typeof afterText !== 'string') throw new Error('DOCUMENT_PAYLOAD_REQUIRED');
  const relativeTarget = safeRelative(plan.target?.path);
  const target = targetPath(plan.workspaceRoot, relativeTarget);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error('TRANSACTION_TARGET_NOT_FOUND');
  const step = plan.steps?.[0];
  const expectedOld = step?.oldSha256;
  const expectedNew = step?.newSha256;
  const before = readFileSync(target, 'utf8');
  const currentSha = sha256(before);
  const id = makeId(plan, context.now);
  if (currentSha === expectedNew) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'already-applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew });
    return output(event);
  }
  if (currentSha !== expectedOld) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'blocked-external-change', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, error: 'EXTERNAL_CHANGE_DETECTED' });
    throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: event });
  }
  if (sha256(afterText) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'interrupted-before-write', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: 'SIMULATED_INTERRUPT' });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit: event, checkpointPath: saved.path });
  }
  try {
    atomicWrite(target, afterText, id);
    const actual = sha256(readFileSync(target, 'utf8'));
    if (actual !== expectedNew) throw new Error('VERIFY_FAILED');
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'applied', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    return output(event, saved.path);
  } catch (error) {
    if (existsSync(saved.path)) atomicWrite(target, readFileSync(saved.path, 'utf8'), `${id}-restore`);
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'document-edit', status: 'recovered-after-failure', target: relativeTarget, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: String(error?.message ?? error) });
    throw Object.assign(new Error(String(error?.message ?? error)), { audit: event, checkpointPath: saved.path });
  }
}

function applyPointer(plan, context) {
  const targetRelative = `${plan.target?.repository}/${plan.target?.resourceId}/current.json`;
  const target = targetPath(plan.workspaceRoot, targetRelative);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error('TRANSACTION_TARGET_NOT_FOUND');
  const step = plan.steps?.[0];
  if (!step?.oldSha256) throw new Error('POINTER_BASELINE_REQUIRED');
  const before = readFileSync(target, 'utf8');
  const parsed = JSON.parse(before);
  const currentVersion = parsed?.version;
  const expectedOld = plan.target?.currentVersion;
  const expectedNew = plan.target?.targetVersion;
  assertPublishedVersion(plan.workspaceRoot, plan.target?.repository, plan.target?.resourceId, expectedNew);
  const id = makeId(plan, context.now);
  if (currentVersion === expectedNew) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'already-applied', target: targetRelative, oldSha256: step.oldSha256 });
    return output(event);
  }
  if (currentVersion !== expectedOld || sha256(before) !== step.oldSha256) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'blocked-external-change', target: targetRelative, oldSha256: step.oldSha256, error: 'EXTERNAL_CHANGE_DETECTED' });
    throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: event });
  }
  const next = { ...parsed, version: expectedNew };
  const after = `${JSON.stringify(next, null, 2)}\n`;
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'interrupted-before-write', target: targetRelative, oldSha256: step.oldSha256, newSha256: sha256(after), checkpointSha256: saved.sha256, checkpointPath: saved.path, error: 'SIMULATED_INTERRUPT' });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit: event, checkpointPath: saved.path });
  }
  try {
    atomicWrite(target, after, id);
    const actual = JSON.parse(readFileSync(target, 'utf8'));
    if (actual.version !== expectedNew) throw new Error('VERIFY_FAILED');
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'applied', target: targetRelative, oldSha256: step.oldSha256, newSha256: sha256(after), checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    return output(event, saved.path);
  } catch (error) {
    if (existsSync(saved.path)) atomicWrite(target, readFileSync(saved.path, 'utf8'), `${id}-restore`);
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'resource-pointer', status: 'recovered-after-failure', target: targetRelative, oldSha256: step.oldSha256, newSha256: sha256(after), checkpointSha256: saved.sha256, checkpointPath: saved.path, error: String(error?.message ?? error) });
    throw Object.assign(new Error(String(error?.message ?? error)), { audit: event, checkpointPath: saved.path });
  }
}

function applyIntegration(plan, afterText, context) {
  const targetRelative = safeRelative(plan.target?.path);
  const target = targetPath(plan.workspaceRoot, targetRelative);
  const step = plan.steps?.[0];
  const expectedOld = step?.oldSha256 ?? null;
  const expectedNew = step?.newSha256;
  if (typeof expectedNew !== 'string') throw new Error('INVALID_TRANSACTION_PLAN');
  const exists = existsSync(target);
  const before = exists ? readFileSync(target, 'utf8') : '';
  const currentSha = exists ? sha256(before) : null;
  const id = makeId(plan, context.now);
  if (currentSha === expectedNew) return output(writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'already-applied', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew }));
  if (currentSha !== expectedOld) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'blocked-external-change', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, error: 'EXTERNAL_CHANGE_DETECTED' });
    throw Object.assign(new Error('EXTERNAL_CHANGE_DETECTED'), { audit: event });
  }
  if (plan.kind === 'integration-pointer') {
    if (typeof plan.target?.currentVersion !== 'string' || typeof plan.target?.targetVersion !== 'string') throw new Error('INVALID_TRANSACTION_PLAN');
    let pointer;
    try { pointer = JSON.parse(before); } catch { throw new Error('CURRENT_POINTER_INVALID'); }
    if (pointer.version !== plan.target.currentVersion) throw new Error('EXTERNAL_CHANGE_DETECTED');
    const next = `${JSON.stringify({ ...pointer, version: plan.target.targetVersion }, null, 2)}\n`;
    if (sha256(next) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
    afterText = next;
    const validated = buildIntegrationPlan({ workspaceRoot: plan.workspaceRoot, kind: plan.target.kind, targetId: plan.target.targetId, mode: 'pointer', relativePath: targetRelative, baselineSha256: currentSha, targetVersion: plan.target.targetVersion, availableVersions: [plan.target.targetVersion] });
    if (validated.steps[0].newSha256 !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  } else {
    if (typeof afterText !== 'string') throw new Error('INTEGRATION_PAYLOAD_REQUIRED');
    try { JSON.parse(afterText); } catch { throw new Error('INTEGRATION_JSON_INVALID'); }
    if (sha256(afterText) !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
    const validated = buildIntegrationPlan({ workspaceRoot: plan.workspaceRoot, kind: plan.target.kind, targetId: plan.target.targetId, mode: plan.target.mode, relativePath: targetRelative, beforeText: before, afterText, baselineSha256: currentSha });
    if (validated.steps[0].newSha256 !== expectedNew) throw new Error('PLAN_PAYLOAD_MISMATCH');
  }
  const parent = resolve(target, '..');
  if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new Error('INTEGRATION_PARENT_NOT_FOUND');
  const saved = saveCheckpoint(context.auditRoot, id, before);
  if (context.failAfterCheckpoint) {
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'interrupted-before-write', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: 'SIMULATED_INTERRUPT' });
    throw Object.assign(new Error('SIMULATED_INTERRUPT'), { audit: event, checkpointPath: saved.path });
  }
  try {
    atomicWrite(target, afterText, id);
    const actual = sha256(readFileSync(target, 'utf8'));
    if (actual !== expectedNew) throw new Error('VERIFY_FAILED');
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'applied', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, writePerformed: true });
    return output(event, saved.path);
  } catch (error) {
    if (exists) atomicWrite(target, before, `${id}-restore`);
    else if (existsSync(target)) rmSync(target, { force: true });
    const event = writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'recovered-after-failure', target: targetRelative, oldSha256: expectedOld, newSha256: expectedNew, checkpointSha256: saved.sha256, checkpointPath: saved.path, error: String(error?.message ?? error) });
    throw Object.assign(new Error(String(error?.message ?? error)), { audit: event, checkpointPath: saved.path });
  }
}

export function verifyPlanTarget({ plan }) {
  requirePlan(plan);
  if (plan.kind === 'software-import') return verifySoftwareImport({ plan });
  if (plan.kind === 'document-edit') {
    const target = targetPath(plan.workspaceRoot, plan.target.path);
    const content = readFileSync(target, 'utf8');
    const actual = sha256(content);
    return { schema: 'architecture-manager-verification/v1', ok: actual === plan.steps[0].newSha256, target: plan.target.path, actualSha256: actual, expectedSha256: plan.steps[0].newSha256, writePerformed: false };
  }
  if (plan.kind === 'resource-pointer') {
    const targetRelative = `${plan.target.repository}/${plan.target.resourceId}/current.json`;
    const target = targetPath(plan.workspaceRoot, targetRelative);
    const current = JSON.parse(readFileSync(target, 'utf8'));
    return { schema: 'architecture-manager-verification/v1', ok: current.version === plan.target.targetVersion, target: targetRelative, actualVersion: current.version, expectedVersion: plan.target.targetVersion, writePerformed: false };
  }
  if (plan.kind === 'platform-view') {
    const path = localViewPath(plan.workspaceRoot);
    const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { enabled: {} };
    const actual = state.enabled?.[plan.target.platformId] !== false;
    return { schema: 'architecture-manager-verification/v1', ok: actual === plan.target.desiredEnabled, target: `platform:${plan.target.platformId}`, actualEnabled: actual, expectedEnabled: plan.target.desiredEnabled, writePerformed: false };
  }
  if (plan.kind === 'registry-edit') {
    const target = targetPath(plan.workspaceRoot, plan.target.path);
    const actual = sha256(readFileSync(target, 'utf8'));
    return { schema: 'architecture-manager-verification/v1', ok: actual === plan.steps[0].newSha256, target: plan.target.path, actualSha256: actual, expectedSha256: plan.steps[0].newSha256, writePerformed: false };
  }
  if (plan.kind === 'integration-config' || plan.kind === 'integration-registry' || plan.kind === 'integration-pointer') {
    const target = targetPath(plan.workspaceRoot, plan.target.path);
    if (plan.kind === 'integration-pointer') {
      const current = JSON.parse(readFileSync(target, 'utf8'));
      return { schema: 'architecture-manager-verification/v1', ok: current.version === plan.target.targetVersion, target: plan.target.path, actualVersion: current.version, expectedVersion: plan.target.targetVersion, writePerformed: false };
    }
    const actual = sha256(readFileSync(target, 'utf8'));
    return { schema: 'architecture-manager-verification/v1', ok: actual === plan.steps[0].newSha256, target: plan.target.path, actualSha256: actual, expectedSha256: plan.steps[0].newSha256, writePerformed: false };
  }
  throw new Error('TRANSACTION_KIND_UNSUPPORTED');
}
