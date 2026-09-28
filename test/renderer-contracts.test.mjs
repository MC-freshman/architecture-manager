import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { friendlyError, PLAN_WRITE_KINDS } from '../src/renderer/presenter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('renderer domains stay split and write kinds remain centralized', () => {
  const source = readFileSync(join(root, 'src', 'renderer', 'components.jsx'), 'utf8');
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
    'integration-config', 'integration-pointer', 'integration-registry'
  ]);
  assert.match(friendlyError(new Error('EXTERNAL_CHANGE_DETECTED')), /目标文件已被其他程序修改/);
});
