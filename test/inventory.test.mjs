import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertWithinRoot, scanWorkspace } from '../src/inventory.mjs';
import { buildPlatformViewPlan, buildResourcePointerPlan } from '../src/plans.mjs';
import { buildDocumentPlan } from '../src/documents.mjs';
import { buildSoftwareLaunchPlan, listSoftware } from '../src/software.mjs';
import { backupAndRestoreFixture, buildGitPlan, scanSensitiveFiles } from '../src/git.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'architecture-manager-'));
  mkdirSync(join(root, 'tool', 'demo'), { recursive: true });
  mkdirSync(join(root, 'agent', 'demo'), { recursive: true });
  mkdirSync(join(root, 'software', 'demo'), { recursive: true });
  mkdirSync(join(root, 'versions'), { recursive: true });
  mkdirSync(join(root, 'codex', 'bridge'), { recursive: true });
  writeFileSync(join(root, 'tool', 'demo', 'current.json'), JSON.stringify({ id: 'demo', version: '1.0.0' }));
  writeFileSync(join(root, 'agent', 'demo', 'current.json'), JSON.stringify({ id: 'demo-agent', version: '1.0.0' }));
  writeFileSync(join(root, 'software', 'demo', 'current.json'), JSON.stringify({ id: 'demo-software', version: '1.0.0' }));
  writeFileSync(join(root, 'codex', 'bridge', 'bridge.json'), '{}');
  writeFileSync(join(root, 'versions', 'architecture.md'), '# test');
  return root;
}

test('scans a workspace without writing', () => {
  const root = fixture();
  try {
    const result = scanWorkspace(root);
    assert.equal(result.schema, 'architecture-manager-inventory/v1');
    assert.equal(result.writePerformed, false);
    assert.equal(result.sharedRepositories[0].pointers[0].version, '1.0.0');
    assert.equal(result.platforms.find((item) => item.id === 'codex').bridge, 'codex/bridge/bridge.json');
    assert.deepEqual(result.architectureDocuments, ['versions/architecture.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classifies corrupt current.json instead of treating it as green', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'tool', 'demo', 'current.json'), '{broken');
    const result = scanWorkspace(root);
    assert.equal(result.sharedRepositories[0].pointers[0].valid, false);
    assert.match(result.sharedRepositories[0].pointers[0].error, /Unexpected|JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a missing root and paths outside the selected root', () => {
  assert.throws(() => scanWorkspace(join(tmpdir(), 'does-not-exist')), /not an existing directory/);
  const root = fixture();
  try {
    assert.throws(() => assertWithinRoot(root, tmpdir()), /outside workspace root/);
    assert.equal(assertWithinRoot(root, join(root, 'tool')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates a reversible platform view plan without applying it', () => {
  const plan = buildPlatformViewPlan({
    workspaceRoot: 'C:/workspace',
    platformId: 'codex',
    currentEnabled: true,
    desiredEnabled: false,
    now: '2026-09-25T00:00:00.000Z'
  });
  assert.equal(plan.kind, 'platform-view');
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.steps[0].operation, 'update-local-view');
  assert.equal(plan.steps[0].newValue, false);
});

test('rejects a stale or unavailable resource pointer target', () => {
  assert.throws(() => buildResourcePointerPlan({
    workspaceRoot: 'C:/workspace',
    repository: 'tool',
    resourceId: 'demo',
    currentVersion: '1.0.0',
    targetVersion: '1.1.0',
    availableVersions: ['1.0.0']
  }), /TARGET_VERSION_UNAVAILABLE/);
  assert.throws(() => buildResourcePointerPlan({
    workspaceRoot: 'C:/workspace',
    repository: 'tool',
    resourceId: 'demo',
    currentVersion: '1.0.0',
    targetVersion: '1.0.0',
    availableVersions: ['1.0.0']
  }), /NO_CHANGE/);
});

test('protects top-level requirements and creates a hashed document plan', () => {
  const beforeText = '# 原文\n';
  assert.throws(() => buildDocumentPlan({
    workspaceRoot: 'C:/workspace',
    relativePath: 'versions/架构基本原则.md',
    beforeText,
    afterText: '# 修改\n',
    baselineSha256: 'wrong'
  }), /DOCUMENT_BASELINE_MISMATCH/);
  const baselineSha256 = createHash('sha256').update(beforeText, 'utf8').digest('hex');
  assert.throws(() => buildDocumentPlan({
    workspaceRoot: 'C:/workspace',
    relativePath: 'versions/架构基本原则.md',
    beforeText,
    afterText: '# 修改\n',
    baselineSha256
  }), /TOP_LEVEL_CONFIRMATION_REQUIRED/);
  const plan = buildDocumentPlan({
    workspaceRoot: 'C:/workspace',
    relativePath: 'versions/普通文档.md',
    beforeText,
    afterText: '# 修改\n',
    baselineSha256,
    now: '2026-09-25T00:00:00.000Z'
  });
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.steps[0].oldSha256, baselineSha256);
});

test('lists registered software and creates a provider-only launch plan', () => {
  const root = fixture();
  try {
    const software = listSoftware(root);
    assert.equal(software.length, 1);
    assert.equal(software[0].id, 'demo');
    const plan = buildSoftwareLaunchPlan({ workspaceRoot: root, softwareId: 'demo', mode: 'launch', now: '2026-09-25T00:00:00.000Z' });
    assert.equal(plan.kind, 'software-action');
    assert.equal(plan.writePerformed, false);
    assert.equal(plan.steps[0].dispatch, 'registered-provider-only');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates guarded Git plans without applying them', () => {
  const commit = buildGitPlan({ workspaceRoot: 'C:/workspace', action: 'commit', message: 'update manager', now: '2026-09-25T00:00:00.000Z' });
  assert.equal(commit.kind, 'git-commit');
  assert.equal(commit.writePerformed, false);
  assert.deepEqual(commit.steps[0].command, ['git', 'commit', '-m', 'update manager']);
  const push = buildGitPlan({ workspaceRoot: 'C:/workspace', action: 'push', remote: 'origin' });
  assert.equal(push.steps[0].force, false);
  const rollback = buildGitPlan({ workspaceRoot: 'C:/workspace', action: 'rollback', commit: '0123456789abcdef0123456789abcdef01234567' });
  assert.equal(rollback.steps[0].operation, 'revert-commit');
  const backup = buildGitPlan({ workspaceRoot: 'C:/workspace', action: 'backup', backupName: 'before-upgrade' });
  assert.match(backup.steps[0].destination, /before-upgrade$/);
  assert.throws(() => buildGitPlan({ workspaceRoot: 'C:/workspace', action: 'commit', message: '' }), /COMMIT_MESSAGE_REQUIRED/);
  assert.throws(() => buildGitPlan({ workspaceRoot: 'C:/workspace', action: 'rollback', commit: 'nope' }), /INVALID_COMMIT_SHA/);
});

test('rehearses backup and restore on a temporary fixture', () => {
  const root = fixture();
  writeFileSync(join(root, 'payload.txt'), 'restore-me');
  const scan = scanSensitiveFiles(root);
  assert.equal(scan.clean, true);
  const result = backupAndRestoreFixture(root);
  assert.equal(result.restored, 'restore-me');
  assert.equal(result.writePerformed, true);
  rmSync(root, { recursive: true, force: true });
});
