import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/app/api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('application boundary exposes the complete IPC domain surface', () => {
  const expected = [
    'applyPlan', 'buildDocumentPlan', 'buildGitPlan', 'buildIntegrationPlan',
    'buildPlatformViewPlan', 'buildRegistryPlan', 'buildResourcePointerPlan',
    'buildSoftwareLaunchPlan', 'healthSoftware', 'inspectGit',
    'inspectPlatformDirectory', 'inspectRegistration', 'listIntegrationTargets',
    'readCatalogEntry', 'readDocument', 'readIntegrationTarget', 'readSkillContent',
    'scanSensitiveFiles', 'scanWorkspace', 'verifyPlanTarget'
  ];
  assert.deepEqual(Object.keys(api).sort(), expected.sort());
});

test('core and transaction kernel remain Electron independent', () => {
  const files = [
    join(root, 'src', 'core', 'hash.mjs'),
    join(root, 'src', 'core', 'paths.mjs'),
    join(root, 'src', 'transactions', 'kernel.mjs')
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from ['"]electron['"]|require\(['"]electron['"]\)/, file);
    assert.doesNotMatch(source, /renderer\//, file);
  }
});

