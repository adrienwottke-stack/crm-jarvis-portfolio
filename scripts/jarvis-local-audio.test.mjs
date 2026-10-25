import test from "node:test";
import assert from "node:assert/strict";
import { LocalAudioController, splitMusicCommand, musicOfferDecision, isSessionStop } from "../lib/ai-crm/local-audio.ts";
import { LiveUtteranceBuffer, inputTranscriptDelta, sessionTiming, waitForIceGathering } from "../lib/ai-crm/live-audio-input.ts";
import { liveTranscriptEvent } from "./fixtures/live-transcript.ts";
import { isLiveSmallTalk } from "../lib/ai-crm/voice-style.ts";
import { LiveCaptions } from "../lib/ai-crm/live-captions.ts";
import { mergeLiveSpeech } from "../lib/ai-crm/live-timeline.ts";

class AudioFixture {
  src = ""; volume = 1; currentTime = 0; paused = true; listeners = new Map(); calls = 0;
  playResult = null;
  async play() { this.calls++; if (this.playResult) await this.playResult; this.paused = false; }
  pause() { this.paused = true; this.listeners.get("pause")?.(); }
  load() {}
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
}
function fixture(src = "/authenticated-fixture") {
  const audio = new AudioFixture(); const states = [];
  const player = new LocalAudioController(audio, { src, title: "Gekennzeichnetes Testfixture", onChange: state => states.push(state) });
  return { audio, player, states };
}
const advanceFade = timers => { for (let i = 0; i < 30; i++) timers.tick(25); };

test("no source means missing, not simulated AC/DC or successful playback", async () => {
  const { player, audio } = fixture("");
  await player.start(); assert.equal(audio.calls, 0); assert.equal(player.snapshot().status, "MISSING"); player.dispose();
});
test("reports playback only after a successful play promise", async () => {
  const { player, audio } = fixture(); let resolve;
  audio.playResult = new Promise(done => { resolve = done; });
  const started = player.start(); assert.equal(player.snapshot().status, "LOADING"); resolve(); await started;
  assert.equal(player.snapshot().status, "PLAYING"); assert.equal(audio.volume, .12); player.dispose();
});
test("stop wins against a delayed play promise", async () => {
  const { player, audio } = fixture(); let resolve;
  audio.playResult = new Promise(done => { resolve = done; });
  const started = player.start(); player.stop(); resolve(); await started;
  assert.equal(audio.paused, true); assert.equal(player.snapshot().status, "STOPPED"); player.dispose();
});
test("pause wins against delayed play and unducking never restarts", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { player, audio } = fixture(); let resolve;
  audio.playResult = new Promise(done => { resolve = done; });
  const started = player.start(); player.setDucked(true); player.pause(); resolve(); await started;
  player.setDucked(false); advanceFade(t.mock.timers);
  assert.equal(audio.calls, 1); assert.equal(audio.paused, true); assert.equal(player.snapshot().status, "PAUSED"); player.dispose();
});
test("an older play resolution cannot pause a newer explicitly requested start", async () => {
  const { player, audio } = fixture(); let resolve;
  audio.playResult = new Promise(done => { resolve = done; });
  const first = player.start(); player.pause(); audio.playResult = null; await player.start(); resolve(); await first;
  assert.equal(player.snapshot().status, "PLAYING"); assert.equal(audio.paused, false); player.dispose();
});
test("ducking lowers volume smoothly and returns to prior chosen volume", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { player, audio } = fixture(); await player.start(); player.changeVolume(1); advanceFade(t.mock.timers); const chosen = player.snapshot().volume;
  player.setDucked(true); assert.ok(audio.volume > .018); advanceFade(t.mock.timers); assert.ok(audio.volume <= .019);
  player.setDucked(false); advanceFade(t.mock.timers); assert.ok(Math.abs(audio.volume - chosen) < .006); assert.equal(audio.calls, 1); player.dispose();
});
test("volume bounds, blocked playback and explicit manual retry are truthful", async () => {
  const { player, audio } = fixture();
  for (let i = 0; i < 30; i++) player.changeVolume(1); assert.equal(player.snapshot().volume, .5);
  for (let i = 0; i < 30; i++) player.changeVolume(-1); assert.equal(player.snapshot().volume, 0);
  audio.playResult = Promise.reject(Object.assign(new Error("browser fixture"), { name: "NotAllowedError" }));
  await player.start(); assert.equal(player.snapshot().status, "BLOCKED"); audio.playResult = null;
  await player.start(); assert.equal(player.snapshot().status, "PLAYING"); player.dispose();
});
test("dispose clears event handlers, source, timers and pending automatic work", async () => {
  const { player, audio } = fixture(); await player.start(); player.setDucked(true); player.dispose();
  assert.equal(audio.src, ""); assert.equal(audio.paused, true); assert.equal(audio.listeners.size, 0);
  await player.start(); assert.equal(audio.calls, 1);
});
test("media prefixes retain CRM question and weak acknowledgements do not authorize music", () => {
  assert.deepEqual(splitMusicCommand("Etwas leiser. Was ist heute für mich offen?"), { command: "quieter", remainder: "Was ist heute für mich offen?" });
  assert.deepEqual(splitMusicCommand("Jarvis, Musik aus und bereite mein Gespräch vor"), { command: "stop", remainder: "bereite mein Gespräch vor" });
  assert.equal(splitMusicCommand("Die Notiz sagt Musik an").command, null);
  assert.equal(musicOfferDecision("Ja, gerne."), "yes"); assert.equal(musicOfferDecision("Nein danke"), "no");
  for (const text of ["mhm", "okay", "ja die Aufgabe ist fertig", "In der Notiz steht ja"]) assert.equal(musicOfferDecision(text), null);
  assert.equal(isSessionStop("Sitzung beenden"), true); assert.equal(isSessionStop("Musik aus"), false);
});
test("quiet-microphone fallback waits for a stable transcript; event retries deduplicate", () => {
  const buffer = new LiveUtteranceBuffer(); const delta = inputTranscriptDelta(liveTranscriptEvent("Jarvis?", "one"));
  assert.ok(delta, "the real SDK transcript shape must reach the utterance buffer");
  buffer.append(delta, 1000); buffer.append(delta, 1000); assert.equal(buffer.preview(), "Jarvis?"); assert.equal(buffer.ready(2799), false); assert.equal(buffer.ready(2800), true);
  buffer.activity(1000); assert.equal(buffer.ready(1749), false); assert.equal(buffer.ready(1750), true);
  assert.equal(buffer.take(), "Jarvis?"); assert.equal(buffer.ready(10_000), false);
});

