// Isolated, reproducible UI evidence. This fixture never uses an external DB/provider.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";
import { berlinToday, dayToUtcDate, shiftDay } from "../lib/dates.ts";
import { runMasterplanFlows } from "./hubspot-masterplan-flows.mjs";
import { visibleWorkspaceMetrics } from "./hubspot-masterplan-metrics.mjs";
import { cleanUiFlows } from "./clean-ui-browser-flows.mjs";

const phase = process.argv.includes("--baseline") ? "before" : "after";
const productionBuild = process.argv.includes("--production");
if (productionBuild && phase === "before") throw new Error("Use the captured development baseline; production mode is for the final isolated UI check");
const flowsOnly = process.argv.includes("--flows-only");
const early = process.argv.includes("--early");
const selectedPages = process.argv.find(arg => arg.startsWith("--pages="))?.slice(8).split(",");
const evidenceDirectory = process.env.CRM_UI_EVIDENCE_DIR || "hubspot-masterplan";
const outputPhase = productionBuild ? (flowsOnly ? "optimized-flows" : "after-optimized") : flowsOnly ? "after-flows" : early ? "after-early" : phase;
const output = new URL(`../test-results/${evidenceDirectory}/${outputPhase}/`, import.meta.url);
await mkdir(output, { recursive: true });
const previous = process.argv.includes("--refresh") ? JSON.parse(await readFile(new URL("result.json", output), "utf8")) : null;
if (previous) assert.ok(selectedPages?.length && phase === "after" && !flowsOnly && process.argv.includes("--matrix-only"), "Refresh must select matrix areas after a successful full capture");
const cache = new URL(`../test-results/${evidenceDirectory}/cache-${phase}/`, import.meta.url);
await mkdir(cache, { recursive: true });
await writeFile(new URL("tsconfig.json", cache), JSON.stringify({ extends: "../../../tsconfig.json", compilerOptions: { baseUrl: "../../..", paths: { "@/*": ["./*"] } } }));
await writeFile(new URL("server.log", output), "");
const fixture = await testDatabase(0, 40), db = fixture.client;
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const now = new Date(), today = berlinToday(), day = dayToUtcDate(today);
const tomorrow = dayToUtcDate(shiftDay(today, 1));
const names = ["Jonas Beispiel", "Mara Muster", "Anna-Lena Sophie Charlotte von Beispielhausen-Mustermann", "Lea Muster", "Ben Beispiel", "Mila Probe", "Finn Muster", "Clara Beispiel", "Nora Probe", "Paul Muster", "Lena Beispiel", "Jan Probe", "Lukas Muster", "Emma Beispiel", "Sarah Probe", "Max Muster"];
const users = {}, contacts = {}, checks = [], measurements = [], errors = [], findings = [];
const providerState = { fail: false };
let browser, server, provider, page, context, providerRequests = 0;
const seedUser = async (id, name, leaderId, arbeitsfokus, empty = false) => {
  const user = await db.user.create({ data: { id, name, email: `${id}@example.test`, passwordHash: "synthetic-test-only", aiBetaEnabled: true, leaderId, path: leaderId ? `/qa-lead/${id}/` : `/${id}/`, arbeitsfokus, onboardingDoneAt: now, installedAt: now, startTrack: "VERKAUF", createdAt: new Date("2026-01-01"), person: { create: { name } }, startProgress: { create: { phase: empty ? "COLLECTION" : "DONE" } } }, include: { person: true } });
  users[id] = user;
  if (empty) return user;
  contacts[id] = [];
  for (let i = 0; i < names.length; i++) {
    contacts[id].push(await db.contact.create({ data: { id: `${id}-contact-${i}`, ownerId: id, name: names[i], phone: i === 1 ? null : `+49 170 123${String(i).padStart(4, "0")}`, email: i === 0 ? "jonas@example.test" : null, listKinds: i % 4 === 0 ? ["VERKAUF", "RECRUITING"] : ["VERKAUF"], note: i === 0 ? "Beratung vorbereitet. Rückmeldung nach dem Gespräch vereinbart." : null, createdAt: new Date(day.getTime() - (names.length - i) * 86400000), lastProgressAt: day, nextStepType: i < 7 ? "ANRUF" : null, nextStepAt: i < 3 ? day : i < 7 ? tomorrow : null, nextStepNote: i < 7 ? "Nächste Schritte besprechen" : null, ...(i === 0 ? { followUps: { create: { ownerId: id, type: "ANRUF", at: new Date(day.getTime() + 9 * 3600000), note: "Beratungstermin abstimmen" } } } : {}) } }));
  }
  await db.termin.createMany({ data: [0, 1, 2].map(i => ({ ownerId: id, titel: ["Beratung vorbereiten", "Gespräch mit Jonas Beispiel", "Wochenplanung"][i], art: i === 0 ? "BEGLEITUNG" : "SONSTIGES", von: new Date(day.getTime() + (11 + i * 2) * 3600000), bis: new Date(day.getTime() + (12 + i * 2) * 3600000), ort: "Testbüro", notiz: "Ausschließlich synthetischer Testtermin" })) });
  await db.dailyLog.createMany({ data: [{ personId: user.person.id, type: "CALL", count: 6, date: day }, { personId: user.person.id, type: "APPOINTMENT_SET", count: 2, date: day }] });
  await db.einheitenbuchung.create({ data: { userId: id, hundertstel: 12500, tag: day } });
  const goal = await db.ziel.create({ data: { inhaberId: id, erstelltVonId: id, titel: "Meine Anrufe im Monat", kennzahl: "CALL", zeitraum: "MONAT", start: dayToUtcDate(today.slice(0, 8) + "01"), ende: dayToUtcDate(shiftDay(today, 31)), zielwert: 20, beteiligte: { create: { userId: id, zusage: "BESTAETIGT", bestaetigtAt: now } } } });
  await db.user.update({ where: { id }, data: { hauptzielId: goal.id } });
  return user;
};

