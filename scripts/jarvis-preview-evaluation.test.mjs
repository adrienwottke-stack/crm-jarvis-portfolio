import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { preparePreviewEvaluation } from "./jarvis-preview-evaluation.mjs";
import { reportedUsageDiagnostic, evaluationCostSummary, safeHermesRuntimeDiagnostic } from "./jarvis-evaluation-metering.mjs";
import { PREVIEW_PROJECT, PREVIEW_MODELS, PREVIEW_MANIFEST, PREVIEW_CONFIG, PREVIEW_DATABASE_SENTINEL, isolatedPreviewEnvironment, assertPreviewEnvironment, assertManifest, assertPreviewConfig, verifyPreviewStage, evaluationArguments, digest } from "./jarvis-preview-evaluation-common.mjs";

test("provider-only child environment drops remote database and all other credentials", () => {
  const input = { VERCEL_ENV: "preview", PATH: "runtime-path", DATABASE_URL: "postgres://foreign-db.invalid/live", DIRECT_URL: "postgres://foreign-db.invalid/live", OPENAI_API_KEY: "synthetic-openai", ANTHROPIC_API_KEY: "synthetic-foreign", VERCEL_TOKEN: "synthetic-cli", SESSION_SECRET: "synthetic-session", OPENAI_BASE_URL: "https://foreign.invalid", AI_MODEL: "unapproved", NODE_OPTIONS: "unapproved-loader" };
  const install = isolatedPreviewEnvironment(input);
  assert.equal(install.OPENAI_API_KEY, undefined);
  const run = isolatedPreviewEnvironment(input, { provider: true });
  assert.equal(run.OPENAI_API_KEY, "synthetic-openai");
  assert.equal(run.DATABASE_URL, PREVIEW_DATABASE_SENTINEL);
  assert.equal(run.DIRECT_URL, PREVIEW_DATABASE_SENTINEL);
  for (const name of ["ANTHROPIC_API_KEY", "VERCEL_TOKEN", "SESSION_SECRET", "OPENAI_BASE_URL", "AI_MODEL", "NODE_OPTIONS"]) assert.equal(run[name], undefined);
  assert.equal(input.DATABASE_URL, "postgres://foreign-db.invalid/live");
});

test("production and foreign project/team are rejected before any runtime import", () => {
  assert.throws(() => assertPreviewEnvironment({ VERCEL_ENV: "production" }), /PREVIEW_ENV_REQUIRED/);
  assert.throws(() => assertPreviewEnvironment({ VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "foreign" }), /PROJECT_MISMATCH/);
  assert.throws(() => assertPreviewEnvironment({ VERCEL_ENV: "preview", VERCEL_ORG_ID: "foreign" }), /TEAM_MISMATCH/);
  assert.doesNotThrow(() => assertPreviewEnvironment({ VERCEL_ENV: "preview", VERCEL_PROJECT_ID: PREVIEW_PROJECT.projectId, VERCEL_ORG_ID: PREVIEW_PROJECT.orgId }));
});

