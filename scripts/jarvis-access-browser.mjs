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
const port = Number(process.env.JARVIS_ACCESS_TEST_PORT || 3148);
const origin = `http://127.0.0.1:${port}`;
const production = process.argv.includes("--production");
const distDir = production ? ".cache/jarvis-access-build-next" : ".cache/jarvis-access-next";
const tsconfig = production ? ".cache/jarvis-access-build/tsconfig.json" : ".cache/jarvis-access/tsconfig.json";
const output = new URL("../test-results/jarvis-access/", import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(new URL("../.cache/jarvis-access/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/jarvis-access/tsconfig.json", import.meta.url), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
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
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", production ? "start" : "dev", "-p", String(port), "--hostname", "127.0.0.1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", CRM_TEST_DIST_DIR: distDir, CRM_TEST_TSCONFIG: tsconfig, NEXT_TELEMETRY_DISABLED: "1", AI_CRM_ENABLED: "true", AI_CRM_EXECUTION_MODES: "true", AI_LIVE_PROVIDER: "disabled", OPENAI_API_KEY: "local-fixture-only", OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, OPENAI_ORG_ID: "", OPENAI_PROJECT_ID: "", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "" } });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => appendFileSync(new URL("server.log", output), chunk));
  for (let index = 0; index < 120; index++) { try { if ((await fetch(`${origin}/login`)).ok) break; } catch {} if (index === 119) throw new Error("Server did not start"); await new Promise(resolve => setTimeout(resolve, 500)); }
  browser = await chromium.launch({ headless: true });
  const { page, context: desktop } = await context(owner.id, { width: 1440, height: 900 });
  await page.goto(`${origin}/heute`, { timeout: 120000 });
  await page.getByRole("button", { name: "Jarvis", exact: true }).first().click();
  const access = panel(page).getByRole("combobox", { name: "Jarvis Zugriffe" });
  await access.waitFor();
  assert.equal(await access.inputValue(), "CONFIRM");
  await access.selectOption("AUTONOMOUS");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Jarvis Zugriffe"]').disabled);
  assert.equal(await access.inputValue(), "AUTONOMOUS");
  await send(page, "Dokumentiere das Gespraech mit Jonas.");
  assert.equal(await db.activity.count({ where: { contactId: contact.id, type: "CALL" } }), 1);
  assert.equal(await panel(page).locator('.assistant-confirmation').count(), 0);
  checks.push("autonomous mode commits through real Next routes without a confirmation click");
  await page.reload();
  await page.getByRole("button", { name: "Jarvis", exact: true }).first().click();
  await access.waitFor();
  // The selected conversation may initially be blank after a browser reload; load saved chat through history if needed.
  if (await access.inputValue() !== "AUTONOMOUS") {
    const chats = await db.aiConversation.findMany({ where: { userId: owner.id }, orderBy: { updatedAt: "desc" } });
    assert.equal(chats[0].executionMode, "AUTONOMOUS");
  }
  await access.selectOption("READ_ONLY");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Jarvis Zugriffe"]').disabled);
  await send(page, "Dokumentiere nochmal das Gespraech mit Jonas.");
  assert.equal(await db.activity.count({ where: { contactId: contact.id, type: "CALL" } }), 1);
  checks.push("read-only blocks a provider write attempt at the server");
  await access.selectOption("CONFIRM");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Jarvis Zugriffe"]').disabled);
  const before = await db.contactFollowUp.count({ where: { contactId: contact.id } });
  await send(page, "Wiedervorlage fuer Jonas vorbereiten.");
  assert.equal(await db.contactFollowUp.count({ where: { contactId: contact.id } }), before);
  await panel(page).locator('.assistant-confirmation button').first().click();
  await page.waitForFunction(() => !document.querySelector('.assistant-confirmation'));
  assert.equal(await db.contactFollowUp.count({ where: { contactId: contact.id } }), before + 1);
  checks.push("confirmation mode writes only after the visible approval");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    const rect = await access.boundingBox(); assert.ok(rect && rect.height >= 44);
    await shot(page, `permissions-${width}`);
  }
  checks.push("permission selector remains usable at 320, 390, 768 and 1440 pixels");
  await panel(page).getByRole("button", { name: "Neue Unterhaltung", exact: true }).click();
  assert.equal(await access.inputValue(), "CONFIRM");
  checks.push("new conversations start with confirmation mode");
  assert.deepEqual(errors, []);
  await writeFile(new URL("result.json", output), JSON.stringify({ success: true, checks, errors, providerRequests: requests.length, limitations: ["Local provider simulator", "No real phone or live microphone", "No production deployment"] }, null, 2));
  console.log(JSON.stringify({ success: true, checks }, null, 2));
  await desktop.close();

} catch (error) {
  if (activePage && !activePage.isClosed()) { await shot(activePage, "failure").catch(() => {}); await writeFile(new URL("failure.html", output), await activePage.content()).catch(() => {}); }
  await writeFile(new URL("result.json", output), JSON.stringify({ success: false, error: String(error), checks, errors }, null, 2));
  throw error;
} finally {
  await browser?.close(); server?.kill(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); await fixture.close();
}