async function capture(name, full = false) {
  await page.screenshot({ path: fileURLToPath(new URL(`${name}${full ? "-full" : ""}.png`, output)), animations: "disabled", caret: "initial", fullPage: full });
}
async function navigate(path) {
  const response = await page.goto(origin + path);
  assert.ok(response?.ok(), `${path}: HTTP ${response?.status()}`);
  await page.locator("#hauptinhalt").waitFor();
  await page.locator("h1").first().waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function login(id, width = 390, height = 844) {
  await context?.close();
  context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block", ...(process.env.CRM_UI_IDENTITY_ENCODING === "1" ? { extraHTTPHeaders: { "Accept-Encoding": "identity" } } : {}) });
  await context.addCookies([{ name: authCookieName, value: await createSession(id), url: origin }]);
  await context.addInitScript(() => { window.__micRequests = 0; Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { window.__micRequests++; throw new DOMException("Fixture denied", "NotAllowedError"); } } }); });
  page = await context.newPage();
  if (process.env.CRM_UI_NO_BROWSER_CACHE === "1") {
    const cdp = await context.newCDPSession(page); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  }
  if (["1", "headers"].includes(process.env.CRM_UI_NETWORK_DEBUG)) {
    for (const event of ["request", "requestfinished", "requestfailed"]) page.on(event, request => {
      if (new URL(request.url()).pathname === "/namen") console.log(`NETWORK ${event} ${request.method()} ${request.url()}`);
    });
    page.on("response", response => {
      if (new URL(response.url()).pathname !== "/namen") return;
      console.log(`NETWORK response ${response.status()} ${response.headers()["content-type"]} ${response.url()}`);
      console.log(JSON.stringify({ cacheControl: response.headers()["cache-control"], encoding: response.headers()["content-encoding"], vary: response.headers().vary }));
    });
    if (process.env.CRM_UI_NETWORK_DEBUG === "1") await page.route("**/namen?**", async route => {
      if (!new URL(route.request().url()).searchParams.has("status")) return route.continue();
      const response = await route.fetch(); const body = await response.text();
      await writeFile(new URL("filter-flight-debug.txt", output), body);
      console.log(JSON.stringify({ filterResponseType: response.headers()["content-type"], bodyLength: body.length, bodyStart: body.slice(0, 2500) }));
      await route.fulfill({ response });
    });
  }
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(productionBuild ? 20000 : 90000);
  page.on("pageerror", error => {
    const detail = { url: page.url(), name: error.name, message: error.stack || error.message || String(error) };
    errors.push(detail); appendFileSync(new URL("browser-errors.jsonl", output), `${JSON.stringify(detail)}\n`);
  });
  page.on("console", message => { if (message.type() === "error") errors.push({ url: page.url(), message: message.text(), expected: providerState.fail && /503/.test(message.text()) || providerState.expected404 && /404/.test(message.text()) || providerState.expectedNetworkFailure && /net::ERR_FAILED|Failed to fetch/.test(message.text()) }); });
}