test("staging has exact hashes, no credentials or Git ancestry and only one config per directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-preview-unit-"));
  try {
    const source = join(root, "source"); await mkdir(source);
    for (const folder of ["app", "lib", "prisma", "scripts", "docs", ".vercel"]) await mkdir(join(source, folder));
    await writeFile(join(source, ".vercel/project.json"), JSON.stringify(PREVIEW_PROJECT));
    for (const name of ["package.json", "package-lock.json", "tsconfig.json"]) await writeFile(join(source, name), "{}");
    await writeFile(join(source, "prisma.config.ts"), "export default {};\n");
    for (const name of ["alias-hook.mjs", "test-db.mjs", "jarvis-evaluation-run.mjs", "jarvis-evaluation-adapter.mjs", "jarvis-evaluation-fixtures.mjs", "jarvis-evaluation-metering.mjs", "evaluation-budget.mjs", "responses-proxy-state.mjs", "jarvis-preview-evaluation-common.mjs", "jarvis-preview-evaluation-install.mjs", "jarvis-preview-evaluation-build.mjs", "jarvis-preview-evaluation-guard.mjs"]) await writeFile(join(source, "scripts", name), "export {};\n");
    await writeFile(join(source, "app/page.tsx"), "export {};\n"); await writeFile(join(source, "lib/logic.ts"), "export {};\n"); await writeFile(join(source, "prisma/schema.prisma"), "// synthetic schema\n");
    await writeFile(join(source, "docs/jarvis-evaluation-2026-10-05.json"), "{}");
    await writeFile(join(source, "docs/private-audit.json"), "DO_NOT_COPY"); await writeFile(join(source, ".env.local"), "OPENAI_API_KEY=DO_NOT_COPY"); await mkdir(join(source, ".git"));
    const destination = join(root, "staging");
    const prepared = await preparePreviewEvaluation({ source, destination, model: PREVIEW_MODELS[0] });
    const manifest = await verifyPreviewStage(destination, { VERCEL_ENV: "preview" });
    assert.equal(prepared.sourceHash, manifest.sourceHash); assert.equal(prepared.model, manifest.model);
    assert.deepEqual(JSON.parse(await readFile(join(destination, "vercel.json"), "utf8")), PREVIEW_CONFIG);
    assert.deepEqual(await readdir(join(destination, "docs")), ["jarvis-evaluation-2026-10-05.json"]);
    assert.equal(manifest.files.some(file => /\.env|\.git\//.test(file.path)), false);
    assert.ok(manifest.files.some(file => file.path === "scripts/jarvis-evaluation-adapter.mjs"));
    assert.equal(manifest.scope, "READ_ONLY"); assert.equal(manifest.maxCostUsd, 2);
    const args = evaluationArguments(manifest, "private/run.json");
    assert.equal(args[args.indexOf("--model") + 1], PREVIEW_MODELS[0]); assert.equal(args.includes("--dry-run"), false);
    const wrong = { ...manifest, scope: "AUTONOMOUS" }; assert.throws(() => assertManifest(wrong), /MANIFEST_INVALID/);
    const isolatedWrite = { ...manifest, scope: "ISOLATED_WRITE" }; assert.doesNotThrow(() => assertManifest(isolatedWrite));
    assert.equal(evaluationArguments(isolatedWrite, "private/run.json")[evaluationArguments(isolatedWrite, "private/run.json").indexOf("--scope") + 1], "ISOLATED_WRITE");
    assert.throws(() => assertManifest({ ...manifest, runtime: "hermes", model: "gpt-6.1-sol" }), /MANIFEST_INVALID/);
    assert.throws(() => assertManifest({ ...manifest, files: [{ path: "../private", sha256: "a".repeat(64) }] }), /PATH_INVALID/);
    await assert.rejects(preparePreviewEvaluation({ source, destination, model: PREVIEW_MODELS[0] }), /ALREADY_EXISTS/);
    await assert.rejects(preparePreviewEvaluation({ source, destination: join(source, "nested"), model: PREVIEW_MODELS[0] }), /OUTSIDE_GIT/);
    await writeFile(join(destination, ".env"), "FOREIGN_CONFIG"); await assert.rejects(verifyPreviewStage(destination, { VERCEL_ENV: "preview" }), /PRIVATE_INPUT/); await rm(join(destination, ".env"));
    await writeFile(join(destination, "lib/logic.ts"), "changed\n"); await assert.rejects(verifyPreviewStage(destination, { VERCEL_ENV: "preview" }), /SOURCE_CHANGED/);
  } finally { if (dirname(root) !== resolve(tmpdir()) || !root.startsWith(join(tmpdir(), "jarvis-preview-unit-"))) throw new Error("UNSAFE_TEST_CLEANUP"); await rm(root, { recursive: true, force: true }); }
});

