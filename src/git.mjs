import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';

const SHA = /^[0-9a-f]{7,40}$/i;
const SECRET = /(password|passwd|api[_-]?key|access[_-]?token|secret|private[_-]?key)\s*[:=]/i;
const SKIP_PARTS = new Set(['node_modules', 'dist', 'build', '.git']);
const GIT_REF_NAME = /^[A-Za-z0-9._/-]{1,120}$/;

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

export function buildGitPlan({ workspaceRoot, action, message = '', remote = 'origin', branch = '', tag = '', commit = '', backupName = '', paths = [], now = new Date().toISOString() }) {
  if (!['commit', 'branch', 'tag', 'push', 'rollback', 'backup'].includes(action)) throw new Error('INVALID_GIT_ACTION');
  const inspected = inspectGit(workspaceRoot);
  if (!inspected.isRepository || !inspected.head) throw new Error('GIT_REPOSITORY_REQUIRED');
  const plan = {
    schema: 'architecture-manager-plan/v1',
    planId: `git-${action}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: `git-${action}`,
    workspaceRoot,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { headBefore: inspected.head, branch: inspected.branch },
    steps: [],
    verification: ['re-read HEAD before apply and reject stale plans', 'reject git add -A/. and force push by construction', 'audit the outcome without storing file bodies']
  };
  if (action === 'commit') {
    if (typeof message !== 'string' || message.trim().length < 3) throw new Error('COMMIT_MESSAGE_REQUIRED');
    const staged = validateStagedPaths(paths);
    if (staged.length === 0) throw new Error('COMMIT_PATHS_REQUIRED');
    plan.target.paths = staged;
    plan.steps.push({ operation: 'commit', message: message.trim(), paths: staged, command: ['git', 'add', '--', ...staged, '&&', 'git', 'commit', '-m', message.trim()] });
  } else if (action === 'branch') {
    if (!GIT_REF_NAME.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new Error('INVALID_BRANCH_NAME');
    plan.steps.push({ operation: 'create-branch', branch, command: ['git', 'branch', branch] });
  } else if (action === 'tag') {
    if (!GIT_REF_NAME.test(tag) || tag.startsWith('-') || tag.includes('..')) throw new Error('INVALID_TAG_NAME');
    plan.steps.push({ operation: 'create-tag', tag, command: ['git', 'tag', tag] });
  } else if (action === 'push') {
    if (!/^[A-Za-z0-9._/-]+$/.test(remote)) throw new Error('INVALID_REMOTE');
    plan.steps.push({ operation: 'push', remote, force: false, command: ['git', 'push', remote] });
  } else if (action === 'rollback') {
    if (!SHA.test(commit)) throw new Error('INVALID_COMMIT_SHA');
    plan.steps.push({ operation: 'revert-commit', commit, command: ['git', 'revert', '--no-edit', commit], destructive: false });
  } else {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(backupName)) throw new Error('INVALID_BACKUP_NAME');
    const destination = `inbox/archive/${backupName}`;
    plan.target.destination = destination;
    plan.steps.push({ operation: 'export-backup', destination, command: ['git', 'archive', '--format=zip', '-o', `${destination}/repo.zip`, 'HEAD'] });
  }
  return plan;
}

function validateStagedPaths(paths) {
  if (!Array.isArray(paths)) throw new Error('GIT_ADD_ALL_FORBIDDEN');
  const forbidden = new Set(['.', './', '-A', '--all', '..', ':/', '*']);
  const staged = [];
  for (const raw of paths) {
    if (typeof raw !== 'string') throw new Error('GIT_ADD_ALL_FORBIDDEN');
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (forbidden.has(trimmed) || trimmed.startsWith('-') || trimmed.includes('..') || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
      throw new Error('GIT_ADD_ALL_FORBIDDEN');
    }
    const normalized = trimmed.split('\\').join('/');
    if (!staged.includes(normalized)) staged.push(normalized);
  }
  return staged;
}

export function scanSensitivePaths(root, paths) {
  const findings = [];
  for (const relativePath of paths) {
    const absolutePath = resolve(root, relativePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;
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
  return { clean: findings.length === 0, findings };
}
