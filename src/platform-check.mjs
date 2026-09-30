import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { sha256 } from './core/hash.mjs';
import { inside, readJson } from './core/json.mjs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { isFormalPlatform } from './core/platforms.mjs';

function fail(stage, issues, extra = {}) { return { schema: 'architecture-manager-platform-check/v1', stage, issues, ...extra, writePerformed: false }; }
function reportGaps(report) {
  return (report?.verdicts || []).filter((row) => row.verdict !== 'pass').map((row) => ({ id: row.id, verdict: row.verdict, reason: row.reason || null, remediation: row.remediation?.path || null, costMinutes: Number.isInteger(row.remediation?.costMinutes) ? row.remediation.costMinutes : null }));
}

export function inspectPlatformConnection({ workspaceRoot, platformId }) {
  const root = resolve(workspaceRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('WORKSPACE_NOT_FOUND');
  if (!isFormalPlatform(platformId)) throw new Error('UNKNOWN_PLATFORM_ID');
  const platformRoot = join(root, platformId);
  if (!existsSync(platformRoot) || !statSync(platformRoot).isDirectory()) return fail('missing-directory', ['平台目录不存在']);
  const canonical = join(platformRoot, 'bridge.json');
  const legacy = join(platformRoot, 'bridge', 'bridge.json');
  const hasRoot = existsSync(canonical) && statSync(canonical).isFile();
  const hasLegacy = existsSync(legacy) && statSync(legacy).isFile();
  if (!hasRoot && !hasLegacy) return fail('missing-bridge', ['尚未创建 bridge.json']);
  if (hasRoot && hasLegacy && !readFileSync(canonical).equals(readFileSync(legacy))) return fail('bridge-conflict', ['根级和旧位置的配置不同'], { bridgePath: canonical });
  const bridgePath = hasRoot ? canonical : legacy;
  let bridge;
  try { bridge = readJson(bridgePath); } catch { return fail('invalid-bridge', ['bridge.json 不是有效 JSON'], { bridgePath }); }
  if (bridge.platform !== platformId || !['ai-platform-bridge/v1', 'ai-platform-bridge/v1.1'].includes(bridge.schema) || bridge.shared?.readOnly !== true || !Array.isArray(bridge.modes)) return fail('invalid-bridge', ['bridge.json 缺少必要字段'], { bridgePath });
  const common = { platformId, bridgePath, bridgeSha256: sha256(readFileSync(bridgePath)), bridgeLocation: hasRoot ? 'root' : 'legacy' };
  const discovered = [join(platformRoot, 'bridge', 'runner-config.json'), join(platformRoot, 'bridge', `${platformId}-config.json`)].find((path) => existsSync(path));
  const selectedConfig = typeof bridge.runner?.config === 'string' ? bridge.runner.config : discovered;
  if (!selectedConfig || bridge.runner?.enabled === false) return fail('adapter-required', ['bridge 已保存，但缺少客户端 runner 适配配置'], common);
  const configPath = resolve(selectedConfig);
  if (!inside(join(platformRoot, 'bridge'), configPath) || !existsSync(configPath) || !statSync(configPath).isFile()) return fail('adapter-required', ['runner 配置不存在或不属于此平台'], common);
  let config;
  try { config = readJson(configPath); } catch { return fail('invalid-runner-config', ['runner 配置不是有效 JSON'], { ...common, configPath }); }
  if (config.platform !== platformId || resolve(config.platformRoot || '') !== platformRoot || resolve(config.toolRoot || '') !== join(root, 'tool') || resolve(config.agentRoot || '') !== join(root, 'agent') || resolve(config.softwareRoot || '') !== join(root, 'software')) return fail('invalid-runner-config', ['runner 配置中的平台或三仓路径不匹配'], { ...common, configPath });
  if (resolve(config.bridge || '') !== bridgePath) return fail('reference-mismatch', ['客户端仍指向另一份 bridge.json；请先迁移引用'], { ...common, configPath });
  const runnerPath = resolve(config.runner || '');
  if (!inside(join(root, 'tool', 'wf-runner', 'versions'), runnerPath) || !existsSync(join(runnerPath, 'cli.py'))) return fail('adapter-required', ['runner 版本入口不存在'], { ...common, configPath });
  const configSha256 = sha256(readFileSync(configPath));
  const previousPath = join(platformRoot, 'runtime', 'manager-check', 'latest.json');
  if (existsSync(previousPath)) {
    try {
      const previous = readJson(previousPath);
      if (previous.bridgeSha256 === common.bridgeSha256 && previous.configSha256 === configSha256 && previous.platformId === platformId) {
        const reportPath = typeof previous.conformPath === 'string' ? resolve(previous.conformPath) : null;
        const cachedGaps = reportPath && inside(join(platformRoot, 'runtime', 'manager-check'), reportPath) && existsSync(reportPath) ? reportGaps(readJson(reportPath)) : [];
        const issues = (previous.issues || []).filter((issue) => issue !== '调用检查命令执行失败' || !(previous.counts?.fail > 0));
        return fail(previous.stage, issues, { ...common, configPath, configSha256, evidencePath: previousPath, counts: previous.counts || null, gaps: previous.gaps || cachedGaps, checkedAt: previous.checkedAt || null, evidenceFresh: false });
      }
    } catch { /* A broken old report is not evidence. */ }
  }
  return fail('configured', ['配置已找到；尚无与当前文件匹配的调用证据'], { ...common, configPath, configSha256 });
}

function releaseScript(root, id, subpath) {
  const pointer = readJson(join(root, 'tool', id, 'current.json'));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pointer.version)) throw new Error('CHECK_RELEASE_INVALID');
  const script = join(root, 'tool', id, 'versions', pointer.version, ...subpath);
  if (!existsSync(script) || !statSync(script).isFile()) throw new Error('CHECK_SCRIPT_MISSING');
  return script;
}