test("real Live delta fragments preserve spaces and trigger a completed spoken request", () => {
  const buffer = new LiveUtteranceBuffer();
  buffer.activity(1000);
  for (const [event, receivedAt] of [[liveTranscriptEvent("Was ist", "one", 0, 300), 1100], [liveTranscriptEvent(" heute offen?", "two", 300, 900), 1300]]) {
    const parsed = inputTranscriptDelta(event);
    assert.ok(parsed);
    buffer.append(parsed, receivedAt);
  }
  assert.equal(buffer.ready(2400), true);
  assert.equal(buffer.take(), "Was ist heute offen?");
});

test("non-transcript events and the old incorrect content-only fixture are rejected", () => {
  const valid = liveTranscriptEvent("Jarvis?");
  for (const invalid of [null, { ...valid, type: "session.output_transcript.delta" }, { ...valid, delta: undefined, content: "Jarvis?" }, { ...valid, delta: 12 }, { ...valid, event_id: null }, { ...valid, start_ms: -1 }, { ...valid, end_ms: -1 }]) assert.equal(inputTranscriptDelta(invalid), null);
});

test("short social replies stay in Live while greetings followed by CRM requests still reach the backend", () => {
  for (const text of ["Hallo Jarvis!", "Danke.", "Wie geht es dir?"]) assert.equal(isLiveSmallTalk(text), true);
  for (const text of ["Hallo Jarvis, was ist heute offen?", "Ja, erstelle einen Entwurf", "Danke, was habe ich zugesagt?", "Welche Aufgaben habe ich?", "Ja, gerne", "Nein", "Okay"]) assert.equal(isLiveSmallTalk(text), false, "context-dependent answers must still reach the backend");
});

test("shorter turn hold still waits for continuing speech and a stable final transcript", () => {
  const buffer = new LiveUtteranceBuffer();
  buffer.activity(1000); buffer.append({ eventId: "start", content: "Welche", startMs: 0, endMs: 300 }, 1000);
  buffer.activity(1800); assert.equal(buffer.ready(2500), false);
  buffer.append({ eventId: "end", content: " Aufgaben?", startMs: 300, endMs: 1100 }, 2600);
  assert.equal(buffer.ready(2900), false); assert.equal(buffer.ready(3100), true);
  assert.equal(buffer.take(), "Welche Aufgaben?");
});

