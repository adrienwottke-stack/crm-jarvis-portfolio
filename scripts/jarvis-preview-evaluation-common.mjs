import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const PREVIEW_PROJECT = Object.freeze({ projectId: "prj_sY1VWrwitKb5lWrZNQAM0uCyJC1M", orgId: "team_Rxa9GTvwX857YSHqLnAHmqpE", projectName: "ergo-crm" });
export const PREVIEW_MODELS = Object.freeze(["gpt-5.6-luna", "gpt-6.1-sol"]);
export const PREVIEW_CONFIGURATIONS = Object.freeze([
  ...PREVIEW_MODELS.flatMap(model => ["READ_ONLY", "ISOLATED_WRITE"].map(scope => Object.freeze({ model, runtime: "jarvis", scope }))),
  ...["READ_ONLY", "ISOLATED_WRITE"].map(scope => Object.freeze({ model: "gpt-5.6-luna", runtime: "hermes", scope })),
]);
export const PREVIEW_SEED = "crm-contact-2026-10-05";
export const PREVIEW_DATABASE_SENTINEL = "postgresql://postgres:postgres@127.0.0.1:1/postgres";
export const PREVIEW_MANIFEST = "preview-evaluation-manifest.json";
export const PREVIEW_CONFIG = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  installCommand: "node scripts/jarvis-preview-evaluation-install.mjs",
  buildCommand: "node scripts/jarvis-preview-evaluation-build.mjs",
  outputDirectory: "preview-evaluation-static",
  crons: [],
  public: false,
});
export const digest = value => createHash("sha256").update(value).digest("hex");

export function assertPreviewConfig(config) {
  const expected = { ...PREVIEW_CONFIG }; const actual = { ...config };
  // Vercel can reserialize configuration and omit the editor schema annotation.
  // Object property order has no behavioral meaning; all execution fields do.
  delete expected.$schema; delete actual.$schema;
  if (Object.hasOwn(actual, "name")) {
    if (actual.name !== PREVIEW_PROJECT.projectName) throw new Error("PREVIEW_CONFIG_CHANGED:name");
    delete actual.name;
  }
  if (Object.hasOwn(actual, "version")) {
    if (actual.version !== 2) throw new Error("PREVIEW_CONFIG_CHANGED:version");
    delete actual.version;
  }
  if (!isDeepStrictEqual(actual, expected)) {
    const changed = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter(key => !isDeepStrictEqual(actual[key], expected[key]) && /^[A-Za-z0-9_$]{1,80}$/.test(key));
    throw new Error(`PREVIEW_CONFIG_CHANGED:${changed.join(",")}`);
  }
}

/** Copy only runtime necessities; remote DB/config/credential variables are omitted. */
export function isolatedPreviewEnvironment(source, { provider = false } = {}) {
  const result = {};
  for (const name of ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "COMSPEC", "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID"])
    if (typeof source[name] === "string") result[name] = source[name];
  if (provider && typeof source.OPENAI_API_KEY === "string") result.OPENAI_API_KEY = source.OPENAI_API_KEY;
  return { ...result, DATABASE_URL: PREVIEW_DATABASE_SENTINEL, DIRECT_URL: PREVIEW_DATABASE_SENTINEL,
    NODE_ENV: "production", AI_PROVIDER_MAX_RETRIES: "0", JARVIS_PREVIEW_EVALUATION: "1", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
}

export function assertPreviewEnvironment(env) {
  if (env.VERCEL_ENV !== "preview") throw new Error("PREVIEW_ENV_REQUIRED");
  if (env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID !== PREVIEW_PROJECT.projectId) throw new Error("PREVIEW_PROJECT_MISMATCH");
  if (env.VERCEL_ORG_ID && env.VERCEL_ORG_ID !== PREVIEW_PROJECT.orgId) throw new Error("PREVIEW_TEAM_MISMATCH");
}

