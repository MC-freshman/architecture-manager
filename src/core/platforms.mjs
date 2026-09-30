import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PLATFORM_IDS = Object.freeze(['codex', 'dsh', 'workbuddy', 'zcode', 'doubao', 'qoder']);

export function isFormalPlatform(id) {
  return PLATFORM_IDS.includes(id);
}

// Data-driven platform list (3.5.0 P7): the six base platforms plus any
// first-level directory that carries its own bridge.json. Registered extras
// need no code change.
export function discoverPlatformIds(workspaceRoot) {
  if (!workspaceRoot || !existsSync(workspaceRoot)) return [];
  const discovered = [];
  for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || isFormalPlatform(entry.name)) continue;
    const bridge = join(workspaceRoot, entry.name, 'bridge.json');
    if (existsSync(bridge) && statSync(bridge).isFile()) discovered.push(entry.name);
  }
  return discovered;
}

export function allPlatformIds(workspaceRoot) {
  const discovered = discoverPlatformIds(workspaceRoot);
  return [...PLATFORM_IDS, ...discovered.filter((id) => !PLATFORM_IDS.includes(id))];
}
