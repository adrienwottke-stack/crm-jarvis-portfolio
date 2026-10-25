// Real routes and disposable data; OpenAI responses are a local deterministic fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";
import { berechne, standardWerte } from "../lib/zinsrechner.ts";

const fixture = await testDatabase(0, 30), db = fixture.client;
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const output = new URL("../test-results/hubspot-workspace/", import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(new URL("../.cache/hubspot-workspace/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/hubspot-workspace/tsconfig.json", import.meta.url), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
await writeFile(new URL("server.log", output), "");
await writeFile(new URL("browser-console.log", output), "");
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const now = new Date();
const owner = await db.user.create({ data: { name: "Alex Beispiel", email: "workspace@example.test", aiBetaEnabled: true, passwordHash: "synthetic-test-only", onboardingDoneAt: now, person: { create: { name: "Alex Beispiel" } }, startProgress: { create: { phase: "DONE" } } } });
await db.user.update({ where: { id: owner.id }, data: { path: `/${owner.id}/` } });
for (const key of ["aiCrm", "zinsrechner"]) await db.feature.upsert({ where: { key }, create: { key, titel: key, state: "TEST" }, update: { state: "TEST" } });
const contact = await db.contact.create({ data: { name: "Jonas Müller", phone: "+49 170 1234567", ownerId: owner.id, listKinds: ["VERKAUF"], note: "Interesse an einem Beratungstermin.", followUps: { create: { ownerId: owner.id, at: new Date(now.getTime() + 3600000), type: "ANRUF", note: "Entscheidung besprechen" } } } });
await db.contact.createMany({ data: [{ name: "Mara Beispiel", phone: null, ownerId: owner.id, listKinds: ["VERKAUF"] }, { name: "Lea Muster", phone: "+49 170 1111111", ownerId: owner.id, listKinds: ["VERKAUF"] }] });
let requests = 0;
const provider = createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  const data = JSON.parse(body); requests++;
  const message = data.input.findLast(item => item.role === "user")?.content ?? "";
  const round = data.input.filter(item => item.type === "function_call_output").length;
  const sequence = /Rechner/.test(message) ? [{ name: "calculate_interest", args: { start: 1000, monthly: 100, years: 10, rate: 5 } }] : /Hilfe/.test(message) ? [{ name: "get_crm_help", args: {} }] : [{ name: "search_contacts", args: { query: "Jonas" } }, { name: "update_contact", args: { contactId: contact.id, changeFields: ["phone"], phone: "+49 170 7654321", name: null, email: null, source: null, job: null } }];
  const call = sequence[round];
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ id: `resp_${randomUUID()}`, object: "response", status: "completed", model: data.model, output: call ? [{ type: "function_call", id: randomUUID(), call_id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args), status: "completed" }] : [{ type: "message", id: randomUUID(), role: "assistant", status: "completed", content: [{ type: "output_text", text: "Die Angaben sind geprüft. Nutze die angezeigte Vorschau.", annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }));
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
let server, browser, page; const checks = [], errors = [];
const shot = async name => page.screenshot({ path: new URL(`${name}.png`, output).pathname.replace(/^\/(.:)/, "$1"), animations: "disabled", caret: "initial" });
const panel = () => page.locator("#crm-assistant-surface");
async function noOverflow() {
  const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(geometry.scroll <= geometry.width, JSON.stringify(geometry));
}
async function send(message) { await panel().getByRole("textbox", { name: "Nachricht an den Assistenten" }).fill(message); await panel().getByRole("button", { name: "Senden", exact: true }).click(); await panel().getByText("Deine Anfrage wird bearbeitet …", { exact: true }).waitFor({ state: "hidden", timeout: 60000 }); }
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "--hostname", "127.0.0.1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", CRM_TEST_DIST_DIR: ".cache/hubspot-workspace-next", CRM_TEST_TSCONFIG: ".cache/hubspot-workspace/tsconfig.json", SESSION_SECRET: process.env.SESSION_SECRET, AI_CRM_ENABLED: "true", AI_LIVE_PROVIDER: "disabled", OPENAI_API_KEY: "local-fixture-only", OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, OPENAI_ORG_ID: "", OPENAI_PROJECT_ID: "", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "", NEXT_TELEMETRY_DISABLED: "1" } });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => appendFileSync(new URL("server.log", output), chunk));
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${origin}/login`)).ok) break; } catch {} if (i === 119) throw new Error("Server not ready"); await new Promise(resolve => setTimeout(resolve, 500)); }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addCookies([{ name: authCookieName, value: await createSession(owner.id), url: origin }]);
  await context.addInitScript(() => { window.__micRequests = 0; Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { window.__micRequests++; throw new DOMException("Fixture denied", "NotAllowedError"); } } }); });
  page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(90000);
  page.on("pageerror", error => { const detail = `${page.url()}\n${error.stack ?? error.message}`; errors.push(detail); appendFileSync(new URL("browser-console.log", output), detail + "\n"); });
  page.on("console", message => { if (message.type() === "error") { const detail = `${page.url()}\n${message.text()}`; errors.push(detail); appendFileSync(new URL("browser-console.log", output), detail + "\n"); } });
  await page.goto(`${origin}/namen?liste=VERKAUF`);
  await page.getByRole("heading", { name: "Kontakte", exact: true }).waitFor();
  assert.equal(requests, 0);
  await page.getByRole("searchbox", { name: "Kontakte suchen" }).fill("Jonas");
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("offen");
  await page.getByRole("button", { name: "Anwenden", exact: true }).click();
  await page.getByText("1 von 3 Kontakten in dieser Ansicht", { exact: true }).waitFor();
  const filtered = new URL(page.url()).search;
  await page.getByRole("link", { name: "Jonas Müller", exact: true }).click();
  await page.getByRole("heading", { name: "Jonas Müller", exact: true }).waitFor();
  await page.getByRole("link", { name: "Bearbeiten", exact: true }).click();
  await page.getByRole("textbox", { name: "Telefon", exact: true }).fill("+49 170 2222222");
  await page.getByRole("button", { name: "Änderungen speichern", exact: true }).click();
  await page.getByRole("heading", { name: "Jonas Müller", exact: true }).waitFor();
  assert.equal((await db.contact.findUnique({ where: { id: contact.id } })).phone, "+49 170 2222222");
  await page.getByRole("link", { name: "Zurück zu Kontakten", exact: true }).click();
  await page.getByRole("heading", { name: "Kontakte", exact: true }).waitFor();
  const restored = new URL(page.url()).searchParams;
  for (const key of ["q", "liste", "status"]) assert.equal(restored.get(key), new URLSearchParams(filtered).get(key));
  assert.equal(await panel().count(), 0); assert.equal(requests, 0);
  checks.push("Manual search/filter → contact → edit/save → same filtered list, database result verified, no Jarvis request");
  await page.getByRole("searchbox", { name: "Kontakte suchen" }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button", { name: "Kontakte suchen", exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button", { name: /^Filter/ }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Enter");
  await page.getByRole("combobox", { name: "Status", exact: true }).focus();
  assert.equal(await page.getByRole("combobox", { name: "Status", exact: true }).evaluate(element => element === document.activeElement && getComputedStyle(element).outlineStyle !== "none"), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("combobox", { name: "Telefon", exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByRole("link", { name: "Kontakt anlegen", exact: true }).click();
  await page.getByRole("textbox", { name: "Name *", exact: true }).fill("Manuell angelegt");
  await page.getByRole("button", { name: "Kontakt anlegen", exact: true }).click();
  await page.getByRole("heading", { name: "Manuell angelegt", exact: true }).waitFor();
  const created = await db.contact.findFirst({ where: { ownerId: owner.id, name: "Manuell angelegt" } });
  assert.deepEqual(created.listKinds, ["VERKAUF"]);
  assert.equal(requests, 0);
  checks.push("Keyboard filter order and visible focus; manual contact creation persists in the chosen list without Jarvis");

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, path, heading] of [["contacts", "/namen?liste=VERKAUF", "Kontakte"], ["record", `/contacts/${contact.id}`, "Jonas Müller"], ["edit", `/contacts/${contact.id}/edit`, "Kontakt bearbeiten"], ["today", "/heute", "Heute"], ["calendar", "/kalender?ansicht=liste", "Kalender"], ["help", "/hilfe", "Hilfe und Support"], ["calculator", "/zinsrechner?start=1000&monatlich=100&jahre=10&rendite=5", /Was aus deinem Geld/]]) {
      await page.goto(origin + path); await page.getByRole("heading", { name: heading, exact: typeof heading === "string" }).waitFor(); await noOverflow(); await shot(`${name}-${width}-dark`);
      if (width === 1440 || width === 390) { await page.evaluate(() => document.documentElement.classList.remove("dark")); await noOverflow(); await shot(`${name}-${width}-light`); await page.evaluate(() => document.documentElement.classList.add("dark")); }
    }
    assert.deepEqual(await page.getByRole("navigation", { name: "Hauptnavigation", exact: true }).getByRole("link").allTextContents(), ["Heute", "Kontakte", "Kalender", "Fortschritt", "Team"]);
    for (const target of [page.getByRole("button", { name: "Jarvis", exact: true }), page.getByRole("button", { name: "Werkzeuge und Profil", exact: true }), page.getByRole("link", { name: "Suchen", exact: true })]) {
      const rect = await target.boundingBox(); assert.ok(rect.width >= 43 && rect.height >= 43);
    }
  }
  checks.push("Seven real pages at 320/390/768/1024/1440, light/dark captures, no document overflow, original five navigation items, global touch targets at least 44px");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/contacts/${contact.id}`);
  await page.getByRole("heading", { name: "Jonas Müller", exact: true }).waitFor();
  await page.getByRole("button", { name: "Jarvis", exact: true }).click();
  await panel().getByRole("textbox", { name: "Nachricht an den Assistenten" }).waitFor();
  await panel().getByText("Unterhaltung wird geladen …", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__micRequests), 0);
  await panel().getByText("Jonas Müller", { exact: true }).waitFor();
  const geometry = await page.evaluate(() => ({ main: document.getElementById("hauptinhalt").getBoundingClientRect().right, assistant: document.getElementById("crm-assistant-surface").getBoundingClientRect().left, inert: document.getElementById("hauptinhalt").inert }));
  assert.ok(geometry.main <= geometry.assistant + 1); assert.equal(geometry.inert, false);
  await shot("record-with-jarvis-1440");
  await send("Ändere die Telefonnummer von Jonas.");
  await panel().getByRole("button", { name: "Telefonnummer ändern", exact: true }).click();
  await panel().getByText("Gespeichert", { exact: true }).waitFor();
  assert.equal((await db.contact.findUnique({ where: { id: contact.id } })).phone, "+49 170 7654321");
  await page.locator("#hauptinhalt").getByRole("link", { name: "+49 170 7654321", exact: true }).first().waitFor();
  checks.push("Jarvis text task via simulated provider → confirmed server action → same CRM record refreshed");
  await send("Ändere die Telefonnummer von Jonas erneut.");
  await panel().getByRole("button", { name: "Vorschlag bearbeiten", exact: true }).click();
  await panel().getByRole("textbox", { name: "Telefonnummer", exact: true }).fill("+49 170 3333333");
  assert.equal(await panel().getByRole("button", { name: "Telefonnummer ändern", exact: true }).isEnabled(), false);
  await panel().getByRole("button", { name: "Neue Vorschau übernehmen", exact: true }).click();
  await panel().getByRole("button", { name: "Telefonnummer ändern", exact: true }).click();
  await page.locator("#hauptinhalt").getByRole("link", { name: "+49 170 3333333", exact: true }).first().waitFor();
  assert.equal((await db.contact.findUnique({ where: { id: contact.id } })).phone, "+49 170 3333333");
  checks.push("Mixed task: Jarvis proposal → manual field edit → new preview → confirmation → correct persisted value");
  await panel().getByRole("textbox", { name: "Nachricht an den Assistenten" }).focus();
  await page.keyboard.press("F6");
  assert.equal(await page.locator("#hauptinhalt").evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("F6");
  assert.equal(await panel().evaluate(element => element.contains(document.activeElement)), true);
  checks.push("F6 transfers focus between the usable CRM and Jarvis panel");
  await send("Zeige Hilfe"); await panel().getByRole("link", { name: "Quelle öffnen ↗" }).last().waitFor();
  await send("Öffne den Rechner");
  await panel().getByRole("link", { name: "Quelle öffnen ↗" }).last().waitFor();
  const calculator = panel().locator('a[href^="/zinsrechner?"]');
  assert.ok(await calculator.count() > 0);
  const expected = berechne({ ...standardWerte(), start: 1000, monthly: 100, years: 10, scenario: "custom", customRate: 5 }).main.end;
  assert.ok(expected > 0); await shot("jarvis-calculator-result");
  for (const width of [320, 390, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1000 }); await noOverflow(); await shot(`jarvis-${width}`); }
  checks.push("Help source links and calculator handoff use actual shared helpers; assistant panel responsive; opening does not request microphone");
  assert.deepEqual(errors, []);
  await writeFile(new URL("result.json", output), JSON.stringify({ success: true, checks, errors, limitations: ["Local simulated text provider", "No real microphone, OpenAI or physical device acceptance", "No deployment"] }, null, 2));
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) {
  if (page) await shot("failure").catch(() => {});
  await writeFile(new URL("result.json", output), JSON.stringify({ success: false, checks, errors, error: String(error) }, null, 2)); throw error;
} finally {
  await browser?.close(); server?.kill(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); await fixture.close();
}
