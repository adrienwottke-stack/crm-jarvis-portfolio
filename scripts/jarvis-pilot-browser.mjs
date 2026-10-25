// UI acceptance with controlled WebRTC/audio and API fixtures. No live provider or real music.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";
import { liveTranscriptEvent } from "./fixtures/live-transcript.ts";

const fixture = await testDatabase(0, 24);
const port = Number(process.env.JARVIS_PILOT_BROWSER_PORT || 3147);
const origin = `http://127.0.0.1:${port}`;
const output = new URL("../test-results/jarvis-pilot/", import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(new URL("../.cache/jarvis-pilot-browser/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/jarvis-pilot-browser/tsconfig.json", import.meta.url), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "--hostname", "127.0.0.1"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", CRM_TEST_DIST_DIR: ".cache/jarvis-pilot-browser-next", CRM_TEST_TSCONFIG: ".cache/jarvis-pilot-browser/tsconfig.json", NEXT_TELEMETRY_DISABLED: "1", AI_CRM_ENABLED: "true", AI_LIVE_PROVIDER: "mock", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1", SPOTIFY_ENABLED: "false", SPOTIFY_LOCAL_ENABLED: "false", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "" },
});
let logs = ""; server.stdout.on("data", chunk => { logs += chunk; }); server.stderr.on("data", chunk => { logs += chunk; });
let browser;
try {
  const user = await fixture.client.user.create({ data: { name: "Jarvis UI Test", aiBetaEnabled: true, onboardingDoneAt: new Date(), person: { create: { name: "Jarvis UI Test" } }, startProgress: { create: { phase: "DONE" } } } });
  await fixture.client.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI CRM", state: "TEST" }, update: { state: "TEST" } });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {} if (i === 119) throw new Error(logs.slice(-4000)); await new Promise(resolve => setTimeout(resolve, 500)); }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addCookies([{ name: authCookieName, value: await createSession(user.id), url: origin }]);
  await context.addInitScript(({ transcriptTemplate }) => {
    window.__inputLevel = 0; window.__trackStops = 0; window.__micRequests = 0; window.__audio = []; window.__controls = []; window.__timeline = 0; window.__lastUtteranceEnd = 0; window.__firstAudioMs = null;
    class AudioFixture extends EventTarget {
      src; srcObject = null; volume = 1; paused = true; currentTime = 0; muted = false;
      constructor(src = "") { super(); this.src = src; this.createdSrc = src; window.__audio.push(this); }
      async play() { if (window.__blockMusic && this.src.includes("/live/music")) throw new DOMException("Blocked fixture", "NotAllowedError"); this.paused = false; if (this.src.startsWith("blob:")) { if (window.__firstAudioMs === null) window.__firstAudioMs = performance.now() - window.__lastUtteranceEnd; setTimeout(() => this.onended?.(), 70); } }
      pause() { this.paused = true; this.dispatchEvent(new Event("pause")); } load() {}
    }
    window.Audio = AudioFixture;
    window.AudioContext = class {
      state = "running";
      createMediaStreamSource(stream) { return { connect(analyser) { analyser.kind = stream.kind; }, disconnect() {} }; }
      createAnalyser() { return { kind: "", fftSize: 0, getFloatTimeDomainData(array) { array.fill(this.kind === "input" ? window.__inputLevel : window.__outputLevel || 0); }, disconnect() {} }; }
      async resume() { this.state = "running"; } async close() { this.state = "closed"; }
    };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
      window.__micRequests++;
      if (window.__denyMic) throw new DOMException("Controlled microphone denial", "NotAllowedError");
      const track = { enabled: true, stop() { window.__trackStops++; } };
      return { kind: "input", getTracks: () => [track], getAudioTracks: () => [track] };
    } } });
    window.RTCPeerConnection = class extends EventTarget {
      connectionState = "new"; iceGatheringState = "new"; localDescription = null;
      constructor() { super(); window.__peer = this; window.__providerStarted = false; }
      addTrack() {} async createOffer() { return { type: "offer", sdp: "v=0\r\ncontrolled-ui-test-only-sdp\r\n" }; }
      async setLocalDescription(value) { this.localDescription = value; this.iceGatheringState = "gathering"; setTimeout(() => { this.iceGatheringState = "complete"; this.dispatchEvent(new Event("icegatheringstatechange")); }, 15); }
      createDataChannel() { this.channel = { readyState: "open", send(value) { window.__controls.push(JSON.parse(value)); }, close() {} }; return this.channel; }
      async setRemoteDescription() { this.connectionState = "connected"; this.onconnectionstatechange?.(); this.ontrack?.({ streams: [{ kind: "output" }] }); setTimeout(() => {
        window.__providerStarted = true; this.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
        if (!window.__earlyGreetingSent) {
          window.__earlyGreetingSent = true;
          this.channel.onmessage?.({ data: JSON.stringify({ type: "session.output_transcript.delta", delta: "Hallo, Meister Emil.", event_id: "greeting-caption", start_ms: 0, end_ms: 1000 }) });
        }
      }, 10); }
      close() { this.connectionState = "closed"; }
    };
    window.__say = async text => {
      window.__inputLevel = .2; await new Promise(resolve => setTimeout(resolve, 260));
      window.__timeline += 4000;
      window.__peer.channel.onmessage({ data: JSON.stringify({ ...transcriptTemplate, delta: text, event_id: crypto.randomUUID(), start_ms: window.__timeline, end_ms: window.__timeline + 1000 }) });
      window.__inputLevel = 0;
      window.__lastUtteranceEnd = performance.now();
    };
  }, { transcriptTemplate: liveTranscriptEvent("") });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const settings = { demoEnabled: true, greetingText: "Hallo, Meister Emil.", inactivitySeconds: 180, warningSeconds: 30, maxSessionSeconds: 600, reconnectLimit: 1 };
  const conversation = { id: "fixture-conversation", title: "Jarvis UI Test", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), updatedAt: new Date().toISOString(), messageCount: 0 };
  let introState = "WAITING", introCalls = 0, turnCalls = [], revision = 0, ends = 0, failNextTurn = false, fallbackNextTurn = false, lastTurn = null, introDelay = 0, failIntro = false, fallbackIntro = false;
  let activeSessionId = "fixture-blocked", failEnd = true, failStart = false, delayedStart = null, startEntered = null;
  const introBodies = [];
  const selectedVoices = [];
  const selectedEnergy = [];
  const greetingAcceptances = [];
  let turnDelay = 0;
  await page.route("**/api/ai-crm/live/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const body = request.method() === "POST" || request.method() === "PATCH" ? request.postDataJSON() : {};
    let response = {};
    if (url.pathname.endsWith("/music")) response = { available: true, title: "Gekennzeichnetes Audio-Testfixture" };
    else if (url.pathname.endsWith("/intro")) {
      if (request.method() === "POST") {
        introCalls++; introBodies.push(body); introState = "PLAYING";
        assert.equal(await page.evaluate(() => window.__providerStarted), true, "greeting waits for session.started");
        if (failIntro) { failIntro = false; return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Controlled uncertain greeting delivery" }) }); }
        if (fallbackIntro) { fallbackIntro = false; introState = "DONE"; return route.fulfill({ status: 200, contentType: "audio/mpeg", headers: { "X-Jarvis-Voice-Fallback": "1" }, body: Buffer.from([1, 2, 3]) }); }
        if (introDelay) await new Promise(resolve => setTimeout(resolve, introDelay));
        const accepted = introState !== "DONE";
        if (accepted) greetingAcceptances.push(Date.now());
        introState = "DONE";
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ introState, accepted }) });
      }
      introState = body.state;
    } else if (url.pathname.endsWith("/turn")) {
      assert.equal("sessionId" in body, false); assert.equal(body.context?.label, undefined);
      assert.ok(body.revision > revision || body.clientTurnId === lastTurn?.clientTurnId); revision = body.revision;
      turnCalls.push(body); lastTurn = body;
      if (turnDelay) await new Promise(resolve => setTimeout(resolve, turnDelay));
      if (failNextTurn) { failNextTurn = false; return route.abort("failed"); }
      response = { answer: "Dies ist eine gekennzeichnete kontrollierte UI-Testantwort.", requestId: body.clientTurnId, actions: [], results: [{ id: "fixture-read", readAt: new Date().toISOString(), summary: "Kontrolliertes Testresultat", items: [] }], conversation, revision, stale: false, audioDelivered: true };
      if (fallbackNextTurn) { fallbackNextTurn = false; response.audioDelivered = false; response.fallbackAudio = Buffer.from([1, 2, 3]).toString("base64"); }
    } else if (url.pathname.endsWith("/session")) {
      if (request.method() === "GET") response = { mode: "live", config: settings, activeSession: activeSessionId ? { id: activeSessionId } : null };
      else {
        if (activeSessionId && !body.reconnect) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "LIVE_SESSION_ALREADY_ACTIVE", error: "Eine Sprachsitzung ist noch geöffnet." }) });
        activeSessionId = "fixture-session";
        selectedVoices.push(body.voice);
        selectedEnergy.push(body.energy);
        if (!body.reconnect) introState = "WAITING";
        startEntered?.();
        if (delayedStart) await delayedStart;
        if (failStart) { failStart = false; return route.abort("failed"); }
        response = { mode: "live", session: { id: activeSessionId, introState, revision, expiresAt: new Date(Date.now() + 600_000).toISOString() }, conversation, transport: { type: "webrtc", sdp: "controlled-answer" } };
      }
    } else if (request.method() === "GET") response = { session: { introState, revision } };
    else if (request.method() === "PATCH") { revision = Math.max(revision, body.revision || 0); }
    else if (request.method() === "DELETE") {
      if (failEnd) { failEnd = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Kontrollierter Fehler beim Beenden" }) }); }
      ends++; activeSessionId = null;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/api/ai-crm/requests/**", route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Controlled not-found fixture" }) }));
  await page.goto(`${origin}/heute`);
  await page.getByRole("button", { name: /^Mit Jarvis sprechen/ }).click();
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Sprachchat starten", exact: true }).count(), 1, "the composer has one visible voice entry");
  assert.equal(await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).count(), 0, "opening Jarvis does not claim an active microphone");

  await page.getByRole("button", { name: "Vorherige Sitzung beenden", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__micRequests), 0, "discovering a stale lock never opens the microphone");
  await page.getByRole("button", { name: "Vorherige Sitzung beenden", exact: true }).click();
  await page.getByText("Kontrollierter Fehler beim Beenden", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Sprachchat starten", exact: true }).isDisabled(), true, "do not pretend an unacknowledged end succeeded");
  await page.getByRole("button", { name: "Vorherige Sitzung beenden", exact: true }).click();
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__micRequests), 0, "ending another session does not implicitly start audio");
  await page.getByRole("textbox", { name: "Nachricht an den Assistenten" }).fill("Mein Entwurf bleibt erhalten");
  await page.evaluate(() => { window.__redesignComposer = document.getElementById("assistant-message"); });
  assert.equal(await page.getByRole("button", { name: "Sprachchat starten", exact: true }).count(), 1, "a text draft does not duplicate the voice entry");
  assert.equal(await page.getByLabel("Jarvis-Stimme", { exact: true }).count(), 0, "the normal composer has no voice preference selector");
  assert.equal(await page.getByLabel("Jarvis-Gesprächsstil", { exact: true }).count(), 0, "the normal composer has no style preference selector");
  await page.getByRole("button", { name: "Weitere Eingabemöglichkeiten", exact: true }).click();
  await page.getByRole("menuitem", { name: "Nachricht diktieren", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "Nachricht diktieren", exact: true }).press("Escape");
  const firstIntroResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/intro"));
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  await firstIntroResponse;
  await page.getByLabel("Gesprächsverlauf").getByText("Hallo, Meister Emil.", { exact: true }).waitFor();
  assert.equal(await page.locator('.assistant-message[data-kind="speech"]').count(), 1, "a transcript arriving immediately with session.started survives conversation startup");
  const micBeforeLayout = await page.evaluate(() => window.__micRequests);
  assert.equal(selectedVoices.at(-1), "meridian", "the session uses the approved default voice when config has no voice");
  assert.equal(selectedEnergy.at(-1), "balanced", "the session starts with the shared default style");
  assert.equal(await page.getByRole("button", { name: "Sprachchat starten", exact: true }).count(), 0, "an active session replaces the voice entry");
  assert.equal(await page.getByLabel("Jarvis-Stimme", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Jarvis-Gesprächsstil", { exact: true }).count(), 0);
  await page.getByRole("textbox", { name: "Im Gespräch schreiben", exact: true }).waitFor();
  await page.evaluate(() => {
    const event = { type: "session.output_transcript.delta", delta: "Hallo, Meister Emil.", event_id: "greeting-caption", start_ms: 0, end_ms: 1000 };
    window.__peer.channel.onmessage({ data: JSON.stringify(event) });
    window.__peer.channel.onmessage({ data: JSON.stringify(event) });
  });
  await page.getByLabel("Gesprächsverlauf").getByText("Hallo, Meister Emil.", { exact: true }).waitFor();
  assert.equal(await page.locator('.assistant-message[data-kind="speech"]').count(), 1);
  assert.equal(await page.getByRole("button", { name: "Live-Mitschrift", exact: true }).count(), 0, "speech belongs to the main chat without a second tab");
  await page.screenshot({ path: fileURLToPath(new URL("hype-live-captions.png", output)) });
  await page.getByRole("button", { name: "Groß öffnen", exact: true }).click();
  await page.waitForURL("**/assistent");
  await page.getByRole("button", { name: "Als Panel öffnen", exact: true }).click();
  await page.waitForURL("**/heute");
  assert.equal(await page.evaluate(() => window.__micRequests), micBeforeLayout, "layout switch preserves the one live transport");
  assert.equal(await page.evaluate(() => document.getElementById("assistant-message") === window.__redesignComposer), true, "composer stays mounted during speech and layout changes");
  assert.equal(await page.getByRole("button", { name: "Weitere Eingabemöglichkeiten", exact: true }).count(), 0, "live owns the microphone while the dictation menu is hidden");
  assert.equal(await page.getByRole("menuitem", { name: "Nachricht diktieren", exact: true }).count(), 0);

  // Native startup is requested before any user speech, without a TTS clip or music gate.
  assert.equal(introCalls, 1); assert.equal(turnCalls.length, 0);
  assert.equal(greetingAcceptances.length, 1);
  assert.equal(await page.evaluate(() => window.__audio.filter(audio => audio.createdSrc.startsWith("blob:")).length), 0);
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.src.includes("/live/music"))?.paused), true);
  turnDelay = 800;
  await page.evaluate(() => window.__say("Was ist heute für mich offen?"));
  await page.getByText("Jarvis schaut für dich nach", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), false, "Live backchannels stay audible while CRM work is pending");
  await page.getByText("Kontrolliertes Testresultat", { exact: true }).waitFor();
  turnDelay = 0;
  await page.getByLabel("Gesprächsverlauf").getByText("Was ist heute für mich offen?", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Gesprächsverlauf").getByText("Was ist heute für mich offen?", { exact: true }).count(), 1, "a backend reply must not repeat the transcribed user question");
  const firstLiveResult = page.locator("section.assistant-live-result").first();
  await firstLiveResult.getByText("Ergebnis aus dem Sprachgespräch", { exact: true }).waitFor();
  assert.equal(await firstLiveResult.getByText("Dies ist eine gekennzeichnete kontrollierte UI-Testantwort.", { exact: true }).isVisible(), true, "the backend result is directly readable in the main chat");
  await page.evaluate(() => {
    window.__peer.channel.onmessage({ data: JSON.stringify({ type: "session.output_transcript.delta", event_id: "actual-answer-one", delta: "Ey, jetzt packen wir's an!", start_ms: 6000, end_ms: 6500 }) });
    window.__peer.channel.onmessage({ data: JSON.stringify({ type: "session.output_transcript.delta", event_id: "actual-answer-two", delta: " Hier ist dein nächster Schritt.", start_ms: 6500, end_ms: 7200 }) });
  });
  await page.getByLabel("Gesprächsverlauf").getByText("Ey, jetzt packen wir's an! Hier ist dein nächster Schritt.", { exact: true }).waitFor();
  await firstLiveResult.getByText("Dies ist eine gekennzeichnete kontrollierte UI-Testantwort.", { exact: true }).waitFor();
  assert.equal(await firstLiveResult.locator("summary").count(), 0, "the result is readable beside speech without a summary toggle");
  await page.screenshot({ path: fileURLToPath(new URL("spoken-main-chat.png", output)) });
  assert.equal(turnCalls[0].transcript, "Was ist heute für mich offen?"); assert.equal(introCalls, 1);
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.volume), .8, "greeting and ongoing speech share a reduced output level");
  await page.getByRole("button", { name: "Sprachausgabe unterbrechen", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), true);
  await page.evaluate(() => window.__say("Danke."));
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), false, "a new social reply resumes native Live after manual stop");
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.equal(turnCalls.length, 1, "short social replies do not enter the slower CRM backend");
  await page.evaluate(() => window.__say("Mehr Energie"));
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(turnCalls.length, 1, "a spoken style change stays in the Live conversation");
  await page.evaluate(() => window.__say("Musik an"));
  await page.waitForFunction(() => window.__audio.some(audio => audio.src.includes("/live/music") && !audio.paused));
  // Raw microphone noise while Jarvis speaks must not mute or revoke his answer.
  await page.evaluate(() => { window.__outputLevel = .12; });
  await page.getByText("Jarvis spricht", { exact: true }).waitFor();
  const revisionBeforeNoise = revision;
  await page.evaluate(() => { window.__inputLevel = .08; });
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), false, "microphone noise without recognized speech must not cut off Jarvis");
  assert.equal(revision, revisionBeforeNoise, "noise must not cancel backend work");
  await page.evaluate(() => { window.__inputLevel = 0; window.__outputLevel = 0; });
  await page.getByLabel("Sprachoptionen", { exact: true }).click();
  await page.getByText("Musik · läuft", { exact: true }).click();
  await page.getByRole("button", { name: "Musikpause", exact: true }).click();
  await page.getByLabel("Sprachoptionen", { exact: true }).click();
  await page.evaluate(() => { window.__outputLevel = .12; });
  await page.getByText("Jarvis spricht", { exact: true }).waitFor();
  await page.evaluate(() => window.__say("Etwas leiser. Was habe ich selbst zugesagt?"));
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), false, "native interruption leaves the new acknowledgment audible");
  await page.evaluate(() => { window.__outputLevel = 0; });
  await page.waitForFunction(() => document.querySelectorAll(".assistant-read-result").length >= 2);
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), false, "the next current answer resumes normally");
  const controlledTiming = await page.evaluate(() => ({ crmResultVisibleAfterCrmUtteranceMs: Math.round(performance.now() - window.__lastUtteranceEnd), providerLatencyMeasured: false, audioPlaybackHardwareMeasured: false }));
  assert.equal(turnCalls.at(-1).transcript, "Was habe ich selbst zugesagt?");
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.src.includes("/live/music"))?.paused), true);
  await page.evaluate(() => { window.__peer.connectionState = "failed"; window.__peer.onconnectionstatechange(); });
  await page.getByRole("button", { name: "Verbindung wiederherstellen", exact: true }).click();
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  assert.equal(introCalls, 1, "technical reconnect preserves the durable intro state");
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.src.includes("/live/music"))?.paused), true, "reconnect never restarts paused music");
  await page.getByRole("button", { name: "Stumm", exact: true }).click();
  await page.getByText("Mikrofon stumm · Verbindung aktiv", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Mikrofon einschalten", exact: true }).click();
  // A lost response is recovered by operation id; explicit retry uses the original id/body.
  failNextTurn = true; fallbackNextTurn = true; await page.evaluate(() => window.__say("Welche Aufgaben stehen diese Woche an?"));
  await page.getByRole("button", { name: "Ergebnis anhand der Operationskennung prüfen" }).click();
  await page.getByRole("button", { name: "Dieselbe Anfrage erneut senden" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".assistant-read-result").length >= 3);
  assert.equal(turnCalls.at(-1).clientTurnId, turnCalls.at(-2).clientTurnId);
  assert.deepEqual(turnCalls.at(-1), turnCalls.at(-2));
  await page.waitForFunction(() => window.__audio.some(audio => audio.createdSrc.startsWith("blob:")));
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), true, "the Live output is muted while verified fallback audio plays");
  await page.evaluate(() => window.__say("Danke."));
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), false, "the next spoken turn restores Live output");
  await page.getByRole("button", { name: "Groß öffnen", exact: true }).click();
  await page.waitForURL("**/assistent");
  for (const dark of [true, false]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value), dark);
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: fileURLToPath(new URL("redesign-live-" + width + (dark ? "-dark" : "-light") + ".png", output)) });
      const geometry = await page.evaluate(() => {
        const bar = document.querySelector(".assistant-voice-bar").getBoundingClientRect();
        const messages = document.querySelector(".assistant-messages").getBoundingClientRect();
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, barWidth: bar.width, chatWidth: messages.width, barX: bar.x, chatX: messages.x };
      });
      assert.ok(geometry.scrollWidth <= geometry.width + 1);
      assert.ok(Math.abs(geometry.barWidth - geometry.chatWidth) <= 1 && Math.abs(geometry.barX - geometry.chatX) <= 1, "chat and voice composer align exactly: " + JSON.stringify(geometry));
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("button", { name: "Als Panel öffnen", exact: true }).click();
  await page.screenshot({ path: fileURLToPath(new URL("desktop.png", output)), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // Read both rectangles in the same frame: the responsive panel animates on resize.
  await page.waitForFunction(() => {
    const end = document.querySelector('[aria-label="Sitzung beenden"]').getBoundingClientRect();
    const bar = document.querySelector(".assistant-voice-bar").getBoundingClientRect();
    return end.height > 0 && end.top >= bar.top - .5 && end.bottom <= bar.bottom + .5;
  }, undefined, { timeout: 5000 });
  await page.screenshot({ path: fileURLToPath(new URL("mobile.png", output)), fullPage: false });
  await page.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Nachricht an den Assistenten" }).inputValue(), "Mein Entwurf bleibt erhalten");
  assert.ok(ends >= 1); assert.ok(await page.evaluate(() => window.__trackStops >= 1)); assert.equal(introCalls, 1);
  // A superseded slow intro response must never start after the user moved to CRM.
  await page.setViewportSize({ width: 1280, height: 900 });
  introState = "WAITING"; introDelay = 3500;
  const beforeGreetings = greetingAcceptances.length;
  const slowIntroEntered = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/intro"));
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  await slowIntroEntered;
  const beforeClips = await page.evaluate(() => window.__audio.filter(audio => audio.createdSrc.startsWith("blob:")).length);
  await page.getByRole("textbox", { name: "Im Gespräch schreiben", exact: true }).fill("Was ist für meine Führungsrunde offen?");
  await page.getByRole("button", { name: "Im Gespräch senden", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".assistant-read-result").length >= 4);
  await new Promise(resolve => setTimeout(resolve, 3800));
  assert.equal(await page.evaluate(() => window.__audio.filter(audio => audio.createdSrc.startsWith("blob:")).length), beforeClips);
  assert.equal(greetingAcceptances.length, beforeGreetings, "a skipped greeting cannot arrive after the CRM answer");
  await page.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
  // Uncertain native delivery stays claimed; only an explicit retry asks again.
  introState = "WAITING"; introDelay = 0; failIntro = true;
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  await page.getByText("Controlled uncertain greeting delivery", { exact: true }).waitFor();
  await page.getByLabel("Sprachoptionen", { exact: true }).click();
  const retryResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/intro"));
  await page.getByRole("button", { name: "Begrüßung erneut anfordern", exact: true }).click();
  await retryResponse;
  assert.deepEqual(introBodies.at(-1), { replay: true });
  await page.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
  // The same voice surface plays the server-approved greeting clip if sideband delivery fails.
  fallbackIntro = true;
  const beforeFallbackIntro = await page.evaluate(() => window.__audio.filter(audio => audio.createdSrc.startsWith("blob:")).length);
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  await page.waitForFunction(count => window.__audio.filter(audio => audio.createdSrc.startsWith("blob:")).length > count, beforeFallbackIntro);
  assert.equal(await page.evaluate(() => window.__audio.find(audio => audio.srcObject?.kind === "output")?.muted), true);
  await page.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
  // An accepted start with a lost HTTP response exposes owner-scoped recovery.
  failStart = true;
  const endsBeforeLostStart = ends;
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await page.getByRole("button", { name: "Vorherige Sitzung beenden", exact: true }).waitFor();
  assert.equal(ends, endsBeforeLostStart, "a lost response must not silently end a possibly different tab");
  assert.equal(await page.evaluate(() => window.__peer.connectionState), "closed");
  await page.getByRole("button", { name: "Vorherige Sitzung beenden", exact: true }).click();
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  assert.equal(activeSessionId, null);
  // Cancelling before the start response arrives still closes the late session.
  let releaseStart;
  delayedStart = new Promise(resolve => { releaseStart = resolve; });
  const entered = new Promise(resolve => { startEntered = resolve; });
  const endsBeforeCancel = ends;
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await entered;
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.getByLabel("Jarvis startet", { exact: true }).waitFor();
    assert.equal(await page.getByText("Jarvis ist gleich für dich da …", { exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Abbrechen", exact: true }).isVisible(), true);
    assert.equal(await page.locator(".assistant-voice-notices .assistant-error:visible").count(), 0);
    assert.equal(await page.getByText(/Sprachverbindung wird hergestellt|Mikrofonfreigabe wird angefragt/).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: fileURLToPath(new URL(`redesign-connecting-${width}.png`, output)) });
  }
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  releaseStart(); delayedStart = null; startEntered = null;
  await page.waitForResponse(response => response.request().method() === "DELETE" && response.url().endsWith("/fixture-session"));
  assert.equal(ends, endsBeforeCancel + 1);
  assert.equal(activeSessionId, null);
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
  await page.evaluate(() => { window.__denyMic = true; });
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await page.getByText(/Mikrofonzugriff wurde verweigert/).waitFor();
  await page.getByRole("textbox", { name: "Nachricht an den Assistenten" }).waitFor();
  await page.evaluate(() => { window.__denyMic = false; });
  await page.reload();
  await page.getByRole("button", { name: "Jarvis", exact: true }).click();
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  await page.getByRole("button", { name: "Groß öffnen", exact: true }).click();
  await page.waitForURL("**/assistent");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: fileURLToPath(new URL("redesign-start-desktop.png", output)) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fileURLToPath(new URL("redesign-start-mobile.png", output)) });
  assert.deepEqual(errors, []);
  await writeFile(new URL("report.json", output), JSON.stringify({ passed: true, simulated: true, controlledTiming, assertions: ["one voice entry and no primary preference selectors", "default voice and balanced style sent to session", "readable CRM results beside speech", "direct text continuation during voice", "same composer and live transport across panel/workspace", "draft restored after voice", "microphone denied returns to text", "chat and composer align at 320/390/768/1440/1920 in both themes", "WebRTC handshake/ICE", "native greeting after session.started without user speech or TTS", "CRM question without music gate", "Live acknowledgments remain audible while backend works", "social replies bypass CRM", "music starts only on explicit request", "noise cannot cancel output", "native interruption without a second delayed stop", "pause preserved after speech and ducking", "reconnect preserves intro and does not restart music", "shared timeline sources", "mute separate from end", "lost response retry keeps operation id", "desktop/mobile overflow and persistent microphone/end controls", "tracks and transport cleanup", "superseded slow intro never plays", "uncertain greeting delivery has explicit retry"], liveProvider: "not tested", microphoneHardware: "not tested", actualMusic: "not tested" }, null, 2));
  console.log("Jarvis pilot controlled browser acceptance passed.");
} finally {
  await writeFile(new URL("server.log", output), logs);
  await browser?.close(); server.kill(); await new Promise(resolve => server.once("exit", resolve)); await fixture.close();
}
