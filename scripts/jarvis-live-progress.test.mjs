import assert from "node:assert/strict";
import test from "node:test";
import { crmOrientationAnswer } from "../lib/ai-crm/capabilities.ts";
import { withinAiDeadline } from "../lib/ai-crm/deadline.ts";
import { LIVE_STREAM_TYPE, liveTurnStream, readLiveTurn } from "../lib/ai-crm/live-progress.ts";
import { LiveUtteranceBuffer, inputTranscriptDelta } from "../lib/ai-crm/live-audio-input.ts";

test("the reported open CM question gives a concrete orientation without a search", () => {
  for (const question of ["Yo, ey, was kann ich mit CM machen? Hilf mir mal bitte mal ein bisschen dabei, was geht so?", "Was kann ich mit dem CRM machen?", "Was kann ich alles mit meinem CRM machen?"]) {
    const answer = crmOrientationAnswer(question);
    assert.match(answer, /Kontakte/); assert.match(answer, /Was steht heute an/); assert.match(answer, /Bestätigung/);
    assert.doesNotMatch(answer, /warte|konkrete.*Anfrage/i);
  }
  for (const question of ["Was kann ich mit CRM machen? Suche Anna", "Suche den Kontakt CM", "Was kann ich mit CM machen? Gemeint ist Content Management.", "Was kann ich mit CM machen? Erstelle einen Kontakt."]) assert.equal(crmOrientationAnswer(question), null);
});

test("progress arrives before a pending result and never enters the result object", async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const phases = [];
  const response = liveTurnStream(async progress => {
    progress("accepted"); await pending; progress("composing");
    return Response.json({ answer: "Fertig", requestId: "same-id" });
  });
  const result = readLiveTurn(response, message => phases.push(message));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(phases.length, 1);
  complete();
  assert.deepEqual(await result, { answer: "Fertig", requestId: "same-id" });
  assert.equal(phases.length, 2);
});

test("fragmented UTF-8 streams, errors, truncated responses and JSON fallback", async () => {
  const wire = new TextEncoder().encode(JSON.stringify({ type: "result", status: 200, data: { answer: "Grüße zurück" } }));
  const stream = new ReadableStream({ start(controller) { for (const byte of wire) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  assert.equal((await readLiveTurn(new Response(stream, { headers: { "Content-Type": LIVE_STREAM_TYPE } }), () => {})).answer, "Grüße zurück");
  await assert.rejects(readLiveTurn(liveTurnStream(async () => Response.json({ error: "Zeitüberschreitung" }, { status: 504 })), () => {}), /Zeitüberschreitung/);
  await assert.rejects(readLiveTurn(new Response('{"type":"progress","message":"Läuft"}\n', { headers: { "Content-Type": LIVE_STREAM_TYPE } }), () => {}), /unterbrochen/);
  assert.equal((await readLiveTurn(Response.json({ answer: "Replay" }), () => {})).answer, "Replay");
  await assert.rejects(readLiveTurn(Response.json({ error: "Nicht erlaubt" }, { status: 403 }), () => {}), /Nicht erlaubt/);
});

test("a single deadline aborts a hung request and prevents its late work", async () => {
  let signal;
  await assert.rejects(withinAiDeadline(async current => { signal = current; await new Promise(() => {}); }, 20), error => error.code === "AI_PROVIDER_TIMEOUT");
  assert.equal(signal.aborted, true);
  const parent = new AbortController(); parent.abort(new Error("Canceled"));
  let ran = false;
  await assert.rejects(withinAiDeadline(async () => { ran = true; }, 100, parent.signal), /Canceled/);
  assert.equal(ran, false);
  assert.equal(await withinAiDeadline(async () => "done", 100), "done");
});

test("quiet recognized speech finalizes and a provider delegation bypasses a noisy meter", () => {
  const buffer = new LiveUtteranceBuffer();
  buffer.append({ eventId: "q", content: "Was kann ich mit CM machen?", startMs: 0, endMs: 1400 }, 1000);
  assert.equal(buffer.ready(2799), false); assert.equal(buffer.ready(2800), true);
  buffer.activity(2799); assert.equal(buffer.ready(2800), false);
  assert.equal(buffer.delegate("delegation-one", 1500), true);
  assert.equal(buffer.ready(2800), true); assert.equal(buffer.delegationId(), "delegation-one");
  buffer.take(); assert.equal(buffer.delegationId(), undefined);
  assert.equal(buffer.delegate("late-one", 1500), false);
  buffer.append({ eventId: "q2", content: "Was steht heute an?", startMs: 4000, endMs: 5000 }, 4000);
  assert.equal(buffer.delegate("old", 1500), false); assert.equal(buffer.delegationId(), undefined);
  buffer.clear(); assert.equal(buffer.delegate("canceled", 5000), false);
});

test("continuing transcripts wait for a stable tail and malformed timestamps are rejected", () => {
  const buffer = new LiveUtteranceBuffer();
  buffer.append({ eventId: "one", content: "Was kann", startMs: 0, endMs: 100 }, 1000);
  buffer.append({ eventId: "two", content: " ich machen?", startMs: 100, endMs: 900 }, 2500);
  assert.equal(buffer.ready(2800), false); assert.equal(buffer.ready(4300), true);
  for (const end_ms of [NaN, Infinity, -1]) assert.equal(inputTranscriptDelta({ type: "session.input_transcript.delta", delta: "Test", event_id: "x", start_ms: 0, end_ms }), null);
});
