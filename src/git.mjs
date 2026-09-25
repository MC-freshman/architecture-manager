import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';

const SHA = /^[0-9a-f]{7,40}$/i;
const SECRET = /(password|passwd|api[_-]?key|access[_-]?token|secret|private[_-]?key)\s*[:=]/i;
const SKIP_PARTS = new Set(['node_modules', 'dist', 'build', '.git']);

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function pathRel(root, target) {
  return relative(root, target).split(sep).join('/');
}

function parseStatus(status) {
  return status.split(/\r?\n/).filter(Boolean).map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }));
}

export function inspectGit(root) {
  const result = { isRepository: false, branch: null, head: null, upstream: null, ahead: null, behind: null, remotes: [], status: [], error: null };
  try {
    result.isRepository = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
    if (!result.isRepository) return result;
    result.branch = git(root, ['branch', '--show-current']) || null;
    result.head = git(root, ['rev-parse', 'HEAD']);
    result.status = parseStatus(git(root, ['status', '--short']));
    result.remotes = git(root, ['remote', '-v']).split(/\r?\n/).filter(Boolean).map((line) => line.trim());
    try {
      result.upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
      const [behind, ahead] = git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).split(/\s+/).map(Number);
      result.ahead = Number.isFinite(ahead) ? ahead : null;
      result.behind = Number.isFinite(behind) ? behind : null;
    } catch {
      result.upstream = null;
    }
  } catch (error) {
    result.error = String(error?.message ?? error);
  }
  return result;
}

function changedPaths(root) {
  return inspectGit(root).status.map((item) => item.path.split(' -> ').at(-1));
}

export function scanSensitiveFiles(root) {
  const findings = [];
  for (const relativePath of changedPaths(root)) {
    const absolutePath = resolve(root, relativePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;
    if (relativePath.split('/').some((part) => SKIP_PARTS.has(part))) continue;
    const size = statSync(absolutePath).size;
    if (size > 10 * 1024 * 1024) {
      findings.push({ path: relativePath, kind: 'large-file', bytes: size });
      continue;
    }
    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    const text = buffer.toString('utf8');
    if (SECRET.test(text) || text.includes('-----BEGIN PRIVATE KEY-----')) findings.push({ path: relativePath, kind: 'possible-secret', bytes: size });
  }
  return { schema: 'architecture-manager-sensitive-scan/v1', clean: findings.length === 0, findings, writePerformed: false };
}

export function buildGitPlan({ workspaceRoot, action, message = '', remote = 'origin', commit = '', backupName = '', now = new Date().toISOString() }) {
  if (!['commit', 'push', 'rollback', 'backup'].includes(action)) throw new Error('INVALID_GIT_ACTION');
  const plan = {
    schema: 'architecture-manager-plan/v1',
    planId: `git-${action}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: `git-${action}`,
    workspaceRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    steps: [],
    verification: ['re-read HEAD and workspace status before apply', 'preserve a checkpoint before destructive or remote actions']
  };
  if (action === 'commit') {
    if (typeof message !== 'string' || message.trim().length < 3) throw new Error('COMMIT_MESSAGE_REQUIRED');
    plan.steps.push({ operation: 'commit', message: message.trim(), command: ['git', 'commit', '-m', message.trim()] });
  } else if (action === 'push') {
    if (!/^[A-Za-z0-9._/-]+$/.test(remote)) throw new Error('INVALID_REMOTE');
    plan.steps.push({ operation: 'push', remote, force: false, command: ['git', 'push', remote] });
  } else if (action === 'rollback') {
    if (!SHA.test(commit)) throw new Error('INVALID_COMMIT_SHA');
    plan.steps.push({ operation: 'revert-commit', commit, command: ['git', 'revert', '--no-edit', commit], destructive: false });
  } else {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(backupName)) throw new Error('INVALID_BACKUP_NAME');
    plan.steps.push({ operation: 'backup', destination: `%LOCALAPPDATA%/ArchitectureManager/backups/${backupName}`, command: 'managed-copy', destructive: false });
  }
  return plan;
}

export function backupAndRestoreFixture(sourceRoot) {
  const backupRoot = `${sourceRoot}-backup-test`;
  const restoredRoot = `${sourceRoot}-restore-test`;
  rmSync(backupRoot, { recursive: true, force: true });
  rmSync(restoredRoot, { recursive: true, force: true });
  cpSync(sourceRoot, backupRoot, { recursive: true, force: true });
  rmSync(sourceRoot, { recursive: true, force: true });
  cpSync(backupRoot, restoredRoot, { recursive: true, force: true });
  const restored = readFileSync(join(restoredRoot, 'payload.txt'), 'utf8');
  rmSync(backupRoot, { recursive: true, force: true });
  rmSync(restoredRoot, { recursive: true, force: true });
  return { restored, writePerformed: true };
}

