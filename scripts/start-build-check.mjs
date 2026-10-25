// Production compilation against an isolated database; never runs migrate deploy.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { testDatabase } from './start-test-db.mjs';

const fixture=await testDatabase(0,100);
let result=1;
try {
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{
    env:{...process.env,DATABASE_URL:fixture.url,DATABASE_POOL_MAX:'1',SESSION_SECRET:randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'},
    windowsHide:true,stdio:'inherit',
  });
  result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code ?? 1));});
} finally { await fixture.close(); }
process.exitCode=result;
