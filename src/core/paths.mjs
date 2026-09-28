import { existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { sha256 } from './hash.mjs';

export function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('INVALID_TRANSACTION_TARGET');
  const normalized = normalize(value).split(sep).join('/');
  if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
  return normalized;
}

export function targetPath(workspaceRoot, relativePath) {
  const root = realpathSync(workspaceRoot);
  const lexical = resolve(root, safeRelative(relativePath));
  const target = existsSync(lexical) ? realpathSync(lexical) : lexical;
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || /^[A-Za-z]:/i.test(rel)) throw new Error('TRANSACTION_TARGET_OUTSIDE_WORKSPACE');
  return target;
}

export function defaultAuditRoot() {
  return join(process.env.LOCALAPPDATA || tmpdir(), 'ArchitectureManager', 'audit');
}

export function localViewPath(workspaceRoot) {
  const key = sha256(realpathSync(workspaceRoot)).slice(0, 24);
  const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(base, 'ArchitectureManager', 'views', `${key}.json`);
}

