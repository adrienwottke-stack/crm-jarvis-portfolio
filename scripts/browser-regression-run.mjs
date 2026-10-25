// Serial browser acceptance. Each harness seeds a fresh PGlite DB and local Next.
// Historical output is backed up before a legacy harness overwrites its folder.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync } from "node:fs";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const suites = [
  ["remodel-browser.mjs", null],
  ["coach-browser.test.mjs", "emil"],
  ["ai-crm-ux-browser.mjs", "ai-crm-ux"],
  ["ai-crm-live-browser.mjs", "ai-crm-live"],
  ["jarvis-pilot-browser.mjs", "jarvis-pilot"],
  ["jarvis-live-progress-browser.mjs", "jarvis-live-progress"],
  ["jarvis-access-browser.mjs", "jarvis-access"],
  ["jarvis-leadership-browser.mjs", "jarvis-leadership"],
  ["ai-crm-browser.mjs", "ai-crm"],
  ["arbeitslagen-browser.mjs", "arbeitslagen"],
  ["start-browser.test.mjs", "start"],
  ["struktur-browser.test.mjs", "struktur-dev"],
  ["suche-browser.mjs", "suche"],
  ["hubspot-workspace-browser.mjs", "hubspot-workspace"],
  ["hubspot-masterplan-browser.mjs", "hubspot-masterplan/after"],
];
const runFile = promisify(execFile);
const quotePowerShell = value => `'${value.replaceAll("'", "''")}'`;
async function processes() {
  if (process.platform !== "win32") return [];
  const { stdout } = await runFile("powershell.exe", ["-NoProfile", "-Command", "@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ id=$_.ProcessId; parent=$_.ParentProcessId; created=$_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress"], { windowsHide: true });
  return JSON.parse(stdout);
}
async function rememberChildren(root, owned) {
  const snapshot = await processes();
  const ids = new Set([root, ...owned.keys()]);
  let changed;
  do {
    changed = false;
    for (const entry of snapshot) if (ids.has(entry.parent) && !ids.has(entry.id)) { ids.add(entry.id); owned.set(entry.id, entry.created); changed = true; }
  } while (changed);
}
async function closeOwnedChildren(owned, directory) {
  if (!owned.size || process.platform !== "win32") return [];
  const file = resolve(directory, "owned-processes.json");
  await writeFile(file, JSON.stringify([...owned].map(([id, created]) => ({ id, created }))));
  // Stop only observed descendants with the same creation time; reused PIDs stay untouched.
  const command = `$stopped=@(); foreach($entry in (Get-Content -Raw -LiteralPath ${quotePowerShell(file)} | ConvertFrom-Json)) { $current=Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$entry.id); if($current -and $current.CreationDate.ToUniversalTime().ToString('o') -eq $entry.created) { Stop-Process -Id ([int]$entry.id) -ErrorAction Stop; $stopped += [int]$entry.id } }; ConvertTo-Json -InputObject $stopped -Compress`;
  const { stdout } = await runFile("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
  return JSON.parse(stdout);
}
const argument = process.argv.find(value => value.startsWith("--only="));
const selected = argument ? argument.slice(7).split(",") : suites.map(([file]) => file);
assert.ok(selected.length && selected.every(file => suites.some(([name]) => name === file)), "Select only inventoried standalone synthetic browser harnesses");
const stamp = new Date().toISOString().replaceAll(":", "-");
const base = resolve(".cache", `browser-acceptance-${stamp}`);
await mkdir(base, { recursive: true });
const env = { ...process.env,
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/never-used",
  DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/never-used",
  OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1/v1", OPENAI_ORG_ID: "", OPENAI_PROJECT_ID: "",
  AI_CRM_ENABLED: "false", AI_LIVE_PROVIDER: "disabled", AI_LIVE_REALTIME_APPROVED: "false",
  STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", STRIPE_AI_PRICE_ID: "",
  SPOTIFY_ENABLED: "false", SPOTIFY_LOCAL_ENABLED: "false", SPOTIFY_CLIENT_ID: "", SPOTIFY_CLIENT_SECRET: "",
  SPOTIFY_TOKEN_SECRET: "", AI_LIVE_SIDEBAND_URL: "", AI_LIVE_SIDEBAND_SECRET: "",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", RESEND_API_KEY: "",
  NEXT_TELEMETRY_DISABLED: "1", CRM_TEST_PRODUCTION: "0", CRM_TEST_DISABLE_WEBPACK_CACHE: "1",
};
const report = { startedAt: new Date().toISOString(), syntheticOnly: true, externalProviderCalls: 0, suites: [], limitations: ["Local Chromium, PGlite and simulated media/providers; no hardware, authenticated remote or performed pilot proof"] };
const selectedSuites = suites.filter(([file]) => selected.includes(file));
for (const [file, historicalFolder] of selectedSuites) {
  const name = file.replace(/\.(?:test\.)?mjs$/, "");
  const directory = resolve(base, name);
  await mkdir(directory, { recursive: true });
  const source = await readFile(resolve("scripts", file), "utf8");
  assert.ok(source.includes("testDatabase(") && source.includes("fixture.url"), `${file}: disposable database contract missing`);
  assert.ok(source.includes("127.0.0.1"), `${file}: local Next contract missing`);
  if (historicalFolder) {
    const historical = resolve("test-results", historicalFolder);
    try { await access(historical); await cp(historical, resolve(directory, "prior-output"), { recursive: true, errorOnExist: true, force: false }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const config = resolve(directory, "tsconfig.json");
  await writeFile(config, JSON.stringify({ extends: relative(directory, resolve("tsconfig.json")).replaceAll("\\", "/"), compilerOptions: { baseUrl: relative(directory, resolve(".")).replaceAll("\\", "/"), paths: { "@/*": ["./*"] } } }));
  const log = resolve(directory, "run.log");
  await writeFile(log, "");
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({ event: "START", file, log, historicalBackup: historicalFolder ? resolve(directory, "prior-output") : null }));
  const child = spawn(process.execPath, ["--import", "./scripts/alias-hook.mjs", resolve("scripts", file)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CRM_TEST_DIST_DIR: relative(resolve("."), resolve(directory, "next")).replaceAll("\\", "/"), CRM_TEST_TSCONFIG: relative(resolve("."), config).replaceAll("\\", "/"), CRM_REMODEL_BROWSER_DIST: relative(resolve("."), resolve(directory, "next")).replaceAll("\\", "/"), CRM_REMODEL_BROWSER_OUTPUT: "remodel-ui-acceptance-2026-10-06" } });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => appendFileSync(log, chunk));
  const owned = new Map();
  let observing = Promise.resolve();
  const observe = () => { observing = observing.then(() => rememberChildren(child.pid, owned)); };
  observe();
  const timer = setInterval(observe, 5000);
  const exitCode = await new Promise((resolveExit, reject) => { child.once("error", reject); child.once("exit", code => resolveExit(code)); });
  clearInterval(timer); await observing;
  const stoppedOwnedChildren = await closeOwnedChildren(owned, directory);
  const result = { file, startedAt, finishedAt: new Date().toISOString(), exitCode, log, stoppedOwnedChildren, historicalBackup: historicalFolder ? resolve(directory, "prior-output") : null };
  report.suites.push(result);
  await writeFile(resolve(base, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ event: "FINISH", ...result }));
  if (exitCode !== 0) { report.stoppedOnFailure = file; process.exitCode = 1; break; }
}
report.finishedAt = new Date().toISOString();
report.success = report.suites.length === selectedSuites.length && report.suites.every(suite => suite.exitCode === 0);
await writeFile(resolve(base, "result.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ success: report.success, completed: report.suites.length, requested: selectedSuites.length, result: resolve(base, "result.json") }));
