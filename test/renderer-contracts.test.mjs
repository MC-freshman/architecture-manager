import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { friendlyError, PLAN_WRITE_KINDS } from '../src/renderer/presenter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('renderer domains stay split and write kinds remain centralized', () => {
  const source = [
    'stats.jsx', 'platform.jsx', 'integration.jsx', 'catalog.jsx',
    'resources.jsx', 'documents.jsx', 'software.jsx', 'git.jsx',
    'safety.jsx', 'plan-preview.jsx'
  ].map((file) => readFileSync(join(root, 'src', 'renderer', 'panels', file), 'utf8')).join('\n');
  const domains = [
    'DashboardStats', 'PlatformPanel', 'IntegrationPanel', 'CatalogPanel',
    'ResourcePanel', 'DocumentPanel', 'SoftwarePanel', 'GitPanel',
    'SafetyPanel', 'HelpPanel', 'PlanPreview'
  ];
  for (const domain of domains) {
    assert.match(source, new RegExp(`export function ${domain}\\b`), domain);
  }

  assert.deepEqual(PLAN_WRITE_KINDS, [
    'document-edit', 'resource-pointer', 'platform-view', 'registry-edit',
    'integration-config', 'integration-pointer', 'integration-registry', 'software-import', 'software-recipe-publish'
  ]);
  assert.match(friendlyError(new Error('EXTERNAL_CHANGE_DETECTED')), /目标文件已被其他程序修改/);
});
