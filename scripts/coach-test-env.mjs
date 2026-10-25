import { mkdir, writeFile } from 'node:fs/promises';

export async function coachTestEnvironment(url, secret) {
  await mkdir(new URL('../.cache/emil/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.cache/emil/tsconfig.json', import.meta.url), JSON.stringify({ extends: '../../tsconfig.json', compilerOptions: { baseUrl: '../..', paths: { '@/*': ['./*'] } } }, null, 2));
  return { ...process.env, DATABASE_URL: url, DATABASE_POOL_MAX: '1', SESSION_SECRET: secret, NEXT_TELEMETRY_DISABLED: '1', CRM_TEST_DIST_DIR: '.cache/emil-next', CRM_TEST_TSCONFIG: '.cache/emil/tsconfig.json' };
}
