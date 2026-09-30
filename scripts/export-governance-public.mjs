// Public governance export (sensitivity-review round 2026-09-30).
// Exports the governance repo HEAD into a fresh public tree:
//   - drops platform-private evidence (qoder/runtime/**, inbox/**)
//   - redacts personal local paths (C:\Users\wk, D:/ctf-competition)
//   - adds LICENSE, PUBLICATION-BOUNDARY.md, README.md, EXPORT-MANIFEST.json, REPOSITORY-SHA256SUMS
// Re-runnable: every run re-exports from the current HEAD of the source repo.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const source = resolve(process.argv[2] || 'E:/ai');
const staging = resolve(process.argv[3] || join(tmpdirDefault(), 'governance-public-export'));

function tmpdirDefault() {
  return process.env.TEMP || '/tmp';
}
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function walk(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const tarFile = join(staging, '..', 'export-source.tar');
execFileSync('git', ['-C', source, 'archive', '--format=tar', head, '-o', tarFile]);
execFileSync('tar', ['--force-local', '-xf', tarFile, '-C', staging]);
rmSync(tarFile, { force: true });

const removed = [];
for (const banned of ['qoder/runtime', 'inbox']) {
  const target = join(staging, banned);
  if (existsSync(target)) {
    removed.push(...walk(target).map((rel) => `${banned}/${rel}`.slice(banned.length + 1)));
    rmSync(target, { recursive: true, force: true });
  }
}

const REDACTIONS = [
  { pattern: /D:[\\/]+ctf-competition[^\s"']*/gi, replacement: '<local-tool-body-path>' },
  { pattern: /C:[\\/]+Users[\\/]+wk[^\s"']*/gi, replacement: '<local-user-path>' }
];
const redacted = [];
for (const rel of walk(staging)) {
  if (!/\.(json|md|mjs|js|ts|txt|yaml|yml|py|html|css)$/i.test(rel)) continue;
  const path = join(staging, rel);
  const text = readFileSync(path, 'utf8');
  let next = text;
  for (const { pattern, replacement } of REDACTIONS) {
    next = next.replace(pattern, replacement);
  }
  if (next !== text) {
    writeFileSync(path, next);
    redacted.push(rel);
  }
}

writeFileSync(join(staging, 'LICENSE'), `MIT License (code) + CC-BY-4.0 (documentation)

Code files (scripts, .mjs/.js/.ts/.py) are licensed under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Documentation, workflow definitions, agent definitions and architecture baselines (.md/.yaml files under versions/, tool/, agent/, docs-site/) are licensed under CC-BY-4.0: https://creativecommons.org/licenses/by/4.0/
`);

writeFileSync(join(staging, 'PUBLICATION-BOUNDARY.md'), `# Publication boundary

This repository is a **fresh public export** of a private governance workspace
(current generation, exported from governance HEAD \`${head.slice(0, 12)}\`).

**Published here:** governance baselines (versions/), the three shared repositories
(tool = workflows, agent = experts, software = software recipes/definitions),
platform chapters and capability declarations, the documentation site, and the
architecture baselines.

**Never published (kept in the private live workspace):** platform runtime
evidence and maintenance ledgers, software bodies and their local install paths
(replaced by \`<local-tool-body-path>\` / \`<local-user-path>\` placeholders),
credentials (none exist in this export — verified by a full-history scan of the
source at export time), inbox contents.

**Dual-use note:** the security workflows and experts included here are
*definitions* (prompts, schemas, tool-lock manifests) for publicly available
standard tooling. They contain no exploits and no targets. Use them only on
systems you are authorized to test.

Re-exports are generated by \`scripts/export-governance-public.mjs\` in the
[architecture-manager](https://github.com/MC-freshman/architecture-manager) repository.
`);

// README body lives in ./export-readme.md (edit that file, not this one).
writeFileSync(join(staging, 'README.md'), readFileSync(new URL('./export-readme.md', import.meta.url), 'utf8'));

// The exported tree carries the source repo's whitelist .gitignore (`/*` + allowlist),
// which silently git-ignores the five publication files above and below — so `git add -A`
// in the export repo would drop them. Re-allowlist them before the hash manifest is computed.
const gitignore = join(staging, '.gitignore');
if (existsSync(gitignore)) {
  appendFileSync(gitignore, '\n# ── publication files added by export-governance-public.mjs\n' +
    ['/LICENSE', '/README.md', '/PUBLICATION-BOUNDARY.md', '/REPOSITORY-SHA256SUMS', '/EXPORT-MANIFEST.json']
      .map((p) => `!${p}`).join('\n') + '\n');
}

const allFiles = walk(staging);
const sums = allFiles.map((rel) => `${sha256File(join(staging, rel))}  ${rel}`).join('\n') + '\n';
writeFileSync(join(staging, 'REPOSITORY-SHA256SUMS'), sums);
writeFileSync(join(staging, 'EXPORT-MANIFEST.json'), `${JSON.stringify({
  schema: 'ai-public-export-manifest/v1',
  generatedAt: new Date().toISOString(),
  sourceHead: head,
  fileCount: allFiles.length,
  removedPrefixes: ['qoder/runtime/**', 'inbox/**'],
  removedCount: removed.length,
  redactedFiles: redacted,
  redactionPlaceholders: ['<local-tool-body-path>', '<local-user-path>']
}, null, 2)}\n`);

console.log(JSON.stringify({ staging, sourceHead: head.slice(0, 12), fileCount: allFiles.length, removedCount: removed.length, redacted: redacted.length, redactedFiles: redacted }, null, 1));
