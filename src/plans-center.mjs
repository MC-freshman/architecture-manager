// Plan center (3.5.0 P6): parse P-step tables out of the implementation
// documents under versions/, so the GUI can show each P's blocks, artifacts
// and acceptance criteria without copying content anywhere. Status text stays
// with the documents themselves (edited through the document plan flow).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { targetPath } from './core/paths.mjs';

const P_ROW = /^\|\s*\*\*(P\d+[0-9A-Za-z（(.]?)\s*([^*]*)\*\*\s*\|/;

function splitCells(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

export function parseImplementationTables(workspaceRoot) {
  const root = resolve(workspaceRoot);
  const versionsDir = targetPath(root, 'versions');
  if (!existsSync(versionsDir)) return { versionsDir, documents: [] };
  const documents = [];
  for (const entry of readdirSync(versionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join('versions', entry.name);
    const text = readFileSync(join(versionsDir, entry.name), 'utf8');
    const steps = [];
    for (const line of text.split(/\r?\n/)) {
      const match = P_ROW.exec(line);
      if (!match) continue;
      const cells = splitCells(line);
      if (cells.length < 4) continue;
      steps.push({
        id: match[1].replace(/[（(].*$/, ''),
        name: match[2].trim(),
        duration: cells[1] || null,
        blocks: cells[2] || null,
        artifacts: cells[3] || null,
        criteria: cells[4] || cells[3] || null
      });
    }
    if (steps.length > 0) documents.push({ path: `versions/${entry.name}`, steps });
  }
  return { versionsDir, documents };
}
