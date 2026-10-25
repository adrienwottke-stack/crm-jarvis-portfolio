// Real CRM HTTP and browser flow; all data and provider traffic are disposable fixtures.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";

const fixture = await testDatabase(0, 30);
const db = fixture.client;
const port = Number(process.env.JARVIS_LEADERSHIP_TEST_PORT || 3148);
const origin = `http://127.0.0.1:${port}`;
const output = new URL("../test-results/jarvis-leadership/", import.meta.url);
const cache = new URL("../.cache/jarvis-leadership/", import.meta.url);
await mkdir(output, { recursive: true }); await mkdir(cache, { recursive: true });
await writeFile(new URL("tsconfig.json", cache), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
await writeFile(new URL("server.log", output), "");
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const checks = [], errors = [], requests = [], screenshots = [];
let server, browser, page, provider;
const now = new Date();
const occurredAt = new Date(now.getTime() - 3600000).toISOString();
const berlinOccurredParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(occurredAt));
const berlinPart = type => berlinOccurredParts.find(part => part.type === type).value;
const berlinOccurredAt = `${berlinPart("year")}-${berlinPart("month")}-${berlinPart("day")}T${berlinPart("hour")}:${berlinPart("minute")}`;
const dueAt = new Date(now.getTime() + 86400000).toISOString();
const initialText = "Vorführfixture: Jonas hat seinen Einstieg geübt. Die Begleitung ist als nächster Gesprächspunkt dokumentiert.";
const proposedText = "Vorführfixture: Jonas erläuterte seinen Gesprächseinstieg. Ich begleite sein nächstes Erstgespräch.";
const editedText = "Vorführfixture bearbeitet: Jonas erläuterte seinen Einstieg. Ich begleite sein nächstes Erstgespräch und wir prüfen danach gemeinsam den Leitfaden.";

async function account(name, parent = null) {
  const id = randomUUID();
  return db.user.create({ data: { id, name, passwordHash: "synthetic-isolated-fixture", path: `${parent?.path ?? "/"}${id}/`, leaderId: parent?.id ?? null, aiBetaEnabled: true, onboardingDoneAt: now, person: { create: { name } }, startProgress: { create: { phase: "DONE" } } } });
}
const owner = await account("Jarvis Führungstest");
const partner = await account("Jonas Führungsfixture", owner);
const lower = await account("Untergeordnetes Fixture", partner);
const foreign = await account("Fremde Führung");
const source = await db.leadershipNote.create({ data: { ownerId: owner.id, partnerId: partner.id, text: initialText, occurredAt: new Date(occurredAt) } });
await db.leadershipNote.create({ data: { ownerId: partner.id, partnerId: lower.id, text: "PRIVATE_SUBTEAM_NOTE_MUST_NEVER_APPEAR", occurredAt: new Date(occurredAt) } });
await db.partnerVereinbarung.create({ data: { initiatorId: owner.id, empfaengerId: partner.id, verantwortlicherId: owner.id, titel: "Eigene Unterstützungszusage aus Führungsfixture", faelligAm: new Date(dueAt), status: "BESTAETIGT", vorgeschlagenVonId: partner.id, bestaetigtVonId: owner.id, bestaetigtAm: now, verlauf: { create: { version: 1, akteurId: owner.id, aktion: "Bestätigt", stand: { status: "BESTAETIGT" } } } } });
await db.partnerVereinbarung.create({ data: { initiatorId: partner.id, empfaengerId: lower.id, verantwortlicherId: lower.id, titel: "PRIVATE_SUBTEAM_AGREEMENT_MUST_NEVER_APPEAR", faelligAm: new Date(dueAt), status: "BESTAETIGT", vorgeschlagenVonId: partner.id } });
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });

