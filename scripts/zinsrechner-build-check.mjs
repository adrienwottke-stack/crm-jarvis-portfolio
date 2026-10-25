import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { testDatabase } from "./test-db.mjs";

// Isolated build: neither real databases nor another running Next cache.
await mkdir(new URL("../.cache/zinsrechner/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../.cache/zinsrechner/tsconfig.json", import.meta.url),
  JSON.stringify(
    {
      extends: "../../tsconfig.json",
      compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } },
    },
    null,
    2,
  ),
);
const fixture = await testDatabase(0, 100);
try {
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build"],
    {
      env: {
        ...process.env,
        DATABASE_URL: fixture.url,
        DIRECT_URL: fixture.url,
        DATABASE_POOL_MAX: "1",
        SESSION_SECRET: randomBytes(32).toString("hex"),
        NEXT_TELEMETRY_DISABLED: "1",
        CRM_TEST_DIST_DIR: ".cache/zinsrechner-next",
        CRM_TEST_TSCONFIG: ".cache/zinsrechner/tsconfig.json",
      },
      windowsHide: true,
      stdio: "inherit",
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await fixture.close();
}
