// Connector-client launch (3.5.0 P5). The manager never dispatches software
// itself: it relays one JSON request to the platform's own connector exactly
// the way the engine does, and surfaces whatever the connector answers
// (INTERACTIVE_REQUIRED / CAPABILITY_UNAVAILABLE / drift) without rewording.
// allowGuiLaunch stays the gateway's own gate, not the manager's.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isFormalPlatform } from './core/platforms.mjs';
import { defaultAuditRoot } from './core/paths.mjs';
import { runnerConfig } from './software-publish.mjs';
import { makeId, output, requirePlan, writeAudit } from './transactions/kernel.mjs';

export function buildSoftwareConnectorLaunchPlan({ workspaceRoot, platformId, softwareId, now = new Date().toISOString() }) {
  if (!isFormalPlatform(platformId)) throw new Error('INVALID_PLATFORM');
  if (typeof softwareId !== 'string' || softwareId.trim() === '') throw new Error('INVALID_SOFTWARE_ID');
  const root = resolve(workspaceRoot);
  const connector = runnerConfig(root, platformId);
  const bodies = connector.value.bodies || {};
  if (!bodies[softwareId]) throw new Error('SOFTWARE_NOT_DECLARED');
  if (!existsSync(connector.gatewayPath)) throw new Error('SOFTWARE_CONNECTOR_ENTRY_MISSING');
  const interpreter = connector.value.interpreters?.['.py'] || 'python';
  return {
    schema: 'architecture-manager-plan/v1',
    planId: `software-launch-${softwareId}-${now.replace(/[^0-9]/g, '').slice(0, 17)}`,
    kind: 'software-launch',
    workspaceRoot: root,
    generatedAt: now,
    applyMode: 'confirmation-required',
    writePerformed: false,
    target: {
      platformId,
      softwareId,
      bodyPath: bodies[softwareId],
      connectorPath: connector.gatewayPath,
      gatewayConfigPath: connector.path,
      interpreter,
      allowGuiLaunch: connector.value.allowGuiLaunch === true
    },
    steps: [{
      operation: 'relay-launch-request',
      connectorPath: connector.gatewayPath,
      gatewayConfigPath: connector.path,
      interpreter,
      request: { schema: 'ai-software-admin/v1', kind: 'request', operation: 'software.launch', softwareId }
    }],
    verification: ['the connector answer is relayed verbatim', 'the manager never claims a launch the connector did not report'],
    payload: {}
  };
}

export function applySoftwareLaunch({ plan }, { actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString() } = {}) {
  if (plan?.kind !== 'software-launch') throw new Error('INVALID_TRANSACTION_PLAN');
  const target = plan.target;
  const step = plan.steps[0];
  const id = makeId(plan, now);
  const context = { actor, auditRoot, now };
  let stdout;
  try {
    stdout = execFileSync(step.interpreter, ['-B', step.connectorPath, '--config', step.gatewayConfigPath], {
      input: JSON.stringify({ ...step.request, requestId: id }),
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      shell: false
    });
  } catch (error) {
    writeAudit({ ...context, transactionId: id, plan, action: 'software-launch', status: 'failed', target: `${target.platformId}/${target.softwareId}`, error: String(error.stderr || error.message).slice(0, 400), now });
    throw new Error('SOFTWARE_CONNECTOR_FAILED');
  }
  let reply;
  try {
    reply = JSON.parse(stdout);
  } catch {
    writeAudit({ ...context, transactionId: id, plan, action: 'software-launch', status: 'failed', target: `${target.platformId}/${target.softwareId}`, error: 'connector output was not valid JSON', now });
    throw new Error('SOFTWARE_CONNECTOR_INVALID');
  }
  const connectorStatus = reply?.result?.status || reply?.status || 'relayed';
  const event = writeAudit({ ...context, transactionId: id, plan, action: 'software-launch', status: 'applied', target: `${target.platformId}/${target.softwareId}`, connectorStatus, writePerformed: false, now });
  return { ...output(event), connectorReply: reply, connectorStatus, writePerformed: false };
}
