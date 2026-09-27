import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertWithinRoot, inspectPlatformDirectory, scanWorkspace } from '../src/inventory.mjs';
import { buildPlatformViewPlan, buildResourcePointerPlan } from '../src/plans.mjs';
import { buildRegistryPlan, readCatalogEntry } from '../src/catalog.mjs';
import { buildDocumentPlan } from '../src/documents.mjs';
import { buildSoftwareLaunchPlan, listSoftware } from '../src/software.mjs';
import { backupAndRestoreFixture, buildGitPlan, scanSensitiveFiles } from '../src/git.mjs';
import { applyPlan, verifyPlanTarget } from '../src/transactions.mjs';
import { buildIntegrationPlan, listIntegrationTargets, readIntegrationTarget } from '../src/integration.mjs';

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
  mkdirSync(join(root, 'software', 'demo', 'versions', '1.1.0'), { recursive: true });
  writeFileSync(join(root, 'software', 'demo', 'versions', '1.1.0', 'SHA256SUMS'), 'demo\n');
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
    assert.equal(result.documentSummaries[0].bytes > 0, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates platform markers and persists only a local view plan', () => {
  const root = fixture();
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = join(root, 'localappdata');
  try {
    const inspected = inspectPlatformDirectory(root, 'codex');
    assert.equal(inspected.validForView, true);
    const plan = buildPlatformViewPlan({ workspaceRoot: root, platformId: 'codex', currentEnabled: true, desiredEnabled: false, directoryRelative: inspected.directoryRelative, markers: inspected.markers });
    const applied = applyPlan({ plan, auditRoot: join(root, 'audit') });
    assert.equal(applied.status, 'applied');
    assert.equal(verifyPlanTarget({ plan }).actualEnabled, false);
    assert.equal(existsSync(join(root, 'codex', 'bridge', 'bridge.json')), true);
  } finally {
    process.env.LOCALAPPDATA = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('reads full agent/skill entries and applies a guarded registry plan', () => {
  const root = fixture();
  mkdirSync(join(root, 'agent', 'demo', 'versions', '1.0.0'), { recursive: true });
  mkdirSync(join(root, 'tool', '_registry'), { recursive: true });
  writeFileSync(join(root, 'agent', 'demo', 'versions', '1.0.0', 'manifest.json'), JSON.stringify({ id: 'demo', version: '1.0.0' }));
  writeFileSync(join(root, 'agent', 'demo', 'versions', '1.0.0', 'prompt.md'), '# Demo agent\n');
  writeFileSync(join(root, 'agent', 'registry.json'), JSON.stringify({ schema: 'test', agents: [{ id: 'demo', current: 'agent/demo/current.json', version: '1.0.0', enabled: true }] }, null, 2));
  writeFileSync(join(root, 'tool', '_registry', 'skills-demo.json'), JSON.stringify({ skills: [{ id: 'demo-skill', version: '1.0.0' }] }, null, 2));
  writeFileSync(join(root, 'tool', 'registry.json'), JSON.stringify({ schema: 'test', skills: [{ id: 'skills-demo', path: '_registry/skills-demo.json', kind: 'skill-catalog', enabled: true }] }, null, 2));
  try {
    const detail = readCatalogEntry({ workspaceRoot: root, kind: 'agent', id: 'demo' });
    assert.match(detail.prompt, /Demo agent/);
    const skill = readCatalogEntry({ workspaceRoot: root, kind: 'skill', id: 'skills-demo' });
    assert.equal(skill.skillCount, 1);
    const before = readFileSync(join(root, 'agent', 'registry.json'), 'utf8');
    const plan = buildRegistryPlan({ workspaceRoot: root, kind: 'agent', action: 'disable', id: 'demo', baselineSha256: createHash('sha256').update(before, 'utf8').digest('hex') });
    const applied = applyPlan({ plan, afterText: plan.payload.afterText, auditRoot: join(root, 'audit') });
    assert.equal(applied.status, 'applied');
    assert.equal(JSON.parse(readFileSync(join(root, 'agent', 'registry.json'), 'utf8')).agents[0].enabled, false);
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

test('applies and verifies a document plan with checkpoint and idempotency', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  const target = join(root, 'versions', 'architecture.md');
  const beforeText = readFileSync(target, 'utf8');
  const afterText = '# changed safely\n';
  const plan = buildDocumentPlan({
    workspaceRoot: root,
    relativePath: 'versions/architecture.md',
    beforeText,
    afterText,
    baselineSha256: createHash('sha256').update(beforeText, 'utf8').digest('hex'),
    now: '2026-09-25T00:00:00.000Z'
  });
  try {
    const applied = applyPlan({ plan, afterText, auditRoot, actor: 'test-user', now: '2026-09-25T00:00:01.000Z' });
    assert.equal(applied.status, 'applied');
    assert.equal(applied.writePerformed, true);
    assert.equal(verifyPlanTarget({ plan }).ok, true);
    const repeated = applyPlan({ plan, afterText, auditRoot, actor: 'test-user', now: '2026-09-25T00:00:02.000Z' });
    assert.equal(repeated.status, 'already-applied');
    const audit = readFileSync(join(auditRoot, 'events.jsonl'), 'utf8');
    assert.doesNotMatch(audit, /changed safely/);
    assert.ok(existsSync(applied.checkpointPath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks external document changes and preserves the original on interruption', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  const target = join(root, 'versions', 'architecture.md');
  const beforeText = readFileSync(target, 'utf8');
  const afterText = '# planned change\n';
  const plan = buildDocumentPlan({
    workspaceRoot: root,
    relativePath: 'versions/architecture.md',
    beforeText,
    afterText,
    baselineSha256: createHash('sha256').update(beforeText, 'utf8').digest('hex')
  });
  try {
    writeFileSync(target, '# changed outside manager\n');
    assert.throws(() => applyPlan({ plan, afterText, auditRoot }), /EXTERNAL_CHANGE_DETECTED/);
    writeFileSync(target, beforeText);
    assert.throws(() => applyPlan({ plan, afterText, auditRoot, failAfterCheckpoint: true }), /SIMULATED_INTERRUPT/);
    assert.equal(readFileSync(target, 'utf8'), beforeText);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applies and verifies a hashed shared current pointer plan', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  const target = join(root, 'tool', 'demo', 'current.json');
  const beforeText = readFileSync(target, 'utf8');
  const baselineSha256 = createHash('sha256').update(beforeText, 'utf8').digest('hex');
  const plan = buildResourcePointerPlan({
    workspaceRoot: root,
    repository: 'tool',
    resourceId: 'demo',
    currentVersion: '1.0.0',
    targetVersion: '1.1.0',
    availableVersions: ['1.0.0', '1.1.0'],
    baselineSha256
  });
  try {
    const applied = applyPlan({ plan, auditRoot, actor: 'test-user' });
    assert.equal(applied.status, 'applied');
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).version, '1.1.0');
    assert.equal(verifyPlanTarget({ plan }).ok, true);
    const repeated = applyPlan({ plan, auditRoot });
    assert.equal(repeated.status, 'already-applied');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('plans and applies GUI integration for platform config and shared resource pointer', () => {
  const root = fixture();
  const auditRoot = join(root, 'audit');
  try {
    const platform = readIntegrationTarget({ workspaceRoot: root, kind: 'platform', targetId: 'codex' });
    assert.equal(platform.path, 'codex/bridge/bridge.json');
    const platformPlan = buildIntegrationPlan({
      workspaceRoot: root,
      kind: 'platform',
      targetId: 'codex',
      mode: 'config',
      relativePath: platform.path,
      beforeText: platform.content,
      afterText: '{"platform":"codex","bridgeVersion":"1.0.0"}\n',
      baselineSha256: platform.sha256
    });
    assert.equal(platformPlan.kind, 'integration-config');
    assert.equal(applyPlan({ plan: platformPlan, afterText: platformPlan.payload.afterText, auditRoot }).status, 'applied');
    assert.equal(verifyPlanTarget({ plan: platformPlan }).ok, true);

    const current = readIntegrationTarget({ workspaceRoot: root, kind: 'software', targetId: 'demo' });
    const pointerPlan = buildIntegrationPlan({
      workspaceRoot: root,
      kind: 'software',
      targetId: 'demo',
      mode: 'pointer',
      relativePath: current.path,
      baselineSha256: current.sha256,
      targetVersion: '1.1.0',
      availableVersions: ['1.0.0', '1.1.0']
    });
    assert.equal(pointerPlan.kind, 'integration-pointer');
    assert.equal(applyPlan({ plan: pointerPlan, auditRoot }).status, 'applied');
    assert.equal(JSON.parse(readFileSync(join(root, 'software', 'demo', 'current.json'), 'utf8')).version, '1.1.0');
    assert.equal(verifyPlanTarget({ plan: pointerPlan }).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects GUI integration paths outside the existing workspace shape and raw secrets', () => {
  const root = fixture();
  try {
    assert.deepEqual(listIntegrationTargets({ workspaceRoot: root, kind: 'platform', targetId: 'codex' }).paths, ['codex/bridge/bridge.json']);
    const current = readIntegrationTarget({ workspaceRoot: root, kind: 'platform', targetId: 'codex' });
    assert.throws(() => buildIntegrationPlan({ workspaceRoot: root, kind: 'platform', targetId: 'codex', relativePath: '../outside.json', beforeText: current.content, afterText: '{}', baselineSha256: current.sha256 }), /INTEGRATION_TARGET_OUTSIDE_WORKSPACE|PLATFORM_CONFIG_TARGET_NOT_ALLOWED/);
    assert.throws(() => buildIntegrationPlan({ workspaceRoot: root, kind: 'platform', targetId: 'codex', relativePath: current.path, beforeText: current.content, afterText: '{"token":"plain-text"}', baselineSha256: current.sha256 }), /RAW_SECRET_NOT_ALLOWED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