export function assertManifest(manifest) {
  if (manifest.version !== "jarvis-preview-evaluation-v1" || !PREVIEW_CONFIGURATIONS.some(config => config.model === manifest.model && config.runtime === manifest.runtime && config.scope === manifest.scope) || manifest.provider !== "openai" || manifest.seed !== PREVIEW_SEED || manifest.maxCostUsd !== 2 || manifest.maxRunWallTimeMs !== 32 * 60_000 || manifest.project?.projectId !== PREVIEW_PROJECT.projectId || manifest.project?.orgId !== PREVIEW_PROJECT.orgId || !Array.isArray(manifest.files) || !manifest.files.length)
    throw new Error("PREVIEW_MANIFEST_INVALID");
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || file.path.startsWith("/") || file.path.includes("\\") || file.path.split("/").some(part => !part || part === "." || part === "..") || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("PREVIEW_MANIFEST_PATH_INVALID");
  }
  if (new Set(manifest.files.map(file => file.path)).size !== manifest.files.length || manifest.sourceHash !== digest(JSON.stringify(manifest.files))) throw new Error("PREVIEW_MANIFEST_HASH_INVALID");
  return manifest;
}

export async function verifyPreviewStage(directory, env) {
  assertPreviewEnvironment(env);
  const manifest = assertManifest(JSON.parse(await readFile(resolve(directory, PREVIEW_MANIFEST), "utf8")));
  const files = new Set(manifest.files.map(file => file.path));
  for (const file of manifest.files) {
    const absolute = resolve(directory, file.path);
    const relation = relative(directory, absolute);
    if (relation.startsWith(`..${sep}`) || relation === ".." || (await lstat(absolute)).isSymbolicLink() || digest(await readFile(absolute)) !== file.sha256) throw new Error("PREVIEW_SOURCE_CHANGED");
  }
  assertPreviewConfig(JSON.parse(await readFile(resolve(directory, "vercel.json"), "utf8")));
  async function visit(folder) {
    for (const entry of await readdir(resolve(directory, folder), { withFileTypes: true })) {
      const name = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("PREVIEW_SYMLINK_REJECTED");
      if (name === ".cache" && entry.isDirectory() && manifest.runtime === "hermes") {
        const runtimeFiles = await readdir(resolve(directory, name), { withFileTypes: true });
        if (runtimeFiles.some(item => !["hermes-evaluation-source", "hermes-evaluation-venv", "hermes-evaluation-home", "hermes-evaluation-homes"].includes(item.name) || item.isSymbolicLink() || !item.isDirectory())) throw new Error("PREVIEW_RUNTIME_CACHE_REJECTED");
        continue;
      }
      if (/^(?:\.git|\.env(?:\..*)?|\.cache|test-results|audit|vault)$/i.test(entry.name)) throw new Error("PREVIEW_PRIVATE_INPUT_REJECTED");
      if (entry.isDirectory()) {
        if (["node_modules", "lib/generated", "preview-evaluation-static", "preview-evaluation-private"].includes(name)) continue;
        await visit(name);
      } else if (!files.has(name) && ![PREVIEW_MANIFEST, "vercel.json", ".vercel/project.json"].includes(name)) throw new Error("PREVIEW_UNLISTED_INPUT_REJECTED");
    }
  }
  await visit("");
  // CLI-local .vercel may be excluded from the uploaded source. The manifest is
  // always present; when Vercel exposes system project/team IDs, check them above.
  return manifest;
}

export function evaluationArguments(manifest, output, { dry = false } = {}) {
  assertManifest(manifest);
  return ["--import", "./scripts/jarvis-preview-evaluation-guard.mjs", "--import", "./scripts/alias-hook.mjs", "scripts/jarvis-evaluation-run.mjs",
    "--provider", "openai", "--runtime", manifest.runtime, "--scope", manifest.scope, "--model", manifest.model,
    "--seed", manifest.seed, "--max-cost-usd", "2", "--output", output,
    ...(manifest.runtime === "hermes" ? ["--hermes-python", resolve(".cache/hermes-evaluation-venv/bin/python")] : []), ...(dry ? ["--dry-run"] : [])];
}