try {
  await seedUser("qa-lead", "Lena Führung", null, "FUEHRUNG");
  await seedUser("qa-ready", "Alex Eigenarbeit", "qa-lead", "EIGEN");
  for (const [i, name] of ["Nora Partner", "Ben Begleitung", "Mara Aufbau"].entries()) {
    const id = `qa-partner-${i}`;
    await db.user.create({ data: { id, name, email: `${id}@example.test`, passwordHash: "synthetic-test-only", leaderId: "qa-lead", path: `/qa-lead/${id}/`, createdAt: new Date("2026-01-01"), onboardingDoneAt: now, person: { create: { name } }, startProgress: { create: { phase: "DONE" } } } });
    await db.partnerVereinbarung.create({ data: { initiatorId: "qa-lead", empfaengerId: id, verantwortlicherId: id, vorgeschlagenVonId: "qa-lead", titel: ["Gespräch gemeinsam vorbereiten", "Rückblick vereinbaren", "Nächste Woche planen"][i], art: "AUFGABE", faelligAm: new Date(day.getTime() + (10 + i) * 3600000), status: "BESTAETIGT", bestaetigtVonId: id, bestaetigtAm: now } });
  }
  await seedUser("qa-empty", "Robin Neustart", null, "AUTO", true);
  await db.teamziel.create({ data: { wurzelId: "qa-lead", verantwortlichId: "qa-lead", titel: "Anrufe im Team", kennzahl: "CALL", zeitraum: "MONAT", start: dayToUtcDate(today.slice(0, 8) + "01"), ende: dayToUtcDate(shiftDay(today, 31)), zielwert: 100 } });
  for (const key of ["aiCrm", "zinsrechner"]) await db.feature.upsert({ where: { key }, create: { key, titel: key, state: "TEST" }, update: { state: "TEST" } });
  if (phase === "after") await db.feature.upsert({ where: { key: "startfuehrung" }, create: { key: "startfuehrung", titel: "Startführung", state: "TEST" }, update: { state: "TEST" } });
  provider = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    providerRequests++; const data = JSON.parse(body || "{}");
    res.setHeader("Content-Type", "application/json");
    if (providerState.fail) { res.statusCode = 503; res.end(JSON.stringify({ error: { code: "service_unavailable", type: "server_error", message: "Synthetic local fixture failure" } })); return; }
    const round = data.input?.filter(item => item.type === "function_call_output").length ?? 0;
    const calls = [{ name: "search_contacts", args: { query: "Jonas" } }, { name: "update_contact", args: { contactId: "qa-ready-contact-0", changeFields: ["phone"], phone: "+49 170 7654321", name: null, email: null, source: null, job: null } }];
    const call = calls[round];
    res.end(JSON.stringify({ id: `resp_${randomUUID()}`, object: "response", status: "completed", model: data.model, output: call ? [{ type: "function_call", id: randomUUID(), call_id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args), status: "completed" }] : [{ type: "message", id: randomUUID(), role: "assistant", status: "completed", content: [{ type: "output_text", text: "Die Angaben sind geprüft. Nutze die angezeigte Vorschau.", annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }));
  });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", productionBuild ? "start" : "dev", "-p", String(port), "--hostname", "127.0.0.1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: "1", CRM_TEST_DIST_DIR: productionBuild ? `.cache/${evidenceDirectory}-next` : `.cache/${evidenceDirectory}-${phase}-next`, CRM_TEST_DISABLE_WEBPACK_CACHE: "1", CRM_TEST_TSCONFIG: `test-results/${evidenceDirectory}/cache-${phase}/tsconfig.json`, SESSION_SECRET: process.env.SESSION_SECRET, AI_CRM_ENABLED: "true", AI_LIVE_PROVIDER: phase === "before" ? "disabled" : "mock", OPENAI_API_KEY: "local-fixture-only", OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, OPENAI_ORG_ID: "", OPENAI_PROJECT_ID: "", STRIPE_SECRET_KEY: "", STRIPE_AI_PRICE_ID: "", SPOTIFY_ENABLED: "false", SPOTIFY_LOCAL_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" } });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => appendFileSync(new URL("server.log", output), chunk));
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(10000) })).ok) break; } catch {} if (i === 119) throw new Error("Server not ready"); await new Promise(resolve => setTimeout(resolve, 500)); }
  browser = await chromium.launch({ headless: true });
  // Compile the disposable development server's read endpoints before timing
  // interactions. These GETs never start an AI request or microphone/session.
  if (phase === "after" && !productionBuild && !process.argv.includes("--matrix-only")) {
    await login("qa-ready");
    for (const path of ["/api/ai-crm/access", "/api/ai-crm/live/session", "/api/ai-crm/conversations", "/api/ai-crm/music/spotify"]) {
      const response = await context.request.get(origin + path, { timeout: 90000 });
      assert.ok(response.ok(), `Development read endpoint warmup ${path}: HTTP ${response.status()}`);
    }
    assert.equal(providerRequests, 0, "Read endpoint warmup must not call the model provider");
  }
  const widths = flowsOnly ? [] : phase === "before" || process.argv.includes("--quick") ? [390, 1440] : [320, 390, 768, 1024, 1440];
  for (const [id, role] of [["qa-ready", "ready"], ["qa-lead", "leader"]]) {
    await login(id);
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : width === 390 ? 844 : 900 });
      for (const [name, path] of [["today", "/heute"], ["contacts", "/namen?liste=VERKAUF"], ["record", `/contacts/${contacts[id][0].id}`], ["edit", `/contacts/${contacts[id][0].id}/edit`], ["calendar", "/kalender?ansicht=liste"], ["progress", "/fortschritt"], ["team", "/mannschaft"]]) {
        if (early && ["contacts", "record", "edit"].includes(name)) continue;
        if (selectedPages && !selectedPages.includes(name)) continue;
        await navigate(path);
        for (const theme of ["light", "dark"]) {
          await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
          const geometry = phase === "after" ? await page.evaluate(visibleWorkspaceMetrics) : await page.evaluate(() => {
            const rect = e => e ? { y: e.getBoundingClientRect().y, height: e.getBoundingClientRect().height, width: e.getBoundingClientRect().width } : null;
            const contact = Array.from(document.querySelectorAll("#hauptinhalt a[href^='/contacts/']")).find(e => e.textContent.includes("Jonas Beispiel"));
            const dock = document.querySelector(".crm-dock");
            return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, firstContact: rect(contact), firstAction: rect(document.querySelector(".crm-today-next")), primaryAction: rect(document.querySelector(".crm-primary-action")), header: rect(document.querySelector(".crm-header")), dock: rect(dock), heading: rect(document.querySelector("h1")), main: rect(document.getElementById("hauptinhalt")) };
          });
          measurements.push({ role, page: name, theme, ...geometry });
          if (phase === "after" && geometry.documentWidth > width) findings.push({ name: `${role}/${name}/${width}/${theme}: horizontal overflow`, geometry });
          if (phase === "after" && width === 390 && name === "today" && geometry.firstAction?.y > 240) findings.push({ name: `${role}/today/390/${theme}: first next action starts below 240px`, geometry });
          if (phase === "after" && name === "contacts" && [320, 390, 1440].includes(width)) {
            const limit = width === 1440 ? 280 : 300, count = width === 1440 ? 8 : width === 390 ? 3 : 1;
            if (!geometry.firstContact || geometry.firstContact.y > limit || geometry.completeRows < count) findings.push({ name: `${role}/contacts/${width}/${theme}: first row <=${limit}px and ${count} complete rows required`, firstContact: geometry.firstContact, completeRows: geometry.completeRows });
          }
          await capture(`${role}-${name}-${width}-${theme}`);
          if (theme === "light") await capture(`${role}-${name}-${width}-${theme}`, true);
        }
        console.log(`${phase}: ${role} ${name} ${width}`);
      }
    }
  }
  await login("qa-empty");
  for (const [name, path] of [["today", "/heute"], ["contacts", "/namen?liste=VERKAUF"], ["progress", "/fortschritt"], ["team", "/mannschaft"]]) {
    await navigate(path);
    for (const theme of ["light", "dark"]) { await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme); await capture(`empty-${name}-390-${theme}`); }
  }
  checks.push(flowsOnly ? "Independent functional run with fresh isolated fixture; empty/onboarding states captured at 390 px." : `${selectedPages?.join(", ") ?? "Five main pages and contact detail/edit"} captured for ready and leadership roles at ${widths.join("/")} px in both themes; empty/onboarding role captured at 390 px.`);
  assert.equal(providerRequests, 0, "Screenshots must not start an AI request");
  if (phase === "after" && !process.argv.includes("--matrix-only")) await runMasterplanFlows({ getPage: () => page, login, navigate, db, today, origin, output, providerState, checks, findings });
  if (phase === "after" && process.env.CRM_UI_CLEAN_CHECKS === "1") await cleanUiFlows({ getPage: () => page, login, navigate, db, origin, output, checks, findings });
  if (previous) {
    measurements.unshift(...previous.measurements.filter(row => !selectedPages.includes(row.page)));
    checks.unshift(...previous.checks);
    errors.unshift(...previous.errors);
    findings.unshift(...previous.findings);
    checks.push(`Only ${selectedPages.join(", ")} measurements/screenshots refreshed; remaining ${previous.measurements.filter(row => !selectedPages.includes(row.page)).length} views retain the final full-matrix evidence.`);
  }
  const report = { success: !errors.some(error => !error.expected) && !findings.length, phase, serverMode: productionBuild ? "local-optimized-build" : "local-development", scope: process.argv.includes("--matrix-only") ? "matrix-only" : flowsOnly ? "selected-flows" : "matrix-and-flows", browserCacheDisabled: process.env.CRM_UI_NO_BROWSER_CACHE === "1", identityEncoding: process.env.CRM_UI_IDENTITY_ENCODING === "1", date: now.toISOString(), commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), workingTreeModified: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()), seed: { date: today, roles: ["ready", "leader", "empty", ...(process.env.CRM_UI_CLEAN_CHECKS === "1" ? ["admin"] : [])], contactsPerActiveRole: 16, partners: 4, agreements: 3, personalGoals: 2, teamGoals: 1 }, checks, measurements, errors, findings, limitations: ["Local Chromium emulation; no physical devices", "No real provider or microphone acceptance", "Disposable in-memory database; no deployment", ...(process.argv.includes("--matrix-only") ? ["Matrix only; query navigation and functional flows are not verified in this run"] : [])] };
  await writeFile(new URL("result.json", output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, phase, checks, errors: errors.length, findings }));
  if (!report.success) process.exitCode = 1;
} catch (error) {
  if (page) await capture("failure").catch(() => {});
  await writeFile(new URL("result.json", output), JSON.stringify({ success: false, phase, checks, measurements, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close(); server?.kill(); if (provider) { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); } await fixture.close();
}
// PGlite cleanup may change exitCode; the evidence verdict remains authoritative.
if (findings.length || errors.some(error => !error.expected)) process.exitCode = 1;
