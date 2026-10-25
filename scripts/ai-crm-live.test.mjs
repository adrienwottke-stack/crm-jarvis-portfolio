import assert from "node:assert/strict";
import test from "node:test";

import {
  initialLiveClientState,
  transitionLiveClientState,
} from "../lib/ai-crm/live-state.ts";
import { LocalMockMusicProvider } from "../lib/ai-crm/live-music.ts";

test("live client state renders a client-only assistant preview before its final text and can be interrupted", () => {
  let state = initialLiveClientState();
  assert.equal(state.phase, "IDLE");

  state = transitionLiveClientState(state, { type: "START" });
  assert.equal(state.phase, "REQUESTING_MICROPHONE");
  state = transitionLiveClientState(state, { type: "MICROPHONE_GRANTED" });
  assert.equal(state.phase, "CONNECTING");
  state = transitionLiveClientState(state, { type: "SESSION_READY" });
  assert.equal(state.phase, "LISTENING");
  state = transitionLiveClientState(state, { type: "PARTIAL_TRANSCRIPT", value: "Hey Jarvis" });
  assert.equal(state.partialTranscript, "Hey Jarvis");
  assert.equal(state.phase, "LISTENING");
  state = transitionLiveClientState(state, { type: "TURN_SENT" });
  assert.equal(state.phase, "THINKING");
  state = transitionLiveClientState(state, { type: "ASSISTANT_PARTIAL", value: "Lokale Demo" });
  assert.equal(state.phase, "SPEAKING");
  assert.equal(state.assistantPartialTranscript, "Lokale Demo");
  state = transitionLiveClientState(state, { type: "ASSISTANT_FINAL", value: "Lokale Demo." });
  assert.equal(state.phase, "SPEAKING");
  assert.equal(state.finalTranscript, "Lokale Demo.");
  state = transitionLiveClientState(state, { type: "BARGE_IN" });
  assert.equal(state.phase, "LISTENING");
  assert.equal(state.finalTranscript, "Lokale Demo.");
  state = transitionLiveClientState(state, { type: "END" });
  assert.equal(state.phase, "ENDED");
});

test("the local music mock remains per user/session and never claims real playback", async () => {
  const music = new LocalMockMusicProvider();
  const started = await music.start({ userId: "owner-a", sessionId: "session-a", query: "AC/DC" });
  assert.equal(started.mode, "simulation");
  assert.match(started.message, /Lokale Demo/);
  assert.doesNotMatch(started.message, /^Klar\. AC\/DC läuft\.$/);

  const other = await music.state({ userId: "owner-b", sessionId: "session-b" });
  assert.equal(other.playback, "STOPPED");

  const paused = await music.pause({ userId: "owner-a", sessionId: "session-a" });
  assert.equal(paused.playback, "PAUSED");
  assert.match(paused.message, /simulierte Wiedergabe/);
});
