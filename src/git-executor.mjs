// Git command executors (3.5.0 P3). Plans are built by buildGitPlan; this module
// executes them with argument-array git calls (never shell:true), a HEAD
// staleness check, an explicit-path commit red line (no add -A/.), a sensitive
// scan before commits, force-free push, revert --no-edit only, and backups
// written under inbox/archive with a SHA256SUMS.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanSensitivePaths } from './git.mjs';
import { defaultAuditRoot } from './core/paths.mjs';
import { makeId, output, requirePlan, writeAudit } from './transactions/kernel.mjs';

function run(root, args, timeoutMs = 120000) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs }).trim();
  } catch (error) {
    const detail = [error.stderr, error.stdout].map((value) => String(value ?? '').trim()).filter(Boolean).join(' | ');
    throw new Error(`GIT_COMMAND_FAILED:${detail.slice(0, 400) || String(error?.message ?? error)}`);
  }
}

export function applyGitTransaction({ plan, actor = 'local-user', auditRoot = defaultAuditRoot(), now = new Date().toISOString() }) {
  requirePlan(plan);
  const root = resolve(plan.workspaceRoot);
  const headBefore = run(root, ['rev-parse', 'HEAD']);
  if (headBefore !== plan.target?.headBefore) throw new Error('GIT_EXTERNAL_CHANGE');
  const step = plan.steps?.[0];
  if (!step) throw new Error('INVALID_TRANSACTION_PLAN');
  const id = makeId(plan, now);
  const context = { actor, auditRoot, now };
  const succeed = (target, extra = {}) => output(writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'applied', target, writePerformed: true, ...extra }));
  try {
    if (plan.kind === 'git-commit') {
      const scan = scanSensitivePaths(root, step.paths);
      if (!scan.clean) throw Object.assign(new Error('COMMIT_BLOCKED_SENSITIVE'), { findings: scan.findings });
      run(root, ['add', '--', ...step.paths]);
      const identityOptions = step.identity ? ['-c', `user.name=${step.identity.name}`, '-c', `user.email=${step.identity.email}`] : [];
      run(root, [...identityOptions, 'commit', '-m', step.message]);
      const head = run(root, ['rev-parse', 'HEAD']);
      return succeed(`HEAD:${head.slice(0, 12)}`, { oldSha256: headBefore, newSha256: head });
    }
    if (plan.kind === 'git-branch') {
      run(root, ['branch', step.branch]);
      return succeed(`branch:${step.branch}`);
    }
    if (plan.kind === 'git-tag') {
      run(root, ['tag', step.tag]);
      return succeed(`tag:${step.tag}`);
    }
    if (plan.kind === 'git-push') {
      run(root, ['push', step.remote], 300000);
      return succeed(`remote:${step.remote}`);
    }
    if (plan.kind === 'git-rollback') {
      run(root, ['revert', '--no-edit', step.commit]);
      const head = run(root, ['rev-parse', 'HEAD']);
      return succeed(`HEAD:${head.slice(0, 12)}`, { oldSha256: headBefore, newSha256: head });
    }
    if (plan.kind === 'git-backup') {
      const destinationRoot = resolve(root, 'inbox', 'archive');
      const destination = resolve(root, plan.target.destination);
      if (!destination.startsWith(destinationRoot)) throw new Error('GIT_BACKUP_DESTINATION_INVALID');
      mkdirSync(destination, { recursive: true });
      const archivePath = join(destination, 'repo.zip');
      run(root, ['archive', '--format=zip', '-o', archivePath, 'HEAD']);
      const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
      writeFileSync(join(destination, 'SHA256SUMS'), `${digest}  repo.zip\n`, 'utf8');
      return succeed(plan.target.destination, { newSha256: digest });
    }
    throw new Error('TRANSACTION_KIND_UNSUPPORTED');
  } catch (error) {
    writeAudit({ ...context, transactionId: id, plan, action: plan.kind, status: 'failed', target: step.operation, error: String(error?.message ?? error) });
    throw error;
  }
}

export function verifyGitTransaction({ plan }) {
  const root = resolve(plan.workspaceRoot);
  const describe = (ok, extra = {}) => ({ schema: 'architecture-manager-verification/v1', ok, target: plan.target?.destination || plan.target?.branch || plan.kind, writePerformed: false, ...extra });
  try {
    if (plan.kind === 'git-commit' || plan.kind === 'git-rollback') {
      const head = run(root, ['rev-parse', 'HEAD']);
      return describe(head !== plan.target.headBefore, { head });
    }
    if (plan.kind === 'git-branch') {
      const ref = run(root, ['rev-parse', '--verify', `refs/heads/${plan.steps[0].branch}`]);
      return describe(Boolean(ref), { ref });
    }
    if (plan.kind === 'git-tag') {
      const ref = run(root, ['rev-parse', '--verify', `refs/tags/${plan.steps[0].tag}`]);
      return describe(Boolean(ref), { ref });
    }
    if (plan.kind === 'git-push') {
      const count = run(root, ['rev-list', '--count', `@{upstream}..HEAD`]);
      return describe(count === '0', { aheadCount: Number(count) });
    }
    if (plan.kind === 'git-backup') {
      const sums = join(root, plan.target.destination, 'SHA256SUMS');
      return describe(existsSync(sums), { sumsPath: sums });
    }
    return describe(false, { error: 'TRANSACTION_KIND_UNSUPPORTED' });
  } catch (error) {
    return describe(false, { error: String(error?.message ?? error) });
  }
}
