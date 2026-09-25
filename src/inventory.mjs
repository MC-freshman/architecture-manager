import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const FORMAL_TOP_LEVEL_DIRECTORIES = [
  '.workbuddy',
  '.zcode',
  'agent',
  'codex',
  'docs-site',
  'doubao',
  'dsh',
  'inbox',
  'qoder',
  'software',
  'tool',
  'versions',
  'workbuddy',
  'zcode'
];

export const PLATFORM_IDS = ['codex', 'dsh', 'workbuddy', 'zcode', 'doubao', 'qoder'];
export const SHARED_REPOSITORIES = ['tool', 'agent', 'software'];

function asPosixPath(value) {
  return value.split(sep).join('/');
}

function normalizeRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new TypeError('workspace root must be a non-empty path');
  }
  const candidate = resolve(root);
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`workspace root is not an existing directory: ${candidate}`);
  }
  return realpathSync(candidate);
}

function relativePath(root, target) {
  return asPosixPath(relative(root, target));
}

function safeReadJson(filePath) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

function readCurrentPointer(root, filePath) {
  const parsed = safeReadJson(filePath);
  const result = {
    path: relativePath(root, filePath),
    valid: parsed.ok,
    id: parsed.ok && typeof parsed.value?.id === 'string' ? parsed.value.id : null,
    version: parsed.ok && typeof parsed.value?.version === 'string' ? parsed.value.version : null,
    error: parsed.ok ? null : parsed.error
  };
  if (parsed.ok && typeof parsed.value?.version !== 'string') {
    result.valid = false;
    result.error = 'current.json has no string version';
  }
  return result;
}

function listReleasePointers(root, repository) {
  const repositoryRoot = join(root, repository);
  if (!existsSync(repositoryRoot) || !statSync(repositoryRoot).isDirectory()) {
    return { repository, exists: false, pointers: [], errors: [`missing repository: ${repository}`] };
  }
  const pointers = [];
  const errors = [];
  for (const entry of readdirSync(repositoryRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const currentPath = join(repositoryRoot, entry.name, 'current.json');
    if (!existsSync(currentPath)) continue;
    pointers.push(readCurrentPointer(root, currentPath));
  }
  return { repository, exists: true, pointers, errors };
}

function findBridge(root, platform) {
  const candidates = [
    join(root, platform, 'bridge', 'bridge.json'),
    join(root, platform, 'bridge.json')
  ];
  const found = candidates.find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile());
  return found ? relativePath(root, found) : null;
}

function inspectGit(root) {
  const result = { isRepository: false, branch: null, head: null, status: [], error: null };
  const gitOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    result.isRepository = execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], gitOptions).trim() === 'true';
    if (!result.isRepository) return result;
    result.branch = execFileSync('git', ['-C', root, 'branch', '--show-current'], gitOptions).trim() || null;
    result.head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], gitOptions).trim();
    const status = execFileSync('git', ['-C', root, 'status', '--short'], gitOptions);
    result.status = status.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    result.error = String(error?.message ?? error);
  }
  return result;
}

export function scanWorkspace(workspaceRoot) {
  const root = normalizeRoot(workspaceRoot);
  const topLevel = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const errors = [];
  const shared = SHARED_REPOSITORIES.map((repository) => listReleasePointers(root, repository));
  for (const item of shared) errors.push(...item.errors);
  const platforms = PLATFORM_IDS.map((id) => ({
    id,
    directoryExists: existsSync(join(root, id)),
    bridge: findBridge(root, id)
  }));
  const versionsRoot = join(root, 'versions');
  const architectureDocuments = existsSync(versionsRoot)
    ? readdirSync(versionsRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => relativePath(root, join(versionsRoot, entry.name)))
        .sort()
    : [];

  return {
    schema: 'architecture-manager-inventory/v1',
    scannedAt: new Date().toISOString(),
    workspaceRoot: root,
    formalTopLevelDirectories: FORMAL_TOP_LEVEL_DIRECTORIES,
    observedTopLevelDirectories: topLevel,
    sharedRepositories: shared,
    platforms,
    architectureDocuments,
    git: inspectGit(root),
    errors,
    writePerformed: false
  };
}

export function assertWithinRoot(root, target) {
  const normalizedRoot = normalizeRoot(root);
  const candidate = resolve(target);
  const rel = relative(normalizedRoot, candidate);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return true;
  throw new Error(`path is outside workspace root: ${candidate}`);
}
