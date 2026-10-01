import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildGitPlan } from './git.mjs';
import { applyGitTransaction } from './git-executor.mjs';
import { onboardingGitPaths } from './onboarding-governance.mjs';
import { markOnboardingRecorded, readOnboardingState } from './onboarding-state.mjs';
import { requirePlan } from './transactions/kernel.mjs';
import { readOnboardingConfig } from './onboarding-config.mjs';

export function buildOnboardingFinalizePlan({ workspaceRoot, platformId, identity = null, now = new Date().toISOString() }) {
  const state = readOnboardingState({ workspaceRoot, platformId });
  identity ||= readOnboardingConfig({workspaceRoot,platformId}).config.commitIdentity || null;
  if (state.status !== 'verified-awaiting-governance-git') throw new Error('ONBOARDING_NOT_VERIFIED');
  const paths = onboardingGitPaths(workspaceRoot, platformId);
  const gitPlan = buildGitPlan({ workspaceRoot, action: 'commit', paths, message: `Register ${platformId} via graphical onboarding`, now });
  if (identity?.name || identity?.email) {
    if (typeof identity.name !== 'string' || !identity.name.trim() || /[\r\n\0]/.test(identity.name) || typeof identity.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) throw new Error('GIT_IDENTITY_REQUIRED');
    gitPlan.steps[0].identity = { name: identity.name.trim(), email: identity.email.trim() };
  } else {
    const configured = ['user.name', 'user.email'].every((key) => { try { return execFileSync('git', ['-C',workspaceRoot,'config','--get',key],{encoding:'utf8',windowsHide:true}).trim(); } catch { return false; } });
    if (!configured) throw new Error('GIT_IDENTITY_REQUIRED');
  }
  return { ...gitPlan, kind: 'platform-finalize', planId: `finalize-${randomUUID()}`, target: { ...gitPlan.target, platformId, identity }, payload: { gitPlan }, verification: ['only the listed governance and platform config texts are committed', 'real Git readback closes onboarding', 'never force push'] };
}

export function applyOnboardingFinalize(plan, options) {
  requirePlan(plan);
  const expected = buildOnboardingFinalizePlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, identity: plan.target.identity, now: plan.generatedAt });
  if (JSON.stringify(expected.payload) !== JSON.stringify(plan.payload)) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  const staged = execFileSync('git', ['-C', plan.workspaceRoot, 'diff', '--cached', '--name-only'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
  if (staged.some((path) => !expected.payload.gitPlan.target.paths.includes(path))) throw new Error('GIT_UNRELATED_STAGED_FILES');
  const transaction = applyGitTransaction({ plan: expected.payload.gitPlan, ...options });
  const state = markOnboardingRecorded({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId });
  return { ...transaction, onboarding: state };
}
export function verifyOnboardingFinalize(plan) { return { ok: readOnboardingState({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId }).status === 'complete', writePerformed: false }; }