test("a new question after a short pause is not discarded as an old fragment", () => {
  const buffer = new LiveUtteranceBuffer();
  buffer.activity(1000); buffer.append({ eventId: "one", content: "Danke", startMs: 0, endMs: 1000 }, 1000);
  assert.equal(buffer.ready(1750), true); buffer.take();
  assert.equal(buffer.append({ eventId: "old", content: "!", startMs: 1050, endMs: 1100 }, 1800), "late");
  buffer.activity(1800);
  assert.equal(buffer.append({ eventId: "new", content: "Was ist morgen?", startMs: 1800, endMs: 2600 }, 1900), "added");
});

test("read-along captions join fragments, distinguish speakers, deduplicate and keep reconnect timelines separate", () => {
  const captions = new LiveCaptions();
  const first = { ...liveTranscriptEvent("Hallo,", "out1", 0, 300), type: "session.output_transcript.delta" };
  assert.equal(captions.append(first)[0].text, "Hallo,");
  assert.equal(captions.append(first), null);
  assert.equal(captions.append({ ...first, delta: " Meister Emil.", event_id: "out2", start_ms: 300, end_ms: 900 })[0].text, "Hallo, Meister Emil.");
  const lines = captions.append(liveTranscriptEvent("Los geht’s.", "in1", 1100, 1600));
  assert.equal(lines.length, 2); assert.equal(lines[1].role, "user");
  captions.reconnect();
  assert.equal(captions.append(liveTranscriptEvent("Weiter", "in1", 0, 300)).length, 3);
  assert.equal(captions.append({ ...first, delta: 42 }), null);
  for (let i = 0; i < 100; i++) captions.append(liveTranscriptEvent("A".repeat(1000), `large${i}`, i * 3000 + 3000, i * 3000 + 4000));
  const bounded = captions.append(liveTranscriptEvent("Letzter Satz", "last", 400000, 400100));
  assert.ok(bounded.length <= 50); assert.ok(bounded.reduce((sum, line) => sum + line.text.length, 0) <= 16000);
});

test("the primary chat follows actual speech fragments without replacing CRM facts or repeating a bubble", () => {
  const captions = new LiveCaptions();
  const event = { type: "session.output_transcript.delta", event_id: "speech-one", delta: "Yo, ich bin dran!", start_ms: 0, end_ms: 500 };
  const summary = { id: "result-one", role: "assistant", kind: "live-result", content: "An entirely different written backend answer", actions: [{ id: "proposal-one", status: "PENDING" }] };
  let entries = mergeLiveSpeech([summary], captions.append(event));
  assert.equal(entries[1].content, "Yo, ich bin dran!");
  assert.equal(entries[1].kind, "speech");
  entries = mergeLiveSpeech(entries, captions.append({ ...event, event_id: "speech-two", delta: " Wie läuft dein Tag?", start_ms: 500, end_ms: 1100 }));
  assert.equal(entries.length, 2);
  assert.equal(entries[1].content, "Yo, ich bin dran! Wie läuft dein Tag?");
  assert.equal(entries[0], summary, "no spoken text may rewrite a CRM result or authorize an action");
  assert.equal(captions.append(event), null, "event replays cannot repeat speech");
  captions.boundary();
  entries = mergeLiveSpeech(entries, captions.append({ ...event, event_id: "speech-three", delta: "Hier ist die Antwort.", start_ms: 1100, end_ms: 1500 }));
  assert.equal(entries.length, 3, "the answer must not join the waiting message across a result boundary");
  assert.equal(entries.at(-1).content, "Hier ist die Antwort.");
});