export async function runPlatformCheck({ workspaceRoot, platformId, mode = 'quick' }) {
  if (!['quick', 'full'].includes(mode)) throw new Error('INVALID_PLATFORM_CHECK_MODE');
  const root = resolve(workspaceRoot);
  const pre = inspectPlatformConnection({ workspaceRoot: root, platformId });
  if (!['configured', 'callable', 'complete', 'check-failed'].includes(pre.stage)) throw new Error(`PLATFORM_NOT_READY_FOR_CHECK:${pre.stage}`);
  const base = join(root, platformId, 'runtime', 'manager-check');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(base, stamp);
  mkdirSync(out, { recursive: true });
  const conform = releaseScript(root, 'platform-conformance', ['conformance', 'conform.py']);
  const matrix = releaseScript(root, 'architecture-ops', ['architecture_ops', 'invocation_matrix.py']);
  const environment = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
  const command = async (script, args, timeout) => {
    try { return { ...await execFileAsync('python', ['-B', script, ...args], { cwd: out, env: environment, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }), exitCode: 0 }; }
    catch (error) { return { stdout: error.stdout || '', stderr: error.stderr || String(error.message), exitCode: error.code ?? 1 }; }
  };
  const conformPath = join(out, 'conform.json');
  const matrixPath = join(out, 'matrix.json');
  const conformResult = await command(conform, ['--config', pre.configPath, '--out', conformPath], 120000);
  const matrixArgs = ['--config', pre.configPath, '--out', matrixPath];
  const exceptionsPath = join(root, platformId, 'bridge', 'invocation-exceptions.json');
  if (existsSync(exceptionsPath)) matrixArgs.push('--exceptions', exceptionsPath);
  if (mode === 'quick') {
    const workflows = readJson(join(root, 'tool', 'registry.json')).workflows || [];
    const selected = workflows.find((item) => item.id === 'expert-task' && item.enabled) || workflows.find((item) => item.enabled && item.id !== 'wf-runner');
    if (!selected) throw new Error('NO_CALLABLE_WORKFLOW_REGISTERED');
    matrixArgs.push('--only', selected.id);
  }
  const matrixResult = await command(matrix, matrixArgs, mode === 'quick' ? 180000 : 1800000);
  let floor = null;
  let matrixReport = null;
  try { floor = readJson(conformPath); } catch { /* Failure is reported below. */ }
  try { matrixReport = readJson(matrixPath); } catch { /* Failure is reported below. */ }
  const rows = Array.isArray(matrixReport?.rows) ? matrixReport.rows : [];
  const failed = rows.filter((row) => row.status === 'FAIL' || row.verdict === 'FAIL').length;
  const passed = rows.filter((row) => row.status === 'PASS' || row.verdict === 'PASS').length;
  const blocking = [];
  if (conformResult.exitCode !== 0 && !floor) blocking.push('能力检查命令执行失败');
  if (matrixResult.exitCode !== 0 && (!matrixReport || rows.length === 0)) blocking.push('调用检查命令执行失败');
  if (!floor) blocking.push('能力检查未产生可读报告');
  if (!matrixReport || rows.length === 0) blocking.push('调用检查未产生有效行');
  if (rows.length && passed === 0) blocking.push('调用检查没有任何成功行');
  if (failed) blocking.push(`调用检查有 ${failed} 条失败`);
  if (matrixReport?.summary?.['NEEDS-INPUT']) blocking.push(`调用检查有 ${matrixReport.summary['NEEDS-INPUT']} 条需要输入`);
  if (matrixResult.exitCode !== 0 && rows.length > 0 && failed === 0 && !matrixReport?.summary?.['NEEDS-INPUT']) blocking.push('调用检查异常退出，报告未说明失败原因');
  if (conformResult.exitCode !== 0 && floor?.floorReached === true) blocking.push('能力检查异常退出，不能据此声明能力地板通过');
  const issues = [...blocking];
  if (floor && !floor.floorReached) issues.push(`能力并集仍有 ${floor.counts?.declaredAbsent ?? '?'} 个缺口，未验证 ${floor.counts?.unverified ?? '?'} 项`);
  const stage = blocking.length ? 'check-failed' : mode === 'full' && floor.floorReached ? 'complete' : 'callable';
  const gaps = reportGaps(floor);
  const result = { schema: 'architecture-manager-platform-check/v1', platformId, stage, issues, mode, bridgeSha256: pre.bridgeSha256, configSha256: pre.configSha256, counts: { pass: passed, fail: failed, expected: matrixReport?.summary?.EXPECTED ?? null, needsInput: matrixReport?.summary?.['NEEDS-INPUT'] ?? null, conform: floor?.counts || null }, gaps, conformDigest: floor?.conformDigest || null, conformPath, matrixPath, commandErrors: [conformResult.stderr, matrixResult.stderr].filter(Boolean).map((item) => String(item).slice(0, 500)), checkedAt: new Date().toISOString(), evidenceFresh: true };
  const latest = join(base, 'latest.json');
  const temporary = `${latest}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, latest);
  return { ...result, evidencePath: latest, writePerformed: true };
}
