import {parseJson as parseJsonText} from './core/json.mjs';
import { validateResourceContent } from './domains/resources/contracts.mjs';
import { validateFrozenResource } from './domains/resources/versions.mjs';
import { verifyFrozenDirectory } from './domains/resources/integrity.mjs';
// Release wizard (3.5.0 P4): publish/upgrade scaffolds for the tool and agent
// shared repositories. Publishing creates a NEW semver directory and never
// touches published bytes; adoption stays a separate resource-pointer plan
// (发布 ≠ 采纳). Every file is covered by a regenerated SHA256SUMS and
// re-verified after write.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from './core/hash.mjs';
import { targetPath,safeRelative } from './core/paths.mjs';
import { atomicWrite, makeId, output, requirePlan, writeAudit } from './transactions/kernel.mjs';

const SEMVER = /^\d+\.\d+\.\d+$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPOSITORIES = { tool: { key: 'workflows' }, agent: { key: 'agents' } };
const EXCLUDED_PARTS = new Set(['__pycache__', '.pytest_cache', 'node_modules']);
const EXCLUDED_FILES = new Set(['SHA256SUMS']);
const BINARY_SUFFIXES = ['.png', '.jpg', '.zip', '.exe', '.dll', '.pdf', '.ico'];

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function listFilesRecursive(directory, prefix = '') {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_PARTS.has(entry.name)) continue;
      out.push(...listFilesRecursive(join(directory, entry.name), relativePath));
    } else if (!EXCLUDED_FILES.has(entry.name)) {
      out.push(relativePath);
    }
  }
  return out.sort();
}

function manifestFor(repository, id, version) {
  if (repository === 'tool') {
    return { schema: 'ai-tool-manifest/v2', id, version, entry: 'workflow.yaml', inputFormat: 'text', outputFormat: 'json', permissions: [], dependencies: {} };
  }
  return { schema: 'ai-agent-manifest/v2', id, version, prompt: 'prompt.md', workflows: [], permissions: [], model: null };
}

function sourceFor(repository, id, version, upgradeFrom) {
  return {
    schema: 'ai-release-source/v1',
    repository,
    id,
    version,
    generatedBy: 'architecture-manager release wizard (3.5.0 P4)',
    upgradeFrom: upgradeFrom || null,
    releaseScope: 'staged-by-manager; complete SOURCE fields before adoption',
    pairingRequired: repository === 'tool' ? ['repo-lint pairing (D-52): raising tool/repo-lint pointer must pair with each platform scannerRelease'] : []
  };
}

function definitionFor(repository, id, version) {
  if (repository === 'tool') {
    return { path: 'workflow.yaml', content: `schema: ai-workflow-definition/v3\nid: ${id}\nversion: "${version}"\nstages: []\n` };
  }
  return { path: 'prompt.md', content: `# ${id} ${version}\n\n(prompt body)\n` };
}

