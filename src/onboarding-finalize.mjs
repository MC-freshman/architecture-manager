import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildGitPlan } from './git.mjs';
import { applyGitTransaction } from './git-executor.mjs';
import { onboardingGitPaths } from './onboarding-governance.mjs';
import { markOnboardingRecorded, readOnboardingState } from './onboarding-state.mjs';
import { requirePlan } from './transactions/kernel.mjs';

export function buildOnboardingFinalizePlan({ workspaceRoot, platformId, now = new Date().toISOString() }) {
  const state = readOnboardingState({ workspaceRoot, platformId });
  if (state.status !== 'verified-awaiting-governance-git') throw new Error('ONBOARDING_NOT_VERIFIED');
  const paths = onboardingGitPaths(workspaceRoot, platformId);
  const gitPlan = buildGitPlan({ workspaceRoot, action: 'commit', paths, message: `Register ${platformId} via graphical onboarding`, now });
  return { ...gitPlan, kind: 'platform-finalize', planId: `finalize-${randomUUID()}`, target: { ...gitPlan.target, platformId }, payload: { gitPlan }, verification: ['only the listed governance and platform config texts are committed', 'real Git readback closes onboarding', 'never force push'] };
}

export function applyOnboardingFinalize(plan, options) {
  requirePlan(plan);
  const expected = buildOnboardingFinalizePlan({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId, now: plan.generatedAt });
  if (JSON.stringify(expected.payload) !== JSON.stringify(plan.payload)) throw new Error('INTEGRATION_BASELINE_MISMATCH');
  const staged = execFileSync('git', ['-C', plan.workspaceRoot, 'diff', '--cached', '--name-only'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
  if (staged.some((path) => !expected.payload.gitPlan.target.paths.includes(path))) throw new Error('GIT_UNRELATED_STAGED_FILES');
  const transaction = applyGitTransaction({ plan: expected.payload.gitPlan, ...options });
  const state = markOnboardingRecorded({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId });
  return { ...transaction, onboarding: state };
}
export function verifyOnboardingFinalize(plan) { return { ok: readOnboardingState({ workspaceRoot: plan.workspaceRoot, platformId: plan.target.platformId }).status === 'complete', writePerformed: false }; }
