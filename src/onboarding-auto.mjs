import {parseJson as parseJsonText} from './core/json.mjs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readOnboardingConfig, buildOnboardingConfigPlan, applyOnboardingConfig } from './onboarding-config.mjs';
import { buildOnboardingBackendPlan, applyOnboardingBackend, buildOnboardingRuntimePlan, applyOnboardingRuntime, runtimeRequirements } from './onboarding-runtime.mjs';
import { buildOnboardingProvidersPlan, applyOnboardingProviders } from './onboarding-providers.mjs';
import { probeOnboardingCapabilities, buildOnboardingAttestationPlan, applyOnboardingAttestation } from './onboarding-attestation.mjs';
import { buildOnboardingClientPlan, applyOnboardingClient } from './onboarding-client.mjs';
import { buildOnboardingGovernancePlan, applyOnboardingGovernance } from './onboarding-governance.mjs';
import { buildOnboardingFinalizePlan, applyOnboardingFinalize } from './onboarding-finalize.mjs';
import { executeOnboardingChecks } from './onboarding-state.mjs';
import { targetPath } from './core/paths.mjs';
import { sha256 } from './core/hash.mjs';
import { atomicWrite, requirePlan } from './transactions/kernel.mjs';
import { startOnboardingJob } from './core/onboarding-jobs.mjs';

const active = new Set();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const load = (path) => parseJsonText(readFileSync(path, 'utf8'));
function preparationInputs(value) {
  if (!value) return null;
  const fields = { ...value.fields };
  delete fields.gitAuthorName; delete fields.gitAuthorEmail;
  return { ...value, fields };
}

export function buildAutomaticOnboardingPlan({ workspaceRoot, platformId, fields = {}, backendFields = {}, bodies = {}, interpreterAliases = {}, confirmed = false, now = new Date().toISOString() }) {
  const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
  const executionBackend = backendFields.distro ? targetPath(workspaceRoot, `${platformId}/bridge/backends/manager-sealed.json`) : fields.executionBackend || snapshot.fields.executionBackend;
  const configuration = buildOnboardingConfigPlan({ workspaceRoot, platformId, fields: { ...fields, executionBackend }, confirmed, now });
  if (!executionBackend) throw new Error('RUNTIME_BACKEND_REQUIRED');
  const inputFields = { ...fields, executionBackend };
  for (const key of ['gitAuthorName', 'gitAuthorEmail']) if (!inputFields[key]) delete inputFields[key];
  const inputs = { fields: inputFields, backendFields, bodies, interpreterAliases, confirmed: configuration.target.userAuthorized };
  const requirements = runtimeRequirements(workspaceRoot);
  return { schema: 'architecture-manager-plan/v1', kind: 'platform-onboarding', planId: `automatic-${randomUUID()}`, workspaceRoot, generatedAt: now, applyMode: 'confirmation-required', writePerformed: false, target: { platformId, inputs, inputsSha256: sha256(json(inputs)), creating: configuration.target.creating, versions: configuration.target.versions }, payload: { configuration, requirements }, steps: ['配置与版本', '独立环境与恢复', '软件及 provider', '真实能力探针', '客户端工具入口', 'conform 与首次矩阵', '五件治理登记', '配置提交与完成回读'].map((operation) => ({ operation, target: platformId })), verification: ['one confirmed plan; no AI maintenance session', 'stop and resume at a persisted safe step', 'no completion before every real check and Git readback', 'system login/UAC/restart pause instead of bypass'] };
}

