import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.mjs';
import { buildRegistryPlan } from '../src/catalog.mjs';
import { buildReleasePlan, listResourceReferences, readRegistryBaseline, verifyRelease } from '../src/releases.mjs';
import { applyPlan } from '../src/transactions.mjs';

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'am-release-'));
  const auditRoot = mkdtempSync(join(tmpdir(), 'am-release-audit-'));
  // tool resource with a published 1.0.0
  const toolDir = join(root, 'tool', 'game-pipeline');
  mkdirSync(join(toolDir, 'versions', '1.0.0', 'tests'), { recursive: true });
  writeFileSync(join(toolDir, 'current.json'), `${JSON.stringify({ schema: 'ai-workflow-pointer/v1', id: 'game-pipeline', version: '1.0.0', hashManifest: 'SHA256SUMS' }, null, 2)}\n`);
  writeFileSync(join(toolDir, 'versions', '1.0.0', 'manifest.json'), `${JSON.stringify({ schema: 'ai-tool-manifest/v2', id: 'game-pipeline', version: '1.0.0', entry: 'workflow.yaml' }, null, 2)}\n`);
  writeFileSync(join(toolDir, 'versions', '1.0.0', 'workflow.yaml'), 'schema: ai-workflow-definition/v3\nid: game-pipeline\nstages: []\n');
  writeFileSync(join(toolDir, 'versions', '1.0.0', 'tests', 'a.txt'), 'test\n');
  writeFileSync(join(toolDir, 'versions', '1.0.0', 'logo.bin'), Buffer.from([1, 0, 2, 0]));
  // another tool resource that references game-pipeline
  const otherDir = join(root, 'tool', 'other-flow');
  mkdirSync(join(otherDir, 'versions', '1.0.0'), { recursive: true });
  writeFileSync(join(otherDir, 'current.json'), `${JSON.stringify({ schema: 'ai-workflow-pointer/v1', id: 'other-flow', version: '1.0.0' }, null, 2)}\n`);
  writeFileSync(join(otherDir, 'versions', '1.0.0', 'manifest.json'), `${JSON.stringify({ schema: 'ai-tool-manifest/v2', id: 'other-flow', version: '1.0.0' }, null, 2)}\n`);
  writeFileSync(join(otherDir, 'versions', '1.0.0', 'workflow.yaml'), 'schema: ai-workflow-definition/v3\nid: other-flow\ndependencies: [game-pipeline]\n');
  // agent resource
  const agentDir = join(root, 'agent', 'game-builder');
  mkdirSync(join(agentDir, 'versions', '2.0.0'), { recursive: true });
  writeFileSync(join(agentDir, 'current.json'), `${JSON.stringify({ schema: 'ai-agent-pointer/v1', id: 'game-builder', version: '2.0.0' }, null, 2)}\n`);
  writeFileSync(join(agentDir, 'versions', '2.0.0', 'manifest.json'), `${JSON.stringify({ schema: 'ai-agent-manifest/v2', id: 'game-builder', version: '2.0.0', prompt: 'prompt.md' }, null, 2)}\n`);
  writeFileSync(join(agentDir, 'versions', '2.0.0', 'prompt.md'), 'body\n');
  // registries
  mkdirSync(join(root, 'tool'), { recursive: true });
  writeFileSync(join(root, 'tool', 'registry.json'), `${JSON.stringify({ schema: 'ai-tool-registry/v2', version: 1, workflows: [{ id: 'game-pipeline', current: 'game-pipeline/current.json', enabled: true, kind: 'workflow', invocable: true }] }, null, 2)}\n`);
  writeFileSync(join(root, 'agent', 'registry.json'), `${JSON.stringify({ schema: 'ai-agent-registry/v2', version: 1, agents: [{ id: 'game-builder', current: 'game-builder/current.json', enabled: true }] }, null, 2)}\n`);
  return { root, auditRoot };
}

function hashTree(directory) {
  const files = [];
  (function walk(current, prefix) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, rel);
      else files.push([rel, sha256(readFileSync(path, 'utf8'))]);
    }
  })(directory, '');
  return Object.fromEntries(files);
}

