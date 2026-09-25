import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('INVALID_TRANSACTION_TARGET');
  const normalized = normalize(value).split(sep).join('/');
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
  return normalized;
}

function targetPath(workspaceRoot, relativePath) {
  const root = resolve(workspaceRoot);
  const target = resolve(root, safeRelative(relativePath));
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || /^[A-Za-z]:/i.test(rel)) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
  return target;
}

function defaultAuditRoot() {
  return join(process.env.LOCALAPPDATA || tmpdir(), 'ArchitectureManager', 'audit');
}

function auditPath(auditRoot) {
  mkdirSync(auditRoot, { recursive: true });
  return join(auditRoot, 'events.jsonl');
}

function makeId(plan, now) {
  return `${plan.planId}-${now.replace(/[^0-9]/g, '').slice(0, 17)}-${randomUUID().slice(0, 8)}`;
}

function writeAudit({ auditRoot, transactionId, plan, actor, action, status, target, oldSha256 = null, newSha256 = null, checkpointSha256 = null, checkpointPath = null, writePerformed = false, error = null, now }) {
  const event = {
    schema: 'architecture-manager-audit/v1',
    transactionId,
    planId: plan.planId,
    action,
    status,
    actor,
    workspaceRoot: plan.workspaceRoot,
    target,
    oldSha256,
    newSha256,
    checkpointSha256,
    checkpointPath,
    writePerformed,
    error,
    occurredAt: now
  };
  appendFileSync(auditPath(auditRoot), `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

function saveCheckpoint(auditRoot, transactionId, content) {
  const directory = join(auditRoot, 'checkpoints');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${transactionId}.before`);
  writeFileSync(path, content, 'utf8');
  return { path, sha256: sha256(content) };
}

function atomicWrite(target, content, transactionId) {
  const temporary = `${target}.architecture-manager-${transactionId}.tmp`;
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function requirePlan(plan) {
  if (!plan || plan.schema !== 'architecture-manager-plan/v1' || plan.writePerformed !== false) throw new Error('INVALID_TRANSACTION_PLAN');
  if (plan.applyMode !== 'confirmation-required') throw new Error('TRANSACTION_CONFIRMATION_REQUIRED');
}

function output(event, checkpointPath = null) {
  return { schema: 'architecture-manager-transaction/v1', ...event, checkpointPath };
}

export function applyPlan({ plan, afterText = null, actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString(), failAfterCheckpoint = false }) {
  requirePlan(plan);
  if (plan.kind === 'document-edit') return applyDocument(plan, afterText, { actor, auditRoot, now, failAfterCheckpoint });
  if (plan.kind === 'resource-pointer') return applyPointer(plan, { actor, auditRoot, now, failAfterCheckpoint });
  throw new Error('TRANSACTION_KIND_UNSUPPORTED');
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

export function verifyPlanTarget({ plan }) {
  requirePlan(plan);
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
  throw new Error('TRANSACTION_KIND_UNSUPPORTED');
}