export function buildReleasePlan({ workspaceRoot, repository, resourceId, targetVersion, upgradeFrom = null, definitionOverride = null, note = null, now = new Date().toISOString() }) {
  if (!REPOSITORIES[repository]) throw new Error('RELEASE_REPOSITORY_INVALID');
  if (!RESOURCE_ID.test(String(resourceId || ''))) throw new Error('RELEASE_RESOURCE_ID_INVALID');
  if (!SEMVER.test(String(targetVersion || ''))) throw new Error('RELEASE_SEMVER_INVALID');
  const root = resolve(workspaceRoot);
  const resourceRoot = targetPath(root, join(repository, resourceId));
  const currentPath = join(resourceRoot, 'current.json');
  if (!existsSync(currentPath)) throw new Error('RESOURCE_NOT_FOUND');
  const versionRoot = join(resourceRoot, 'versions', targetVersion);
  if (existsSync(versionRoot)) throw new Error('RELEASE_VERSION_EXISTS');
  const files = [];
  let copyFrom = null;
  if (upgradeFrom) {
    if (!SEMVER.test(String(upgradeFrom))) throw new Error('RELEASE_SEMVER_INVALID');
    const sourceRoot = join(resourceRoot, 'versions', upgradeFrom);
    if (!existsSync(sourceRoot)) throw new Error('RELEASE_UPGRADE_SOURCE_MISSING');
    const binaries = [];
    for (const relativePath of listFilesRecursive(sourceRoot)) {
      const buffer = readFileSync(join(sourceRoot, relativePath));
      if (relativePath === 'manifest.json') {
        const manifest = parseJsonText(buffer.toString('utf8'));
        files.push({ path: relativePath, encoding: 'utf8', content: `${JSON.stringify({ ...manifest, version: targetVersion }, null, 2)}\n` });
      } else if (relativePath === 'SOURCE.json') {
        const source = parseJsonText(buffer.toString('utf8'));
        files.push({ path: relativePath, encoding: 'utf8', content: `${JSON.stringify({ ...source, version: targetVersion, upgradeFrom }, null, 2)}\n` });
      } else if (isBinary(buffer) || BINARY_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) {
        binaries.push(relativePath);
      } else {
        files.push({ path: relativePath, encoding: 'utf8', content: buffer.toString('utf8') });
      }
    }
    copyFrom = { version: upgradeFrom, files: binaries.map((relativePath) => ({ path: relativePath, sha256: fileHash(join(sourceRoot, relativePath)) })) };
  }
  const hasManifest = files.some((file) => file.path === 'manifest.json');
  if (!hasManifest) files.unshift({ path: 'manifest.json', encoding: 'utf8', content: `${JSON.stringify(manifestFor(repository, resourceId, targetVersion), null, 2)}\n` });
  if (!files.some((file) => file.path === 'SOURCE.json')) {
    files.splice(1, 0, { path: 'SOURCE.json', encoding: 'utf8', content: `${JSON.stringify(sourceFor(repository, resourceId, targetVersion, upgradeFrom), null, 2)}\n` });
  }
  const definition = definitionFor(repository, resourceId, targetVersion);
  if (!files.some((file) => file.path === definition.path)) files.push({ ...definition });
  if (typeof definitionOverride === 'string' && definitionOverride.trim() !== '') {
    const index = files.findIndex((file) => file.path === definition.path);
    files[index] = { path: definition.path, encoding: 'utf8', content: definitionOverride };
  }
  if (!files.some((file) => file.path.startsWith('tests/'))) files.push({ path: 'tests/.gitkeep', encoding: 'utf8', content: '' });
  const manifest = parseJsonText(files.find((file) => file.path === 'manifest.json').content);
  if (manifest.version !== targetVersion) throw new Error('RELEASE_MANIFEST_VERSION_MISMATCH');
  const candidate = new Map(files.map(file=>[file.path,file.content]));
  validateResourceContent({repository,resourceId,version:targetVersion,read:name=>candidate.get(name),has:name=>candidate.has(name)});
  const sumsEntries = files.map((file) => `${sha256(file.content)}  ${file.path}`);
  for (const binary of copyFrom?.files || []) sumsEntries.push(`${binary.sha256}  ${binary.path}`);
  const sums = sumsEntries.sort().join('\n') + '\n';
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `release-${repository}-${resourceId}-${targetVersion}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'release-publish',
    workspaceRoot: root,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: { repository, resourceId, targetVersion, upgradeFrom: upgradeFrom || null, note: typeof note === 'string' ? note : null, destination: `${repository}/${resourceId}/versions/${targetVersion}` },
    steps: [{ operation: 'create-release-directory', fileCount: files.length + (copyFrom?.files.length || 0), sha256sums: true, sumsSha256: sha256(sums) }],
    verification: ['re-check the target version directory does not exist before apply', 'write every file atomically and re-hash against SHA256SUMS', 'remove the whole directory on failure'],
    payload: { files, sums, copyFrom }
  };
}

export function applyRelease(plan, context) {
  requirePlan(plan);
  const root = resolve(plan.workspaceRoot);
  const { repository, resourceId, targetVersion, destination } = plan.target;
  if(destination!==`${repository}/${resourceId}/versions/${targetVersion}`) throw new Error('INVALID_TRANSACTION_TARGET');
  const candidate=new Map(plan.payload.files.map(file=>[file.path,file.content]));
  validateResourceContent({repository,resourceId,version:targetVersion,read:name=>candidate.get(name),has:name=>candidate.has(name)});
  const versionRoot = targetPath(root, destination);
  const sumsPath = join(versionRoot, 'SHA256SUMS');
  const id = makeId(plan, context.now);
  if (existsSync(sumsPath)) {
    const actualSums = readFileSync(sumsPath, 'utf8');
    if (actualSums === plan.payload.sums) {
      validateFrozenResource(root,repository,resourceId,targetVersion);
      return output(writeAudit({ ...context, transactionId: id, plan, action: 'release-publish', status: 'already-applied', target: destination, newSha256: plan.steps[0].sumsSha256 }));
    }
    throw new Error('RELEASE_VERSION_EXISTS');
  }
  if (existsSync(versionRoot)) throw new Error('RELEASE_VERSION_EXISTS');
  for(const file of [...plan.payload.files,...(plan.payload.copyFrom?.files || [])]) {
    if(safeRelative(file.path)!==file.path.replaceAll('\\','/')) throw new Error('INVALID_TRANSACTION_TARGET');
    targetPath(root,`${destination}/${file.path}`);
  }
  let created = false;
  try {
    for (const file of plan.payload.files) {
      const target = targetPath(root,`${destination}/${file.path}`);
      mkdirSync(join(target, '..'), { recursive: true });
      atomicWrite(target, file.content, id);
      created = true;
    }
    if (plan.payload.copyFrom) {
      const sourceRoot = join(root, repository, resourceId, 'versions', plan.payload.copyFrom.version);
      if (!existsSync(sourceRoot)) throw new Error('RELEASE_UPGRADE_SOURCE_MISSING');
      for (const binary of plan.payload.copyFrom.files) {
        const target = targetPath(root,`${destination}/${binary.path}`);
        mkdirSync(join(target, '..'), { recursive: true });
        copyFileSync(join(sourceRoot, binary.path), target);
        created = true;
      }
    }
    mkdirSync(versionRoot, { recursive: true });
    atomicWrite(sumsPath, plan.payload.sums, id);
    created = true;
    validateFrozenResource(root,repository,resourceId,targetVersion);
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'release-publish', status: 'applied', target: destination, newSha256: plan.steps[0].sumsSha256, writePerformed: true });
    return output(event);
  } catch (error) {
    if (created && existsSync(versionRoot)) rmSync(versionRoot, { recursive: true, force: true });
    throw Object.assign(new Error(String(error?.message ?? error)), {});
  }
}

function verifyReleaseDir(versionRoot) { return verifyFrozenDirectory(versionRoot); }


export function verifyRelease({ plan }) {
  const root = resolve(plan.workspaceRoot);
  const versionRoot = join(root, plan.target.destination);
  if (!existsSync(versionRoot)) {
    return { schema: 'architecture-manager-verification/v1', ok: false, target: plan.target.destination, error: 'RELEASE_DIR_MISSING', writePerformed: false };
  }
  try {
    verifyReleaseDir(versionRoot);
    validateFrozenResource(root,plan.target.repository,plan.target.resourceId,plan.target.targetVersion);
    return { schema: 'architecture-manager-verification/v1', ok: true, target: plan.target.destination, writePerformed: false };
  } catch (error) {
    return { schema: 'architecture-manager-verification/v1', ok: false, target: plan.target.destination, error: String(error?.message ?? error), writePerformed: false };
  }
}

export function readRegistryBaseline(workspaceRoot, kind) {
  const paths = { agent: 'agent/registry.json', skill: 'tool/registry.json', workflow: 'tool/registry.json' };
  const relativePath = paths[kind];
  if (!relativePath) throw new Error('INVALID_CATALOG_KIND');
  const registryPath = targetPath(resolve(workspaceRoot), relativePath);
  if (!existsSync(registryPath)) throw new Error('CATALOG_REGISTRY_NOT_FOUND');
  const content = readFileSync(registryPath, 'utf8');
  return { path: relativePath, sha256: sha256(content) };
}

export function listResourceReferences(workspaceRoot, repository, resourceId) {
  const root = resolve(workspaceRoot);
  const scanRoots = [join(root, 'tool'), join(root, 'agent')];
  const needle = String(resourceId || '');
  if (!needle) return { references: [], scanned: 0 };
  const references = [];
  let scanned = 0;
  for (const base of scanRoots) {
    if (!existsSync(base)) continue;
    for (const resource of readdirSync(base, { withFileTypes: true })) {
      if (!resource.isDirectory()) continue;
      const currentPath = join(base, resource.name, 'current.json');
      if (!existsSync(currentPath)) continue;
      let version = null;
      try {
        version = parseJsonText(readFileSync(currentPath, 'utf8')).version;
      } catch {
        continue;
      }
      const versionRoot = join(base, resource.name, 'versions', String(version));
      if (!existsSync(versionRoot)) continue;
      for (const relativePath of listFilesRecursive(versionRoot)) {
        if (!/\.(json|yaml|yml|md|txt)$/.test(relativePath)) continue;
        const absolutePath = join(versionRoot, relativePath);
        if (!statSync(absolutePath).isFile()) continue;
        const buffer = readFileSync(absolutePath);
        if (buffer.includes(0)) continue;
        scanned += 1;
        const text = buffer.toString('utf8');
        if (text.includes(needle)) references.push({ path: `${repository === 'tool' ? 'agent' : 'tool'}/${resource.name}/versions/${version}/${relativePath}`, hint: 'mentions ' + needle });
        if (references.length >= 50) return { references, scanned, truncated: true };
      }
    }
  }
  return { references, scanned, truncated: false };
}
