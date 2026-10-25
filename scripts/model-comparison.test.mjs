import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { testDatabase } from "./test-db.mjs";
import { priceReportedTokens, beginProviderAttempt, meterProviderResponse, meterProviderFailure, maximumTextCallCostMicros } from "../lib/ai-crm/provider-metering.ts";
import { createCrmModelClient, responsesToClaudeMessages } from "../lib/ai-crm/model-client.ts";
import { evaluationReport, assertComparableRuns } from "../lib/experiments/jarvis-evaluation.ts";
import { aiCrmConfig } from "../lib/ai-crm/config.ts";
import { renderMeteredSpeechFallback, renderSpeechFallback } from "../lib/ai-crm/speech-fallback.ts";
import { createResponsesProxyState } from "./responses-proxy-state.mjs";
import { createEvaluationFixture } from "./jarvis-evaluation-fixtures.mjs";
const fixture = await testDatabase(); const db = fixture.client;
after(async () => fixture.close());
test("evaluation fixtures contain the stipulated promise, distinct people, stale reference and exactly 35 history rows", async () => {
  const s = await createEvaluationFixture(db, { id: "prep-03", task: "preparation" }, "READ_ONLY");
  const call = await db.activity.findUniqueOrThrow({ where: { id: "eval-prep-03-ben-call" } });
  assert.match(call.text, /zugesagt.*Unterlagen.*senden/);
  assert.match(call.text, /Kein Zeitpunkt/);
  assert.notEqual((await db.activity.findUniqueOrThrow({ where: { id: "eval-prep-03-chris-call" } })).text, call.text);
  assert.match((await db.activity.findUniqueOrThrow({ where: { id: "eval-prep-03-annaOther-call" } })).text, /Reisewunsch/);
  assert.equal(s.context.contactId, s.contacts.ben.id);
  const switched = await createEvaluationFixture(db, { id: "post-03", task: "postprocessing" }, "ISOLATED_WRITE");
  assert.equal(switched.context.contactId, switched.contacts.chris.id);
  const stale = await db.contactFollowUp.findUniqueOrThrow({ where: { id: "eval-post-03-old-ben-follow-up" } });
  assert.equal(stale.contactId, switched.contacts.ben.id);
  assert.match(switched.history[1].content, /eval-post-03-old-ben-follow-up/);
  const paged = await createEvaluationFixture(db, { id: "prep-10", task: "preparation" }, "READ_ONLY");
  assert.equal(await db.activity.count({ where: { contactId: paged.contacts.ben.id } }), 35);
  const history = await db.activity.findMany({ where: { contactId: paged.contacts.ben.id }, orderBy: { date: "desc" } });
  assert.match(history[34].text, /Älteste dokumentierte Zusage/);
  assert.ok(paged.contacts.ben.id);
});
test("pricing preserves missing/invalid usage as unknown and accounts for cached input/write", () => {
  assert.equal(priceReportedTokens("gpt-4o-mini", undefined), null);
  assert.equal(priceReportedTokens("unknown-model", { input_tokens: 100, output_tokens: 20 }), null);
  assert.equal(priceReportedTokens("gpt-4o-mini", { input_tokens: -1, output_tokens: 20 }), null);
  assert.equal(priceReportedTokens("gpt-4o-mini", { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 101 } }), null);
  assert.equal(priceReportedTokens("gpt-5.6-luna", { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 500 } }), 230);
  assert.equal(priceReportedTokens("gpt-6.1-sol", { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cache_write_tokens: 500 } }), 3250);
});
test("every attempt persists tokens before a later failure and retry never turns unknown billed usage into zero", async () => {
  const user = await db.user.create({ data: { name: "Metering-Test" } });
  const usage = await db.aiUsage.create({ data: { userId: user.id, requestId: "fixture-retry", kind: "EVALUATION" } });
  await beginProviderAttempt(db, usage.id, "gpt-5.6-luna");
  await meterProviderResponse(db, usage.id, "gpt-5.6-luna", { input_tokens: 1000, output_tokens: 100 });
  let saved = await db.aiUsage.findUniqueOrThrow({ where: { id: usage.id } });
  assert.equal(saved.pricedCostMicros, 320); assert.equal(saved.meteringComplete, true);
  await beginProviderAttempt(db, usage.id, "gpt-5.6-luna"); await meterProviderFailure(db, usage.id);
  await beginProviderAttempt(db, usage.id, "gpt-5.6-luna");
  await meterProviderResponse(db, usage.id, "gpt-5.6-luna", { input_tokens: 50, output_tokens: 10 });
  saved = await db.aiUsage.findUniqueOrThrow({ where: { id: usage.id } });
  assert.equal(saved.inputTokens, 1050); assert.equal(saved.outputTokens, 110); assert.equal(saved.providerAttempts, 3);
  assert.equal(saved.pricedCostMicros, null); assert.equal(saved.meteringComplete, false);
});
test("Luna cache writes use the verified tariff and remain completely metered across tool rounds", async () => {
  const reported = { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 500 } };
  assert.equal(priceReportedTokens("gpt-5.6-luna", reported), 345);
  assert.equal(priceReportedTokens("gpt-5.6-luna", { ...reported, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 500 } }), 309);
  assert.equal(priceReportedTokens("gpt-5.6-luna", { ...reported, input_tokens_details: { cached_tokens: 501, cache_write_tokens: 500 } }), null);
  assert.equal(maximumTextCallCostMicros("gpt-5.6-luna", 1000, 100), 2418);
  const user = await db.user.create({ data: { name: "Cache-Write-Test" } });
  const usage = await db.aiUsage.create({ data: { userId: user.id, requestId: "fixture-cache-write", kind: "EVALUATION" } });
  await beginProviderAttempt(db, usage.id, "gpt-5.6-luna");
  await meterProviderResponse(db, usage.id, "gpt-5.6-luna", reported);
  await beginProviderAttempt(db, usage.id, "gpt-5.6-luna");
  await meterProviderResponse(db, usage.id, "gpt-5.6-luna", { input_tokens: 1200, output_tokens: 50, input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 200 } });
  const saved = await db.aiUsage.findUniqueOrThrow({ where: { id: usage.id } });
  assert.equal(saved.meteringComplete, true);
  assert.equal(saved.providerAttempts, 2);
  assert.equal(saved.pricedCostMicros, 475);
  assert.equal(saved.inputTokens, 2200);
  assert.equal(saved.outputTokens, 150);
});
test("Claude bridge preserves tool IDs, arguments, grouped results, and later user turn", () => {
  const messages = responsesToClaudeMessages([{ role: "user", content: "Ben vorbereiten" },
    { type: "function_call", call_id: "tool-1", name: "get_contact", arguments: '{"contactId":"Ben"}' },
    { type: "function_call", call_id: "tool-2", name: "get_contact_history", arguments: '{"contactId":"Ben"}' },
    { type: "function_call_output", call_id: "tool-1", output: '{"owned":true}' },
    { type: "function_call_output", call_id: "tool-2", output: '{"total":35}' }, { role: "user", content: "Aktueller Bezug Chris" }]);
  assert.equal(messages.length, 3); assert.equal(messages[1].content[0].id, "tool-1");
  assert.equal(messages[1].content[1].name, "get_contact_history"); assert.equal(messages[2].content[1].tool_use_id, "tool-2");
  assert.equal(messages[2].content[2].text, "Aktueller Bezug Chris");
});
test("Claude uses own Messages transport and normalizes tool usage/cache without hidden retries", async () => {
  let calls = 0, body;
  const client = createCrmModelClient("anthropic", "fixture-not-a-secret", 1000, async (url, init) => {
    calls++; body = JSON.parse(init.body); assert.equal(url, "https://api.anthropic.com/v1/messages");
    return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "claude-tool", name: "get_contact", input: { contactId: "owned" } }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 } }), { status: 200 });
  });
  const result = await client.responses.create({ model: "claude-sonnet-5-5", instructions: "Nur eigene Daten", input: "Vorbereitung", tools: [{ type: "function", name: "get_contact", description: "Eigener Kontakt", parameters: { type: "object", properties: {}, additionalProperties: false }, strict: true }] });
  assert.equal(calls, 1); assert.equal(body.tools[0].name, "get_contact"); assert.equal(body.thinking.type, "between_tools");
  assert.equal(result.output[0].call_id, "claude-tool"); assert.equal(result.usage.input_tokens, 350);
  assert.equal(result.usage.input_tokens_details.cache_write_tokens, 50); assert.equal(priceReportedTokens("claude-sonnet-5-5", result.usage), 565);
});
test("provider error body is not exposed and a failed call is not retried inside the adapter", async () => {
  let calls = 0;
  const client = createCrmModelClient("anthropic", "fixture", 1000, async () => { calls++; return new Response('private prompt and fixture key', { status: 429 }); });
  await assert.rejects(client.responses.create({ model: "claude-sonnet-5-5", input: "fixture" }), error => error.status === 429 && !error.message.includes("private prompt"));
  assert.equal(calls, 1);
});

