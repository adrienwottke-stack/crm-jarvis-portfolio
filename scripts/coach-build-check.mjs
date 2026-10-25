import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { testDatabase } from './test-db.mjs';
import { coachTestEnvironment } from './coach-test-env.mjs';

const fixture = await testDatabase(0, 100);
try {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { env: await coachTestEnvironment(fixture.url, randomBytes(32).toString('hex')), windowsHide: true, stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
} finally { await fixture.close(); }
