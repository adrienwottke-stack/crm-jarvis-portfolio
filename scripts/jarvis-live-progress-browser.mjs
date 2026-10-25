// Controlled UI/transport regression; isolated database, no provider calls or real audio.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";

const fixture = await testDatabase(0, 24);
const port = 3152, origin = `http://127.0.0.1:${port}`;
const output = new URL("../test-results/jarvis-live-progress/", import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(new URL("../.cache/jarvis-live-progress/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/jarvis-live-progress/tsconfig.json", import.meta.url), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "--hostname", "127.0.0.1"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", CRM_TEST_DIST_DIR: ".cache/jarvis-live-progress-next", CRM_TEST_TSCONFIG: ".cache/jarvis-live-progress/tsconfig.json", NEXT_TELEMETRY_DISABLED: "1", AI_CRM_ENABLED: "true", AI_LIVE_PROVIDER: "mock", OPENAI_API_KEY: "", OPENAI_BASE_URL: "http://127.0.0.1:1", SPOTIFY_ENABLED: "false", SPOTIFY_LOCAL_ENABLED: "false", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "" },
});
let logs = "", browser;
server.stdout.on("data", data => { logs += data; }); server.stderr.on("data", data => { logs += data; });
try {
  const user = await fixture.client.user.create({ data: { name: "Progress Browser", aiBetaEnabled: true, onboardingDoneAt: new Date(), person: { create: { name: "Progress Browser" } }, startProgress: { create: { phase: "DONE" } } } });
  await fixture.client.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {} if (i === 119) throw new Error(logs.slice(-3000)); await new Promise(resolve => setTimeout(resolve, 500)); }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.addCookies([{ name: authCookieName, value: await createSession(user.id), url: origin }]);
  const conversation = { id: "progress-conversation", title: "Test", expiresAt: new Date(Date.now() + 86400000).toISOString(), updatedAt: new Date().toISOString(), messageCount: 0 };
  await context.addInitScript(({ conversation }) => {
    window.__turns = []; window.__streams = []; window.__timeline = 0; window.__shortTimeout = false;
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = ms => originalTimeout(window.__shortTimeout && ms === 65000 ? 250 : ms);
    window.Audio = class { muted = false; paused = true; volume = 1; src = ""; srcObject = null; async play() { this.paused = false; } pause() { this.paused = true; } addEventListener() {} removeEventListener() {} load() {} };
    window.AudioContext = class { state = "running"; createMediaStreamSource() { return { connect() {}, disconnect() {} }; } createAnalyser() { return { getFloatTimeDomainData(array) { array.fill(0); }, disconnect() {} }; } async resume() {} async close() {} };
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => { const track = { enabled: true, stop() {} }; return { getTracks: () => [track], getAudioTracks: () => [track] }; } } });
    window.RTCPeerConnection = class extends EventTarget {
      connectionState = "new"; iceGatheringState = "complete";
      addTrack() {} async createOffer() { return { type: "offer", sdp: "fixture" }; } async setLocalDescription(value) { this.localDescription = value; }
      createDataChannel() { this.channel = { readyState: "open", send() {}, close() {} }; window.__channel = this.channel; return this.channel; }
      async setRemoteDescription() { this.connectionState = "connected"; this.onconnectionstatechange?.(); this.channel.onmessage({ data: JSON.stringify({ type: "session.started" }) }); }
      close() { this.connectionState = "closed"; }
    };
    window.__say = text => { window.__timeline += 4000; window.__channel.onmessage({ data: JSON.stringify({ type: "session.input_transcript.delta", event_id: crypto.randomUUID(), delta: text, start_ms: window.__timeline, end_ms: window.__timeline + 1000 }) }); };
    window.__delegate = (id, offset = window.__timeline + 1200) => window.__channel.onmessage({ data: JSON.stringify({ type: "session.delegation.created", event_id: crypto.randomUUID(), offset_ms: offset, delegation: { id, type: "delegation", target: "client" } }) });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (!String(url).endsWith("/turn")) return originalFetch(url, options);
      const body = JSON.parse(options.body); window.__turns.push(body);
      let canceled = false;
      const stream = new ReadableStream({ start(controller) {
        const emit = event => { if (!canceled) controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")); };
        window.__streams.push({ progress: message => emit({ type: "progress", message }), result: data => { emit({ type: "result", status: 200, data: { conversation, answer: "Kontrollierte Antwort", requestId: body.clientTurnId, audioDelivered: true, ...data } }); }, truncate: () => controller.close() });
        options.signal.addEventListener("abort", () => { if (!canceled) { canceled = true; controller.error(options.signal.reason); } }, { once: true });
        emit({ type: "progress", message: "Deine Frage ist angekommen. Ich kümmere mich darum." });
      }, cancel() { canceled = true; } });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
    };
  }, { conversation });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message)); page.setDefaultTimeout(30000);
  await page.route("**/api/ai-crm/live/**", route => {
    const request = route.request(), url = new URL(request.url());
    let data = {};
    if (url.pathname.endsWith("/session")) data = request.method() === "GET" ? { mode: "live", config: { voice: "vesper", greetingText: "Hallo.", inactivitySeconds: 180, warningSeconds: 15, maxSessionSeconds: 600, reconnectLimit: 1 } } : { session: { id: "progress-session", introState: "DONE", revision: 0, expiresAt: new Date(Date.now() + 600000).toISOString() }, conversation, transport: { sdp: "fixture" } };
    if (url.pathname.endsWith("/music")) data = { available: false };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.route("**/api/ai-crm/requests/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "FAILED", response: null }) }));
  await page.goto(`${origin}/heute`);
  await page.getByRole("button", { name: /^Mit Jarvis sprechen/ }).click();
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Sprachchat starten", exact: true }).count(), 1, "the composer has one visible voice entry");
  assert.equal(await page.getByLabel("Jarvis-Stimme", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Jarvis-Gesprächsstil", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  await page.evaluate(() => { window.__say("Was kann ich mit CM machen?"); window.__delegate("question-one"); });
  await page.getByText("Deine Frage ist angekommen. Ich kümmere mich darum.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__turns[0].delegationId), "question-one");
  await page.evaluate(() => window.__streams[0].progress("Die Antwort dauert gerade länger. Deine Anfrage läuft noch."));
  await page.getByText("Die Antwort dauert gerade länger. Deine Anfrage läuft noch.", { exact: true }).waitFor();
  await page.evaluate(() => window.__say("Alles gut, und dir?"));
  await page.waitForTimeout(2300); // Finalize the social utterance with a quiet microphone.
  assert.equal(await page.evaluate(() => window.__turns.length), 1, "smalltalk does not start a new backend job");
  await page.getByText("Die Antwort dauert gerade länger. Deine Anfrage läuft noch.", { exact: true }).waitFor();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
  await page.evaluate(() => window.__streams[0].result({ answer: "Du kannst Kontakte organisieren und deinen Tag planen." }));
  const firstLiveResult = page.locator("section.assistant-live-result").first();
  await firstLiveResult.getByText("Ergebnis aus dem Sprachgespräch", { exact: true }).waitFor();
  assert.equal(await firstLiveResult.getByText("Du kannst Kontakte organisieren und deinen Tag planen.", { exact: true }).isVisible(), true);
  assert.equal(await firstLiveResult.locator("summary").count(), 0, "the CRM result needs no disclosure to be readable");
  await page.evaluate(() => window.__channel.onmessage({ data: JSON.stringify({ type: "session.output_transcript.delta", event_id: "actual-spoken-result", delta: "Lass uns deinen Tag anpacken!", start_ms: 11000, end_ms: 12000 }) }));
  await page.getByLabel("Gesprächsverlauf").getByText("Lass uns deinen Tag anpacken!", { exact: true }).waitFor();
  await firstLiveResult.getByText("Du kannst Kontakte organisieren und deinen Tag planen.", { exact: true }).waitFor();
  await page.getByText("Die Antwort dauert gerade länger. Deine Anfrage läuft noch.", { exact: true }).waitFor({ state: "hidden" });
  // Late delegation of the completed question must not attach to the next one.
  await page.evaluate(() => { window.__delegate("late-one"); window.__say("Was steht heute an?"); });
  await page.waitForFunction(() => window.__turns.length === 2);
  assert.equal(await page.evaluate(() => window.__turns[1].delegationId), undefined);
  await page.evaluate(() => window.__streams[1].result({ stale: true }));
  await page.getByText(/durch einen neueren Auftrag ersetzt/).waitFor();
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  await page.evaluate(() => { window.__shortTimeout = true; window.__say("Welche Aufgaben habe ich?"); });
  await page.getByText("Die Antwort dauert zu lange. Prüfe das Ergebnis, bevor du dieselbe Anfrage erneut sendest.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Ergebnis anhand der Operationskennung prüfen" }).click();
  await page.getByText("Die Anfrage wurde ohne vollständige Antwort beendet. Du kannst die Frage jetzt erneut stellen.", { exact: true }).waitFor();
  await page.evaluate(() => { window.__shortTimeout = false; window.__say("Bereite meinen Tag vor"); });
  await page.waitForFunction(() => window.__turns.length === 4);
  await page.getByRole("button", { name: "Sprachausgabe unterbrechen", exact: true }).click();
  await page.evaluate(() => window.__streams[3].result({ answer: "ALTE ANTWORT DARF NICHT ERSCHEINEN" }));
  await page.getByText("Mikrofon aktiv · Jarvis hört zu", { exact: true }).waitFor();
  assert.equal(await page.getByText("ALTE ANTWORT DARF NICHT ERSCHEINEN").count(), 0);
  await page.evaluate(() => window.__say("Lies meine offenen Aufgaben"));
  await page.waitForFunction(() => window.__turns.length === 5);
  await page.evaluate(() => window.__say("Alles gut, suche stattdessen Anna"));
  await page.waitForFunction(() => window.__turns.length === 6);
  assert.equal(await page.evaluate(() => window.__turns[5].transcript), "Alles gut, suche stattdessen Anna");
  await page.evaluate(() => { window.__streams[4].result({ answer: "VERALTETER AUFTRAG" }); window.__streams[5].result({ answer: "NEUER AUFTRAG" }); });
  await page.locator("section.assistant-live-result").last().getByText("NEUER AUFTRAG", { exact: true }).waitFor();
  assert.equal(await page.getByText("VERALTETER AUFTRAG").count(), 0);
  await page.evaluate(() => window.__say("Prüfe meine nächsten Termine"));
  await page.waitForFunction(() => window.__turns.length === 7);
  await page.evaluate(() => window.__say("Abbrechen"));
  await page.getByText("Anfrage abgebrochen. Du kannst jetzt etwas Neues fragen.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__turns.length), 7, "cancel is a control, never a replacement CRM query");
  await page.evaluate(() => window.__streams[6].result({ answer: "ABGEBROCHENER AUFTRAG" }));
  assert.equal(await page.getByText("ABGEBROCHENER AUFTRAG").count(), 0);
  await page.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
  assert.deepEqual(errors, []);
  await writeFile(new URL("report.json", output), JSON.stringify({ passed: true, simulated: true, checks: ["one voice entry and no primary preference selectors", "readable CRM results beside speech", "quiet microphone transcript", "delegation correlation", "progress before result", "smalltalk preserves pending request and result", "mixed reply starts new request", "spoken cancel prevents old result", "320/390/768/1440 overflow", "late delegation cannot leak", "stale result exits spinner", "timeout exits spinner", "failed recovery is terminal", "interrupted result stays hidden"], realProvider: false }, null, 2));
  console.log("Jarvis progress browser regression passed.");
} finally {
  await writeFile(new URL("server.log", output), logs);
  await browser?.close(); server.kill(); if (server.exitCode === null) await new Promise(resolve => server.once("exit", resolve)); await fixture.close();
}
