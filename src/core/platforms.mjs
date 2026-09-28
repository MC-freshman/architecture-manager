export const PLATFORM_IDS = Object.freeze(['codex', 'dsh', 'workbuddy', 'zcode', 'doubao', 'qoder']);

export function isFormalPlatform(id) {
  return PLATFORM_IDS.includes(id);
}
