import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { testDatabase } from "./test-db.mjs";
import { createEvaluationFixture, changeContactBeforeRemainingConfirmation, createEvaluationProtocolPreview, evaluationFixtureReceipts } from "./jarvis-evaluation-fixtures.mjs";
import { createResponsesProxyState } from "./responses-proxy-state.mjs";
import { reportedUsageDiagnostic, meterDiagnostic, evaluationCostSummary, safeHermesRuntimeDiagnostic } from "./jarvis-evaluation-metering.mjs";
import { prepareEvaluationCall } from "./evaluation-budget.mjs";
import { installEvaluationAdapter } from "./jarvis-evaluation-adapter.mjs";

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const model = option("--model", "gpt-5.6-luna");
const provider = option("--provider", model.startsWith("claude-") ? "anthropic" : "openai");
const runtime = option("--runtime", "jarvis");
const scope = option("--scope", "READ_ONLY");
const dry = args.includes("--dry-run");
const seed = option("--seed", "crm-contact-2026-10-05");
if (!["openai", "anthropic"].includes(provider) || !["jarvis", "hermes"].includes(runtime) || !["READ_ONLY", "ISOLATED_WRITE"].includes(scope)) throw new Error("Ungültiger Vergleichsmodus.");
// Only provider keys may be loaded; testDatabase never reads an external DB URL.
const env = (await import("@next/env")).default;
env.loadEnvConfig(process.cwd());
const key = process.env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"];
const fixture = await testDatabase(); const db = fixture.client;
// Even legacy domain actions must stay in this fixture and share its transaction.
process.env.DATABASE_URL = fixture.url; process.env.DIRECT_URL = fixture.url;
await installEvaluationAdapter(db, () => globalThis.evaluationActor);
const { createCrmModelClient } = await import("../lib/ai-crm/model-client.ts");
const { beginProviderAttempt, meterProviderResponse, meterProviderFailure, maximumTextCallCostMicros, priceReportedTokens, PRICING_VERSION } = await import("../lib/ai-crm/provider-metering.ts");
const { runUxCrmAgent, buildUxAgentInstructions, readResult } = await import("../lib/ai-crm/ux-agent.ts");
const { assembleAgentContext } = await import("../lib/ai-crm/context.ts");
const { CRM_TOOL_DEFINITIONS, WRITE_TOOLS, runCrmTool } = await import("../lib/ai-crm/tools.ts");
const { PROPOSAL_TOOL_DEFINITIONS } = await import("../lib/ai-crm/proposal-tools.ts");
const { stageAction, executeActionPlan, actionReceipts, resolveAssistantContext, pendingProposalList, cancelActionPlans, reviseActionPlan, recordFailedAction } = await import("../lib/ai-crm/action-plans.ts");
const { reserveAiToolCall } = await import("../lib/ai-crm/entitlement.ts");
const { AiCrmError } = await import("../lib/ai-crm/errors.ts");
const { reviseProposalInput } = await import("../lib/ai-crm/proposal-tools.ts");
const { captureExecutionPolicy, setExecutionMode } = await import("../lib/ai-crm/execution-policy.ts");
const { safeAiMessage } = await import("../lib/ai-crm/errors.ts");
const { hashAiRequestInput, claimAiRequest } = await import("../lib/ai-crm/requests.ts");
const { requestView } = await import("../lib/ai-crm/presentation.ts");
const { answerWithReceipts } = await import("../lib/ai-crm/receipt-answer.ts");
const { assertContactTaskScope } = await import("../lib/ai-crm/contact-task-scope.ts");
const { serializeCrmModelData } = await import("../lib/ai-crm/model-data.ts");
const output = resolve(option("--output", `test-results/model-comparison/${runtime}-${model}-${scope.toLowerCase()}${dry ? "-dry" : ""}.json`));
await mkdir(resolve(output, ".."), { recursive: true });
const suite = JSON.parse(await readFile(new URL("../docs/jarvis-evaluation-2026-10-05.json", import.meta.url), "utf8"));
const budgets = { durationMs: suite.budgets.maxWallTimeMs, tokens: suite.budgets.maxTotalTokens, toolCalls: suite.budgets.maxToolCalls, maxToolRounds: suite.budgets.maxToolRounds, maxOutputTokensPerRound: suite.budgets.maxOutputTokensPerRound };
const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
let randomState = Number.parseInt(hash(seed).slice(0, 8), 16);
const cases = [...suite.cases];
for (let index = cases.length - 1; index > 0; index--) {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  const picked = randomState % (index + 1); [cases[index], cases[picked]] = [cases[picked], cases[index]];
}
const contactNames = new Set(["search_contacts", "get_contact", "get_contact_task_context", "get_contact_history", "get_contact_follow_ups", "get_daily_overview", "get_upcoming_follow_ups", "create_contact", "update_contact", "add_note", "add_activity", "create_follow_up", "complete_follow_up", "discover_crm_functions", "read_crm_data", "execute_crm_operation", "get_crm_help"]);
const allTools = CRM_TOOL_DEFINITIONS.filter(tool => contactNames.has(tool.name));
const metadata = { id: randomUUID(), model, provider, runtime, scope, seed, caseOrder: cases.map(item => item.id), fixtureHash: hash([suite, seed, await readFile(new URL("./jarvis-evaluation-fixtures.mjs", import.meta.url), "utf8")]),
  toolsetHash: hash([allTools, PROPOSAL_TOOL_DEFINITIONS]), contextHash: hash(await Promise.all(["task-context", "context", "memory", "prompt"].map(name => readFile(new URL(`../lib/ai-crm/${name}.ts`, import.meta.url), "utf8")))),
  memoryHash: hash([]), promptHash: hash(buildUxAgentInstructions.toString()), budgets, pricingVersion: PRICING_VERSION,
  evidence: dry ? "SCRIPTED_WIRING_ONLY" : "REAL_PROVIDER_SYNTHETIC_DATA", qualityStatus: "NOT_REVIEWED", rows: [], transcripts: [] };
