// Real Next routes + disposable PostgreSQL; provider responses stay on loopback.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";

const fixture = await testDatabase(0, 30);
const db = fixture.client;
const port = Number(process.env.AI_UX_TEST_PORT || 3134);
const origin = `http://127.0.0.1:${port}`;
const production = process.argv.includes("--production");
const distDir = production ? ".cache/ai-ux-build-next" : ".cache/ai-ux-next";
const tsconfig = production ? ".cache/ai-ux-build/tsconfig.json" : ".cache/ai-ux/tsconfig.json";
const output = new URL("../test-results/ai-crm-ux/", import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(new URL("../.cache/ai-ux/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/ai-ux/tsconfig.json", import.meta.url), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
await writeFile(new URL("server.log", output), "");
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
let server, browser, activePage;
const errors = [], requests = [], checks = [];
const now = new Date();
const owner = await db.user.create({ data: { name: "UX Testberater", email: "ux@example.test", aiBetaEnabled: true, onboardingDoneAt: now, person: { create: { name: "UX Testberater" } }, startProgress: { create: { phase: "DONE" } } } });
const locked = await db.user.create({ data: { name: "Ohne Zugang", onboardingDoneAt: now, person: { create: { name: "Ohne Zugang" } }, startProgress: { create: { phase: "DONE" } } } });
await db.user.update({ where: { id: owner.id }, data: { passwordHash: "synthetic-test-account", path: `/${owner.id}/` } });
const contact = await db.contact.create({ data: { name: "Jonas Müller", phone: "+49 170 1234567", ownerId: owner.id, followUps: { create: { ownerId: owner.id, at: new Date(now.getTime() + 3600000), type: "ANRUF", note: "Entscheidung besprechen" } } } });
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });
await db.user.create({ data: { name: "Direkter Testpartner", passwordHash: "synthetic-test-account", leaderId: owner.id, path: `/${owner.id}/partner/`, onboardingDoneAt: now } });