export async function applyAutomaticOnboarding(plan, options = {}) {
  requirePlan(plan);
  if (plan.kind !== 'platform-onboarding' || sha256(json(plan.target.inputs)) !== plan.target.inputsSha256) throw new Error('PLAN_PAYLOAD_MISMATCH');
  if (JSON.stringify(runtimeRequirements(plan.workspaceRoot)) !== JSON.stringify(plan.payload.requirements)) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  const key = `${plan.workspaceRoot}:${plan.target.platformId}`;
  if (active.has(key)) throw new Error('ONBOARDING_ALREADY_RUNNING');
  const control = startOnboardingJob(plan.workspaceRoot, plan.target.platformId);
  options = { ...options, registerCancel: control.registerCancel };
  active.add(key);
  const { workspaceRoot, target: { platformId, inputs } } = plan;
  const directory = targetPath(workspaceRoot, `${platformId}/runtime/maintenance/manager-onboarding`);
  const journalPath = join(directory, 'automatic.json');
  let journal = existsSync(journalPath) ? load(journalPath) : null;
  const progress = options.onProgress || (() => {});
  const save = () => { mkdirSync(directory, { recursive: true }); atomicWrite(journalPath, json(journal), randomUUID()); };
  try {
    const samePreparation = journal?.inputs && json(preparationInputs(journal.inputs)) === json(preparationInputs(inputs));
    if (journal && (journal.inputsSha256 === plan.target.inputsSha256 || samePreparation) && journal.status !== 'complete') {
      for (const [path, hash] of Object.entries(journal.finalTargets || {})) if (!existsSync(targetPath(workspaceRoot, path)) || sha256(readFileSync(targetPath(workspaceRoot, path))) !== hash) throw new Error('ONBOARDING_RESUME_DRIFT');
      const configured = readOnboardingConfig({ workspaceRoot, platformId }).config;
      if (journal.steps.some((item) => item.step === 'configuration' && item.status === 'passed') && ['runner', 'contracts', 'scanner'].some((name) => configured[name === 'scanner' ? 'scannerRelease' : name] !== plan.target.versions[name].path)) throw new Error('ONBOARDING_RESUME_DRIFT');
    } else journal = { schema: 'architecture-manager-auto/v1', planId: plan.planId, platformId, inputsSha256: plan.target.inputsSha256, status: 'running', steps: [], finalTargets: {}, startedAt: new Date().toISOString() };
    journal.inputsSha256 = plan.target.inputsSha256;
    journal.inputs = inputs;
    if (journal.error) (journal.previousAttempts ||= []).push({ status: journal.status, stoppedAt: journal.stoppedAt, error: journal.error, resumedAt: new Date().toISOString() });
    journal.error = null; journal.stoppedAt = null;
    journal.status = 'running';
    const step = async (name, operation) => {
      control.assertActive();
      if (journal.steps.some((item) => item.step === name && item.status === 'passed')) { progress({ platformId, phase: name, reused: true }); return; }
      journal.currentStep = name; save(); progress({ platformId, phase: name, reused: false });
      const result = await operation();
      control.assertActive();
      if (result?.status === 'failed' || result?.status === 'cancelled') throw new Error(`ONBOARDING_STEP_FAILED:${name}`);
      journal.steps.push({ step: name, status: 'passed', result, completedAt: new Date().toISOString() }); save();
    };
    const apply = async (generated, executor) => {
      const result = await executor(generated, { ...options, onProgress: progress });
      for (const file of generated.payload?.files || []) journal.finalTargets[file.path] = file.newSha256;
      if (generated.kind === 'platform-runtime') { const activation = load(join(targetPath(workspaceRoot, generated.target.installRoot), 'activation.json')); for (const file of activation.plan.payload.files) journal.finalTargets[file.path] = file.newSha256; }
      return result;
    };
    await step('configuration', async () => {
      const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
      // Rebuild against current file baselines; original version seals remain fixed by this plan.
      const candidate = buildOnboardingConfigPlan({ workspaceRoot, platformId, fields: { ...inputs.fields, runnerVersion: plan.target.versions.runner.version, contractsVersion: plan.target.versions.contracts.version, scannerVersion: plan.target.versions.scanner.version }, confirmed: inputs.confirmed });
      if (snapshot.exists && JSON.stringify(candidate.target.versions) !== JSON.stringify(plan.target.versions)) throw new Error('INTEGRATION_BASELINE_MISMATCH');
      if (!journal.steps.length && JSON.stringify(candidate.payload) !== JSON.stringify(plan.payload.configuration.payload)) throw new Error('INTEGRATION_BASELINE_MISMATCH');
      return apply(candidate, applyOnboardingConfig);
    });
    await step('backend', async () => inputs.backendFields.distro ? apply(buildOnboardingBackendPlan({ workspaceRoot, platformId, fields: inputs.backendFields }), applyOnboardingBackend) : { status: 'existing-backend' });
    await step('environment', async () => {
      const snapshot = readOnboardingConfig({ workspaceRoot, platformId });
      const manifest = snapshot.config.environmentManifest && existsSync(snapshot.config.environmentManifest) ? load(snapshot.config.environmentManifest) : null;
      const matches = manifest && plan.payload.requirements.requirements.every((requirement) => { const [name, version] = requirement.split('=='); return manifest.packages?.[name] === version; });
      const backup = snapshot.config.scriptEnvironment ? targetPath(workspaceRoot, `inbox/backup/${platformId}/manager-environments/${snapshot.config.scriptEnvironment.split(/[\\/]/).at(-2)}/RESTORE.json`) : null;
      if (matches && backup && existsSync(backup)) return { status: 'existing-environment-to-reverify', backup };
      const runtimeFields = { pythonExecutable: snapshot.fields.pythonExecutable, executionBackend: inputs.fields.executionBackend };
      if (!journal.runtimePlan) { journal.runtimePlan = buildOnboardingRuntimePlan({ workspaceRoot, platformId, fields: runtimeFields }); save(); }
      else {
        const refreshed = buildOnboardingRuntimePlan({ workspaceRoot, platformId, fields: runtimeFields, installationId: journal.runtimePlan.target.installationId });
        if (JSON.stringify(refreshed.target) !== JSON.stringify(journal.runtimePlan.target)) throw new Error('ONBOARDING_RESUME_DRIFT');
        journal.runtimePlan = refreshed; save();
      }
      return apply(journal.runtimePlan, applyOnboardingRuntime);
    });
    await step('providers', () => apply(buildOnboardingProvidersPlan({ workspaceRoot, platformId, bodies: inputs.bodies, interpreterAliases: inputs.interpreterAliases }), applyOnboardingProviders));
    await step('capabilities', async () => {
      const proof = await probeOnboardingCapabilities({ workspaceRoot, platformId }, { onProgress: progress, registerCancel: control.registerCancel });
      if (!['script-environment-isolation-jail', 'prompt-stage-claim', 'peerDispatch', 'administrator-consent-denied'].every((key) => proof.checks[key] === true)) throw new Error('ONBOARDING_CAPABILITY_PROBE_FAILED');
      return apply(buildOnboardingAttestationPlan({ workspaceRoot, platformId, evidencePath: proof.evidencePath }), applyOnboardingAttestation);
    });
    await step('client', () => apply(buildOnboardingClientPlan({ workspaceRoot, platformId }), applyOnboardingClient));
    await step('certification', async () => { const result = await executeOnboardingChecks({ workspaceRoot, platformId }, { onProgress: progress }); if (result.status === 'cancelled') throw new Error('ONBOARDING_CANCELLED'); if (result.status !== 'verified-awaiting-governance-git') throw new Error(`ONBOARDING_CHECK_FAILED:${result.stoppedAt}`); return result; });
    await step('governance', () => apply(buildOnboardingGovernancePlan({ workspaceRoot, platformId }), applyOnboardingGovernance));
    await step('git', () => applyOnboardingFinalize(buildOnboardingFinalizePlan({ workspaceRoot, platformId, identity: inputs.fields.gitAuthorName || inputs.fields.gitAuthorEmail ? { name: inputs.fields.gitAuthorName, email: inputs.fields.gitAuthorEmail } : null }), options));
    journal.status = 'complete'; journal.completedAt = new Date().toISOString(); save();
  } catch (error) { if (journal) { journal.status = error.message === 'ONBOARDING_CANCELLED' ? 'cancelled' : /RUNTIME_(BACKEND|SEALED_BACKEND|PYTHON)_REQUIRED|CLIENT_ADAPTER_PENDING|GIT_IDENTITY_REQUIRED/.test(error.message) ? 'waiting-user' : 'failed'; journal.error = String(error.message); journal.stoppedAt = journal.currentStep; save(); } else throw error; }
  finally { active.delete(key); control.finish(); }
  return { ...journal, writePerformed: true };
}
export function verifyAutomaticOnboarding(plan) { const path = targetPath(plan.workspaceRoot, `${plan.target.platformId}/runtime/maintenance/manager-onboarding/automatic.json`); return { ok: existsSync(path) && load(path).status === 'complete', writePerformed: false }; }