test("runtime guard blocks remote DB and foreign provider paths without network calls", () => {
  const guard = new URL("./jarvis-preview-evaluation-guard.mjs", import.meta.url).href;
  const script = `global.fetch=async()=>new Response('synthetic');await import(${JSON.stringify(guard)});const net=await import('node:net');let blocked=0;for(const host of ['foreign-db.invalid','10.1.2.3'])try{net.connect({host,port:5432});}catch(e){if(e.message==='PREVIEW_NETWORK_TARGET_REJECTED')blocked++;}for(const url of ['https://foreign.invalid/v1/responses','https://api.openai.com/v1/models','http://api.openai.com/v1/responses'])try{await fetch(url,{method:'POST'});}catch(e){if(e.message==='PREVIEW_PROVIDER_ENDPOINT_REJECTED')blocked++;}const allowed=await(await fetch('https://api.openai.com/v1/responses',{method:'POST'})).text();console.log(JSON.stringify({blocked,allowed}));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: isolatedPreviewEnvironment({ ...process.env, VERCEL_ENV: "preview" }), encoding: "utf8", windowsHide: true });
  assert.deepEqual(JSON.parse(out), { blocked: 5, allowed: "synthetic" });
});

test("manifest source hash binds exact copied bytes", () => {
  assert.notEqual(digest("module bytes\n"), digest("module bytes\r\n"));
  assert.equal(PREVIEW_CONFIG.framework, null); assert.deepEqual(PREVIEW_CONFIG.crons, []); assert.equal(PREVIEW_CONFIG.routes, undefined); assert.equal(PREVIEW_CONFIG.functions, undefined);
  assert.match(PREVIEW_CONFIG.installCommand, /preview-evaluation-install/); assert.doesNotMatch(PREVIEW_CONFIG.buildCommand, /next build|migrate|npm run build/);
  assert.equal(PREVIEW_MANIFEST, "preview-evaluation-manifest.json");
});

test("runtime guard still permits the fixture's local TCP transport", () => {
  const guard = new URL("./jarvis-preview-evaluation-guard.mjs", import.meta.url).href;
  const script = `await import(${JSON.stringify(guard)});const net=await import('node:net');const server=net.createServer(socket=>socket.end('fixture'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let received='';await new Promise((resolve,reject)=>{const client=net.connect({host:'127.0.0.1',port:server.address().port});client.on('data',data=>received+=data);client.on('end',resolve);client.on('error',reject);});await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify({received}));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: isolatedPreviewEnvironment({ ...process.env, VERCEL_ENV: "preview" }), encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.deepEqual(JSON.parse(out), { received: "fixture" });
});

test("provider guard permits token counting but rejects other endpoints and non-POST calls", () => {
  const guard = new URL("./jarvis-preview-evaluation-guard.mjs", import.meta.url).href;
  const script = `globalThis.fetch=async()=>new Response('{}');await import(${JSON.stringify(guard)});let permitted=0,blocked=0;for(const path of ['/v1/responses','/v1/responses/input_tokens']){await fetch('https://api.openai.com'+path,{method:'POST'});permitted++;}for(const [url,method] of [['https://api.openai.com/v1/responses/input_tokens','GET'],['https://api.openai.com/v1/files','POST'],['https://foreign.invalid/v1/responses','POST'],['https://api.openai.com/v1/responses/input_tokens/extra','POST']]){try{await fetch(url,{method});}catch(e){if(e.message==='PREVIEW_PROVIDER_ENDPOINT_REJECTED')blocked++;else throw e;}}console.log(JSON.stringify({permitted,blocked}));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: isolatedPreviewEnvironment({ ...process.env, VERCEL_ENV: "preview" }), encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.deepEqual(JSON.parse(out), { permitted: 2, blocked: 4 });
});

test("configuration reserialization is accepted while executable changes remain blocked", () => {
  assert.doesNotThrow(() => assertPreviewConfig(Object.fromEntries(Object.entries(PREVIEW_CONFIG).reverse())));
  const noAnnotation = { ...PREVIEW_CONFIG }; delete noAnnotation.$schema;
  assert.doesNotThrow(() => assertPreviewConfig(noAnnotation));
  assert.doesNotThrow(() => assertPreviewConfig({ ...noAnnotation, name: PREVIEW_PROJECT.projectName, version: 2 }));
  assert.throws(() => assertPreviewConfig({ ...noAnnotation, name: "foreign-project", version: 2 }), /CONFIG_CHANGED:name/);
  assert.throws(() => assertPreviewConfig({ ...noAnnotation, version: 1 }), /CONFIG_CHANGED:version/);
  assert.throws(() => assertPreviewConfig({ ...noAnnotation, framework: "nextjs" }), /CONFIG_CHANGED:framework/);
  assert.throws(() => assertPreviewConfig({ ...noAnnotation, buildCommand: "npm run build" }), /CONFIG_CHANGED:buildCommand/);
  assert.throws(() => assertPreviewConfig({ ...noAnnotation, routes: [] }), /CONFIG_CHANGED:routes/);
});

test("unknown provider costs stay nullable and diagnostics contain only numeric values and types", () => {
  const rows = [{ caseId: "known", providerAttempts: 2, totalCostUsd: .004 }, { caseId: "unknown", providerAttempts: 1, totalCostUsd: null }];
  assert.deepEqual(evaluationCostSummary(rows), { spentEstimatedUsd: null, knownSubtotalUsd: .004, unknownCostCases: ["unknown"], costStatus: "UNKNOWN" });
  assert.equal(evaluationCostSummary(rows.slice(0, 1)).spentEstimatedUsd, .004);
  assert.deepEqual(evaluationCostSummary([{ ...rows[1], providerAttemptDiagnostics: [{ responsePriceMicros: 345 }, { responsePriceMicros: null }] }]),
    { spentEstimatedUsd: null, knownSubtotalUsd: .000345, unknownCostCases: ["unknown"], costStatus: "UNKNOWN" });
  assert.equal(evaluationCostSummary([], { dry: true }).spentEstimatedUsd, null);
  const usage = reportedUsageDiagnostic({ input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 500, cache_write_tokens: "PRIVATE_VALUE" }, output: "PRIVATE_RESPONSE" });
  assert.deepEqual(usage.cache_write_tokens, { type: "string", value: null });
  assert.deepEqual(usage.cached_tokens, { type: "number", value: 500 });
  assert.equal(JSON.stringify(usage).includes("PRIVATE"), false);
  assert.deepEqual(reportedUsageDiagnostic(null).input_tokens, { type: "undefined", value: null });
});

test("runtime exception diagnostics omit messages and reject full paths or arbitrary fields", () => {
  const source = { exceptionClass: "FileNotFoundError", message: "PRIVATE_EXCEPTION_MESSAGE", frames: [{ file: "turn_usage.py", function: "finish", line: 12, code: "PRIVATE_CODE" }] };
  assert.deepEqual(safeHermesRuntimeDiagnostic(source), { exceptionClass: "FileNotFoundError", frames: [{ file: "turn_usage.py", function: "finish", line: 12 }] });
  assert.equal(JSON.stringify(safeHermesRuntimeDiagnostic(source)).includes("PRIVATE"), false);
  assert.equal(safeHermesRuntimeDiagnostic({ ...source, frames: [{ file: "C:/private/file.py", function: "finish", line: 12 }] }), null);
  assert.equal(safeHermesRuntimeDiagnostic({ ...source, exceptionClass: "Exception: PRIVATE" }), null);
});
