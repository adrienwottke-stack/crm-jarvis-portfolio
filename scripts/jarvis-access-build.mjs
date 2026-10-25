import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { testDatabase } from "./test-db.mjs";

// Direct Next build against a disposable local database; no migrate deploy.
await mkdir(new URL("../.cache/jarvis-backend-build/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/jarvis-backend-build/tsconfig.json", import.meta.url), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
const fixture = await testDatabase(0, 100);
try {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
    windowsHide: true, stdio: "inherit",
    env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", SESSION_SECRET: randomBytes(32).toString("hex"), NEXT_TELEMETRY_DISABLED: "1", CRM_TEST_DIST_DIR: ".cache/jarvis-backend-build-next", CRM_TEST_TSCONFIG: ".cache/jarvis-backend-build/tsconfig.json", AI_CRM_ENABLED: "false", AI_LIVE_PROVIDER: "disabled", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "" },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => resolve(code ?? 1)); });
} finally { await fixture.close(); }
