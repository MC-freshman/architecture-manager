// Workspace bootstrap (3.5.0 P10): clone an architecture repository into a
// fresh local root, verify it looks like an architecture workspace, and hand
// it to the normal first-scan flow. Local-only, single user, no server.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultAuditRoot } from './core/paths.mjs';
import { makeId, output, requirePlan, writeAudit } from './transactions/kernel.mjs';

const ARCHITECTURE_MARKERS = ['versions', 'tool', 'agent', 'software', 'AGENTS.md'];

function isEmptyDirectory(path) {
  if (!existsSync(path)) return true;
  if (!statSync(path).isDirectory()) return false;
  return readdirSync(path).length === 0;
}

export function buildWorkspaceClonePlan({ workspaceRoot = null, remote, destination, confirmed = false, now = new Date().toISOString() }) {
  if (confirmed !== true) throw new Error('WORKSPACE_CLONE_CONFIRMATION_REQUIRED');
  if (typeof remote !== 'string' || remote.trim() === '') throw new Error('CLONE_REMOTE_REQUIRED');
  if (!/^(https:\/\/|git@|file:\/\/\/|[A-Za-z]:[\\/])/i.test(remote.trim())) throw new Error('CLONE_REMOTE_INVALID');
  const destinationRoot = resolve(String(destination || ''));
  if (!isEmptyDirectory(destinationRoot)) throw new Error('CLONE_DESTINATION_NOT_EMPTY');
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `workspace-clone-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'workspace-clone',
    workspaceRoot: destinationRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { remote: remote.trim(), destination: destinationRoot },
    steps: [{ operation: 'git-clone', remote: remote.trim(), destination: destinationRoot }],
    verification: ['destination becomes a git repository', 'architecture markers (versions/tool/agent/software/AGENTS.md) present', 'partial clone is removed on failure'],
    payload: {}
  };
}

export function applyWorkspaceClone({ plan }, { actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString() } = {}) {
  requirePlan(plan);
  const destination = plan.target.destination;
  const id = makeId(plan, now);
  const createdHere = !existsSync(destination);
  try {
    execFileSync('git', ['clone', plan.target.remote, destination], { encoding: 'utf8', timeout: 600000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    const head = execFileSync('git', ['-C', destination, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
    const missing = ARCHITECTURE_MARKERS.filter((marker) => !existsSync(join(destination, marker)));
    if (missing.length > 0) throw Object.assign(new Error(`GIT_CLONE_NOT_ARCHITECTURE:${missing.join(',')}`), { missing });
    const event = writeAudit({ actor, auditRoot, now, transactionId: id, plan, action: 'workspace-clone', status: 'applied', target: destination, newSha256: head, writePerformed: true });
    return { ...output(event), head, destination };
  } catch (error) {
    const detail = String(error?.message ?? error);
    writeAudit({ actor, auditRoot, now, transactionId: id, plan, action: 'workspace-clone', status: 'failed', target: destination, error: detail.slice(0, 400) });
    if (createdHere && existsSync(destination)) rmSync(destination, { recursive: true, force: true });
    throw detail.includes('GIT_CLONE_NOT_ARCHITECTURE') ? error : new Error('GIT_CLONE_FAILED');
  }
}
