import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildOnboardingConfigPlan, applyOnboardingConfig, verifyOnboardingConfig } from '../src/onboarding-config.mjs';
import { allPlatformIds } from '../src/core/platforms.mjs';
import { inspectPlatformConnection } from '../src/platform-check.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'manager-config-'));
  const auditRoot = join(root, 'audit');
  const put = (name, value) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), value); };
  for (const [repository, id, version, entry] of [['tool', 'wf-runner', '0.12.0', 'cli.py'], ['tool', 'runtime-contracts', '1.5.0', 'contracts/runtime/validate_contracts.py'], ['tool', 'repo-lint', '0.6.3', 'scripts/repo_lint.py'], ['software', '_connector', '1.0.7', 'connector.py']]) {
    put(`${repository}/${id}/current.json`, JSON.stringify({ id, version }));
    put(`${repository}/${id}/versions/${version}/manifest.json`, JSON.stringify({ id, version }));
    put(`${repository}/${id}/versions/${version}/SHA256SUMS`, 'fixture');
    put(`${repository}/${id}/versions/${version}/${entry}`, '# fixture');
  }
  return { root, auditRoot, put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a non-base platform is configured, discovered and checked without source edits or PIN', () => {
  const f = fixture();
  try {
    assert.throws(() => buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client' }), /CONFIRMATION_REQUIRED/);
    const plan = buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', confirmed: true, fields: { pythonExecutable: process.execPath } });
    assert.doesNotMatch(JSON.stringify(plan), /<PIN>/);
    applyOnboardingConfig(plan, { auditRoot: f.auditRoot });
    assert.equal(verifyOnboardingConfig(plan).ok, true);
    assert.ok(allPlatformIds(f.root).includes('another-client'));
    assert.equal(inspectPlatformConnection({ workspaceRoot: f.root, platformId: 'another-client' }).stage, 'configured');
    const capabilities = JSON.parse(readFileSync(join(f.root, 'another-client/bridge/capabilities.json')));
    assert.deepEqual(capabilities.checks, {}, 'generated declarations are not evidence');
  } finally { f.cleanup(); }
});

test('existing fields survive a configuration update and partial writes are restored', () => {
  const f = fixture();
  try {
    const initial = buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', confirmed: true });
    applyOnboardingConfig(initial, { auditRoot: f.auditRoot });
    const path = join(f.root, 'another-client/bridge/another-client-config.json');
    const value = JSON.parse(readFileSync(path)); value.customUserSetting = 'preserve';
    writeFileSync(path, JSON.stringify(value));
    const plan = buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', fields: { displayName: 'Changed' } });
    const before = plan.payload.files.map((file) => readFileSync(join(f.root, file.path), 'utf8'));
    assert.throws(() => applyOnboardingConfig(plan, { auditRoot: f.auditRoot, failAfterFiles: 2 }), /SIMULATED_INTERRUPT/);
    assert.deepEqual(plan.payload.files.map((file) => readFileSync(join(f.root, file.path), 'utf8')), before);
    applyOnboardingConfig(plan, { auditRoot: f.auditRoot });
    assert.equal(JSON.parse(readFileSync(path)).customUserSetting, 'preserve');
  } finally { f.cleanup(); }
});

test('changed baselines, raw credentials and another platform environment are rejected', () => {
  const f = fixture();
  try {
    const plan = buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', confirmed: true });
    f.put('another-client/bridge.json', '{}');
    assert.throws(() => applyOnboardingConfig(plan, { auditRoot: f.auditRoot }), /BASELINE_MISMATCH/);
    assert.throws(() => buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', fields: { apiKey: 'do-not-store' } }), /RAW_SECRET/);
    assert.throws(() => buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'another-client', fields: { environmentManifest: join(f.root, 'codex/runtime/environment.json') } }), /PATH_MISMATCH/);
    assert.throws(() => buildOnboardingConfigPlan({ workspaceRoot: f.root, platformId: 'software', confirmed: true }), /INVALID_PLATFORM_ID/);
  } finally { f.cleanup(); }
});
