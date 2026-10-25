// Actual Next UI and release APIs on a disposable database. Live media/API fixtures
// exercise the existing browser controller; no provider, device or production claim.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";
import { RELEASES } from "../lib/releases/catalog.ts";
import { releaseContentHash } from "../lib/releases/service.ts";
import { workflowUiBrowser } from "./workflow-ui-browser.mjs";
import { remodelProductFlows } from "./remodel-product-flows.mjs";

const fixture = await testDatabase(0, 24);
const db = fixture.client;
const providerRequests = [];
const provider = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/responses");
    let text = ""; for await (const chunk of request) text += chunk;
    const body = JSON.parse(text); providerRequests.push(body);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: `fixture-${providerRequests.length}`, object: "response", status: "completed", model: body.model,
      output: [{ type: "message", id: `fixture-message-${providerRequests.length}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Isolierte Jarvis-Vorbereitung: Die aktuelle eigene Quelle wurde geprüft; offene Angaben bleiben offen.", annotations: [] }] }],
      usage: { input_tokens: 20, output_tokens: 15, total_tokens: 35 } }));
  } catch { response.writeHead(500); response.end("Local Responses fixture failed"); }
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
const port = Number(process.env.CRM_REMODEL_BROWSER_PORT || 3158);
const origin = `http://127.0.0.1:${port}`;
const testDist = process.env.CRM_REMODEL_BROWSER_DIST || ".cache/remodel-ui-next";
const output = new URL(`../test-results/${process.env.CRM_REMODEL_BROWSER_OUTPUT || "remodel-ui"}/`, import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(new URL("../.cache/remodel-ui/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/remodel-ui/tsconfig.json", import.meta.url), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
await writeFile(new URL("server.log", output), "");
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
let browser, server, page;
const checks = [], errors = [];
const release = RELEASES[0];
const user = await db.user.create({ data: { name: "UI Prüfkonto", createdAt: new Date("2020-01-01"), passwordHash: "synthetic-only", passwordSalt: "synthetic-fixture-salt", onboardingDoneAt: new Date(), aiBetaEnabled: true, person: { create: { name: "UI Prüfkonto" } }, startProgress: { create: { phase: "DONE" } } } });
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });
async function context(userId = user.id, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addCookies([{ name: authCookieName, value: await createSession(userId), url: origin }]);
  const nextPage = await context.newPage(); nextPage.setDefaultTimeout(30_000); nextPage.setDefaultNavigationTimeout(120_000);
  await nextPage.addInitScript(() => { window.__scriptErrors = []; window.addEventListener("error", event => window.__scriptErrors.push({ message: event.message, filename: event.filename, line: event.lineno, column: event.colno })); });
  nextPage.on("pageerror", error => errors.push({ message: error.message, stack: error.stack })); page = nextPage;
  return { context, page: nextPage };
}
const surface = page => page.locator("#crm-assistant-surface");
async function layout(page, label, controls = []) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, surface: document.querySelector("#crm-assistant-surface")?.getBoundingClientRect().toJSON() }));
  assert.ok(geometry.scroll <= geometry.width + 1, `${label}: overflow ${JSON.stringify(geometry)}`);
  const inputs = await page.locator(".assistant-composer textarea:visible").evaluateAll(elements => elements.map(element => ({ height: element.clientHeight, scroll: element.scrollHeight, overflow: getComputedStyle(element).overflowY })));
  assert.ok(inputs.every(input => input.scroll <= input.height + 1 || input.overflow === "auto"), `${label}: clipped composer ${JSON.stringify(inputs)}`);
  for (const control of controls) {
    if (["history-", "memory-", "work-", "pilot-"].some(prefix => label.startsWith(prefix))) await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    assert.ok(box && box.width >= 43 && box.height >= 43 && box.x >= -1 && box.x + box.width <= geometry.width + 1 && box.y >= -1 && box.y + box.height <= geometry.height + 1, `${label}: control geometry ${JSON.stringify(box)}`);
  }
}
async function shot(page, label) { await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)), animations: "disabled" }); }
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "--hostname", "127.0.0.1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", CRM_TEST_DIST_DIR: testDist, CRM_TEST_DISABLE_WEBPACK_CACHE: "1", CRM_TEST_TSCONFIG: ".cache/remodel-ui/tsconfig.json", NEXT_TELEMETRY_DISABLED: "1", AI_CRM_ENABLED: "true", AI_CRM_EXECUTION_MODES: "true", AI_LIVE_PROVIDER: "mock", OPENAI_API_KEY: "local-responses-fixture-only", OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, OPENAI_ORG_ID: "", OPENAI_PROJECT_ID: "", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "", SPOTIFY_ENABLED: "false", SPOTIFY_LOCAL_ENABLED: "false" } });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => appendFileSync(new URL("server.log", output), chunk));
  for (let index = 0; index < 120; index++) { try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {} if (index === 119) throw new Error("Server did not start"); await new Promise(resolve => setTimeout(resolve, 500)); }
  browser = await chromium.launch({ headless: true });
  const first = await context(); page = first.page;
  if (process.env.CRM_REMODEL_ONLY_WORKFLOW === "1") {
    await page.goto(`${origin}/tools/jarvis-erinnerungen`, { timeout: 120_000 });
    await page.getByRole("button", { name: "Jarvis", exact: true }).first().click();
    await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten", exact: true }).waitFor();
  } else {
  await page.goto(`${origin}/neuigkeiten`, { timeout: 120_000 });
  await page.getByText("Du bist auf dem aktuellen Stand.", { exact: true }).waitFor();
  assert.equal(await page.getByText(release.title, { exact: true }).count(), 0);
  checks.push("draft content never appears without a publication");
  // An isolated fixture publication is deliberately not the administrative production path.
  await db.releasePublication.create({ data: { id: release.id, contentHash: releaseContentHash(release), deploymentId: "isolated-browser-fixture", confirmedById: user.id, publishedAt: new Date() } });
  await page.goto(`${origin}/heute`);
  await page.getByRole("dialog", { name: "Das ist neu", exact: true }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link").count(), 5);
  const acknowledgement = page.waitForResponse(response => response.url().endsWith("/api/releases/acknowledge") && response.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: "Später", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Das ist neu"]'));
  assert.equal((await acknowledgement).ok(), true);
  await assert.doesNotReject(async () => {
    for (let index = 0; index < 30; index++) { if (await db.releaseAcknowledgement.count({ where: { userId: user.id, releaseId: release.id } })) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error("Acknowledgement was not stored");
  });
  const second = await context();
  await second.page.goto(`${origin}/heute`); await second.page.waitForTimeout(2200);
  assert.equal(await second.page.getByRole("dialog", { name: "Das ist neu" }).count(), 0);
  await second.context.close();
  checks.push("one acknowledgement persists through a separate browser context; five work areas retained");
  const newlyCreated = await db.user.create({ data: { name: "Neues Prüfkonto", passwordHash: "synthetic-only", onboardingDoneAt: new Date(), person: { create: { name: "Neues Prüfkonto" } }, startProgress: { create: { phase: "DONE" } } } });
  const newcomer = await context(newlyCreated.id);
  await newcomer.page.goto(`${origin}/heute`); await newcomer.page.waitForTimeout(2200);
  assert.equal(await newcomer.page.getByRole("dialog", { name: "Das ist neu" }).count(), 0);
  await newcomer.context.close();
  checks.push("a new account gets history without old entry popups");
  for (const blocker of ["writing", "dialog", "emil", "assistant"]) {
    const pending = await db.user.create({ data: { name: `Warten ${blocker}`, createdAt: new Date("2020-01-01"), passwordHash: "synthetic-only", onboardingDoneAt: new Date(), aiBetaEnabled: true, person: { create: { name: `Warten ${blocker}` } }, startProgress: { create: { phase: "DONE" } } } });
    const next = await context(pending.id); page = next.page;
    await page.route("**/api/releases", async route => { await new Promise(resolve => setTimeout(resolve, 900)); await route.continue(); });
    await page.goto(`${origin}/heute`);
    if (blocker === "assistant") await page.getByRole("button", { name: "Jarvis", exact: true }).first().click();
    else await page.evaluate(kind => {
      const element = document.createElement(kind === "writing" ? "input" : kind === "dialog" ? "dialog" : "aside"); element.id = "work-blocker";
      if (kind === "emil") { element.className = "emil-expanded"; element.textContent = "Isolierte Mini-Emil-Prüfansicht"; }
      document.body.appendChild(element); if (kind === "writing") element.focus(); if (kind === "dialog") element.showModal();
    }, blocker);
    await page.waitForTimeout(2600);
    assert.equal(await page.getByRole("dialog", { name: "Das ist neu" }).count(), 0, `${blocker} should defer announcement`);
    if (blocker === "assistant") await surface(page).getByRole("button", { name: "Assistent schließen" }).click();
    else await page.evaluate(() => document.getElementById("work-blocker").remove());
    await page.getByRole("dialog", { name: "Das ist neu" }).waitFor();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Alle Neuigkeiten");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Schließen");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Das ist neu" }).waitFor({ state: "hidden" });
    await next.context.close();
  }
  checks.push("entry waits for writing, work dialog, Mini-Emil and open Jarvis; modal traps focus and Escape dismisses");
  const busyUser = await db.user.create({ data: { name: "Geräteübergreifend", createdAt: new Date("2020-01-01"), passwordHash: "synthetic-only", onboardingDoneAt: new Date(), person: { create: { name: "Geräteübergreifend" } }, startProgress: { create: { phase: "DONE" } } } });
  const waitingTab = await context(busyUser.id); page = waitingTab.page;
  await page.route("**/api/releases", async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
  await page.goto(`${origin}/heute`);
  await page.evaluate(() => { const input = document.createElement("input"); input.id = "typing-cross-device"; document.body.appendChild(input); input.focus(); });
  await page.waitForTimeout(1500);
  const otherDevice = await context(busyUser.id);
  await otherDevice.page.goto(`${origin}/neuigkeiten`);
  assert.equal(await otherDevice.page.evaluate(async releaseId => (await fetch("/api/releases/acknowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ releaseIds: [releaseId] }) })).ok, release.id), true);
  page = waitingTab.page;
  await page.bringToFront();
  await page.evaluate(() => document.getElementById("typing-cross-device").remove());
  await page.waitForTimeout(3000);
  assert.equal(await page.getByRole("dialog", { name: "Das ist neu" }).count(), 0);
  await otherDevice.context.close(); await waitingTab.context.close();
  checks.push("deferred entry rechecks acknowledgements made on another device before opening");

  page = first.page;
  await page.goto(`${origin}/neuigkeiten?release=${release.id}&opened=1`);
  await page.getByRole("heading", { name: release.title, exact: true }).waitFor();
  for (const dark of [false, true]) for (const scale of [1, 2]) for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(({ dark, scale }) => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.fontSize = `${scale * 100}%`; }, { dark, scale });
    await layout(page, `history-${width}-${dark}-${scale}`, [page.locator(".crm-release-action")]);
    if (scale === 1) await shot(page, `history-${width}-${dark ? "dark" : "light"}`);
  }
  checks.push("history fits 320/390/768/1440, light/dark and 200 percent text");
  await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Jarvis", exact: true }).first().click();
  await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten" }).waitFor();
  await surface(page).getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const start = document.querySelector("#crm-assistant-surface .assistant-live-start");
    return start instanceof HTMLButtonElement && !start.disabled;
  });
  assert.equal(await surface(page).getByRole("button", { name: "Sprachchat starten", exact: true }).count(), 1);
  assert.equal(await surface(page).getByRole("combobox", { name: /Jarvis-(Stimme|Gesprächsstil)/ }).count(), 0);
  assert.equal(await surface(page).getByRole("button", { name: "Senden", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "H2");
  for (const dark of [false, true]) for (const scale of [1, 2]) for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(({ dark, scale }) => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.fontSize = `${scale * 100}%`; }, { dark, scale });
    await layout(page, `composer-${width}-${dark}-${scale}`, [surface(page).getByRole("button", { name: "Sprachchat starten", exact: true })]);
    assert.equal(await surface(page).evaluate(element => getComputedStyle(element).getPropertyValue("--color-canvas").trim()), dark ? "#212121" : "#fff");
    if (scale === 1) await shot(page, `composer-${width}-${dark ? "dark" : "light"}`);
  }
  checks.push("one labelled voice entry, no idle send or preferences; neutral theme verified at all widths and 200 percent text");
  await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
  await surface(page).getByRole("button", { name: "Weitere Eingabemöglichkeiten" }).click();
  await surface(page).getByRole("menuitem", { name: "Nachricht diktieren" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Weitere Eingabemöglichkeiten");
  await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten" }).fill("Entwurf bleibt beim Sprachgespräch");
  assert.equal(await surface(page).getByRole("button", { name: "Senden", exact: true }).count(), 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await surface(page).getByRole("button", { name: "Groß öffnen", exact: true }).click();
  await page.waitForURL("**/assistent");
  assert.equal(await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten" }).inputValue(), "Entwurf bleibt beim Sprachgespräch");
  assert.equal(await surface(page).getByRole("button", { name: "Neuer Chat", exact: true }).isVisible(), true);
  assert.equal(await surface(page).getByRole("button", { name: "Neue Unterhaltung", exact: true }).count(), 0);
  await surface(page).getByRole("button", { name: "Unterhaltungen schließen", exact: true }).click();
  assert.equal(await surface(page).getByRole("button", { name: "Neue Unterhaltung", exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem("crm-jarvis-sidebar")), "closed");
  await surface(page).getByRole("button", { name: "Als Panel öffnen", exact: true }).click();
  await page.waitForURL("**/neuigkeiten");
  checks.push("panel/workspace keeps draft; new chat appears once and sidebar choice is remembered");

  // Minimal local media and existing simulated controller, with explicit fake responses.
  await page.evaluate(() => {
    window.__microphones = 0; window.__stops = 0;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(utterance) { queueMicrotask(() => utterance.onend?.()); } } });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { window.__microphones++; if (window.__deny) throw new DOMException("Fixture denial", "NotAllowedError"); const track = { enabled: true, stop() { window.__stops++; } }; return { getTracks: () => [track], getAudioTracks: () => [track] }; } } });
  });
  const conversation = { id: "browser-live", title: "Isolierte Sprachprüfung", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), updatedAt: new Date().toISOString(), messageCount: 2, executionMode: "CONFIRM", executionVersion: 0 };
  const music = { connection: "LOCAL_SIMULATION", playback: "STOPPED", mode: "simulation", query: null, message: "Lokale Browserprüfung" };
  let liveTurns = 0, chatCalls = 0;
  await page.route("**/api/ai-crm/chat", route => { chatCalls++; return route.abort(); });
  await page.route("**/api/ai-crm/live/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const body = request.method() === "POST" ? request.postDataJSON() : {};
    if (url.pathname.endsWith("/turn")) {
      liveTurns++;
      const stale = body.transcript.includes("Alten Modus prüfen"), modeCheck = !stale && body.transcript.includes("Modus prüfen");
      await route.fulfill({ json: { requestId: body.clientTurnId, answer: modeCheck || stale ? stale ? "Modusprüfung: ältere Antwort empfangen." : "Modusprüfung: aktuelle Leserechte empfangen." : "Prüfantwort: Gesprächskontext ist lesbar. Fehlende Zusagen werden nicht ergänzt.", actions: modeCheck || stale ? [] : [{ id: "browser-preview", requestId: body.clientTurnId, status: "PENDING", summary: "Isolierter Vorschlag · noch nicht gespeichert", details: ["Testvorschau mit sichtbarer Bestätigung"], confirmLabel: "Notiz speichern" }], results: modeCheck || stale ? [] : [{ id: "browser-read", readAt: new Date().toISOString(), summary: "Isolierte aktuelle CRM-Quelle", coverage: "Nur gekennzeichnete Prüfdaten", items: [{ id: "source", title: "Quelle der Prüfansicht", link: "/contacts" }] }], conversation: modeCheck ? { ...conversation, executionMode: "READ_ONLY", executionVersion: 2 } : conversation, music } });
    } else if (request.method() === "POST") await route.fulfill({ json: { session: { id: "browser-session" }, conversation, music, reconnectLimit: 1 } });
    else await route.fulfill({ json: {} });
  });
  await surface(page).getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await surface(page).getByRole("textbox", { name: "Simulation: gesprochene Zeile" }).waitFor();
  assert.equal(await page.evaluate(() => window.__microphones), 1);
  await surface(page).getByRole("textbox", { name: "Simulation: gesprochene Zeile" }).fill("Bereite mein Gespräch vor.");
  await surface(page).getByRole("button", { name: "Live-Zeile senden", exact: true }).click();
  await surface(page).getByRole("list", { name: "Gesprächsverlauf", exact: true }).getByText("Prüfantwort: Gesprächskontext ist lesbar. Fehlende Zusagen werden nicht ergänzt.", { exact: true }).waitFor();
  assert.equal(liveTurns, 1); assert.equal(chatCalls, 0);
  await surface(page).getByRole("button", { name: "Notiz speichern", exact: true }).waitFor();
  await surface(page).getByRole("link", { name: "Quelle öffnen ↗" }).waitFor();
  assert.equal(await surface(page).getByRole("combobox", { name: "Jarvis Zugriffe" }).count(), 1);
  for (const dark of [false, true]) for (const scale of [1, 2]) for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(({ dark, scale }) => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.fontSize = `${scale * 100}%`; }, { dark, scale });
    await layout(page, `live-${width}-${dark}-${scale}`, [surface(page).getByRole("button", { name: "Sitzung beenden", exact: true }), surface(page).getByRole("combobox", { name: "Jarvis Zugriffe" })]);
    if (scale === 1) await shot(page, `live-${width}-${dark ? "dark" : "light"}`);
  }
  checks.push("active text continuation sends one Live turn and no parallel text call; readable result, source, confirmation, mode and end control remain visible");
  await surface(page).getByRole("textbox", { name: "Simulation: gesprochene Zeile" }).fill("Neuen Modus prüfen");
  await surface(page).getByRole("button", { name: "Live-Zeile senden", exact: true }).click();
  await surface(page).getByText("Modusprüfung: aktuelle Leserechte empfangen.", { exact: true }).first().waitFor();
  assert.equal(await surface(page).getByRole("combobox", { name: "Jarvis Zugriffe" }).inputValue(), "READ_ONLY");
  await surface(page).getByRole("textbox", { name: "Simulation: gesprochene Zeile" }).fill("Alten Modus prüfen");
  await surface(page).getByRole("button", { name: "Live-Zeile senden", exact: true }).click();
  await surface(page).getByText("Modusprüfung: ältere Antwort empfangen.", { exact: true }).first().waitFor();
  assert.equal(await surface(page).getByRole("combobox", { name: "Jarvis Zugriffe" }).inputValue(), "READ_ONLY");
  assert.equal(liveTurns, 3); assert.equal(chatCalls, 0);
  checks.push("live response preserves current execution mode/version and cannot replace it with an older mode reply");
  await surface(page).getByRole("button", { name: "Sitzung beenden", exact: true }).click();
  await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten" }).waitFor();
  assert.equal(await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten" }).inputValue(), "Entwurf bleibt beim Sprachgespräch");
  assert.ok(await page.evaluate(() => window.__stops) >= 1);
  await page.route("**/api/ai-crm/conversations/browser-live", route => route.fulfill({ json: { ...conversation, messages: [{ id: "stored-live-result", kind: "live-result", role: "assistant", content: "Gespeicherter isolierter Sprachbeleg.", actions: [], createdAt: new Date().toISOString() }] } }));
  await surface(page).getByRole("button", { name: "Unterhaltungen öffnen", exact: true }).click();
  await surface(page).getByRole("button", { name: "Isolierte Sprachprüfung", exact: true }).click();
  await surface(page).getByText("Gespeicherter isolierter Sprachbeleg.", { exact: true }).waitFor();
  assert.equal(await surface(page).locator(".assistant-live-result").evaluate(element => element.tagName), "SECTION");
  checks.push("reopened persisted live-result fixture is readable without expanding a summary");
  await page.unroute("**/api/ai-crm/chat");
  await page.route("**/api/ai-crm/chat", route => {
    chatCalls++;
    return route.fulfill({ json: { requestId: route.request().postDataJSON().clientRequestId, answer: "Textprüfung: Diese Antwort ist direkt lesbar.", actions: [], conversation: { ...conversation, id: "browser-text", title: "Textprüfung" } } });
  });
  await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten" }).fill("Isolierte Textprüfung");
  await surface(page).getByRole("button", { name: "Senden", exact: true }).click();
  await surface(page).getByRole("list", { name: "Gesprächsverlauf", exact: true }).getByText("Textprüfung: Diese Antwort ist direkt lesbar.", { exact: true }).waitFor();
  assert.equal(chatCalls, 1); assert.equal(liveTurns, 3);
  for (const dark of [false, true]) for (const scale of [1, 2]) for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(({ dark, scale }) => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.fontSize = `${scale * 100}%`; }, { dark, scale });
    await layout(page, `text-${width}-${dark}-${scale}`, [surface(page).getByRole("button", { name: "Sprachchat starten", exact: true })]);
    if (scale === 1) await shot(page, `text-${width}-${dark ? "dark" : "light"}`);
  }
  checks.push("ordinary text uses one request, renders readable response and fits all width/theme/text-scale combinations");
  await page.evaluate(() => { window.__deny = true; });
  await surface(page).getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await surface(page).getByText("Das Mikrofon wurde nicht freigegeben. Du kannst die lokale Live-Demo später erneut starten.", { exact: true }).waitFor();
  await surface(page).getByRole("textbox", { name: "Nachricht an den Assistenten" }).waitFor();
  checks.push("ending releases local tracks and preserves text draft; microphone denial returns to usable text input");
  await page.unroute("**/api/ai-crm/live/**");
  }
  await workflowUiBrowser({ page, db, origin, user, checks, errors, layout, shot, surface });
  await remodelProductFlows({ page, db, origin, user, checks, shot, surface, providerRequests });
  assert.deepEqual(errors, []);
  await writeFile(new URL("result.json", output), JSON.stringify({ success: true, checks, errors, limitations: ["Isolated PostgreSQL through PGlite with synthetic accounts and CRM evidence", "Live and chat responses and media simulated", "No real provider or smartphone", "Pilot UI preparation tested, no real participants or performed study", "No deployment or actual push"] }, null, 2));
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) {
  const scriptErrors = page && !page.isClosed() ? await page.evaluate(() => window.__scriptErrors).catch(() => undefined) : undefined;
  await writeFile(new URL("result.json", output), JSON.stringify({ success: false, checks, error: String(error), errors, scriptErrors }, null, 2));
  if (page && !page.isClosed()) { await shot(page, "failure").catch(() => {}); await page.content().then(content => writeFile(new URL("failure.html", output), content)).catch(() => {}); }
  throw error;
} finally { await browser?.close(); server?.kill(); await new Promise(resolve => provider.close(resolve)); await fixture.close(); }