if (!dry && !key) {
  await writeFile(output, JSON.stringify({ ...metadata, status: "BLOCKED_PROVIDER_NOT_CONFIGURED", requiredVariable: provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY" }, null, 2));
  console.log(JSON.stringify({ status: "BLOCKED_PROVIDER_NOT_CONFIGURED", output })); process.exitCode = 2;
  await fixture.close();
} else {
  process.env.AI_CRM_ENABLED = "true"; process.env.AI_CRM_EXECUTION_MODES = "true";
  process.env.AI_PROVIDER_MAX_RETRIES = "0"; // same retry budget for both runtimes
  const maxCostMicros = Math.round(Number(option("--max-cost-usd", "2")) * 1_000_000);
  if (!Number.isSafeInteger(maxCostMicros) || maxCostMicros <= 0) throw new Error("Positives Ausgabenbudget erforderlich.");
  let spent = 0;
  const baseClient = dry ? { responses: { async create() { return { output: [], output_text: "Lokale Verbindung und Fixture geprüft; keine fachliche Modellbewertung.", usage: { input_tokens: 0, output_tokens: 0 } }; } } } : createCrmModelClient(provider, key);
  const toolsFor = s => [...allTools.filter(tool => s.mode !== "READ_ONLY" || !WRITE_TOOLS.has(tool.name)), ...PROPOSAL_TOOL_DEFINITIONS.filter(tool => s.mode !== "READ_ONLY" || tool.name === "read_pending_proposals")];
  try {
    await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI Vergleich", state: "TEST" }, update: { state: "TEST" } });
    for (const item of cases) {
      // Worst next request at the selected verified tariff cannot silently exceed cap.
      if (spent >= maxCostMicros) { metadata.stopReason = "SPEND_BUDGET"; break; }
      const s = await createEvaluationFixture(db, item, scope);
      globalThis.evaluationActor = s.user.id;
      const start = Date.now(); let response, errorCode = null, errorMessage = null, runtimeDiagnostic = null;
      const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), budgets.durationMs);
      const initialCounts = { activities: await db.activity.count(), followUps: await db.contactFollowUp.count() };
      let prepared, actualPrompt = item.prompt;
      const phases = [];
      const providerAttemptDiagnostics = [];
      const tokenCountDiagnostics = [];
      const finishLastMeterDiagnostic = async () => {
        const last = providerAttemptDiagnostics.at(-1);
        if (last && !last.meterAfter) last.meterAfter = meterDiagnostic(await db.aiUsage.findUniqueOrThrow({ where: { id: s.usage.id } }));
      };
      const phase = async (kind, extra = {}) => phases.push({ kind, ...extra, ...(s.protocolPreview ? { proposalRequestId: s.protocolPreview.requestId, currentRequestId: s.request.id } : {}), receipts: await evaluationFixtureReceipts(db, s),
        counts: { activities: await db.activity.count(), followUps: await db.contactFollowUp.count() } });
      try {
        if (s.context) await resolveAssistantContext(db, s.user.id, s.context);
        await captureExecutionPolicy(db, s.user.id, s.request.id, s.conversation.id);
        if (scope === "ISOLATED_WRITE" && ["post-08", "post-09"].includes(item.id)) {
          await createEvaluationProtocolPreview(db, s);
          await phase("INITIAL_UNCONFIRMED_PREVIEW", { mode: s.mode, origin: "SERVER_PROTOCOL_FIXTURE" });
          if (item.id === "post-09") { await setExecutionMode(db, { userId: s.user.id, conversationId: s.conversation.id, mode: "READ_ONLY", version: 0 }); s.mode = "READ_ONLY"; await phase("MODE_DOWNGRADED", { mode: s.mode }); }
        }
        prepared = await assembleAgentContext({ db, userId: s.user.id, conversationId: s.conversation.id, context: s.context, now: s.now });
        const message = item.id === "post-10" && scope === "ISOLATED_WRITE" ? "Ben Beispiel hat heute Unterlagen besprochen. Dokumentiere genau ein Telefonat und eine Wiedervorlage für morgen um 10 Uhr. Keine zusätzliche Notiz." : item.prompt;
        actualPrompt = message;
        const beforeProviderAttempt = async input => {
          if (dry) return;
          await finishLastMeterDiagnostic();
          const metered = await db.aiUsage.findUniqueOrThrow({ where: { id: s.usage.id } });
          if (metered.providerAttempts && !metered.meteringComplete) throw Object.assign(new Error("Anbieterkosten unbekannt"), { code: "UNKNOWN_BILLED_COST" });
          const payload = { ...input, tools: toolsFor(s) };
          const tokenReservation = await prepareEvaluationCall({ input: payload, usedTokens: metered.inputTokens + metered.outputTokens,
            maxTotalTokens: budgets.tokens, countInputTokens: baseClient.responses.countInputTokens?.bind(baseClient.responses), signal: abort.signal });
          input.max_output_tokens = payload.max_output_tokens;
          tokenCountDiagnostics.push(tokenReservation);
          const requestBytes = baseClient.responses.requestBytes?.(payload) ?? Buffer.byteLength(JSON.stringify(payload), "utf8");
          const allowance = maximumTextCallCostMicros(model, requestBytes, payload.max_output_tokens ?? budgets.maxOutputTokensPerRound);
          if (allowance === null || spent + (metered.pricedCostMicros ?? 0) + allowance > maxCostMicros) throw Object.assign(new Error("Konservatives Ausgabenbudget erreicht"), { code: "SPEND_BUDGET" });
        };
        const client = { responses: { async create(input, options) {
          const diagnostic = dry ? null : { model, meterBefore: meterDiagnostic(await db.aiUsage.findUniqueOrThrow({ where: { id: s.usage.id } })), toolResults: (Array.isArray(input.input) ? input.input : []).filter(item => item.type === "function_call_output").map(item => ({ callId: item.call_id, output: item.output })) };
          if (diagnostic) providerAttemptDiagnostics.push(diagnostic);
          const result = await baseClient.responses.create({ ...input, tools: toolsFor(s) }, options);
          if (diagnostic) { diagnostic.responseModel = typeof result.model === "string" && /^[a-zA-Z0-9_.-]{1,120}$/.test(result.model) ? result.model : null; diagnostic.reportedUsage = reportedUsageDiagnostic(result.usage); diagnostic.responsePriceMicros = priceReportedTokens(model, result.usage); diagnostic.functionCalls = result.output.filter(item => item.type === "function_call").map(item => ({ callId: item.call_id, name: item.name, arguments: item.arguments })); }
          return result;
        } } };
        if (runtime === "jarvis") response = await runUxCrmAgent({ client, db, userId: s.user.id, usageId: s.usage.id, requestId: s.request.id, sessionId: s.conversation.id, message,
          history: [...prepared.messages, ...s.history], context: s.context, now: s.now, preparedContext: prepared, model, budgets, beforeProviderAttempt, signal: abort.signal });
        else response = await hermesRun(s, { ...item, prompt: message }, prepared, client, db, abort.signal, toolsFor(s), beforeProviderAttempt);
        if (s.protocolPreview) {
          response.actions = await evaluationFixtureReceipts(db, s);
          response.answer = answerWithReceipts(response.answer, response.actions);
        }
        await phase("MODEL_RESPONSE", { prompt: message, answer: response.answer, mode: s.mode });
        if (scope === "ISOLATED_WRITE" && ["post-02", "post-07"].includes(item.id)) {
          const pending = await db.aiToolExecution.findMany({ where: { requestId: s.request.id, status: "PENDING" } });
          await db.aiRequest.update({ where: { id: s.request.id }, data: { status: "COMPLETED" } });
          const permitted = pending.filter(plan => item.id === "post-07" || plan.tool === "add_activity");
          for (const plan of permitted) await executeActionPlan(db, { userId: s.user.id, requestId: s.request.id, actionIds: [plan.id] });
          await phase("USER_CONFIRMED_PERMITTED_ACTIONS", { actionIds: permitted.map(plan => plan.id) });
          response.actions = await actionReceipts(db, s.user.id, s.request.id);
          response.answer = answerWithReceipts(response.answer, response.actions);
        }
        // Run specified interaction protocol against the very same durable plans.
        if (scope === "ISOLATED_WRITE" && item.id === "post-08") {
          const original = s.protocolPreview;
          await executeActionPlan(db, { userId: s.user.id, requestId: original.requestId, actionIds: [original.callId] });
          await phase("PARTIAL_USER_CONFIRMATION", { actionIds: [original.callId], origin: "SERVER_PROTOCOL_FIXTURE" });
          const contactChange = await changeContactBeforeRemainingConfirmation(db, s);
          await phase("CONTACT_CHANGED_BEFORE_REMAINING_CONFIRMATION", contactChange);
          await executeActionPlan(db, { userId: s.user.id, requestId: original.requestId, actionIds: [original.followUpId] });
          await phase("REMAINING_CONFIRMATION_ATTEMPT", { actionIds: [original.followUpId], origin: "SERVER_PROTOCOL_FIXTURE" });
          response.actions = await evaluationFixtureReceipts(db, s);
          response.answer = answerWithReceipts(response.answer, response.actions);
        }
        if (scope === "ISOLATED_WRITE" && item.id === "post-09") {
          await cancelActionPlans(db, s.user.id, s.protocolPreview.requestId);
          await phase("USER_CANCELLED_PREVIEWS", { origin: "SERVER_PROTOCOL_FIXTURE" });
          response.actions = await evaluationFixtureReceipts(db, s);
          response.answer = answerWithReceipts(response.answer, response.actions);
        }
        if (item.id === "post-10" && response) {
          await db.aiRequest.update({ where: { id: s.request.id }, data: { status: "COMPLETED", response } });
          await phase("DURABLE_RESPONSE_BEFORE_SIMULATED_DISCONNECT", { answer: response.answer });
          const replay = await claimAiRequest(db, { userId: s.user.id, clientRequestId: s.request.clientRequestId, kind: "CHAT", inputHash: s.request.inputHash, now: new Date(), expiresAt: s.request.expiresAt, staleAfterMs: 105_000 });
          if (replay.kind === "REPLAY") { const recovered = await requestView(db, s.user.id, s.request.clientRequestId); response = { ...recovered.response, actions: recovered.actions, results: recovered.response?.results ?? [] }; await phase("SERVER_REPLAY_WITHOUT_SECOND_MODEL_CALL", { recoveryPrompt: item.prompt, answer: response.answer }); }
        }
      } catch (error) { errorCode = error.code ?? error.name; errorMessage = safeAiMessage(error); runtimeDiagnostic = safeHermesRuntimeDiagnostic(error.runtimeDiagnostic); }
      finally { clearTimeout(timer); }
      await db.aiUsage.update({ where: { id: s.usage.id }, data: { provider, status: errorCode ? "FAILED" : "SUCCEEDED", errorCode, durationMs: Date.now() - start } });
      await db.aiRequest.update({ where: { id: s.request.id }, data: { status: errorCode ? "FAILED" : "COMPLETED", errorCode, finishedAt: new Date(), ...(response ? { response } : {}) } });
      const usage = await db.aiUsage.findUniqueOrThrow({ where: { id: s.usage.id } });
      await finishLastMeterDiagnostic();
      const calls = await db.aiToolExecution.findMany({ where: { requestId: s.request.id } });
      const counts = { activities: await db.activity.count(), followUps: await db.contactFollowUp.count() };
      const noProvider = usage.providerAttempts === 0;
      const cost = dry ? null : noProvider ? 0 : usage.meteringComplete ? usage.pricedCostMicros : null;
      if (cost !== null) spent += cost;
      // An unknown failed billable attempt ends further paid calls under the cap.
      if (!dry && !noProvider && cost === null) metadata.stopReason = "UNKNOWN_BILLED_COST";
      const critical = [];
      if ((s.mode === "READ_ONLY" || ["prep-07", "post-06"].includes(item.id)) && (counts.activities !== initialCounts.activities || counts.followUps !== initialCounts.followUps || calls.some(call => call.status === "COMPLETED"))) critical.push("unwanted or unauthorized mutation");
      const expectedDenied = ["prep-07", "post-06"].includes(item.id) && ["CONTEXT_NOT_FOUND", "CONTACT_NOT_FOUND"].includes(errorCode);
      metadata.rows.push({ caseId: item.id, correctReaction: expectedDenied, completedTask: false, criticalErrors: critical,
        totalDurationMs: Date.now() - start, totalTokens: usage.inputTokens + usage.outputTokens, totalToolCalls: usage.toolCalls,
        totalCostUsd: cost === null ? null : cost / 1_000_000, providerAttempts: usage.providerAttempts, providerAttemptDiagnostics, tokenCountDiagnostics, errorCode, reviewed: expectedDenied });
      metadata.transcripts.push({ caseId: item.id, prompt: actualPrompt, protocolPrompt: item.prompt, phases, mode: s.mode, expectedReaction: scope === "READ_ONLY" && item.task === "postprocessing" ? `Lesemodus: Personen/Quellen/fehlende Angaben korrekt prüfen oder klären. Keine Vorschau und kein Speichern. Ursprünglicher Schreibfall: ${item.expectedReaction}` : item.expectedReaction, history: s.history, context: s.context,
        answer: response?.answer ?? null, receipts: await evaluationFixtureReceipts(db, s), results: response?.results ?? [],
        errorCode, errorMessage, ...(runtimeDiagnostic ? { runtimeDiagnostic } : {}), before: initialCounts, after: counts, initialContext: prepared?.currentContact ?? null, runtimeCommit: response?.runtimeCommit ?? null });
      if (["SPEND_BUDGET", "UNKNOWN_BILLED_COST"].includes(errorCode)) metadata.stopReason = errorCode;
      await writeFile(output, JSON.stringify({ ...metadata, status: "IN_PROGRESS", ...evaluationCostSummary(metadata.rows, { dry }) }, null, 2));
      console.log(JSON.stringify({ case: item.id, runtime, attempts: usage.providerAttempts, errorCode, quality: "REVIEW_REQUIRED" }));
      if (metadata.stopReason) break;
    }
    metadata.transcriptHash = hash(metadata.transcripts);
    const status = dry ? "DRY_RUN_COMPLETE" : metadata.rows.length === 20 ? "EXECUTED_REVIEW_REQUIRED" : "INCOMPLETE";
    await writeFile(output, JSON.stringify({ ...metadata, status, ...evaluationCostSummary(metadata.rows, { dry }) }, null, 2));
    console.log(JSON.stringify({ status, cases: metadata.rows.length, output }));
  } finally { await fixture.close(); }
}

async function hermesRun(s, item, preparedContext, client, db, signal, tools, beforeProviderAttempt) {
  const token = randomUUID(); let calls = 0, lastErrorCode = null;
  const responseState = createResponsesProxyState();
  const known = new Set(s.context ? [s.context.contactId] : []);
  const ambiguous = new Set(), entities = new Set(), partners = new Set(), followUps = new Set(s.context?.followUpId ? [s.context.followUpId] : []);
  const preparedFollowUps = preparedContext.currentContact?.followUps ?? [];
  if (preparedFollowUps.length === 1) followUps.add(preparedFollowUps[0].id);
  const results = [...preparedContext.results]; let currentProposals = [];
  const instructions = buildUxAgentInstructions({ now: s.now, context: s.context, preparedContext }, s.mode, preparedContext.currentContact);
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
      signal.throwIfAborted();
      const request = await db.aiRequest.findFirst({ where: { id: s.request.id, userId: s.user.id, status: "IN_PROGRESS" } });
      if (!request) throw new Error("REQUEST_ABORTED");
      let raw = ""; for await (const part of req) { raw += part; if (raw.length > 1_000_000) throw new Error("PAYLOAD_LIMIT"); }
      const body = JSON.parse(raw);
      let data;
      if (req.url === "/v1/chat/completions") {
        const input = { model, instructions, input: responseState.replay(body.messages, model), tools, tool_choice: "auto", parallel_tool_calls: false, max_output_tokens: budgets.maxOutputTokensPerRound, store: false };
        await beforeProviderAttempt(input);
        await beginProviderAttempt(db, s.usage.id, model);
        let result;
        try { result = await client.responses.create(input, { signal });
          await meterProviderResponse(db, s.usage.id, model, result.usage);
        } catch (error) { await meterProviderFailure(db, s.usage.id); throw error; }
        responseState.remember(result.output, model);
        const usage = await db.aiUsage.findUniqueOrThrow({ where: { id: s.usage.id } });
        if (usage.inputTokens + usage.outputTokens > budgets.tokens) throw new Error("AI_EVALUATION_BUDGET");
        const tool_calls = result.output.filter(row => row.type === "function_call").map(row => ({ id: row.call_id, type: "function", function: { name: row.name, arguments: row.arguments } }));
        data = { id: randomUUID(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, message: { role: "assistant", content: result.output_text || null, ...(tool_calls.length ? { tool_calls } : {}) }, finish_reason: tool_calls.length ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: result.usage?.input_tokens ?? 0, completion_tokens: result.usage?.output_tokens ?? 0, total_tokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) } };
      } else if (req.url === "/crm-tool") {
        if (++calls > budgets.toolCalls || !tools.some(tool => tool.name === body.name)) throw new Error("AI_EVALUATION_BUDGET");
        await reserveAiToolCall(db, s.usage.id, s.user.id, s.now);
        const args = body.args;
        try {
        if (s.context) await resolveAssistantContext(db, s.user.id, s.context);
        await assertContactTaskScope(db, { userId: s.user.id, message: item.prompt, selectedContact: preparedContext.currentContact?.contact, toolName: body.name, arguments: args });
        if (body.name === "read_pending_proposals") {
          currentProposals = await pendingProposalList(db, s.user.id, s.conversation.id);
          data = { proposals: currentProposals, state: "UNCONFIRMED_DRAFTS", note: "Nur die aktuellste offene Gruppe, Positionsnummern gelten für diesen Stand." };
        }
        else if (body.name === "revise_pending_proposal") {
          if (await captureExecutionPolicy(db, s.user.id, s.request.id, s.conversation.id) === "READ_ONLY") throw new Error("EXECUTION_MODE_BLOCKED");
          const parsed = reviseProposalInput.parse(args);
          const proposal = currentProposals.find(row => row.id === parsed.actionId);
          if (!proposal?.revision || !proposal.requestId) throw new Error("PLAN_STALE");
          await reviseActionPlan(db, { userId: s.user.id, requestId: proposal.requestId, actionId: parsed.actionId, revision: proposal.revision,
            values: Object.fromEntries(parsed.changes.map(change => [change.field, change.value])), destinationRequestId: s.request.id });
          currentProposals = [];
          data = { status: "PENDING_CONFIRMATION", message: "Überarbeitete Vorschau; keine CRM-Änderung gespeichert." };
        }
        else if (WRITE_TOOLS.has(body.name)) {
          const actualMode = await captureExecutionPolicy(db, s.user.id, s.request.id, s.conversation.id);
          if (actualMode === "READ_ONLY") throw new Error("EXECUTION_MODE_BLOCKED");
          if (body.name === "execute_crm_operation") for (const field of Array.isArray(args.fields) ? args.fields : []) {
            if (field.name === "contactId" && ambiguous.has(field.value) && s.context?.contactId !== field.value) throw new AiCrmError("CONTACT_CLARIFICATION", "Bitte wähle zuerst den eindeutigen Kontakt.");
            const ids = field.name === "ids" ? field.value.split(",").map(id => id.trim()) : /Id$|^id$/.test(field.name) ? [field.value] : [];
            for (const id of ids.filter(Boolean)) if (id !== s.user.id && !entities.has(id) && !known.has(id) && !partners.has(id) && !followUps.has(id)) throw new AiCrmError("ENTITY_CLARIFICATION", "Bitte lade zuerst den konkreten Eintrag für diesen Auftrag.");
          }
          if (args.contactId && (!known.has(String(args.contactId)) || ambiguous.has(String(args.contactId)) && s.context?.contactId !== args.contactId)) throw new AiCrmError("CONTACT_CLARIFICATION", "Bitte wähle zuerst den eindeutigen Kontakt.");
          if (args.followUpId && !followUps.has(String(args.followUpId))) throw new AiCrmError("FOLLOW_UP_CLARIFICATION", "Bitte wähle zuerst die konkrete Wiedervorlage.");
          if (args.partnerId && !partners.has(String(args.partnerId))) throw new AiCrmError("PARTNER_CLARIFICATION", "Bitte wähle zuerst den eindeutigen Partner.");
          const staged = await stageAction(db, { userId: s.user.id, requestId: s.request.id, name: body.name, arguments: args, key: `${s.request.id}:plan:${hashAiRequestInput({ name: body.name, args })}` });
          if (actualMode === "AUTONOMOUS") {
            const receipts = await executeActionPlan(db, { userId: s.user.id, requestId: s.request.id, actionIds: [staged.id], direct: true });
            const receipt = receipts.find(row => row.id === staged.id);
            if (receipt?.status === "COMPLETED" && receipt.entityType === "Contact" && receipt.entityId) known.add(receipt.entityId);
            if (receipt?.entityId) entities.add(receipt.entityId);
            data = { ok: receipt?.status === "COMPLETED", status: receipt?.status, receipt };
          } else {
            const contactReference = body.name === "create_contact" ? `pending:${staged.id}` : undefined;
            if (contactReference) known.add(contactReference);
            data = { ok: true, status: "PENDING_CONFIRMATION", contactReference, message: "Vorschau vorbereitet; noch nichts gespeichert." };
          }
        } else {
          data = await runCrmTool(db, { userId: s.user.id, requestId: s.request.id, sessionId: s.conversation.id, name: body.name, arguments: args, now: s.now });
          if (body.name === "read_crm_data" && Array.isArray(data.data.sourceIds)) for (const id of data.data.sourceIds) if (typeof id === "string") entities.add(id);
          const view = readResult(body.name, data, randomUUID()); results.push(view);
          for (const row of view.items) {
            entities.add(row.id);
            if (row.context?.contactId) { known.add(row.context.contactId); if (view.ambiguous) ambiguous.add(row.context.contactId); }
            if (row.context?.partnerId) partners.add(row.context.partnerId);
          }
          if (["get_contact_follow_ups", "get_contact_task_context"].includes(body.name) && data.data.followUps?.length === 1) followUps.add(String(data.data.followUps[0].id));
        }
        } catch (error) {
          if (WRITE_TOOLS.has(body.name)) await recordFailedAction(db, { userId: s.user.id, requestId: s.request.id, name: body.name, key: `${s.request.id}:failed:${calls}`, error });
          data = { ok: false, error: safeAiMessage(error) };
        }
      } else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(serializeCrmModelData(data));
    } catch (error) { lastErrorCode = error.code ?? error.message; res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: safeAiMessage(error), code: lastErrorCode } })); }
  });
  await new Promise(resolveListening => server.listen(0, "127.0.0.1", resolveListening));
  const port = server.address().port;
  const child = spawn(resolve(option("--hermes-python", ".cache/hermes-evaluation-venv/Scripts/python.exe")), [resolve("scripts/hermes-evaluation-worker.py")], {
    cwd: process.cwd(), windowsHide: true, env: { ...process.env, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", HERMES_HOME: resolve(".cache/hermes-evaluation-home"), PYTHONPATH: resolve(".cache/hermes-evaluation-source") }, stdio: ["pipe", "pipe", "pipe"],
  });
  let text = "";
  child.stdout.on("data", data => { text += data; }); child.stderr.resume();
  const stop = () => child.kill(); signal.addEventListener("abort", stop, { once: true });
  child.stdin.end(JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, token, model, instructions, history: [...preparedContext.messages, ...s.history], message: item.prompt, tools, budgets }));
  try {
    const exit = await new Promise((done, reject) => { child.on("exit", done); child.on("error", reject); });
    let result;
    try { result = JSON.parse(text.trim()); } catch { result = null; }
    const runtimeDiagnostic = safeHermesRuntimeDiagnostic(result?.failureDiagnostic);
    const workerErrorCode = typeof result?.errorCode === "string" && /^HERMES_[A-Z_]{1,80}$/.test(result.errorCode) ? result.errorCode : "HERMES_WORKER_FAILED";
    if (exit !== 0) throw Object.assign(new Error("Isolierter Hermes-Worker fehlgeschlagen."), { code: lastErrorCode ?? workerErrorCode, runtimeDiagnostic });
    if (!result) throw Object.assign(new Error("Ungültiges Hermes-Protokoll."), { code: "HERMES_PROTOCOL_INVALID" });
    if (result.errorCode) throw Object.assign(new Error("Hermes-Worker meldet einen Fehler."), { code: lastErrorCode ?? result.errorCode, runtimeDiagnostic });
    const deletedByThisRequest = async contactId => {
      if (!contactId || await db.contact.findUnique({ where: { id: contactId }, select: { id: true } })) return false;
      const completed = await db.aiToolExecution.findMany({ where: { userId: s.user.id, requestId: s.request.id, status: "COMPLETED" }, select: { result: true } });
      return completed.some(execution => {
        const plan = execution.result?.plan;
        return plan?.name === "execute_crm_operation" && plan.args?.operation === "delete_contact" && plan.args.fields?.some(field => field.name === "contactId" && field.value === contactId);
      });
    };
    for (const view of results) {
      const current = [];
      for (const row of view.items) {
        if (row.context) {
          const accessible = await resolveAssistantContext(db, s.user.id, row.context).then(() => true).catch(() => false);
          if (!accessible) {
            if (await deletedByThisRequest(row.context.contactId)) continue;
            throw new AiCrmError("CONTEXT_NOT_FOUND", "Der Kontakt oder Quellenzugriff hat sich während der Anfrage geändert. Bitte wähle den aktuellen Bezug erneut.", 409);
          }
        }
        current.push(row);
      }
      view.items = current;
    }
    if (s.context && !await deletedByThisRequest(s.context.contactId)) await resolveAssistantContext(db, s.user.id, s.context);
    const actions = await actionReceipts(db, s.user.id, s.request.id);
    return { answer: answerWithReceipts(result.answer, actions), actions, results, runtimeCommit: result.runtimeCommit };
  } finally { signal.removeEventListener("abort", stop); await new Promise(resolveClosed => server.close(resolveClosed)); }
}
