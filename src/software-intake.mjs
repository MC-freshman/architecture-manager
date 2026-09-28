import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const IDS = new Set(['codex', 'dsh', 'workbuddy', 'zcode', 'doubao', 'qoder']);
const SOFTWARE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const KINDS = new Set(['portable-file', 'unpacked-directory', 'installer']);

function inside(parent, target) {
  const rel = relative(parent, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !/^[A-Za-z]:/i.test(rel));
}
function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function hashSource(path, kind) {
  const rows = [];
  const walk = (directory, prefix = '') => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('SOFTWARE_SYMLINK_NOT_ALLOWED');
      const next = join(directory, item.name);
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) walk(next, rel);
      else if (item.isFile()) rows.push({ path: rel, sha256: digest(next) });
      else throw new Error('SOFTWARE_FILE_TYPE_NOT_ALLOWED');
    }
  };
  if (kind === 'unpacked-directory') walk(path);
  else rows.push({ path: basename(path), sha256: digest(path) });
  if (!rows.length) throw new Error('SOFTWARE_SOURCE_EMPTY');
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}
function copyRows(source, destination, kind, rows) {
  for (const row of rows) {
    const from = kind === 'unpacked-directory' ? join(source, row.path) : source;
    const to = join(destination, row.path);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}
function assertRows(directory, rows) {
  for (const row of rows) if (digest(join(directory, row.path)) !== row.sha256) throw new Error('SOFTWARE_HASH_MISMATCH');
}

export function buildSoftwareImportPlan({ workspaceRoot, platformId, softwareId, sourcePath, intakeKind, now = new Date().toISOString() }) {
  const root = resolve(workspaceRoot);
  if (!IDS.has(platformId) || !SOFTWARE_ID.test(softwareId) || !KINDS.has(intakeKind)) throw new Error('INVALID_SOFTWARE_INTAKE');
  const platformRoot = join(root, platformId);
  if (!existsSync(platformRoot) || !lstatSync(platformRoot).isDirectory()) throw new Error('PLATFORM_DIRECTORY_NOT_FOUND');
  const source = resolve(sourcePath);
  if (inside(join(root, 'software'), source)) throw new Error('SOURCE_IN_SHARED_SOFTWARE_REPOSITORY');
  if (!existsSync(source) || lstatSync(source).isSymbolicLink()) throw new Error('SOFTWARE_SOURCE_INVALID');
  if (intakeKind === 'unpacked-directory' ? !lstatSync(source).isDirectory() : !lstatSync(source).isFile()) throw new Error('SOFTWARE_SOURCE_KIND_MISMATCH');
  const rows = hashSource(source, intakeKind);
  const target = join(platformRoot, 'runtime', 'software', softwareId);
  if (existsSync(target)) throw new Error('SOFTWARE_TARGET_EXISTS');
  const stamp = now.replace(/[^0-9]/g, '').slice(0, 17);
  const backup = join(root, 'inbox', 'backup', platformId, softwareId, stamp);
  if (existsSync(backup)) throw new Error('SOFTWARE_BACKUP_EXISTS');
  return {
    schema: 'architecture-manager-plan/v1', planId: `software-import-${softwareId}-${stamp}`, kind: 'software-import', workspaceRoot: root,
    generatedAt: now, applyMode: 'confirmation-required', writePerformed: false,
    target: { platformId, softwareId, source, intakeKind, path: target, backup },
    steps: [
      { operation: 'copy-full-backup', target: backup, files: rows.length },
      { operation: 'restore-drill', target: join(platformRoot, 'runtime', 'software'), files: rows.length },
      { operation: 'copy-verified-body', target, files: rows.length }
    ],
    verification: ['source hashes unchanged before apply', 'backup fully copied and restored once', 'body and backup hashes equal source'],
    rows
  };
}

export function applySoftwareImport({ plan }) {
  if (plan?.kind !== 'software-import') throw new Error('INVALID_SOFTWARE_IMPORT_PLAN');
  const fresh = buildSoftwareImportPlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, softwareId: plan.target.softwareId, sourcePath: plan.target.source, intakeKind: plan.target.intakeKind, now: plan.generatedAt });
  if (JSON.stringify(fresh.rows) !== JSON.stringify(plan.rows) || fresh.target.path !== plan.target.path || fresh.target.backup !== plan.target.backup) throw new Error('SOFTWARE_SOURCE_CHANGED');
  const { source, intakeKind, path: target, backup } = plan.target;
  const runtimeParent = dirname(target);
  const backupParent = dirname(backup);
  mkdirSync(runtimeParent, { recursive: true });
  mkdirSync(backupParent, { recursive: true });
  const backupStage = mkdtempSync(join(backupParent, '.backup-stage-'));
  const restoreStage = mkdtempSync(join(runtimeParent, '.restore-drill-'));
  const bodyStage = mkdtempSync(join(runtimeParent, '.body-stage-'));
  try {
    copyRows(source, join(backupStage, 'payload'), intakeKind, plan.rows);
    assertRows(join(backupStage, 'payload'), plan.rows);
    copyRows(join(backupStage, 'payload'), restoreStage, 'unpacked-directory', plan.rows);
    assertRows(restoreStage, plan.rows);
    copyRows(join(backupStage, 'payload'), bodyStage, 'unpacked-directory', plan.rows);
    assertRows(bodyStage, plan.rows);
    const manifest = { schema: 'architecture-manager-software-backup/v1', platformId: plan.target.platformId, softwareId: plan.target.softwareId, sourceName: basename(source), intakeKind, files: plan.rows, restoreDrill: { performed: true, verifiedFiles: plan.rows.length, at: new Date().toISOString() }, target };
    writeFileSync(join(backupStage, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    renameSync(backupStage, backup);
    renameSync(bodyStage, target);
    assertRows(target, plan.rows);
    return { schema: 'architecture-manager-software-import-result/v1', status: 'staged-awaiting-recipe', platformId: plan.target.platformId, softwareId: plan.target.softwareId, target, backup, files: plan.rows.length, restored: true, writePerformed: true };
  } finally {
    for (const staging of [backupStage, restoreStage, bodyStage]) if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

export function verifySoftwareImport({ plan }) {
  if (plan?.kind !== 'software-import') throw new Error('INVALID_SOFTWARE_IMPORT_PLAN');
  const backup = join(plan.target.backup, 'payload');
  try {
    assertRows(plan.target.path, plan.rows);
    assertRows(backup, plan.rows);
    const manifest = JSON.parse(readFileSync(join(plan.target.backup, 'MANIFEST.json'), 'utf8'));
    return { ok: manifest.restoreDrill?.performed === true, target: plan.target.path, backup: plan.target.backup, writePerformed: false };
  } catch { return { ok: false, target: plan.target.path, backup: plan.target.backup, writePerformed: false }; }
}
