// Shared JSON + containment primitives (3.5.0 P9 consolidation).
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function inside(parent, target) {
  const rel = relative(parent, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !/^[A-Za-z]:/i.test(rel));
}
