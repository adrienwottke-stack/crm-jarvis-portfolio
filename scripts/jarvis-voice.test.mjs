import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
globalThis.jarvisVoiceDb = fixture.client;
process.env.AI_CRM_ENABLED = "true";
process.env.AI_LIVE_PROVIDER = "live";
process.env.JARVIS_DEMO_ENABLED = "true";
let creates = 0, speeches = 0, backendCalls = 0;
globalThis.jarvisVoiceEvents = [];
globalThis.jarvisVoiceClient = {
  live: { create: async body => { creates++; globalThis.jarvisVoiceCreated = body; return { session: { id: `live_test_${creates}` }, transport: { type: "webrtc", sdp: "test-answer" } }; } },
  audio: { speech: { create: async body => { if (globalThis.jarvisVoiceRejectTts) throw new Error("TTS unavailable"); speeches++; globalThis.jarvisVoiceSpeechRequest = body; globalThis.jarvisVoiceSpoken = body.input; return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } }); } } },
};
globalThis.jarvisVoiceAgent = async params => { backendCalls++; globalThis.jarvisVoiceAgentParams = params; return { answer: "Zugängliche Daten wurden geprüft.", actions: [], results: [{ id: "fact", summary: "Quelle", readAt: new Date().toISOString(), items: [] }], usage: { inputTokens: 3, outputTokens: 4, toolCalls: 0, estimatedCostMicros: 0 } }; };
const modules = {
  "@/lib/auth": "export async function requireUser(){return globalThis.jarvisVoiceUser}",
  "@/lib/prisma": "export const prisma=globalThis.jarvisVoiceDb",
  "@/lib/ai-crm/openai": "export function openAiClient(){return globalThis.jarvisVoiceClient}",
  "@/lib/ai-crm/ux-agent": "export async function runUxCrmAgent(p){return globalThis.jarvisVoiceAgent(p)}",
  "next/cache": "export function revalidatePath(){}",
  "openai/resources/live/sideband/ws": `export class SidebandWS { handlers={}; on(k,f){(this.handlers[k]??=[]).push(f)} close(){} send(event){globalThis.jarvisVoiceSent=event;globalThis.jarvisVoiceEvents.push(event);queueMicrotask(()=>{
    if(globalThis.jarvisVoiceRejectSideband){ for(const f of this.handlers.event??[])f({type:'error',client_event_id:event.event_id,error:{code:'invalid_request_error'}}); for(const f of this.handlers.error??[])f(new Error('rejected')); return; }
    if(globalThis.jarvisVoiceWrongAck){ for(const f of this.handlers.event??[])f({type:'session.input_audio.muted',client_event_id:event.event_id}); for(const f of this.handlers.error??[])f(new Error('no valid acknowledgement')); return; }
    for(const f of this.handlers.event??[])f({type:event.type==='session.close'?'session.closed':event.type==='session.instructions.append'?'session.instructions.appended':'session.commentary.appended',client_event_id:event.event_id})
  })} }`,
};
registerHooks({ resolve(specifier, context, next) { return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const db = fixture.client;
const owner = await db.user.create({ data: { name: "Pilot User", aiBetaEnabled: true } });
const stranger = await db.user.create({ data: { name: "Other User", aiBetaEnabled: true } });
globalThis.jarvisVoiceUser = owner;
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });
const start = await import("../app/api/ai-crm/live/session/route.ts");
const lifecycle = await import("../app/api/ai-crm/live/session/[sessionId]/route.ts");
const intro = await import("../app/api/ai-crm/live/session/[sessionId]/intro/route.ts");
const turn = await import("../app/api/ai-crm/live/session/[sessionId]/turn/route.ts");
const { providerSessionConfig, liveSpeechChunks, sendProviderUpdate } = await import("../lib/ai-crm/live-provider.ts");
const { aiCrmConfig } = await import("../lib/ai-crm/config.ts");
const req = (body = {}, method = "POST") => new Request("https://crm.example.test/api/ai-crm/live/session", { method, headers: { origin: "https://crm.example.test", "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = sessionId => ({ params: Promise.resolve({ sessionId }) });
after(async () => { for (const key of ["AI_CRM_ENABLED", "AI_LIVE_PROVIDER", "JARVIS_DEMO_ENABLED"]) delete process.env[key]; await fixture.close(); });

test("Live uses actual SDK session configuration with browser instruction/tool escalation blocked", () => {
  const config = providerSessionConfig(aiCrmConfig(), true);
  assert.equal(config.model, "gpt-live-1");
  assert.deepEqual(config.delegation, { type: "client" });
  assert.equal(config.store, false);
  assert.deepEqual(config.client.data_channel.allowed_client_events, ["session.close", "session.input_audio.mute", "session.input_audio.unmute"]);
  assert.match(config.instructions, /Selbstständig arbeiten/);
  assert.match(config.instructions, /Vorschau zurückgelieferte Aktionen brauchen einen sichtbaren Klick/);
  assert.match(config.instructions, /Warte dafür nicht auf das Fachresultat/);
  assert.match(config.instructions, /keine erfundenen Fortschritte/);
  assert.match(config.instructions, /Hey, Meister Emil/);
  assert.match(config.instructions, /souverän, zugewandt und handlungsbereit/);
  assert.match(config.instructions, /Namen, Zahlen, Termine und Bestätigungen/);
  assert.doesNotMatch(config.instructions, /Die Person hat vor dem Sprachstart „Mehr Energie“ gewählt/);
  const energetic = providerSessionConfig(aiCrmConfig(), true, null, "energetic");
  assert.match(energetic.instructions, /Die Person hat vor dem Sprachstart „Mehr Energie“ gewählt/);
  assert.match(energetic.instructions, /werde auf Wunsch sofort ruhiger/);
  assert.deepEqual(liveSpeechChunks("Ein Ergebnis. Ein nächster Schritt."), ["Ein Ergebnis. Ein nächster Schritt."]);
  const speech = "Das ist eine längere belegte Vorbereitung. ".repeat(60);
  const chunks = liveSpeechChunks(speech);
  assert.equal(chunks.join(" "), speech.trim());
  assert.ok(chunks.every(chunk => Buffer.byteLength(chunk, "utf8") <= 450));
});

test("sideband errors emitted before typed errors and unrelated acknowledgments never report delivery", async () => {
  globalThis.jarvisVoiceRejectSideband = true;
  try { await assert.rejects(sendProviderUpdate("live_rejected", "Ein geprüftes Ergebnis."), error => error.code === "LIVE_AUDIO_DELIVERY_FAILED"); }
  finally { globalThis.jarvisVoiceRejectSideband = false; }
  globalThis.jarvisVoiceWrongAck = true;
  try { await assert.rejects(sendProviderUpdate("live_wrong_ack", "Ein geprüftes Ergebnis."), error => error.code === "LIVE_AUDIO_DELIVERY_FAILED"); }
  finally { globalThis.jarvisVoiceWrongAck = false; }
});

test("native greeting needs no user turn or TTS; claim, manual replay and reconnect preserve logical intro", async () => {
  const clientSessionId = randomUUID();
  const started = await start.POST(req({ clientSessionId, sdp: "v=0\r\na=test-session-offer\r\n" }));
  assert.equal(started.status, 200);
  const payload = await started.json();
  assert.equal(payload.mode, "live");
  assert.equal(payload.config.greetingText, "Hey, Meister Emil. Ich bin da. Was steht heute an?");
  assert.equal(payload.session.introState, "WAITING");
  assert.equal(creates, 1);
  assert.equal(globalThis.jarvisVoiceCreated.session.store, false);
  const session = ctx(payload.session.id);
  globalThis.jarvisVoiceUser = stranger;
  assert.equal((await intro.POST(req(), session)).status, 404);
  globalThis.jarvisVoiceUser = owner;
  const first = await intro.POST(req(), session);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { introState: "DONE", accepted: true });
  assert.equal(globalThis.jarvisVoiceSent.type, "session.instructions.append");
  assert.equal(globalThis.jarvisVoiceSent.delegation_id, null);
  assert.match(globalThis.jarvisVoiceSent.content, /Hey, Meister Emil/);
  assert.doesNotMatch(globalThis.jarvisVoiceSent.content, /Musik/);
  assert.equal(globalThis.jarvisVoiceCreated.session.audio.output.voice, "meridian");
  assert.match(globalThis.jarvisVoiceCreated.session.instructions, /natürliches Deutsch mit warmer, mitteltiefer Stimmwirkung/);
  const delivered = globalThis.jarvisVoiceEvents.length;
  assert.deepEqual(await (await intro.POST(req(), session)).json(), { introState: "DONE", accepted: false });
  assert.equal(globalThis.jarvisVoiceEvents.length, delivered);
  assert.equal((await intro.POST(req({ replay: true }), session)).status, 200);
  assert.equal(globalThis.jarvisVoiceEvents.length, delivered + 1);
  assert.equal(speeches, 0, "startup never calls the separate TTS provider");
  assert.equal((await intro.PATCH(req({ state: "OFFERED" }, "PATCH"), session)).status, 400);
  assert.equal((await intro.PATCH(req({ state: "DONE" }, "PATCH"), session)).status, 200);
  const reconnected = await start.POST(req({ clientSessionId, sdp: "v=0\r\na=next-session-offer\r\n", reconnect: true }));
  assert.equal(reconnected.status, 200);
  assert.equal((await reconnected.json()).session.introState, "DONE");
  assert.match(globalThis.jarvisVoiceCreated.session.instructions, /Begrüße nicht erneut/);
  assert.equal((await (await intro.POST(req(), session)).json()).accepted, false);
  await lifecycle.DELETE(req({}, "DELETE"), session);
});

test("a failed Live greeting produces an authenticated one-time spoken fallback", async () => {
  const clientSessionId = randomUUID();
  const { session } = await (await start.POST(req({ clientSessionId, sdp: "v=0\r\na=uncertain-intro\r\n" }))).json();
  const context = ctx(session.id);
  globalThis.jarvisVoiceRejectSideband = true;
  let fallback;
  try { fallback = await intro.POST(req(), context); }
  finally { globalThis.jarvisVoiceRejectSideband = false; }
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get("X-Jarvis-Voice-Fallback"), "1");
  assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.match(globalThis.jarvisVoiceSpoken, /Hey, Meister Emil/);
  assert.equal(globalThis.jarvisVoiceSpeechRequest.voice, "cedar");
  assert.equal((await db.aiLiveSession.findUniqueOrThrow({ where: { id: session.id } })).introState, "DONE");
  const sent = globalThis.jarvisVoiceEvents.length;
  assert.deepEqual(await (await intro.POST(req(), context)).json(), { introState: "DONE", accepted: false });
  assert.equal(globalThis.jarvisVoiceEvents.length, sent);
  const reconnect = await start.POST(req({ clientSessionId, sdp: "v=0\r\na=reconnect-intro\r\n", reconnect: true }));
  assert.equal((await reconnect.json()).session.introState, "DONE");
  assert.match(globalThis.jarvisVoiceCreated.session.instructions, /Begrüße nicht erneut/);
  assert.equal((await intro.POST(req({ replay: true }), context)).status, 200);
  await lifecycle.DELETE(req({}, "DELETE"), context);
});

test("uncertain greeting stays claimed if both voice paths fail", async () => {
  const { session } = await (await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=both-unavailable\r\n" }))).json();
  globalThis.jarvisVoiceRejectSideband = true; globalThis.jarvisVoiceRejectTts = true;
  try { assert.equal((await intro.POST(req(), ctx(session.id))).status, 502); }
  finally { globalThis.jarvisVoiceRejectSideband = false; globalThis.jarvisVoiceRejectTts = false; }
  assert.equal((await db.aiLiveSession.findUniqueOrThrow({ where: { id: session.id } })).introState, "PLAYING");
  await lifecycle.DELETE(req({}, "DELETE"), ctx(session.id));
});

test("skip and concurrent startup requests cannot produce an automatic duplicate greeting", async () => {
  const { session } = await (await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=claim-intro\r\n" }))).json();
  const context = ctx(session.id), before = globalThis.jarvisVoiceEvents.length;
  const responses = await Promise.all([intro.POST(req(), context), intro.POST(req(), context)]);
  assert.ok(responses.some(response => response.status === 200));
  assert.equal(globalThis.jarvisVoiceEvents.length, before + 1);
  await lifecycle.DELETE(req({}, "DELETE"), context);
  const next = await (await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=skip-intro-session\r\n" }))).json();
  const nextContext = ctx(next.session.id);
  await intro.PATCH(req({ state: "DONE" }, "PATCH"), nextContext);
  const skipped = globalThis.jarvisVoiceEvents.length;
  assert.equal((await (await intro.POST(req(), nextContext)).json()).accepted, false);
  assert.equal(globalThis.jarvisVoiceEvents.length, skipped);
  assert.equal((await lifecycle.PATCH(req({ revision: 1, interruptAudio: false }, "PATCH"), nextContext)).status, 200);
  assert.equal((await db.aiLiveSession.findUniqueOrThrow({ where: { id: next.session.id } })).revision, 1);
  assert.equal(globalThis.jarvisVoiceEvents.length, skipped, "native interruption must not send a second stop that clips the new backchannel");
  await lifecycle.DELETE(req({}, "DELETE"), nextContext);
});

test("the new comparison voices reach the provider through the approved session route", async () => {
  for (const voice of ["meridian", "cinder"]) {
    const response = await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=voice-comparison\r\n", voice }));
    assert.equal(response.status, 200);
    const { session } = await response.json();
    assert.equal(globalThis.jarvisVoiceCreated.session.audio.output.voice, voice);
    await lifecycle.DELETE(req({}, "DELETE"), ctx(session.id));
  }
});

test("the selected conversation style reaches Live through the validated session route", async () => {
  assert.equal((await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=energy-check\r\n", energy: "unbounded" }))).status, 400);
  const response = await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=energy-check\r\n", energy: "energetic" }));
  assert.equal(response.status, 200);
  assert.match(globalThis.jarvisVoiceCreated.session.instructions, /Die Person hat vor dem Sprachstart „Mehr Energie“ gewählt/);
  const { session } = await response.json();
  await lifecycle.DELETE(req({}, "DELETE"), ctx(session.id));
});

test("Live delegates to existing backend, persists sourced results, never replays speech or stale revision", async () => {
  assert.equal((await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=test-session-offer\r\n", voice: "unapproved-custom-voice" }))).status, 400);
  const started = await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=test-session-offer\r\n", voice: "cedar" }));
  assert.equal(globalThis.jarvisVoiceCreated.session.audio.output.voice, "cedar", "only approved alternatives override the default");
  const { session } = await started.json();
  const context = ctx(session.id);
  const body = { clientTurnId: randomUUID(), transcript: "Was ist heute offen?", revision: 1 };
  const response = await turn.POST(req(body), context);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.results[0].summary, "Quelle");
  assert.equal(data.audioDelivered, true);
  assert.equal(backendCalls, 1);
  assert.equal(globalThis.jarvisVoiceAgentParams.userId, owner.id);
  assert.equal(globalThis.jarvisVoiceSent.type, "session.commentary.append");
  const replay = await turn.POST(req(body), context);
  assert.equal(replay.status, 200);
  assert.equal(backendCalls, 1);
  assert.equal((await turn.POST(req({ ...body, clientTurnId: randomUUID() }), context)).status, 409);
  assert.equal(await db.aiConversationMessage.count({ where: { conversationId: data.conversation.id } }), 2);
  const stored = await db.aiConversationMessage.findFirst({ where: { conversationId: data.conversation.id, role: "assistant" } });
  assert.ok(stored);
  assert.equal(stored.actions.kind, "live-result", "saved backend prose is labelled as a summary, never a spoken transcript");
  await lifecycle.DELETE(req({}, "DELETE"), context);
});

test("a completed CRM answer is spoken through TTS when Live sideband rejects it", async () => {
  const { session } = await (await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=fallback-turn\r\n" }))).json();
  const context = ctx(session.id);
  const before = backendCalls;
  const body = { clientTurnId: randomUUID(), transcript: "Was steht heute an?", revision: 1 };
  globalThis.jarvisVoiceRejectSideband = true;
  let response;
  try { response = await turn.POST(req(body), context); }
  finally { globalThis.jarvisVoiceRejectSideband = false; }
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.audioDelivered, false);
  assert.equal(Buffer.from(data.fallbackAudio, "base64").toString("hex"), "010203");
  assert.equal(globalThis.jarvisVoiceSpoken, data.answer);
  assert.equal(backendCalls, before + 1);
  const saved = await db.aiRequest.findUniqueOrThrow({ where: { id: data.requestId }, select: { response: true } });
  assert.equal("fallbackAudio" in saved.response, false, "temporary audio must not enter the stored request");
  const replay = await (await turn.POST(req(body), context)).json();
  assert.equal(replay.audioDelivered, false);
  assert.equal(replay.fallbackAudio, undefined);
  assert.equal(backendCalls, before + 1);
  await lifecycle.DELETE(req({}, "DELETE"), context);
});

test("a correction during backend work discards the late result before persistence and audio", async () => {
  const previous = globalThis.jarvisVoiceAgent;
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const entry = new Promise(resolve => { entered = resolve; });
  globalThis.jarvisVoiceAgent = async params => { entered(); await gate; return previous(params); };
  const started = await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=correction-session\r\n" }));
  const payload = await started.json();
  const context = ctx(payload.session.id);
  const pending = turn.POST(req({ clientTurnId: randomUUID(), transcript: "Bereite die erste Anfrage vor.", revision: 1 }), context);
  await entry;
  assert.equal((await lifecycle.PATCH(req({ revision: 2 }, "PATCH"), context)).status, 200);
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stale, true);
  assert.equal(await db.aiConversationMessage.count({ where: { conversationId: payload.conversation.id } }), 0);
  assert.equal(globalThis.jarvisVoiceSent.type, "session.instructions.append");
  globalThis.jarvisVoiceAgent = previous;
  await lifecycle.DELETE(req({}, "DELETE"), context);
});

test("only the owner can discover and end a blocked session before starting again", async () => {
  const started = await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=blocked-session\r\n" }));
  const { session } = await started.json();
  assert.deepEqual((await (await start.GET()).json()).activeSession, { id: session.id });
  globalThis.jarvisVoiceUser = stranger;
  assert.equal((await (await start.GET()).json()).activeSession, null);
  assert.equal((await lifecycle.DELETE(req({}, "DELETE"), ctx(session.id))).status, 404);
  globalThis.jarvisVoiceUser = owner;
  const before = creates;
  assert.equal((await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=other-tab-session\r\n" }))).status, 409);
  assert.equal(creates, before, "a conflict cannot create another provider session");
  assert.equal((await lifecycle.DELETE(req({}, "DELETE"), ctx(session.id))).status, 204);
  assert.equal((await (await start.GET()).json()).activeSession, null);
  const next = await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=next-session\r\n" }));
  assert.equal(next.status, 200);
  await lifecycle.DELETE(req({}, "DELETE"), ctx((await next.json()).session.id));
});

test("a cancelled start closes a provider created after the browser left", async () => {
  const original = globalThis.jarvisVoiceClient.live.create;
  const controller = new AbortController();
  globalThis.jarvisVoiceClient.live.create = async body => { const result = await original(body); controller.abort(); return result; };
  try {
    const request = new Request(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=cancelled-session\r\n" }), { signal: controller.signal });
    assert.equal((await start.POST(request)).status, 409);
    assert.equal(await db.aiLiveSession.count({ where: { userId: owner.id, activeKey: owner.id } }), 0);
    assert.equal(globalThis.jarvisVoiceSent.type, "session.close");
  } finally { globalThis.jarvisVoiceClient.live.create = original; }
});

test("ending during provider creation cannot resurrect the connection", async () => {
  const original = globalThis.jarvisVoiceClient.live.create;
  globalThis.jarvisVoiceClient.live.create = async body => {
    const active = await db.aiLiveSession.findFirstOrThrow({ where: { userId: owner.id, activeKey: owner.id } });
    await lifecycle.DELETE(req({}, "DELETE"), ctx(active.id));
    return original(body);
  };
  try {
    assert.equal((await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=concurrent-end\r\n" }))).status, 409);
    assert.equal(await db.aiLiveSession.count({ where: { userId: owner.id, activeKey: owner.id } }), 0);
    assert.equal(globalThis.jarvisVoiceSent.type, "session.close");
  } finally { globalThis.jarvisVoiceClient.live.create = original; }
});

test("an incomplete provider response releases the session lock and usage claim", async () => {
  const original = globalThis.jarvisVoiceClient.live.create;
  globalThis.jarvisVoiceClient.live.create = async body => ({ ...(await original(body)), transport: {} });
  try {
    const response = await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=incomplete-transport\r\n" }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "LIVE_TRANSPORT_MISSING");
    assert.equal(await db.aiLiveSession.count({ where: { userId: owner.id, activeKey: owner.id } }), 0);
    const ended = await db.aiLiveSession.findFirstOrThrow({ where: { userId: owner.id, errorCode: "LIVE_TRANSPORT_MISSING" } });
    assert.equal((await db.aiUsage.findUniqueOrThrow({ where: { id: ended.usageId } })).status, "FAILED");
    assert.equal(globalThis.jarvisVoiceSent.type, "session.close");
  } finally { globalThis.jarvisVoiceClient.live.create = original; }
});

test("failure preparing the response also closes the already-created provider", async () => {
  const original = db.aiConversationMessage.count;
  db.aiConversationMessage.count = async () => { throw new Error("Controlled response preparation failure"); };
  try {
    assert.equal((await start.POST(req({ clientSessionId: randomUUID(), sdp: "v=0\r\na=response-preparation\r\n" }))).status, 500);
    assert.equal(await db.aiLiveSession.count({ where: { userId: owner.id, activeKey: owner.id } }), 0);
    assert.equal(globalThis.jarvisVoiceSent.type, "session.close");
  } finally { db.aiConversationMessage.count = original; }
});
