import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyPreviewStage, isolatedPreviewEnvironment, evaluationArguments, digest } from "./jarvis-preview-evaluation-common.mjs";

const manifest = await verifyPreviewStage(process.cwd(), process.env);
const env = isolatedPreviewEnvironment(process.env, { provider: true });
const dry = process.argv.includes("--dry-run");
if (process.argv.slice(2).some(arg => arg !== "--dry-run")) throw new Error("PREVIEW_BUILD_ARGUMENT_REJECTED");
if (!dry && (!env.OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY === "[SENSITIVE]")) throw new Error("PREVIEW_PROVIDER_SECRET_UNAVAILABLE");
await mkdir("preview-evaluation-private", { recursive: true });
await mkdir("preview-evaluation-static", { recursive: true });
const privateOutput = resolve("preview-evaluation-private/run.json");
let processStatus = "START_FAILED";
await new Promise(accept => {
  const child = spawn(process.execPath, evaluationArguments(manifest, privateOutput, { dry }), { env, cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout.resume(); child.stderr.resume();
  const timer = setTimeout(() => { processStatus = "WALL_BUDGET_STOP"; child.kill("SIGTERM"); }, manifest.maxRunWallTimeMs);
  child.on("error", () => { clearTimeout(timer); accept(); });
  child.on("exit", code => { clearTimeout(timer); if (processStatus !== "WALL_BUDGET_STOP") processStatus = code === 0 ? "EXITED" : "FAILED"; accept(); });
});
let run = null;
try { run = JSON.parse(await readFile(privateOutput, "utf8")); } catch { /* A failed startup is an explicit incomplete result. */ }
if (run && (run.model !== manifest.model || run.runtime !== manifest.runtime || run.provider !== "openai" || run.scope !== manifest.scope || run.seed !== manifest.seed)) throw new Error("PREVIEW_REPORT_IDENTITY_MISMATCH");
const serialized = run ? JSON.stringify(run, null, 2) : null;
if (serialized && ((env.OPENAI_API_KEY && serialized.includes(env.OPENAI_API_KEY)) || /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/.test(serialized))) throw new Error("PREVIEW_SECRET_OUTPUT_REJECTED");
// All transcripts originate from the synthetic fixture. No credential, .env,
// database or raw dependency/provider log is copied to the served directory.
if (serialized) await writeFile("preview-evaluation-static/run.json", serialized);
const status = { version: manifest.version, model: manifest.model, provider: manifest.provider, runtime: manifest.runtime, scope: manifest.scope,
  sourceHash: manifest.sourceHash, seed: manifest.seed, maxCostUsd: manifest.maxCostUsd, processStatus,
  executionStatus: run?.status ?? "INCOMPLETE", cases: run?.rows?.length ?? 0, evidence: run?.evidence ?? "NOT_RUN", qualityStatus: "NOT_REVIEWED",
  writeAcceptance: manifest.scope === "READ_ONLY" ? "NOT_TESTED_READ_ONLY" : "NOT_REVIEWED_ISOLATED_MEMORY_ONLY", costStatus: run?.costStatus ?? "UNAVAILABLE",
  spentEstimatedUsd: run?.spentEstimatedUsd ?? null, knownSubtotalUsd: run?.knownSubtotalUsd ?? null, unknownCostCases: run?.unknownCostCases ?? [],
  pricingVersion: run?.pricingVersion ?? null, transcriptHash: run?.transcriptHash ?? null, reportHash: serialized ? digest(serialized) : null,
  productionReleased: false, crmRemoteDatabaseUsed: false, staticOutputOnly: true };
await writeFile("preview-evaluation-static/status.json", JSON.stringify(status, null, 2));
await writeFile("preview-evaluation-static/index.html", `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Jarvis – isolierter Preview-Vergleich</title><body><h1>Jarvis – isolierter Preview-Vergleich</h1><p>Ausschließlich synthetische Fälle ${manifest.scope === "READ_ONLY" ? "im Lesemodus" : "mit flüchtigen Änderungen nur in der isolierten Speicherdatenbank"}. Fachliche Bewertung steht aus. Schreibende Arbeitsabläufe wurden nicht abgenommen.</p><p><a href="status.json">Ausführungsstatus</a>${serialized ? ' · <a href="run.json">Synthetisches Prüfprotokoll</a>' : ""}</p></body></html>`);
console.log(JSON.stringify({ status: status.executionStatus, model: status.model, cases: status.cases, processStatus, evidence: status.evidence, qualityStatus: status.qualityStatus }));
