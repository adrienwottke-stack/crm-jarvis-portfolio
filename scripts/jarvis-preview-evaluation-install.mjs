import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { verifyPreviewStage, isolatedPreviewEnvironment } from "./jarvis-preview-evaluation-common.mjs";

const manifest = await verifyPreviewStage(process.cwd(), process.env);
const env = isolatedPreviewEnvironment(process.env);
async function run(command, args) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, { env, cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false });
    // Install/generation receive no provider key and no remote DB URL. Only the
    // exit status is emitted; dependency or environment diagnostics stay private.
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
    child.on("error", () => { clearTimeout(timer); reject(new Error("PREVIEW_INSTALL_EXECUTABLE_FAILED")); });
    child.on("exit", code => { clearTimeout(timer); if (code === 0) accept(); else reject(new Error("PREVIEW_INSTALL_FAILED")); });
  });
}
if (process.platform === "win32") await run(env.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", "npm ci --ignore-scripts --include=dev --no-audit --no-fund"]);
else await run("npm", ["ci", "--ignore-scripts", "--include=dev", "--no-audit", "--no-fund"]);
await run(process.execPath, [resolve("node_modules/prisma/build/index.js"), "generate"]);
if (manifest.runtime === "hermes") await run(process.execPath, [resolve("scripts/setup-hermes-evaluation-linux.mjs")]);
console.log(JSON.stringify({ status: "INSTALLED_PRISMA_GENERATED", migrationsDeployed: false, externalDatabaseUsed: false }));
