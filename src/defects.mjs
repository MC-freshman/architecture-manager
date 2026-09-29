// Read-only defect-book domain (3.5.0 P1②).
// Reads versions/缺陷状态簿.json and runs the book's own stdlib checker
// (versions/缺陷状态簿.check.py) as an external subprocess. Neither writes.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RED_STATUSES = new Set(['open', 'unverified-registration']);
const STATUS_ORDER = ['open', 'closed', 'absorbed', 'ruled', 'unverified-registration'];

export function readDefectBook(workspaceRoot) {
  const bookPath = join(workspaceRoot, 'versions', '缺陷状态簿.json');
  if (!existsSync(bookPath)) return { bookPath, present: false };
  let book;
  try {
    book = JSON.parse(readFileSync(bookPath, 'utf8'));
  } catch (error) {
    return { bookPath, present: true, corrupt: true, error: String(error) };
  }
  const defects = Array.isArray(book.defects) ? book.defects : [];
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  const redRows = [];
  for (const defect of defects) {
    if (defect && typeof defect.status === 'string' && defect.status in counts) counts[defect.status] += 1;
    if (defect && RED_STATUSES.has(defect.status)) {
      redRows.push({ id: defect.id ?? null, status: defect.status, title: defect.title ?? null });
    }
  }
  return {
    bookPath,
    present: true,
    corrupt: false,
    generatedAt: typeof book.generatedAt === 'string' ? book.generatedAt : null,
    total: defects.length,
    counts,
    redRows
  };
}

export function verifyDefectBook(workspaceRoot, pythonExecutable = 'python') {
  const checkerPath = join(workspaceRoot, 'versions', '缺陷状态簿.check.py');
  if (!existsSync(checkerPath)) return { checkerPath, present: false };
  try {
    const output = execFileSync(pythonExecutable, ['-B', checkerPath], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { checkerPath, present: true, passed: true, exitCode: 0, output: output.slice(-2000) };
  } catch (error) {
    const code = typeof error.status === 'number' ? error.status : null;
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n').slice(-2000);
    return { checkerPath, present: true, passed: false, exitCode: code, output };
  }
}