const provider = createServer(async (request, response) => {
  try {
    let body = ""; for await (const chunk of request) body += chunk;
    if (request.url !== "/v1/responses") { response.writeHead(400); response.end("Unexpected provider endpoint"); return; }
    const data = JSON.parse(body); const userMessage = data.input.findLast(item => item.role === "user")?.content ?? "";
    const round = data.input.filter(item => item.type === "function_call_output").length;
    requests.push({ message: userMessage, round });
    const search = { name: "search_contacts", args: { query: "Jonas" } };
    const update = { name: "update_contact", args: { contactId: contact.id, changeFields: ["phone"], phone: "+49 170 7654321", name: null, email: null, source: null, job: null } };
    const follow = { name: "create_follow_up", args: { contactId: contact.id, type: "ANRUF", at: new Date(Date.now() + 86400000).toISOString(), note: "Nächsten Schritt besprechen" } };
    const activity = { name: "add_activity", args: { contactId: contact.id, type: "CALL", text: "Über den nächsten Schritt gesprochen.", occurredAt: null } };
    const sequence = /Telefonnummer/.test(userMessage) ? [search, update] : /Mehrteilig/.test(userMessage) ? [search, activity, follow] : /Dokumentiere/.test(userMessage) ? [search, activity] : /Wiedervorlage/.test(userMessage) ? [search, follow] : /Kontakt/.test(userMessage) ? [search] : [];
    if (/Langsam/.test(userMessage)) await new Promise(resolve => setTimeout(resolve, 2500));
    const call = sequence[round];
    const answer = /Lesbarkeit/.test(userMessage) ? "## Bereit, Meister Emil.\n\n**Hype-Modus:** an. Ein Schritt nach dem anderen.\n\n- **Fokus:** die nächste Aufgabe.\n- **Tempo:** zügig und klar.\n\n1. Überblick holen.\n2. Bewusst entscheiden.\n\n| Thema | Nächster Schritt |\n| --- | --- |\n| Heute | Überblick prüfen |\n\n<script>window.__unsafeMarkdown=true</script>\n[Unsicher](javascript:alert(1))\n![Tracking](https://tracking.example.test/pixel.png)\n\n" + "Ein gut lesbarer Absatz mit etwas Kontext.\n\n".repeat(12) : /Langer Text/.test(userMessage) ? ("Das ist ein längerer Antworttext mit einer verständlichen nächsten Handlung. ").repeat(45) + "\n" + "https://beispiel.test/" + "sehrlang".repeat(45) : "Hier findest du die Ergebnisse aus deinen eigenen CRM-Daten.";
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: `resp_${randomUUID()}`, object: "response", created_at: Math.floor(Date.now()/1000), status: "completed", model: data.model, output: call ? [{ type: "function_call", id: randomUUID(), call_id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args), status: "completed" }] : [{ type: "message", id: randomUUID(), role: "assistant", status: "completed", content: [{ type: "output_text", text: answer, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));

async function context(userId, viewport, mobile = false) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addCookies([{ name: authCookieName, value: await createSession(userId), url: origin }]);
  await context.addInitScript(() => {
    window.__uxStopped = 0;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { if (window.__uxDeny) throw new DOMException("Denied", "NotAllowedError"); return { getTracks: () => [{ stop() { window.__uxStopped++; } }] }; } } });
    class Recorder {
      static isTypeSupported(type) { return type.startsWith("audio/webm"); }
      constructor() { this.mimeType = "audio/webm"; this.state = "inactive"; }
      start() { this.state = "recording"; }
      stop() { if (this.state !== "recording") return; this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["local fixture"], { type: this.mimeType }) }); this.onstop?.(); }
    }
    Object.defineProperty(window, "MediaRecorder", { value: Recorder, configurable: true });
  });
  await context.route("**/api/ai-crm/transcribe", route => route.fulfill({ json: { transcript: "Bitte plane einen Anruf für Jonas am Freitag." } }));
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  return { context, page };
}
const panel = page => page.locator("#crm-assistant-surface");
async function shot(page, name) { await page.screenshot({ path: new URL(`${name}.png`, output).pathname.replace(/^\/(.:)/, "$1"), animations: "disabled" }); }
async function noOverflow(page) {
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll("body *")].filter(element => { const rect = element.getBoundingClientRect(); return rect.width && (rect.right > innerWidth + 1 || rect.left < -1) && getComputedStyle(element).position !== "absolute"; }).slice(0, 12).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })) }));
  assert.ok(geometry.scrollWidth <= geometry.width, `horizontal overflow: ${JSON.stringify(geometry)}`);
}
async function send(page, text) { await panel(page).getByRole("textbox", { name: "Nachricht an den Assistenten" }).fill(text); await panel(page).getByRole("button", { name: "Senden", exact: true }).click(); await panel(page).getByText("Deine Anfrage wird bearbeitet …", { exact: true }).waitFor({ state: "hidden", timeout: 60000 }); }
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", production ? "start" : "dev", "-p", String(port), "--hostname", "127.0.0.1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", CRM_TEST_DIST_DIR: distDir, CRM_TEST_TSCONFIG: tsconfig, NEXT_TELEMETRY_DISABLED: "1", AI_CRM_ENABLED: "true", AI_LIVE_PROVIDER: "disabled", OPENAI_API_KEY: "local-fixture-only", OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, OPENAI_ORG_ID: "", OPENAI_PROJECT_ID: "", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "" } });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => appendFileSync(new URL("server.log", output), chunk));
  for (let index = 0; index < 120; index++) { try { if ((await fetch(`${origin}/login`)).ok) break; } catch {} if (index === 119) throw new Error("Server did not start"); await new Promise(resolve => setTimeout(resolve, 500)); }
  browser = await chromium.launch({ headless: true });
  const { page, context: desktop } = await context(owner.id, { width: 1280, height: 800 });
  await page.goto(`${origin}/heute`); await page.getByRole("heading", { name: "Heute", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Nachricht an den Assistenten" }).count(), 0);
  assert.equal(requests.length, 0); assert.equal(await db.aiConversation.count({ where: { userId: owner.id } }), 0);
  await shot(page, "desktop-closed");
  await page.getByRole("button", { name: "Jarvis", exact: true }).click();
  await panel(page).getByRole("textbox").waitFor();
  await panel(page).getByRole("heading", { name: "Was möchtest du heute erledigen?" }).waitFor();
  assert.equal(requests.length, 0); assert.equal(await db.aiConversation.count({ where: { userId: owner.id } }), 0);
  await noOverflow(page); await shot(page, "desktop-empty"); checks.push("opening has no conversation or provider side effect");
  await panel(page).getByRole("textbox").fill("Entwurf über alle Ansichten");
  await panel(page).getByRole("button", { name: "Groß öffnen", exact: true }).click();
  assert.equal(await panel(page).getByRole("textbox").inputValue(), "Entwurf über alle Ansichten"); await shot(page, "desktop-workspace");
  await panel(page).getByRole("textbox").fill("");
  await page.evaluate(() => { window.__composerElement = document.getElementById("assistant-message"); });
  for (const dark of [true, false]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value), dark);
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      const geometry = await page.evaluate(() => {
        const input = document.getElementById("assistant-message"), composer = document.querySelector(".assistant-composer"), heading = document.querySelector(".assistant-empty h2"), header = document.querySelector(".assistant-header");
        return { stable: input === window.__composerElement, inputScroll: getComputedStyle(input).overflowY, width: composer.getBoundingClientRect().width, top: heading.getBoundingClientRect().top, headerBottom: header.getBoundingClientRect().bottom };
      });
      assert.equal(geometry.stable, true); assert.equal(geometry.inputScroll, "hidden"); assert.ok(geometry.width <= 761); assert.ok(geometry.top >= geometry.headerBottom);
      await shot(page, "redesign-empty-" + width + (dark ? "-dark" : "-light"));
    }
  }
  await page.setViewportSize({ width: 1280, height: 600 }); await noOverflow(page); await shot(page, "redesign-short");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await panel(page).getByRole("textbox").fill("Entwurf über alle Ansichten");
  checks.push("neutral light/dark layouts at 320/390/768/1440/1920, stable composer, no clipped heading or idle textarea scrollbar");
  const tracksBeforeLayout = await page.evaluate(() => window.__uxStopped);
  await panel(page).getByRole("button", { name: "Nachricht diktieren", exact: true }).click();
  await panel(page).getByText("Aufnahme läuft", { exact: true }).waitFor();
  await panel(page).getByRole("button", { name: "Als Panel öffnen", exact: true }).click();
  await page.waitForURL("**/heute");
  await panel(page).getByText("Aufnahme läuft", { exact: true }).waitFor();
  await panel(page).getByRole("button", { name: "Groß öffnen", exact: true }).click();
  await page.waitForURL("**/assistent");
  await panel(page).getByText("Aufnahme läuft", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__uxStopped), tracksBeforeLayout, "presentation switches must not stop dictation");
  await panel(page).getByRole("button", { name: "Aufnahme verwerfen", exact: true }).click();
  assert.equal(await panel(page).getByRole("textbox").inputValue(), "Entwurf über alle Ansichten");
  checks.push("active dictation and its draft survive panel/workspace switching");

  await panel(page).getByRole("button", { name: "Als Panel öffnen", exact: true }).click();
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Team", exact: true }).click();
  await page.waitForURL("**/mannschaft"); assert.equal(await panel(page).getByRole("textbox").inputValue(), "Entwurf über alle Ansichten");
  await page.goto(`${origin}/contacts/${contact.id}`); // reload checks persisted messages later, fresh session now
  await page.getByRole("button", { name: "Mit Assistent besprechen", exact: true }).first().click();
  await panel(page).getByRole("textbox").waitFor(); await panel(page).getByText("Jonas Müller", { exact: true }).waitFor();
  await send(page, "Bitte ändere die Telefonnummer von Jonas.");
  await panel(page).getByRole("button", { name: "Telefonnummer ändern", exact: true }).waitFor();
  assert.equal((await db.contact.findUnique({ where: { id: contact.id } })).phone, "+49 170 1234567");
  await shot(page, "desktop-confirmation");
  await panel(page).getByRole("button", { name: "Telefonnummer ändern", exact: true }).click();
  await panel(page).getByText("Gespeichert", { exact: true }).waitFor();
  assert.equal((await db.contact.findUnique({ where: { id: contact.id } })).phone, "+49 170 7654321");
  await shot(page, "desktop-receipt");
  await panel(page).getByRole("button", { name: /^Rückgängig/ }).click();
  await panel(page).getByText("Rückgängig gemacht", { exact: true }).waitFor();
  assert.equal((await db.contact.findUnique({ where: { id: contact.id } })).phone, "+49 170 1234567"); checks.push("real HTTP confirmation and undo update CRM exactly once");
  await page.reload(); await page.getByRole("button", { name: "Jarvis", exact: true }).click(); await panel(page).getByText("Rückgängig gemacht", { exact: true }).waitFor(); checks.push("reload restores current receipt state");
  await send(page, "Mehrteilig: Gespräch dokumentieren und Wiedervorlage anlegen.");
  const multiResponse = page.waitForResponse(response => response.url().includes("/api/ai-crm/requests/") && response.request().method() === "POST");
  await panel(page).getByRole("button", { name: "2 Änderungen speichern", exact: true }).click();
  assert.equal((await multiResponse).status(), 200);
  await panel(page).getByText("Gespeichert", { exact: true }).first().waitFor();
  assert.equal(await db.activity.count({ where: { contactId: contact.id } }), 1); assert.equal(await db.contactFollowUp.count({ where: { contactId: contact.id } }), 2);
  checks.push("multi-action preview creates separate receipts");
  await panel(page).getByRole("button", { name: "Neue Unterhaltung", exact: true }).click();
  await send(page, "Langer Text"); await noOverflow(page); await shot(page, "desktop-long-answer");
  // A lost response is recovered through the durable request, without rerunning the provider.
  await desktop.route("**/api/ai-crm/chat", async route => { await route.fetch(); await route.abort("failed"); });
  await send(page, "Dokumentiere das Gespräch mit Jonas."); await panel(page).getByRole("button", { name: "Ergebnis prüfen", exact: true }).click();
  await panel(page).getByText("Abschluss prüfen", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await db.activity.count({ where: { contactId: contact.id } }), 1);
  await panel(page).getByRole("button", { name: "Gespräch speichern", exact: true }).click();
  await panel(page).getByText("Gespeichert", { exact: true }).first().waitFor();
  assert.equal(await db.activity.count({ where: { contactId: contact.id } }), 2);
  await desktop.unroute("**/api/ai-crm/chat"); checks.push("lost response recovers existing result without duplicates");
  await panel(page).getByRole("textbox").fill("Langsam bearbeiten"); await panel(page).getByRole("button", { name: "Senden", exact: true }).click();
  await panel(page).getByRole("button", { name: "Stoppen", exact: true }).click();
  await panel(page).getByLabel("Gesprächsverlauf").getByText("Die Verarbeitung wurde beendet. Bereits gespeicherte Änderungen bleiben erhalten.", { exact: true }).waitFor(); checks.push("stop reports retained actions");
  await shot(page, "desktop-stopped");
  await page.getByRole("button", { name: "Assistent schließen", exact: true }).click();
  await page.goto(`${origin}/mannschaft`); await page.getByRole("button", { name: /Vorführ|Vorführmodus|Vorführen/ }).first().click();
  assert.equal(await page.getByRole("button", { name: "Jarvis", exact: true }).isDisabled(), true); checks.push("global presentation mode protects assistant");
  await desktop.close();

  const { page: mobile, context: mobileContext } = await context(owner.id, { width: 375, height: 812 }, true);
  await mobile.goto(`${origin}/heute`); await mobile.getByRole("button", { name: "Jarvis", exact: true }).click(); await panel(mobile).getByRole("textbox").waitFor();
  await panel(mobile).getByRole("button", { name: "Neue Unterhaltung", exact: true }).click();
  await noOverflow(mobile);
  const nav = mobile.getByRole("navigation", { name: "Hauptnavigation" }); assert.equal(await nav.getByRole("link").count(), 5);
  const composer = await panel(mobile).getByRole("textbox").boundingBox(), dock = await mobile.locator(".crm-dock").boundingBox(); assert.ok(composer.y + composer.height <= dock.y);
  const targets = await panel(mobile).locator("button,a,summary").evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => ({ label: element.getAttribute("aria-label") ?? element.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })).filter(item => item.width < 43.5 || item.height < 43.5)); assert.deepEqual(targets, []);
  await shot(mobile, "mobile-empty"); checks.push("375px composer, collection action and unchanged dock remain visible");
  const beforeVoice = requests.length;
  await panel(mobile).getByRole("button", { name: "Nachricht diktieren", exact: true }).click(); await panel(mobile).getByText("Aufnahme läuft", { exact: true }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 400)); await shot(mobile, "mobile-recording");
  await panel(mobile).getByRole("button", { name: "Aufnahme beenden", exact: true }).click(); await panel(mobile).getByText("Bitte prüfe den Text, besonders Namen und Termine.", { exact: true }).waitFor();
  assert.equal(requests.length, beforeVoice); assert.match(await panel(mobile).getByRole("textbox").inputValue(), /Freitag/);
  await panel(mobile).getByRole("textbox").fill("Bitte plane einen Anruf für Jonas am Mittwoch."); await shot(mobile, "mobile-transcript");
  assert.ok(await mobile.evaluate(() => window.__uxStopped > 0)); checks.push("dictation is editable and never automatically submitted");
  await mobile.evaluate(() => { window.__uxDeny = true; }); await panel(mobile).getByRole("button", { name: "Nachricht diktieren", exact: true }).click(); await panel(mobile).getByText(/Das Mikrofon ist nicht freigegeben/).waitFor();
  await mobile.evaluate(() => { window.__uxDeny = false; });
  const editedDraft = await panel(mobile).getByRole("textbox").inputValue();
  await panel(mobile).getByRole("button", { name: "Nachricht diktieren", exact: true }).click(); await panel(mobile).getByText("Aufnahme läuft", { exact: true }).waitFor();
  await panel(mobile).getByRole("button", { name: "Aufnahme verwerfen", exact: true }).click();
  assert.equal(await panel(mobile).getByRole("textbox").inputValue(), editedDraft);
  const stoppedBeforeClose = await mobile.evaluate(() => window.__uxStopped);
  await panel(mobile).getByRole("button", { name: "Nachricht diktieren", exact: true }).click(); await panel(mobile).getByText("Aufnahme läuft", { exact: true }).waitFor();
  await panel(mobile).getByRole("button", { name: "Zurück zum CRM", exact: true }).click();
  await panel(mobile).waitFor({ state: "hidden" }); assert.ok(await mobile.evaluate(() => window.__uxStopped) > stoppedBeforeClose);
  await mobile.getByRole("button", { name: "Jarvis", exact: true }).click();
  assert.equal(await panel(mobile).getByRole("textbox").inputValue(), editedDraft); assert.equal(requests.length, beforeVoice);
  checks.push("discarding and closing a recording release media tracks and retain the unsent draft");
  // A shorter visible viewport exercises keyboard geometry, not an actual phone keyboard.
  await mobile.setViewportSize({ width: 375, height: 512 }); await noOverflow(mobile); const field = await panel(mobile).getByRole("textbox").boundingBox(), navBox = await mobile.locator(".crm-dock").boundingBox(); assert.ok(field.y + field.height <= navBox.y); await shot(mobile, "mobile-short-viewport");
  await mobile.setViewportSize({ width: 375, height: 812 });
  await panel(mobile).getByRole("button", { name: "Unterhaltungen öffnen", exact: true }).click(); await shot(mobile, "mobile-conversations");
  await panel(mobile).locator(".assistant-conversation-menu summary").first().click();
  await panel(mobile).getByRole("button", { name: /^Unterhaltung löschen:/ }).first().click();
  await mobile.getByRole("dialog").waitFor(); assert.equal(await mobile.getByRole("button", { name: "Behalten", exact: true }).evaluate(element => element === document.activeElement), true); await shot(mobile, "mobile-delete"); await mobile.keyboard.press("Escape");
  await panel(mobile).locator(".assistant-sidebar-top button").click();
  await mobile.evaluate(() => { document.documentElement.classList.remove("dark"); }); await shot(mobile, "mobile-light");
  await mobile.setViewportSize({ width: 320, height: 812 }); await noOverflow(mobile); await shot(mobile, "mobile-320");
  await mobile.getByRole("link", { name: "Namen sammeln", exact: true }).click(); await mobile.waitForURL("**/namen/sammeln");
  await mobile.getByRole("heading", { name: "Namen sammeln", exact: true }).waitFor(); assert.equal(await panel(mobile).count(), 0);
  checks.push("mobile collection navigation closes assistant and reaches the unchanged workflow");
  await mobileContext.close();
  // An independent authenticated browser restores the server history.
  const { page: second, context: secondContext } = await context(owner.id, { width: 1280, height: 800 });
  await second.goto(`${origin}/heute`); await second.getByRole("button", { name: "Jarvis", exact: true }).click();
  await panel(second).getByText("Dokumentiere das Gespräch mit Jonas.", { exact: true }).waitFor();
  checks.push("second authenticated browser restores sent history from the server");
  for (let index = 0; index < 12; index++) await db.aiConversation.create({ data: { userId: owner.id, title: `Weiteres Gespräch ${index}: ${"Langer Titel ".repeat(6)}`, startedAt: new Date(Date.now() - 86400000), updatedAt: new Date(Date.now() - 86400000 + index), expiresAt: new Date(Date.now() + 86400000) } });
  await second.reload(); await second.getByRole("button", { name: "Jarvis", exact: true }).click(); await panel(second).getByRole("textbox").waitFor();
  await panel(second).getByRole("button", { name: "Unterhaltungen öffnen", exact: true }).click();
  await panel(second).getByRole("button", { name: "Weitere laden", exact: true }).click();
  const expectedConversations = await db.aiConversation.count({ where: { userId: owner.id } });
  await panel(second).locator(".assistant-conversation-row").nth(expectedConversations - 1).waitFor();
  assert.equal(await panel(second).locator(".assistant-conversation-row").count(), expectedConversations);
  await shot(second, "desktop-conversations"); checks.push("conversation pagination exposes every valid conversation including long titles");
  const full = await db.aiConversation.create({ data: { userId: owner.id, title: "Vollständiges Gespräch", expiresAt: new Date(Date.now() + 86400000), messages: { create: Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Alte Nachricht ${index}`, createdAt: new Date(Date.now() - 10000 + index) })) } } });
  await second.reload(); await second.getByRole("button", { name: "Jarvis", exact: true }).click();
  await panel(second).getByText("Diese Unterhaltung hat 20 Nachrichten erreicht. Deine nächste Nachricht beginnt ein neues Gespräch.", { exact: true }).waitFor();
  await send(second, "Neue Frage nach vollem Gespräch");
  await panel(second).getByText("Hier beginnt eine neue Unterhaltung. Das vorherige Gespräch hat 20 Nachrichten erreicht.", { exact: true }).waitFor();
  assert.equal(await panel(second).getByText("Alte Nachricht 19", { exact: true }).count(), 0);
  assert.equal(await db.aiConversationMessage.count({ where: { conversationId: full.id } }), 20);
  const latest = await db.aiConversation.findFirst({ where: { userId: owner.id }, orderBy: { updatedAt: "desc" } });
  assert.notEqual(latest.id, full.id); checks.push("20-message boundary starts a separate conversation without old visible context");
  // Verify immediate expiry both in the open browser and the HTTP route.
  await db.aiConversation.update({ where: { id: latest.id }, data: { expiresAt: new Date(Date.now() + 5000) } });
  await second.reload(); await second.getByRole("button", { name: "Jarvis", exact: true }).click();
  await panel(second).getByText("Das vorherige Gespräch ist abgelaufen. Hier beginnt ein neues. Deine CRM-Einträge bleiben erhalten.", { exact: true }).waitFor();
  const expiredResponse = await secondContext.request.get(`${origin}/api/ai-crm/conversations/${latest.id}`); assert.equal(expiredResponse.status(), 410);
  await second.evaluate(() => { document.documentElement.style.fontSize = "32px"; }); await noOverflow(second); await shot(second, "desktop-200-percent-text");
  checks.push("expired content disappears without CRM loss; 200 percent text stays within viewport");
  await second.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await send(second, "Lesbarkeit prüfen");
  const formatted = panel(second).locator(".assistant-message-assistant").last();
  assert.equal(await formatted.locator("h2").innerText(), "Bereit, Meister Emil.");
  assert.ok(await formatted.locator("strong").count() >= 3);
  assert.equal(await formatted.locator("ul > li").count(), 2);
  assert.equal(await formatted.locator("ol > li").count(), 2);
  assert.equal(await formatted.locator("table").count(), 1);
  assert.equal(await formatted.locator("script,img,a[href^='javascript:']").count(), 0);
  assert.equal(await second.evaluate(() => window.__unsafeMarkdown), undefined);
  const readingPosition = await second.evaluate(() => { const timeline = document.querySelector(".assistant-timeline").getBoundingClientRect(); const heading = document.querySelector(".assistant-message-assistant:last-child h2").getBoundingClientRect(); return { top: heading.top, viewportTop: timeline.top, bottom: timeline.bottom }; });
  assert.ok(readingPosition.top >= readingPosition.viewportTop && readingPosition.top < readingPosition.bottom, "a long answer begins at its readable start");
  for (const width of [320, 390, 768, 1440]) { await second.setViewportSize({ width, height: 900 }); await noOverflow(second); await shot(second, `hype-formatted-${width}`); }
  await panel(second).locator(".assistant-timeline").evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await send(second, "Noch eine kurze Frage");
  assert.equal(await panel(second).locator(".assistant-timeline").evaluate(element => element.scrollTop), 0);
  await panel(second).getByRole("button", { name: "Neue Antwort ↓", exact: true }).waitFor();
  checks.push("formatted replies, safe markdown, long-answer reading position and scroll preservation");
  await secondContext.close();
  const { page: restricted, context: restrictedContext } = await context(locked.id, { width: 375, height: 812 }, true);
  await restricted.goto(`${origin}/heute`); await restricted.getByRole("button", { name: "Jarvis", exact: true }).click(); await panel(restricted).getByText("Der Assistent ist für dein Konto noch nicht freigeschaltet.", { exact: true }).waitFor(); assert.equal(await panel(restricted).getByRole("textbox").count(), 0); await shot(restricted, "mobile-locked"); await restrictedContext.close();
  checks.push("locked access, microphone denial, delete focus and 320px overflow checked");
  assert.deepEqual(errors, []);
  for (const name of ["failure.png", "failure.html"]) await rm(new URL(name, output), { force: true });
  await writeFile(new URL("result.json", output), JSON.stringify({ success: true, mode: production ? "production-build" : "development", checks, errors, providerRequests: requests.length, limitations: ["Simulated microphone and transcription", "No real smartphone keyboard or screen reader", "No external OpenAI, Stripe or deployment"] }, null, 2));
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) {
  if (activePage && !activePage.isClosed()) { await shot(activePage, "failure").catch(() => {}); await writeFile(new URL("failure.html", output), await activePage.content()).catch(() => {}); }
  await writeFile(new URL("result.json", output), JSON.stringify({ success: false, error: String(error), checks, errors }, null, 2));
  throw error;
} finally {
  await browser?.close(); server?.kill(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); await fixture.close();
}
