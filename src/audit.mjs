import {parseJson as parseJsonText} from './core/json.mjs';
// Read-only audit-history domain (3.5.0 P1④).
// Surfaces the transaction kernel's own events.jsonl and checkpoints to the
// user. The audit root lives in appdata, outside any architecture workspace;
// an override root is accepted so tests can run against fixtures.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAuditRoot } from './core/paths.mjs';

export function readAuditEvents(options = {}) {
  const auditRoot = options.auditRoot ?? defaultAuditRoot();
  const eventsPath = join(auditRoot, 'events.jsonl');
  if (!existsSync(eventsPath)) {
    return { auditRoot, eventsPath, present: false, totalEvents: 0, corruptLines: 0, events: [] };
  }
  const raw = readFileSync(eventsPath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  const events = [];
  let corruptLines = 0;
  for (const line of lines) {
    try {
      events.push(parseJsonText(line));
    } catch {
      corruptLines += 1;
    }
  }
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : events.length;
  const checkpointsPath = join(auditRoot, 'checkpoints');
  let checkpointCount = 0;
  try {
    checkpointCount = readdirSync(checkpointsPath).length;
  } catch {
    checkpointCount = 0;
  }
  return {
    auditRoot,
    eventsPath,
    present: true,
    totalEvents: events.length,
    corruptLines,
    checkpointCount,
    events: events.slice(-limit)
  };
}