test("new calls and reconnects preserve earlier speech without ID collisions; buffers stay bounded", () => {
  let entries = [];
  const event = { type: "session.output_transcript.delta", event_id: "same-provider-id", delta: "Hallo", start_ms: 0, end_ms: 500 };
  const first = new LiveCaptions();
  entries = mergeLiveSpeech(entries, first.append(event));
  first.reconnect(); entries = mergeLiveSpeech(entries, first.append(event));
  const second = new LiveCaptions(); entries = mergeLiveSpeech(entries, second.append(event));
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 3);
  assert.equal(mergeLiveSpeech(entries, []), entries, "starting another call does not erase earlier speech");
  entries.push({ id: "kept", role: "assistant", content: "Saved CRM summary", kind: "live-result" });
  for (let i = 0; i < 100; i++) entries = mergeLiveSpeech(entries, second.append({ ...event, event_id: `bounded-${i}`, delta: "A".repeat(1000), start_ms: 3000 * (i + 1), end_ms: 3000 * (i + 1) + 500 }));
  assert.ok(entries.filter(entry => entry.kind === "speech").length <= 100);
  assert.ok(entries.filter(entry => entry.kind === "speech").reduce((sum, entry) => sum + entry.content.length, 0) <= 32000);
  assert.equal(entries.find(entry => entry.id === "kept").content, "Saved CRM summary");
});

test("noise cannot interrupt speech; recognized words interrupt once and reset for the next utterance", () => {
  const buffer = new LiveUtteranceBuffer();
  buffer.activity(1000);
  assert.equal(buffer.claimInterruption(), false, "microphone activity alone carries no words");
  buffer.append({ eventId: "punctuation", content: " ... ", startMs: 0, endMs: 100 }, 1100);
  assert.equal(buffer.claimInterruption(), false);
  buffer.append({ eventId: "word", content: "Moment", startMs: 100, endMs: 600 }, 1200);
  assert.equal(buffer.claimInterruption(), true);
  buffer.append({ eventId: "continuation", content: ", die andere Person", startMs: 600, endMs: 900 }, 1300);
  assert.equal(buffer.claimInterruption(), false, "fragments cannot repeatedly cancel the same response");
  buffer.take();
  assert.equal(buffer.claimInterruption(), false);
  buffer.append({ eventId: "next", content: "Stopp", startMs: 3000, endMs: 3500 }, 4000);
  assert.equal(buffer.claimInterruption(), true);
  buffer.clear();
  assert.equal(buffer.append({ eventId: "late", content: "weiter", startMs: 3500, endMs: 4000 }, 4100), "late");
  assert.equal(buffer.claimInterruption(), false, "late words cannot interrupt a new context");
  buffer.resetTimeline();
  buffer.append({ eventId: "fresh", content: "Neue Frage", startMs: 0, endMs: 500 }, 5000);
  assert.equal(buffer.claimInterruption(), true);
});
test("late fragments are kept out of a new utterance after partner change", () => {
  const buffer = new LiveUtteranceBuffer();
  buffer.activity(1000); buffer.append({ eventId: "a", content: "Was ist", startMs: 0, endMs: 500 }, 1000);
  assert.equal(buffer.ready(2500), true); assert.equal(buffer.take(), "Was ist");
  buffer.activity(3000);
  assert.equal(buffer.append({ eventId: "late", content: " heute offen?", startMs: 500, endMs: 900 }, 3100), "late");
  assert.equal(buffer.append({ eventId: "next", content: "Bereite Jonas vor", startMs: 2800, endMs: 4000 }, 3500), "added");
  assert.equal(buffer.preview(), "Bereite Jonas vor");
  assert.equal(buffer.ready(3600), false); assert.equal(buffer.ready(4500), true);
});
test("inactivity warning and maximum duration remain independent of mute", () => {
  assert.deepEqual(sessionTiming(90_000, 0, 600_000, 120, 30), { remaining: 30, warn: true, expired: false });
  assert.equal(sessionTiming(121_000, 0, 600_000, 120, 30).expired, true);
  assert.equal(sessionTiming(600_000, 599_000, 600_000, 120, 30).expired, true);
  assert.equal(sessionTiming(150_000, 0, 600_000, 120, 30, true).expired, false);
  assert.equal(sessionTiming(600_000, 0, 600_000, 120, 30, true).expired, true);
});
test("ICE candidates finish before SDP submission and listeners clean up on cancellation", async () => {
  const peer = new EventTarget(); peer.iceGatheringState = "gathering";
  const controller = new AbortController(); let completed = false;
  const waiting = waitForIceGathering(peer, controller.signal, 1000).then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false);
  peer.iceGatheringState = "complete"; peer.dispatchEvent(new Event("icegatheringstatechange")); await waiting; assert.equal(completed, true);
  peer.iceGatheringState = "gathering"; const canceled = waitForIceGathering(peer, controller.signal, 1000); controller.abort();
  await assert.rejects(canceled, error => error.name === "AbortError");
});