test('upgrade copies the previous version, bumps manifest, and verifies SHA256SUMS', () => {
  const fixture = makeWorkspace();
  const before = hashTree(join(fixture.root, 'tool', 'game-pipeline', 'versions', '1.0.0'));
  const plan = buildReleasePlan({ workspaceRoot: fixture.root, repository: 'tool', resourceId: 'game-pipeline', targetVersion: '1.1.0', upgradeFrom: '1.0.0' });
  assert.equal(plan.kind, 'release-publish');
  assert.equal(plan.writePerformed, false);
  const applied = applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(applied.status, 'applied');
  const newRoot = join(fixture.root, 'tool', 'game-pipeline', 'versions', '1.1.0');
  assert.ok(existsSync(newRoot));
  const manifest = JSON.parse(readFileSync(join(newRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '1.1.0');
  const source = JSON.parse(readFileSync(join(newRoot, 'SOURCE.json'), 'utf8'));
  assert.equal(source.upgradeFrom, '1.0.0');
  const binary = readFileSync(join(newRoot, 'logo.bin'));
  assert.deepEqual([...binary], [1, 0, 2, 0]);
  assert.equal(verifyRelease({ plan }).ok, true);
  const again = applyPlan({ plan, auditRoot: fixture.auditRoot });
  assert.equal(again.status, 'already-applied');
  assert.deepEqual(hashTree(join(fixture.root, 'tool', 'game-pipeline', 'versions', '1.0.0')), before);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('fresh template publish creates manifest, SOURCE.json, definition and tests placeholder', () => {
  const fixture = makeWorkspace();
  const plan = buildReleasePlan({ workspaceRoot: fixture.root, repository: 'agent', resourceId: 'game-builder', targetVersion: '2.1.0' });
  applyPlan({ plan, auditRoot: fixture.auditRoot });
  const newRoot = join(fixture.root, 'agent', 'game-builder', 'versions', '2.1.0');
  for (const name of ['manifest.json', 'SOURCE.json', 'prompt.md', join('tests', '.gitkeep'), 'SHA256SUMS']) {
    assert.ok(existsSync(join(newRoot, name)), name);
  }
  assert.equal(JSON.parse(readFileSync(join(newRoot, 'manifest.json'), 'utf8')).version, '2.1.0');
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('rejects existing versions, bad semver and missing resources', () => {
  const fixture = makeWorkspace();
  assert.throws(() => buildReleasePlan({ workspaceRoot: fixture.root, repository: 'tool', resourceId: 'game-pipeline', targetVersion: '1.0.0' }), /RELEASE_VERSION_EXISTS/);
  assert.throws(() => buildReleasePlan({ workspaceRoot: fixture.root, repository: 'tool', resourceId: 'game-pipeline', targetVersion: '1.0' }), /RELEASE_SEMVER_INVALID/);
  assert.throws(() => buildReleasePlan({ workspaceRoot: fixture.root, repository: 'tool', resourceId: 'no-such', targetVersion: '1.0.0' }), /RESOURCE_NOT_FOUND/);
  assert.throws(() => buildReleasePlan({ workspaceRoot: fixture.root, repository: 'tool', resourceId: 'game-pipeline', targetVersion: '2.0.0', upgradeFrom: '9.9.9' }), /RELEASE_UPGRADE_SOURCE_MISSING/);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('lists references from other current releases before a pointer switch', () => {
  const fixture = makeWorkspace();
  const result = listResourceReferences(fixture.root, 'tool', 'game-pipeline');
  assert.ok(result.references.some((reference) => reference.path.includes('other-flow')), JSON.stringify(result));
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});

test('mark action deprecates without disabling and keeps pinned runs resolvable', () => {
  const fixture = makeWorkspace();
  const baseline = readRegistryBaseline(fixture.root, 'workflow');
  assert.equal(baseline.path, 'tool/registry.json');
  const plan = buildRegistryPlan({ workspaceRoot: fixture.root, kind: 'workflow', action: 'mark', id: 'game-pipeline', entry: { supersededBy: 'game-sprint-plan', deprecationNote: 'collapsed' }, baselineSha256: baseline.sha256 });
  applyPlan({ plan, auditRoot: fixture.auditRoot, afterText: plan.payload.afterText });
  const registry = JSON.parse(readFileSync(join(fixture.root, 'tool', 'registry.json'), 'utf8'));
  const entry = registry.workflows.find((item) => item.id === 'game-pipeline');
  assert.equal(entry.deprecated, true);
  assert.equal(entry.supersededBy, 'game-sprint-plan');
  assert.equal(entry.enabled, true);
  assert.throws(() => buildRegistryPlan({ workspaceRoot: fixture.root, kind: 'workflow', action: 'mark', id: 'game-pipeline', entry: {}, baselineSha256: readRegistryBaseline(fixture.root, 'workflow').sha256 }), /CATALOG_SUPERSEDED_BY_REQUIRED/);
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.auditRoot, { recursive: true, force: true });
});
