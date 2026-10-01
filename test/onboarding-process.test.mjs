import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeFile } from '../src/core/runtime-path.mjs';
import { runOwnedProcess } from '../src/core/owned-process.mjs';

const python = process.env.ARCHITECTURE_MANAGER_TEST_PYTHON || 'python';
const platform = { skip: process.platform !== 'win32' };
test('real provider launch/liveness/terminate rejects recycled PID records and leaves no child', platform, () => {
  const root = mkdtempSync(join(tmpdir(), 'manager-provider-'));
  const provider = runtimeFile('platform_provider.py');
  const call = (operation, args = []) => { try { return { code: 0, output: execFileSync(python, ['-B', provider, operation, root, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true }) }; } catch (error) { return { code: error.status, output: String(error.stdout || '') }; } };
  let pid, record, original;
  try {
    const launched = call('launch', [python, '-B', '-c', 'import time;time.sleep(30)']);
    assert.equal(launched.code, 0);
    pid = String(JSON.parse(launched.output).pid); record = join(root, `${pid}.json`); original = readFileSync(record, 'utf8');
    assert.equal(call('liveness', [pid]).code, 0);
    writeFileSync(record, JSON.stringify({ ...JSON.parse(original), processCreated: 0 }));
    assert.equal(call('terminate', [pid]).code, 3);
    writeFileSync(record, original);
    assert.equal(call('liveness', [pid]).code, 0, 'identity mismatch did not kill the live child');
    assert.equal(call('terminate', [pid]).code, 0);
    assert.equal(call('liveness', [pid]).code, 3);
    const missingCredential = call('credential', [`missing-test-${Date.now()}`]);
    assert.equal(missingCredential.code, 3);
    assert.equal(missingCredential.output, '');
  } finally {
    if (pid && original) { writeFileSync(record, original); call('terminate', [pid]); }
    rmSync(root, { recursive: true, force: true });
  }
});

test('cancel owns the real Windows descendant tree', platform, async () => {
  const root = mkdtempSync(join(tmpdir(), 'manager-tree-'));
  const heartbeat = join(root, 'heartbeat'); const childPath = join(root, 'child.py');
  writeFileSync(childPath, 'import pathlib,sys,time\np=pathlib.Path(sys.argv[1])\nfor n in range(150):\n p.write_text(str(n))\n time.sleep(.1)\n');
  const code = 'import subprocess,sys,time;subprocess.Popen([sys.executable,"-B",sys.argv[1],sys.argv[2]]);time.sleep(15)';
  let cancel;
  try {
    const resultPromise = runOwnedProcess({ python: execFileSync(python, ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim(), args: ['-B', '-c', code, childPath, heartbeat], cwd: root, timeout: 20000, registerCancel: (value) => { cancel = value; } });
    for (let n = 0; n < 60 && !existsSync(heartbeat); n++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(heartbeat)); cancel();
    const result = await resultPromise; assert.equal(result.cancelled, true);
    const stoppedAt = readFileSync(heartbeat, 'utf8');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(readFileSync(heartbeat, 'utf8'), stoppedAt, 'no descendant remains updating its output');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