provider = createServer(async (request, response) => {
  try {
    let body = ""; for await (const chunk of request) body += chunk;
    if (request.url !== "/v1/responses") throw new Error("Unexpected provider endpoint");
    const data = JSON.parse(body);
    const message = data.input.findLast(item => item.role === "user")?.content ?? "";
    const round = data.input.filter(item => item.type === "function_call_output").length;
    requests.push({ message, round });
    const search = { name: "search_partners", args: { query: "Jonas Führungsfixture" } };
    const preparation = { name: "prepare_partner_meeting", args: { partnerId: partner.id, since: null } };
    const note = { name: "save_leadership_note", args: { partnerId: partner.id, text: proposedText, occurredAt, appointmentId: null } };
    const task = { name: "create_leadership_task", args: { partnerId: partner.id, type: "BEGLEITUNG", dueAt, note: "Vorführfixture: Erstgespräch begleiten", sourceNoteId: null } };
    const leadershipRound = { name: "get_leadership_round", args: { period: "all" } };
    const sequence = /Nachbereitung/.test(message) ? [search, note, task] : /Führungsrunde/.test(message) ? [leadershipRound] : [search, preparation];
    const call = sequence[round];
    const answer = /Führungsrunde/.test(message) ? "Die Führungsrunde zeigt eigene Absprachen und eigene Unterstützung für direkt geführte Führungskräfte. Die zugänglichen Quellen stehen hier." : "Die Vorbereitung enthält deine gespeicherten Gesprächsquellen und eigenen Zusagen. Geplante Termine sind kein Gesprächsnachweis; zusätzliche Fragen sind Vorschläge.";
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: `resp_${randomUUID()}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed", model: data.model, output: call ? [{ type: "function_call", id: randomUUID(), call_id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args), status: "completed" }] : [{ type: "message", id: randomUUID(), role: "assistant", status: "completed", content: [{ type: "output_text", text: answer, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }));
  } catch { response.writeHead(500); response.end("Isolated provider fixture failed"); }
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
const panel = () => page.locator("#crm-assistant-surface");
async function shot(name) { const path = fileURLToPath(new URL(`${name}.png`, output)); await page.screenshot({ path, animations: "disabled" }); screenshots.push(path); }
async function overflow() {
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, surface: (() => { const element = document.querySelector("#crm-assistant-surface"); return element ? { client: element.clientWidth, scroll: element.scrollWidth } : null; })() }));
  assert.ok(geometry.scrollWidth <= geometry.width + 1, `Page overflow: ${JSON.stringify(geometry)}`);
  if (geometry.surface) assert.ok(geometry.surface.scroll <= geometry.surface.client + 1, `Assistant overflow: ${JSON.stringify(geometry)}`);
}
async function open() {
  await page.getByRole("button", { name: "Assistent", exact: true }).click();
  await panel().getByRole("textbox", { name: "Nachricht an den Assistenten" }).waitFor();
  await panel().getByText("Unterhaltung wird geladen …", { exact: true }).waitFor({ state: "hidden" });
}
async function send(text) {
  await panel().getByRole("textbox", { name: "Nachricht an den Assistenten" }).fill(text);
  const reply = page.waitForResponse(response => response.url() === `${origin}/api/ai-crm/chat` && response.request().method() === "POST", { timeout: 90000 });
  await panel().getByRole("button", { name: "Senden", exact: true }).click();
  const response = await reply; const data = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(data));
  await panel().getByText("Deine Anfrage wird bearbeitet …", { exact: true }).waitFor({ state: "hidden" });
  return data;
}
async function actionResponse(click) {
  const response = page.waitForResponse(value => value.url().includes("/api/ai-crm/requests/") && value.request().method() === "POST");
  await click(); const result = await response; const data = await result.json(); assert.equal(result.status(), 200, JSON.stringify(data)); return data;
}

try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "--hostname", "127.0.0.1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", CRM_TEST_DIST_DIR: ".cache/jarvis-leadership-next", CRM_TEST_TSCONFIG: ".cache/jarvis-leadership/tsconfig.json", NEXT_TELEMETRY_DISABLED: "1", AI_CRM_ENABLED: "true", AI_LIVE_PROVIDER: "disabled", OPENAI_API_KEY: "loopback-test-fixture-only", OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, OPENAI_ORG_ID: "", OPENAI_PROJECT_ID: "", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "" } });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => appendFileSync(new URL("server.log", output), chunk));
  for (let index = 0; index < 150; index++) { try { if ((await fetch(`${origin}/login`)).ok) break; } catch {} if (index === 149) throw new Error("Isolated Next server did not start"); await new Promise(resolve => setTimeout(resolve, 400)); }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addCookies([{ name: authCookieName, value: await createSession(owner.id), url: origin }]);
  page = await context.newPage(); page.setDefaultTimeout(45000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/heute`); await open();
  const preparation = await send("Bereite mein Gespräch mit Jonas Führungsfixture vor.");
  assert.ok(preparation.results.flatMap(r => r.items).some(item => item.link === `/mannschaft/notizen/${source.id}`));
  await panel().getByText(initialText, { exact: false }).first().waitFor();
  await panel().getByText(/Abdeckung: vollständig/).first().waitFor();
  await shot("01-preparation-sources"); checks.push("real preparation API displays own note, agreement, coverage and dated source links");
  const sourceLink = panel().locator(`a[href="/mannschaft/notizen/${source.id}"]`);
  await sourceLink.click(); await page.waitForURL(`**/mannschaft/notizen/${source.id}`);
  await page.getByRole("heading", { name: "Gespräch mit Jonas Führungsfixture", exact: true }).waitFor();
  await page.getByText(initialText, { exact: true }).waitFor(); await shot("02-private-source");
  const foreignContext = await browser.newContext();
  await foreignContext.addCookies([{ name: authCookieName, value: await createSession(foreign.id), url: origin }]);
  const forbidden = await foreignContext.request.get(`${origin}/mannschaft/notizen/${source.id}`);
  assert.ok([404, 200].includes(forbidden.status()));
  assert.equal((await forbidden.text()).includes(initialText), false); await foreignContext.close();
  checks.push("source opens full own note and denies unrelated account content");
  await page.goto(`${origin}/heute`); await open();
  const debrief = await send("Nachbereitung als Vorführfixture: Jonas erläuterte seinen Einstieg. Ich begleite sein nächstes Erstgespräch. Bitte Notiz und eigene Aufgabe vorbereiten.");
  assert.equal(debrief.actions.filter(a => a.status === "PENDING").length, 2);
  assert.equal(await db.leadershipNote.count({ where: { ownerId: owner.id } }), 1);
  assert.equal(await db.leadershipTask.count({ where: { leaderId: owner.id } }), 0);
  const noteCard = panel().getByRole("article", { name: "Bitte prüfen · noch nicht gespeichert: Private Gesprächsnotiz speichern", exact: true });
  await noteCard.getByRole("button", { name: "Vorschlag bearbeiten", exact: true }).click();
  const occurredAtInput = noteCard.getByLabel("Gespräch am (Berliner Zeit)", { exact: true });
  assert.equal(await occurredAtInput.getAttribute("type"), "datetime-local");
  assert.equal(await occurredAtInput.inputValue(), berlinOccurredAt);
  await noteCard.getByRole("textbox", { name: "Gesprächsnotiz", exact: true }).fill(editedText);
  const revisedNote = await actionResponse(() => noteCard.getByRole("button", { name: "Neue Vorschau übernehmen", exact: true }).click());
  assert.equal(revisedNote.actions.find(action => action.status === "PENDING" && action.fields?.some(field => field.name === "occurredAt")).fields.find(field => field.name === "occurredAt").value, berlinOccurredAt);
  await panel().getByRole("article", { name: "Bitte prüfen · noch nicht gespeichert: Private Gesprächsnotiz speichern", exact: true }).getByText(editedText, { exact: true }).waitFor();
  const taskCard = panel().getByRole("article", { name: "Bitte prüfen · noch nicht gespeichert: Eigene Führungsaufgabe anlegen", exact: true });
  await taskCard.locator("..").getByRole("checkbox").uncheck();
  await shot("03-edited-selective-preview");
  await actionResponse(() => panel().getByRole("button", { name: "Nur Notiz speichern", exact: true }).click());
  const savedNote = await db.leadershipNote.findFirst({ where: { ownerId: owner.id, text: editedText } }); assert.ok(savedNote);
  assert.equal(await db.leadershipTask.count({ where: { leaderId: owner.id } }), 0);
  checks.push("editing uses a datetime-local field, preserves the Berlin conversation time and replaces the old proposal; selective note confirmation stores no task");
  await taskCard.locator("..").getByRole("checkbox").check();
  await actionResponse(() => panel().getByRole("button", { name: "Eigene Aufgabe speichern", exact: true }).click());
  const savedTask = await db.leadershipTask.findFirst({ where: { leaderId: owner.id } }); assert.ok(savedTask);
  assert.equal(savedTask.sourceNoteId, savedNote.id); assert.equal(savedTask.memberId, partner.id);
  assert.equal(await db.nachricht.count(), 0);
  await shot("04-confirmed-domain-records");
  await page.reload(); await open();
  await panel().getByText("Private Gesprächsnotiz gespeichert. Keine Aufgabe wurde dadurch angelegt.", { exact: true }).waitFor();
  await panel().getByText("Eigene Führungsaufgabe gespeichert.", { exact: true }).waitFor();
  assert.equal(await db.leadershipTask.count({ where: { leaderId: owner.id } }), 1);
  checks.push("separately confirmed task links the existing own note; reload restores durable receipts without duplicates or messages");
  await panel().getByRole("button", { name: "Neue Unterhaltung", exact: true }).click();
  const reread = await send("Bereite mein Gespräch mit Jonas Führungsfixture erneut vor.");
  assert.ok(reread.results.flatMap(r => r.items).some(i => String(i.detail).includes(editedText)));
  assert.ok(reread.results.flatMap(r => r.items).some(i => i.id === savedTask.id));
  await panel().getByRole("button", { name: "Groß öffnen", exact: true }).click();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 960 }); await overflow(); await shot(`05-workspace-${width}`); }
  checks.push("new conversation retrieves actual note/task; rendered 320/390/768/1440 widths have no horizontal overflow");
  await panel().getByRole("button", { name: "Neue Unterhaltung", exact: true }).click();
  const round = await send("Was ist für meine Führungsrunde offen?");
  assert.equal(JSON.stringify(round).includes("PRIVATE_SUBTEAM_"), false);
  assert.ok(round.results.flatMap(r => r.items).some(i => i.title === "Eigene Unterstützungszusage aus Führungsfixture"));
  await panel().getByText("Eigene Unterstützungszusage aus Führungsfixture", { exact: true }).waitFor();
  assert.equal((await panel().innerText()).includes("PRIVATE_SUBTEAM_"), false);
  await shot("06-tier3-direct-leadership"); checks.push("Tier-3 uses own direct-leader agreement and never exposes private subteam note/agreement");
  assert.deepEqual(errors, []);
  await writeFile(new URL("result.json", output), JSON.stringify({ success: true, checks, errors, screenshots, providerRequests: requests.length, isolated: true, limitations: ["Headless browser with controlled Responses provider on loopback", "No real OpenAI, speech, music, physical device or deployment tested"] }, null, 2));
  console.log(JSON.stringify({ success: true, checks, screenshots }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) { await shot("failure").catch(() => {}); await writeFile(new URL("failure.html", output), await page.content()).catch(() => {}); }
  await writeFile(new URL("result.json", output), JSON.stringify({ success: false, error: String(error), checks, errors, providerRequests: requests, screenshots }, null, 2));
  throw error;
} finally {
  await browser?.close(); server?.kill(); provider?.closeAllConnections(); if (provider) await new Promise(resolve => provider.close(resolve)); await fixture.close();
}