test("Claude tool continuation restores every original block and grouped tools without exposing thinking", async () => {
  const original = [{ type: "thinking", thinking: "", signature: "synthetic-signature-ä😀" },
    { type: "text", text: "Ich prüfe die Quellen. " }, { type: "redacted_thinking", data: "synthetic-opaque-data" },
    { type: "tool_use", id: "first-tool", name: "get_contact", input: { contactId: "owned" } },
    { type: "text", text: "Dann die älteren Aktivitäten. " },
    { type: "tool_use", id: "second-tool", name: "get_contact_history", input: { contactId: "owned", offset: 30 } }];
  const requests = [];
  const client = createCrmModelClient("anthropic", "fixture", 1000, async (_url, init) => {
    requests.push(init.body);
    return new Response(JSON.stringify({ content: requests.length === 1 ? original : [{ type: "text", text: "Aktueller Stand mit Quellen." }], usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });
  });
  const first = await client.responses.create({ model: "claude-sonnet-5-5", input: "Ben vorbereiten" });
  assert.equal(first.output.filter(item => item.type === "function_call").length, 2);
  assert.ok(!JSON.stringify(first).includes("synthetic-signature"));
  assert.ok(!JSON.stringify(first).includes("synthetic-opaque-data"));
  const secondInput = { model: "claude-sonnet-5-5", input: [{ role: "user", content: "Ben vorbereiten" }, ...first.output,
    { type: "function_call_output", call_id: "first-tool", output: '{"name":"Ben"}' },
    { type: "function_call_output", call_id: "second-tool", output: '{"activities":[]}' }] };
  const actualBytes = client.responses.requestBytes(secondInput);
  await client.responses.create(secondInput);
  const second = JSON.parse(requests[1]);
  assert.equal(second.messages.length, 3);
  assert.deepEqual(second.messages[1], { role: "assistant", content: original });
  assert.equal(JSON.stringify(second.messages[1].content), JSON.stringify(original));
  assert.deepEqual(second.messages[2].content, [{ type: "tool_result", tool_use_id: "first-tool", content: '{"name":"Ben"}' },
    { type: "tool_result", tool_use_id: "second-tool", content: '{"activities":[]}' }]);
  assert.equal(actualBytes, Buffer.byteLength(requests[1], "utf8"));
  const withoutPrivate = { ...second, messages: second.messages.map(message => ({ ...message, content: message.content.filter(block => !["thinking", "redacted_thinking"].includes(block.type)) })) };
  assert.ok(actualBytes > Buffer.byteLength(JSON.stringify(withoutPrivate), "utf8"));
});

test("Claude private tool context is bounded, stays in its client and resets for a new turn", async () => {
  const tool = { type: "tool_use", id: "private-tool", name: "get_contact", input: { contactId: "owned" } };
  let calls = 0;
  const client = createCrmModelClient("anthropic", "fixture", 1000, async () => {
    calls++;
    return new Response(JSON.stringify({ content: calls === 1 ? [{ type: "thinking", thinking: "", signature: "private-local" }, tool] : [{ type: "text", text: "New turn" }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  });
  const first = await client.responses.create({ model: "claude-sonnet-5-5", input: "First turn" });
  const continuation = { model: "claude-sonnet-5-5", input: [{ role: "user", content: "First turn" }, ...first.output,
    { type: "function_call_output", call_id: "private-tool", output: "{}" }] };
  const other = createCrmModelClient("anthropic", "fixture", 1000, async () => { throw new Error("No request expected"); });
  assert.throws(() => other.responses.requestBytes(continuation), error => error.code === "MODEL_TOOL_CONTEXT_CHANGED");
  assert.throws(() => client.responses.requestBytes({ ...continuation, model: "claude-another-model" }), error => error.code === "MODEL_TOOL_CONTEXT_CHANGED");
  await client.responses.create({ model: "claude-sonnet-5-5", input: "Independent new turn" });
  assert.throws(() => client.responses.requestBytes(continuation), error => error.code === "MODEL_TOOL_CONTEXT_CHANGED");
  const bounded = createCrmModelClient("anthropic", "fixture", 1000, async () => new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "", signature: "x".repeat(256 * 1024) }, tool], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
  await assert.rejects(bounded.responses.create({ model: "claude-sonnet-5-5", input: "Bounded fixture" }), error => error.code === "MODEL_TOOL_CONTEXT_LIMIT");
});

test("invalid TTS text never reserves usage or counts a provider attempt", async () => {
  let providerCalls = 0, databaseCalls = 0;
  const client = { audio: { speech: { async create() { providerCalls++; throw new Error("No provider call expected"); } } } };
  const config = { ...aiCrmConfig(), liveSpeechModel: "synthetic-tts", providerTimeoutMs: 1000 };
  const fakeDb = new Proxy({}, { get() { databaseCalls++; throw new Error("No database access expected"); } });
  for (const content of ["", "   ", "x".repeat(4097)]) {
    await assert.rejects(renderSpeechFallback(content, config, client), /TTS-Limit/);
    await assert.rejects(renderMeteredSpeechFallback({ db: fakeDb, userId: "own", sessionUsageId: "session", requestId: "turn", content, config, client }), /TTS-Limit/);
  }
  assert.equal(providerCalls, 0); assert.equal(databaseCalls, 0);
});

test("valid TTS success and failure are counted on the own session task without inventing free costs", async () => {
  const config = { ...aiCrmConfig(), liveSpeechModel: "synthetic-tts", providerTimeoutMs: 1000, monthlyRequestLimit: 100, monthlyAudioSecondsLimit: 100, monthlyToolCallLimit: 100 };
  for (const outcome of ["success", "failed", "foreign-session"]) {
    const created = [], updates = [];
    let providerCalls = 0;
    const aiUsage = { async findFirst(query) { assert.equal(query.where.userId, "own-user"); return outcome === "foreign-session" ? null : { workTaskId: "own-task" }; },
      async aggregate() { return { _count: { _all: 0 }, _sum: { audioSeconds: 0, toolCalls: 0 } }; },
      async create(query) { created.push(query.data); return { id: "helper", ...query.data }; },
      async update(query) { updates.push(query.data); return { id: query.where.id, ...query.data }; } };
    const fakeDb = { aiUsage, async $queryRaw() { return []; }, async $transaction(operation) { return operation(fakeDb); } };
    const client = { audio: { speech: { async create() { providerCalls++; if (outcome === "failed") throw new Error("synthetic provider error"); return { async arrayBuffer() { return new ArrayBuffer(3); } }; } } } };
    const request = renderMeteredSpeechFallback({ db: fakeDb, userId: "own-user", sessionUsageId: "session", requestId: "turn", content: "x".repeat(4096), config, client });
    if (outcome === "failed") await assert.rejects(request, /synthetic provider error/);
    else assert.equal((await request).byteLength, 3);
    assert.equal(providerCalls, 1); assert.equal(created.length, 1); assert.equal(created[0].kind, "SPEECH_FALLBACK"); assert.equal(created[0].userId, "own-user");
    assert.equal(updates[0].providerAttempts, 1); assert.equal(updates[0].workTaskId, outcome === "foreign-session" ? undefined : "own-task");
    assert.equal(updates.at(-1).status, outcome === "failed" ? "FAILED" : "SUCCEEDED");
    assert.ok(!updates.some(row => row.pricedCostMicros === 0 || row.meteringComplete === true));
  }
});
test("unreviewed real runs and scripted smoke cannot be mistaken for completed quality proof", () => {
  const run = { id: "a", model: "model", runtime: "jarvis", scope: "READ_ONLY", fixtureHash: "same", toolsetHash: "same", contextHash: "same", memoryHash: "same", promptHash: "same",
    budgets: { durationMs: 1000, tokens: 100, toolCalls: 3 }, rows: [{ caseId: "one", correctReaction: true, completedTask: true, criticalErrors: [], totalDurationMs: 30, totalTokens: 50, totalToolCalls: 1, totalCostUsd: .01 }] };
  assert.equal(evaluationReport({ ...run, evidence: "REAL_PROVIDER_SYNTHETIC_DATA", qualityStatus: "NOT_REVIEWED" }, ["one"]).status, "AWAITING_REVIEW");
  assert.equal(evaluationReport({ ...run, evidence: "SCRIPTED_WIRING_ONLY" }, ["one"]).status, "SCRIPTED_ONLY");
  assert.throws(() => assertComparableRuns(run, { ...run, runtime: "hermes", promptHash: "changed" }, "RUNTIME"), /Prompt/);
});

test("review CLI requires current saved receipts for write completion and rejects READ_ONLY completion", async () => {
  // Synthetic signed CLI inputs exercise validation; they are not provider evidence.
  const suite = JSON.parse(await readFile(new URL("../docs/jarvis-evaluation-2026-10-05.json", import.meta.url), "utf8"));
  const directory = await mkdtemp(join(tmpdir(), "ergo-model-review-"));
  const runFile = join(directory, "run.json"), reviewFile = join(directory, "review.json"), resultFile = join(directory, "reviewed.json");
  const execute = promisify(execFile);
  async function runReview({ receipts = [], scope = "ISOLATED_WRITE", completedCase = "post-02", evidence = "REAL_PROVIDER_SYNTHETIC_DATA", status = "EXECUTED_REVIEW_REQUIRED", reviewerType, budgetFailures = 0, critical = false } = {}) {
    const transcripts = suite.cases.map(item => ({ caseId: item.id, answer: "Synthetic review fixture", receipts: item.id === completedCase ? receipts : [] }));
    const transcriptHash = createHash("sha256").update(JSON.stringify(transcripts)).digest("hex");
    const run = { id: "synthetic-review", model: "synthetic-model", runtime: "jarvis", scope, fixtureHash: "fixture", toolsetHash: "tools", contextHash: "context", memoryHash: "memory",
      budgets: { durationMs: 90000, tokens: 20000, toolCalls: 24, maxToolRounds: 12, maxOutputTokensPerRound: 2400 }, evidence, status, qualityStatus: "NOT_REVIEWED", transcriptHash, transcripts,
      rows: suite.cases.map((item, index) => ({ caseId: item.id, correctReaction: false, completedTask: false, criticalErrors: critical && index === 0 ? ["synthetic critical error"] : [], totalDurationMs: 10, totalTokens: index < budgetFailures ? 20001 : 5, totalToolCalls: 1, totalCostUsd: .001 })) };
    const review = { reviewer: "Synthetic local reviewer", reviewerType, transcriptHash, rows: suite.cases.map(item => ({ caseId: item.id, correctReaction: true, completedTask: item.id === completedCase, criticalErrors: [], reason: "Synthetic validation fixture only" })) };
    await writeFile(runFile, JSON.stringify(run)); await writeFile(reviewFile, JSON.stringify(review));
    return execute(process.execPath, ["--import", "./scripts/alias-hook.mjs", "scripts/jarvis-evaluation-review.mjs", runFile, reviewFile, resultFile], { cwd: process.cwd(), timeout: 10_000 });
  }
  try {
    for (const receipts of [[], [{ status: "PENDING", undoStatus: "UNAVAILABLE" }], [{ status: "COMPLETED", undoStatus: "UNDONE" }]]) {
      await assert.rejects(runReview({ receipts }), error => /aktuellen gespeicherten Einzelbeleg/.test(error.stderr));
    }
    const saved = [{ status: "COMPLETED", undoStatus: "UNAVAILABLE" }];
    await assert.rejects(runReview({ receipts: saved, scope: "READ_ONLY" }), error => /Lesemodus/.test(error.stderr));
    for (const completedCase of ["post-01", "post-08"]) await assert.rejects(runReview({ receipts: saved, completedCase }), error => /Rückfrage oder Teilbestätigung/.test(error.stderr));
    await assert.rejects(runReview({ receipts: saved, evidence: "SCRIPTED_WIRING_ONLY", status: "DRY_RUN_COMPLETE" }), error => /echter Anbieter-Lauf/.test(error.stderr));
    await runReview({ receipts: saved });
    const reviewed = JSON.parse(await readFile(resultFile, "utf8"));
    assert.equal(reviewed.qualityStatus, "REVIEWED"); assert.equal(reviewed.report.completedTasks, 1);
    assert.equal(reviewed.reviewerType, "UNSPECIFIED");
    await runReview({ receipts: saved, reviewerType: "TECHNICAL_AI" });
    const technicalReview = JSON.parse(await readFile(resultFile, "utf8"));
    assert.equal(technicalReview.reviewerType, "TECHNICAL_AI");
    assert.equal(technicalReview.qualityGateEvidence, "TECHNICAL_AI");
    await runReview({ receipts: saved, budgetFailures: 2 });
    const atBoundary = JSON.parse(await readFile(resultFile, "utf8"));
    assert.equal(atBoundary.report.correctReactions, 18);
    assert.equal(atBoundary.report.budgetFailures, 2);
    assert.equal(atBoundary.qualityGate, true);
    assert.equal(atBoundary.qualityGateCriteria.budgetOvershootCountsAsFailure, true);
    await runReview({ receipts: saved, budgetFailures: 3 });
    assert.equal(JSON.parse(await readFile(resultFile, "utf8")).qualityGate, false);
    await runReview({ receipts: saved, critical: true });
    assert.equal(JSON.parse(await readFile(resultFile, "utf8")).qualityGate, false);
    await assert.rejects(runReview({ receipts: saved, reviewerType: "AUTOMATIC_HUMAN_SUCCESS" }), error => /Art der fachlichen Prüfung/.test(error.stderr));
  } finally {
    // Verify the exact temporary target before recursive cleanup on Windows.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("ergo-model-review-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("Responses proxy accepts Hermes GPT developer-role normalization without replacing host instructions", () => {
  const state = createResponsesProxyState();
  const expected = [{ role: "user", content: "Synthetic current contact preparation" }];
  for (const role of ["system", "developer"]) {
    assert.deepEqual(state.replay([{ role, content: "Transport copy of host instructions" }, ...expected], "gpt-5.6-luna"), expected);
  }
  assert.throws(() => state.replay([{ role: "unknown", content: "Unapproved role" }], "gpt-5.6-luna"), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED");
});

test("Responses proxy replays complete original output groups and opaque reasoning before grouped tool results", async () => {
  const state = createResponsesProxyState(), model = "synthetic-reasoning-model";
  const original = [{ type: "reasoning", id: "reasoning-one", encrypted_content: "synthetic-opaque-ä😀", summary: [] },
    { type: "message", id: "message-one", role: "assistant", phase: "commentary", status: "completed", content: [{ type: "output_text", text: "Ich prüfe Quellen.", annotations: [] }] },
    { type: "function_call", id: "function-one", call_id: "call-one", name: "get_contact", arguments: '{"contactId":"owned"}', status: "completed" },
    { type: "function_call", id: "function-two", call_id: "call-two", name: "get_contact_history", arguments: '{"contactId":"owned","offset":30}', status: "completed" }];
  let providerCalls = 0;
  const providerInputs = [];
  const provider = async input => { providerCalls++; providerInputs.push(input); return providerCalls === 1 ? original : [{ type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Aktueller Stand." }] }]; };
  const history = [{ role: "user", content: "Synthetic preparation" }];
  const first = await provider(state.replay(history, model)); state.remember(first, model);
  const chatReply = { role: "assistant", content: "Ich prüfe Quellen.", tool_calls: first.filter(item => item.type === "function_call").map(item => ({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } })) };
  assert.ok(!JSON.stringify(chatReply).includes("synthetic-opaque"));
  const continuation = [...history, chatReply, { role: "tool", tool_call_id: "call-one", content: '{"name":"Ben"}' }, { role: "tool", tool_call_id: "call-two", content: '{"activities":[]}' }];
  await provider(state.replay(continuation, model));
  assert.equal(providerCalls, 2);
  assert.equal(JSON.stringify(providerInputs[1].slice(1, 5)), JSON.stringify(original));
  assert.deepEqual(providerInputs[1].slice(5), [{ type: "function_call_output", call_id: "call-one", output: '{"name":"Ben"}' }, { type: "function_call_output", call_id: "call-two", output: '{"activities":[]}' }]);
  const next = [{ type: "reasoning", id: "reasoning-next", encrypted_content: "synthetic-next", summary: [] }, { type: "function_call", id: "function-next", call_id: "call-next", name: "get_contact", arguments: '{"contactId":"other-owned"}', status: "completed" }];
  state.remember(next, model);
  const extended = [...continuation, { role: "assistant", content: null, tool_calls: [{ id: "call-next", type: "function", function: { name: "get_contact", arguments: '{"contactId":"other-owned"}' } }] }, { role: "tool", tool_call_id: "call-next", content: "{}" }];
  const replayed = state.replay(extended, model);
  assert.deepEqual(replayed.slice(1, 5), original); assert.deepEqual(replayed.slice(7, 9), next);
});

test("Responses proxy rejects foreign IDs, changed args/model, missing results and bounds/reset its private state", () => {
  const model = "synthetic-reasoning-model", state = createResponsesProxyState();
  const output = [{ type: "reasoning", id: "reasoning", encrypted_content: "synthetic-private", summary: [] }, { type: "function_call", id: "function", call_id: "call", name: "get_contact", arguments: '{"contactId":"owned"}', status: "completed" }];
  state.remember(output, model);
  const messages = [{ role: "user", content: "Fixture" }, { role: "assistant", content: null, tool_calls: [{ id: "call", type: "function", function: { name: "get_contact", arguments: '{"contactId":"owned"}' } }] }, { role: "tool", tool_call_id: "call", content: "{}" }];
  const changed = input => assert.throws(() => state.replay(input, model), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED");
  const foreignId = structuredClone(messages); foreignId[1].tool_calls[0].id = "foreign-call"; changed(foreignId);
  const foreignResult = structuredClone(messages); foreignResult[2].tool_call_id = "foreign-result"; changed(foreignResult);
  const changedArgs = structuredClone(messages); changedArgs[1].tool_calls[0].function.arguments = '{"contactId":"different"}'; changed(changedArgs);
  changed(messages.slice(0, 2));
  assert.throws(() => state.replay(messages, "other-model"), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED");
  assert.throws(() => createResponsesProxyState().replay(messages, model), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED");
  output[0].encrypted_content = "mutated-source";
  assert.equal(state.replay(messages, model)[1].encrypted_content, "synthetic-private");
  state.replay([{ role: "user", content: "New initial request" }], model); changed(messages);
  const bounded = createResponsesProxyState();
  assert.throws(() => bounded.remember([{ type: "reasoning", encrypted_content: "x".repeat(256 * 1024) }, { type: "function_call", call_id: "large", name: "get_contact", arguments: "{}" }], model), error => error.code === "RESPONSES_PROXY_CONTEXT_LIMIT");
});

test("Responses proxy accepts semantically equivalent JSON arguments while replaying original private bytes", () => {
  const model = "synthetic-reasoning-model", state = createResponsesProxyState();
  const original = [{ type: "reasoning", id: "reasoning-json", encrypted_content: "synthetic-private-ä😀", summary: [] },
    { type: "function_call", id: "function-json-one", call_id: "json-one", name: "read_fixture", arguments: '{"note":"Grüße 😀","contactId":"owned","filter":{"enabled":true,"values":[1,"2",null]}}', status: "completed" },
    { type: "function_call", id: "function-json-two", call_id: "json-two", name: "get_contact_history", arguments: '{"offset":30,"contactId":"owned"}', status: "completed" }];
  state.remember(original, model);
  const messages = [{ role: "user", content: "Synthetic current task" }, { role: "assistant", content: null, tool_calls: [
    { id: "json-one", type: "function", function: { name: "read_fixture", arguments: String.raw`{ "filter": { "values": [1, "2", null], "enabled": true }, "contactId": "owned", "note": "Gr\u00fc\u00dfe \ud83d\ude00" }` } },
    { id: "json-two", type: "function", function: { name: "get_contact_history", arguments: '{ "contactId": "owned", "offset": 30 }' } },
  ] }, { role: "tool", tool_call_id: "json-one", content: "{}" }, { role: "tool", tool_call_id: "json-two", content: "[]" }];
  const replayed = state.replay(messages, model);
  assert.equal(JSON.stringify(replayed.slice(1, 4)), JSON.stringify(original));
  assert.equal(replayed[2].arguments, original[1].arguments);
  assert.deepEqual(replayed.slice(4), [{ type: "function_call_output", call_id: "json-one", output: "{}" }, { type: "function_call_output", call_id: "json-two", output: "[]" }]);
  assert.ok(!JSON.stringify(messages).includes("synthetic-private"));
  const next = [{ type: "reasoning", id: "reasoning-json-next", encrypted_content: "synthetic-private-next", summary: [] },
    { type: "function_call", call_id: "json-next", name: "read_fixture", arguments: '{"note":"ä","contactId":"owned"}' }];
  state.remember(next, model);
  const extended = [...messages, { role: "assistant", content: null, tool_calls: [{ id: "json-next", type: "function", function: { name: "read_fixture", arguments: String.raw`{"contactId":"owned","note":"\u00e4"}` } }] }, { role: "tool", tool_call_id: "json-next", content: "{}" }];
  assert.equal(JSON.stringify(state.replay(extended, model).slice(6, 8)), JSON.stringify(next));
});

test("Responses proxy semantic binding rejects changed values, array order, types, targets and malformed JSON", () => {
  const model = "synthetic-reasoning-model", state = createResponsesProxyState();
  const output = [{ type: "function_call", call_id: "strict-json", name: "read_fixture", arguments: '{"contactId":"owned","filter":{"enabled":true,"values":[1,"2",null]}}' }];
  state.remember(output, model);
  const messages = [{ role: "assistant", content: null, tool_calls: [{ id: "strict-json", type: "function", function: { name: "read_fixture", arguments: output[0].arguments } }] }, { role: "tool", tool_call_id: "strict-json", content: "{}" }];
  for (const args of [
    '{"contactId":"foreign","filter":{"enabled":true,"values":[1,"2",null]}}',
    '{"contactId":"owned","filter":{"enabled":true,"values":["1","2",null]}}',
    '{"contactId":"owned","filter":{"enabled":true,"values":["2",1,null]}}',
    '{"contactId":"owned","filter":{"enabled":false,"values":[1,"2",null]}}',
    '{"contactId":"owned","filter":{"enabled":true,"values":[1,"2",false]}}',
    '{"contactId":"owned","filter":{"enabled":true,"values":[1,"2",null]},"extra":null}',
    '{"contactId":"owned","filter":{"values":[1,"2",null]}}',
    '{"contactId":"owned",}', "null", "[]", undefined, null,
  ]) {
    const altered = structuredClone(messages); altered[0].tool_calls[0].function.arguments = args;
    assert.throws(() => state.replay(altered, model), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED", `Changed JSON argument accepted: ${String(args)}`);
  }
  assert.deepEqual(state.replay(messages, model).slice(0, 1), output);
  const invalid = createResponsesProxyState();
  assert.throws(() => invalid.remember([{ ...output[0], arguments: '{"contactId":' }], model), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED");
  invalid.remember(output, model);
  assert.deepEqual(invalid.replay(messages, model).slice(0, 1), output);
});

test("Responses proxy semantic binding retains call grouping, order, names and duplicate protections", () => {
  const model = "synthetic-reasoning-model", state = createResponsesProxyState();
  const first = [{ type: "function_call", call_id: "group-one", name: "get_contact", arguments: '{"contactId":"owned","include":true}' }, { type: "function_call", call_id: "group-two", name: "get_contact_history", arguments: '{"contactId":"owned","offset":30}' }];
  const second = [{ type: "function_call", call_id: "group-next", name: "get_contact", arguments: '{"contactId":"other-owned"}' }];
  state.remember(first, model); state.remember(second, model);
  const messages = [{ role: "assistant", content: null, tool_calls: first.map(item => ({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } })) }, { role: "tool", tool_call_id: "group-one", content: "{}" }, { role: "tool", tool_call_id: "group-two", content: "{}" }];
  const changed = input => assert.throws(() => state.replay(input, model), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED");
  const renamed = structuredClone(messages); renamed[0].tool_calls[0].function.name = "delete_contact"; changed(renamed);
  const reordered = structuredClone(messages); reordered[0].tool_calls.reverse(); changed(reordered);
  const duplicated = structuredClone(messages); duplicated[0].tool_calls[1] = structuredClone(duplicated[0].tool_calls[0]); changed(duplicated);
  const split = structuredClone(messages); split[0].tool_calls.pop(); changed(split);
  const mixed = structuredClone(messages); mixed[0].tool_calls[1] = { id: "group-next", type: "function", function: { name: second[0].name, arguments: second[0].arguments } }; changed(mixed);
  assert.throws(() => state.remember(first, model), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED");
  assert.throws(() => createResponsesProxyState().remember([first[0], first[0]], model), error => error.code === "RESPONSES_PROXY_CONTEXT_CHANGED");
  const bounded = createResponsesProxyState();
  for (let index = 0; index < 32; index++) bounded.remember([{ ...first[0], call_id: `bounded-${index}` }], model);
  assert.throws(() => bounded.remember([{ ...first[0], call_id: "bounded-overflow" }], model), error => error.code === "RESPONSES_PROXY_CONTEXT_LIMIT");
});
