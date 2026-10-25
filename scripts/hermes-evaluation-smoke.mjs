// Real pinned AIAgent against synthetic loopback HTTP only. No provider or CRM DB.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { isolatedPreviewEnvironment } from "./jarvis-preview-evaluation-common.mjs";
import { safeHermesRuntimeDiagnostic } from "./jarvis-evaluation-metering.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (args.some((arg, index) => index % 2 === 0 && !["--python", "--output"].includes(arg)) || args.length % 2) throw new Error("HERMES_SMOKE_ARGUMENT_REJECTED");
const python = resolve(option("--python", process.platform === "win32" ? ".cache/hermes-evaluation-venv/Scripts/python.exe" : ".cache/hermes-evaluation-venv/bin/python"));
const output = resolve(option("--output", ".cache/hermes-evaluation-smoke.json"));
const results = [];
const tools = ["get_contact", "get_contact_history", "get_contact_follow_ups"].map(name => ({ type: "function", name, description: "Read the synthetic selected contact.", parameters: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"], additionalProperties: false } }));
for (const withTools of [false, true]) {
  const token = randomUUID(); let chatRequests = 0, crmRequests = 0;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (req.url === "/v1/chat/completions") {
      const index = chatRequests++;
      const tool = withTools && index < 3 ? tools[index] : null;
      const promptTokens = [3812, 4052, 4276, 4403][Math.min(index, 3)];
      const completionTokens = tool ? [69, 34, 28][index] : 283;
      const message = tool ? { role: "assistant", content: null, tool_calls: [{ id: `mock-call-${index}`, type: "function", function: { name: tool.name, arguments: JSON.stringify({ contactId: "mock-anna" }) } }] }
        : { role: "assistant", content: "Anna hat Unterlagen angefragt. Es ist kein Termin vereinbart. Bitte den nächsten Schritt mit ihr klären." };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: `mock-response-${index}`, object: "chat.completion", created: 1_791_205_200, model: "gpt-5.6-luna",
        choices: [{ index: 0, message, finish_reason: tool ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens,
          ...(withTools ? { prompt_tokens_details: { cached_tokens: index ? 3809 : 0, cache_write_tokens: index ? 240 : 3809 } } : {}) } }));
    } else if (req.url === "/crm-tool" && tools.some(tool => tool.name === body.name) && body.args?.contactId === "mock-anna") {
      crmRequests++;
      const data = { contact: { id: "mock-anna", name: "Anna Müller", note: "Eigene Kontaktnotiz." },
        ...(body.name === "get_contact_history" ? { activities: [{ id: "mock-activity", text: "Unterlagen angefragt. Kein fester Termin.", date: "2026-10-04T10:00:00Z" }] } : {}),
        ...(body.name === "get_contact_follow_ups" ? { followUps: [] } : {}) };
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, summary: "Synthetische Quelle geladen.", data }));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(accept => server.listen(0, "127.0.0.1", accept));
  const child = spawn(python, [resolve("scripts/hermes-evaluation-worker.py")], { cwd: process.cwd(), env: isolatedPreviewEnvironment(process.env), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let text = ""; child.stdout.on("data", data => { text += data; }); child.stderr.resume();
  child.stdin.end(JSON.stringify({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, model: "gpt-5.6-luna",
    instructions: "Bereite nur die ausgewählte Anna vor. Quellen: Unterlagen angefragt, kein fester Termin. Keine Speicherung.",
    history: [], message: "Bereite das Gespräch mit Anna vor.", tools: withTools ? tools : [],
    budgets: { durationMs: 90000, tokens: 20000, toolCalls: 24, maxToolRounds: 12, maxOutputTokensPerRound: 2400 } }));
  const timer = setTimeout(() => child.kill(), 90000);
  const exit = await new Promise(accept => { child.on("exit", accept); child.on("error", () => accept(-1)); });
  clearTimeout(timer); await new Promise(accept => server.close(accept));
  let result; try { result = JSON.parse(text.trim()); } catch { result = {}; }
  const passed = exit === 0 && result.answer?.includes("Anna") && chatRequests === (withTools ? 4 : 1) && crmRequests === (withTools ? 3 : 0) && result.networkDeniedCount === 0;
  results.push({ case: withTools ? "REALISTIC_USAGE_THREE_TOOLS" : "REALISTIC_USAGE_FINAL_ONLY", passed, exit, chatRequests, crmRequests,
    runtimeCommit: result.runtimeCommit ?? null, errorCode: typeof result.errorCode === "string" && /^HERMES_[A-Z_]+$/.test(result.errorCode) ? result.errorCode : null,
    runtimeDiagnostic: safeHermesRuntimeDiagnostic(result.failureDiagnostic), wallTimeMs: result.wallTimeMs ?? null });
}
const report = { status: results.every(result => result.passed) ? "REAL_RUNTIME_MOCK_PASSED" : "REAL_RUNTIME_MOCK_FAILED", evidence: "REAL_HERMES_RUNTIME_SYNTHETIC_HTTP_MOCK",
  providerRequests: 0, externalDatabaseUsed: false, nonzeroUsageAndCacheCounts: true, results };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
// Preserve a failed worker diagnostic as a protected static artifact in the
// explicitly configured mock Preview. The report keeps its failed status.
const staticDiagnostic = process.env.VERCEL_ENV === "preview" && output === resolve("preview-evaluation-static/diagnostic.json");
console.log(JSON.stringify(report)); process.exitCode = results.every(result => result.passed) || staticDiagnostic ? 0 : 1;
