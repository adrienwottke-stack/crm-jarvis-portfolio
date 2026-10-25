import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";
import { LIVE_STREAM_TYPE, readLiveTurn } from "../lib/ai-crm/live-progress.ts";

const fixture = await testDatabase();
const db = fixture.client;
process.env.AI_CRM_ENABLED = "true";
process.env.AI_LIVE_PROVIDER = "live";
globalThis.progressDb = db;
globalThis.progressEvents = [];
globalThis.progressModelCalls = 0;
globalThis.progressModel = async () => ({ output_text: "Deine Frage ist beantwortet.", output: [], usage: {} });
globalThis.progressClient = {
  live: { create: async () => ({ session: { id: "live_progress_fixture" }, transport: { type: "webrtc", sdp: "answer" } }) },
  responses: { create: async (...args) => { globalThis.progressModelCalls++; return globalThis.progressModel(...args); } },
};
const modules = {
  "@/lib/auth": "export async function requireUser(){return globalThis.progressUser}",
  "@/lib/prisma": "export const prisma=globalThis.progressDb",
  "@/lib/ai-crm/openai": "export function openAiClient(){return globalThis.progressClient}",
  "next/cache": "export function revalidatePath(){}",
  "openai/resources/live/sideband/ws": `export class SidebandWS { handlers={}; closed=false; on(k,f){(this.handlers[k]??=[]).push(f)} close(){this.closed=true} send(event){globalThis.progressEvents.push(event);queueMicrotask(()=>{if(!this.closed)for(const f of this.handlers.event??[])f({type:event.type==='session.close'?'session.closed':event.type==='session.instructions.append'?'session.instructions.appended':'session.commentary.appended',client_event_id:event.event_id})})} }`,
};
registerHooks({ resolve(specifier, context, next) { return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const start = await import("../app/api/ai-crm/live/session/route.ts");
const turn = await import("../app/api/ai-crm/live/session/[sessionId]/turn/route.ts");
const stop = await import("../app/api/ai-crm/live/session/[sessionId]/route.ts");
globalThis.progressUser = await db.user.create({ data: { name: "Progress Test", aiBetaEnabled: true } });
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });
const req = (body, stream = false, method = "POST") => new Request("https://crm.example.test/api/ai-crm/live/session", { method, headers: { origin: "https://crm.example.test", "Content-Type": "application/json", ...(stream ? { Accept: LIVE_STREAM_TYPE } : {}) }, body: JSON.stringify(body) });
const ctx = sessionId => ({ params: Promise.resolve({ sessionId }) });
async function waitUntil(check, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= end) throw new Error("Expected live speech event did not arrive.");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
async function session() { const response = await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\nprogress-fixture" })); const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data.session.id; }
after(async () => { delete process.env.AI_CRM_ENABLED; delete process.env.AI_LIVE_PROVIDER; delete process.env.AI_PROVIDER_TIMEOUT_MS; await fixture.close(); });

test("reported CM question persists its exact input and direct answer, with zero model/tool calls", async () => {
  const id = await session(), clientTurnId = randomUUID();
  const body = { clientTurnId, transcript: "Yo, ey, was kann ich mit CM machen? Hilf mir mal bitte mal ein bisschen dabei, was geht so?", revision: 1 };
  const phases = [], before = globalThis.progressModelCalls;
  const answer = await readLiveTurn(await turn.POST(req(body, true), ctx(id)), message => phases.push(message));
  assert.match(answer.answer, /Kontakte/); assert.equal(answer.audioDelivered, true);
  assert.equal(globalThis.progressModelCalls, before); assert.ok(phases.length >= 2);
  const messages = await db.aiConversationMessage.findMany({ where: { conversationId: answer.conversation.id }, orderBy: { createdAt: "asc" } });
  assert.equal(messages.length, 2); assert.equal(messages.find(row => row.role === "user").content, body.transcript);
  assert.equal(messages.find(row => row.role === "assistant").content, answer.answer);
  assert.equal(await db.aiToolExecution.count({ where: { requestId: answer.requestId } }), 0);
  const events = globalThis.progressEvents.length;
  const replay = await readLiveTurn(await turn.POST(req(body, true), ctx(id)), () => {});
  assert.equal(replay.answer, answer.answer); assert.equal(replay.audioDelivered, false); assert.equal(globalThis.progressEvents.length, events);
  await stop.DELETE(req({}, false, "DELETE"), ctx(id));
});

test("a slow backend emits progress before the result and receives the original question", async () => {
  const id = await session(); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  globalThis.progressModel = async body => { assert.equal(body.input.at(-1).content, "Was steht heute an?"); entered(); await hold; return { output_text: "Heute sind keine Einträge in diesem Test hinterlegt.", output: [], usage: {} }; };
  const phases = [];
  const result = readLiveTurn(await turn.POST(req({ clientTurnId: randomUUID(), transcript: "Was steht heute an?", revision: 1 }, true), ctx(id)), message => phases.push(message));
  await ready; assert.ok(phases.some(message => /angekommen/.test(message)));
  release(); assert.match((await result).answer, /Heute/);
  await stop.DELETE(req({}, false, "DELETE"), ctx(id));
});

test("a provider that never finishes exits the spinner and cannot save a late answer", async () => {
  process.env.AI_PROVIDER_TIMEOUT_MS = "1000";
  const id = await session(), clientTurnId = randomUUID(); let capturedSignal;
  globalThis.progressModel = async (_body, options) => { capturedSignal = options.signal; return new Promise(() => {}); };
  await assert.rejects(readLiveTurn(await turn.POST(req({ clientTurnId, transcript: "Lies meine heutigen Aufgaben", revision: 1 }, true), ctx(id)), () => {}), /zu lange/);
  assert.equal(capturedSignal.aborted, true);
  const request = await db.aiRequest.findUnique({ where: { userId_clientRequestId: { userId: globalThis.progressUser.id, clientRequestId: clientTurnId } } });
  assert.equal(request.status, "FAILED"); assert.equal(request.errorCode, "AI_PROVIDER_TIMEOUT");
  const liveSession = await db.aiLiveSession.findUnique({ where: { id } });
  assert.equal(await db.aiConversationMessage.count({ where: { conversationId: liveSession.conversationId } }), 0);
  assert.ok(globalThis.progressEvents.some(event => /Bearbeitung.*beendet/.test(event.content ?? "")));
  await stop.DELETE(req({}, false, "DELETE"), ctx(id)); delete process.env.AI_PROVIDER_TIMEOUT_MS;
});

test("empty model responses fail clearly instead of pretending to await a concrete question", async () => {
  const id = await session(); globalThis.progressModel = async () => ({ output_text: "", output: [], usage: {} });
  await assert.rejects(readLiveTurn(await turn.POST(req({ clientTurnId: randomUUID(), transcript: "Lies meine Aufgaben", revision: 1 }, true), ctx(id)), () => {}), /keine vollständige Antwort/);
  await stop.DELETE(req({}, false, "DELETE"), ctx(id));
});

test("a superseded request cannot persist or speak its old result", async () => {
  const id = await session(); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  globalThis.progressModel = async () => { entered(); await hold; return { output_text: "VERALTETE ANTWORT", output: [], usage: {} }; };
  const result = readLiveTurn(await turn.POST(req({ clientTurnId: randomUUID(), transcript: "Lies meine Aufgaben", revision: 1, delegationId: "old-delegation" }, true), ctx(id)), () => {});
  await ready;
  await db.aiLiveSession.update({ where: { id }, data: { revision: 2 } });
  release();
  assert.equal((await result).stale, true);
  assert.equal(globalThis.progressEvents.some(event => /VERALTETE ANTWORT/.test(event.content ?? "")), false);
  const liveSession = await db.aiLiveSession.findUnique({ where: { id } });
  assert.equal(await db.aiConversationMessage.count({ where: { conversationId: liveSession.conversationId } }), 0);
  await stop.DELETE(req({}, false, "DELETE"), ctx(id));
});

test("a long request emits one honest slow update to UI and the matching voice delegation", async () => {
  const id = await session(); let release;
  const hold = new Promise(resolve => { release = resolve; });
  globalThis.progressModel = async () => { await hold; return { output_text: "Jetzt ist die Antwort da.", output: [], usage: {} }; };
  const phases = [];
  const result = readLiveTurn(await turn.POST(req({ clientTurnId: randomUUID(), transcript: "Bereite meinen Tag vor", revision: 1, delegationId: "slow-delegation" }, true), ctx(id)), message => phases.push(message));
  await waitUntil(() => phases.some(message => /dauert gerade länger/.test(message)) && globalThis.progressEvents.some(event => event.delegation_id === "slow-delegation" && /(?:noch dran|noch einen Moment|Anfrage läuft weiter|noch kein fertiges Ergebnis)/.test(event.content ?? "")), 20000);
  assert.equal(phases.filter(message => /dauert gerade länger/.test(message)).length, 1);
  const slowEvents = globalThis.progressEvents.filter(event => event.delegation_id === "slow-delegation" && /(?:noch dran|noch einen Moment|Anfrage läuft weiter|noch kein fertiges Ergebnis)/.test(event.content ?? ""));
  assert.equal(slowEvents.length, 1);
  assert.equal(slowEvents[0].type, "session.commentary.append", "updates go to the actual Live speech channel");
  assert.doesNotMatch(slowEvents[0].content, /Status zur laufenden|Fachresultat|Backend/);
  release(); assert.match((await result).answer, /Jetzt/);
  await stop.DELETE(req({}, false, "DELETE"), ctx(id));
});

test("real tool phases reach the voice channel before the final backend answer", async () => {
  const id = await session(); let release, modelCalls = 0;
  const hold = new Promise(resolve => { release = resolve; });
  globalThis.progressModel = async () => {
    if (++modelCalls === 1) return { output_text: "", output: [{ type: "function_call", call_id: randomUUID(), name: "get_daily_overview", arguments: JSON.stringify({ day: "2026-09-26" }) }], usage: {} };
    await hold; return { output_text: "Der Überblick ist fertig.", output: [], usage: {} };
  };
  const phases = [];
  const result = readLiveTurn(await turn.POST(req({ clientTurnId: randomUUID(), transcript: "Was steht heute an?", revision: 1, delegationId: "phase-delegation" }, true), ctx(id)), message => phases.push(message));
  await waitUntil(() => globalThis.progressEvents.some(event => event.delegation_id === "phase-delegation" && /Abfrage ist zurück|Rückmeldung ist da/.test(event.content ?? "")));
  assert.ok(phases.some(message => /CRM-Einträge/.test(message)));
  assert.ok(phases.some(message => /Abfrage ist zurück/.test(message)));
  const voice = globalThis.progressEvents.filter(event => event.delegation_id === "phase-delegation");
  assert.ok(voice.some(event => event.type === "session.commentary.append" && /Abfrage ist zurück|Rückmeldung ist da/.test(event.content)), "a real phase is spoken while the final answer is still pending");
  release(); assert.equal((await result).answer, "Der Überblick ist fertig.");
  await stop.DELETE(req({}, false, "DELETE"), ctx(id));
});
