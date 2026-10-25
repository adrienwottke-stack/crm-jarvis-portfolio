import { copyFile, mkdir, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PREVIEW_PROJECT, PREVIEW_MODELS, PREVIEW_CONFIGURATIONS, PREVIEW_SEED, PREVIEW_MANIFEST, PREVIEW_CONFIG, digest } from "./jarvis-preview-evaluation-common.mjs";

const SCRIPT_FILES = ["alias-hook.mjs", "test-db.mjs", "jarvis-evaluation-run.mjs", "jarvis-evaluation-adapter.mjs", "jarvis-evaluation-fixtures.mjs", "jarvis-evaluation-metering.mjs", "evaluation-budget.mjs", "responses-proxy-state.mjs",
  "jarvis-preview-evaluation-common.mjs", "jarvis-preview-evaluation-install.mjs", "jarvis-preview-evaluation-build.mjs", "jarvis-preview-evaluation-guard.mjs"];
const ROOT_FILES = ["package.json", "package-lock.json", "prisma.config.ts", "tsconfig.json"];
const CODE_EXTENSIONS = /\.(?:ts|tsx|js|mjs|cjs|css|json|sql|prisma|toml)$/i;

async function rejectGitAncestor(directory) {
  for (let current = resolve(directory);;) {
    try { await lstat(join(current, ".git")); throw new Error("STAGING_MUST_BE_OUTSIDE_GIT"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}

export async function preparePreviewEvaluation({ source, destination, model, runtime = "jarvis", scope = "READ_ONLY" }) {
  if (!PREVIEW_CONFIGURATIONS.some(config => config.model === model && config.runtime === runtime && config.scope === scope)) throw new Error("PREVIEW_CONFIGURATION_INVALID");
  await rejectGitAncestor(destination);
  try { await lstat(destination); throw new Error("STAGING_ALREADY_EXISTS"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const project = JSON.parse(await readFile(join(source, ".vercel/project.json"), "utf8"));
  if (project.projectId !== PREVIEW_PROJECT.projectId || project.orgId !== PREVIEW_PROJECT.orgId) throw new Error("PREVIEW_PROJECT_MISMATCH");
  await mkdir(destination, { recursive: true });
  const files = [];
  async function copy(name) {
    const target = join(destination, name); const original = join(source, name);
    if ((await lstat(original)).isSymbolicLink()) throw new Error("PREVIEW_SYMLINK_REJECTED");
    await mkdir(dirname(target), { recursive: true }); await copyFile(original, target);
    files.push({ path: name.replaceAll("\\", "/"), sha256: digest(await readFile(target)) });
  }
  async function tree(folder) {
    for (const entry of await readdir(join(source, folder), { withFileTypes: true })) {
      const name = `${folder}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("PREVIEW_SYMLINK_REJECTED");
      if (/^(?:\.git|\.env(?:\..*)?|\.cache|node_modules|test-results|audit|vault)$/i.test(entry.name) || name === "lib/generated") continue;
      if (entry.isDirectory()) await tree(name); else if (CODE_EXTENSIONS.test(entry.name)) await copy(name);
    }
  }
  for (const folder of ["app", "lib", "prisma"]) await tree(folder);
  for (const name of ROOT_FILES) await copy(name);
  for (const name of SCRIPT_FILES) await copy(`scripts/${name}`);
  if (runtime === "hermes") for (const name of ["hermes-evaluation-worker.py", "setup-hermes-evaluation-linux.mjs"]) await copy(`scripts/${name}`);
  await copy("docs/jarvis-evaluation-2026-10-05.json");
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = { version: "jarvis-preview-evaluation-v1", project: PREVIEW_PROJECT, model, provider: "openai", runtime, scope, seed: PREVIEW_SEED,
    maxCostUsd: 2, maxRunWallTimeMs: 32 * 60_000, qualityStatus: "NOT_RUN", createdAt: new Date().toISOString(), files, sourceHash: digest(JSON.stringify(files)) };
  await writeFile(join(destination, PREVIEW_MANIFEST), JSON.stringify(manifest, null, 2));
  await writeFile(join(destination, "vercel.json"), JSON.stringify(PREVIEW_CONFIG, null, 2));
  await mkdir(join(destination, ".vercel"));
  await writeFile(join(destination, ".vercel/project.json"), JSON.stringify(PREVIEW_PROJECT, null, 2));
  // A separate directory with no Git ancestor deliberately has no existing
  // branch identity, branch Preview override or branch-domain reassignment.
  await writeFile(join(destination, ".vercelignore"), ".git\n.env\n.env.*\n.cache\ntest-results\nnode_modules\npreview-evaluation-private\npreview-evaluation-static\n");
  manifest.files.push({ path: ".vercelignore", sha256: digest(await readFile(join(destination, ".vercelignore"))) });
  manifest.files.sort((left, right) => left.path.localeCompare(right.path));
  manifest.sourceHash = digest(JSON.stringify(manifest.files));
  await writeFile(join(destination, PREVIEW_MANIFEST), JSON.stringify(manifest, null, 2));
  return { destination, model, runtime, scope, sourceHash: manifest.sourceHash, fileCount: manifest.files.length, status: "PREPARED_NOT_DEPLOYED" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  if (args.some((arg, index) => index % 2 === 0 && !["--model", "--destination", "--runtime", "--scope"].includes(arg)) || args.length % 2) throw new Error("Usage: --model --runtime --scope --destination (all optional, allowlisted configurations only)");
  const runtime = option("--runtime") ?? "jarvis"; const scope = option("--scope") ?? "READ_ONLY";
  const models = option("--model") ? [option("--model")] : runtime === "hermes" ? ["gpt-5.6-luna"] : PREVIEW_MODELS;
  const source = resolve(import.meta.dirname, "..");
  const destination = resolve(option("--destination") ?? join(tmpdir(), `ergo-crm-preview-evaluation-${randomUUID()}`));
  for (const model of models) console.log(JSON.stringify(await preparePreviewEvaluation({ source, destination: join(destination, `${runtime}-${model}-${scope.toLowerCase()}`), model, runtime, scope })));
}
