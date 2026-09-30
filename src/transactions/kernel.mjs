import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sha256 } from '../core/hash.mjs';

export function makeId(plan, now) {
  return `${plan.planId}-${now.replace(/[^0-9]/g, '').slice(0, 17)}-${randomUUID().slice(0, 8)}`;
}

function auditPath(auditRoot) {
  mkdirSync(auditRoot, { recursive: true });
  return join(auditRoot, 'events.jsonl');
}

export function writeAudit({ auditRoot, transactionId, plan, actor, action, status, target, oldSha256 = null, newSha256 = null, checkpointSha256 = null, checkpointPath = null, connectorStatus = null, writePerformed = false, error = null, now }) {
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
    connectorStatus,
    writePerformed,
    error,
    occurredAt: now
  };
  appendFileSync(auditPath(auditRoot), `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export function saveCheckpoint(auditRoot, transactionId, content) {
  const directory = join(auditRoot, 'checkpoints');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${transactionId}.before`);
  writeFileSync(path, content, 'utf8');
  return { path, sha256: sha256(content) };
}

export function atomicWrite(target, content, transactionId) {
  const temporary = `${target}.architecture-manager-${transactionId}.tmp`;
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

export function requirePlan(plan) {
  if (!plan || plan.schema !== 'architecture-manager-plan/v1' || plan.writePerformed !== false) throw new Error('INVALID_TRANSACTION_PLAN');
  if (plan.applyMode !== 'confirmation-required') throw new Error('TRANSACTION_CONFIRMATION_REQUIRED');
}

export function output(event, checkpointPath = null) {
  return { schema: 'architecture-manager-transaction/v1', ...event, checkpointPath };
}

