import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";
import { berlinToday, shiftDay } from "../lib/dates.ts";

const fixture = await testDatabase(0, 50);
const db = fixture.client;
const port = Number(process.env.STRUKTUR_TEST_PORT || 3117);
const origin = `http://localhost:${port}`;
const production = process.env.CRM_TEST_PRODUCTION === "1";
const output = new URL(`../test-results/struktur-${production ? "production" : "dev"}/`, import.meta.url);
await mkdir(output, { recursive: true });
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const env = { ...process.env, DATABASE_URL: fixture.url, DATABASE_POOL_MAX: "1", NEXT_TELEMETRY_DISABLED: "1" };
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", production ? "start" : "dev", "-p", String(port), "--hostname", "127.0.0.1"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (c) => { serverLog += c; });
server.stderr.on("data", (c) => { serverLog += c; });
let browser;
let page;
let failed = false;
const browserLog = [];
try {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(10000) })).ok) break; } catch {}
    if (i === 89) throw new Error(`Server nicht bereit: ${serverLog.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const salt = "browser-test-salt";
  const passwordHash = pbkdf2Sync("Test123456!", salt, 310000, 32, "sha256").toString("base64");
  for (const [id, name, leaderId, path] of [
    ["chef", "Emil Beispiel", null, "/chef/"],
    ["jana", "Jana Beispiel", "chef", "/chef/jana/"],
    ["leo", "Leo Beispiel", "jana", "/chef/jana/leo/"],
    ["fremd", "Fremde Person", null, "/fremd/"],
  ]) await db.user.create({ data: {
    id, name, path, leaderId, email: `${id}@example.test`, passwordHash, passwordSalt: salt,
    onboardingDoneAt: new Date(), startedAt: new Date("2026-06-01"), karrierestufe: 3, einheitenStart: 12000,
    person: { create: { name } },
  } });
  const heute = berlinToday();
  for (const id of ["jana", "leo"]) {
    const p = await db.person.findUnique({ where: { userId: id } });
    for (const [vor, count] of [[20, 3], [12, 8], [4, 5], [0, 2]]) {
      const tag = new Date(shiftDay(heute, -vor));
      await db.dailyLog.create({ data: { personId: p.id, type: "CALL", count, date: tag } });
      await db.dailyLog.create({ data: { personId: p.id, type: "APPOINTMENT_SET", count: 1, date: tag } });
      await db.einheitenbuchung.create({ data: { userId: id, hundertstel: vor === 4 ? -1500 : count * 1000, tag } });
    }
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addCookies([{ name: authCookieName, value: await createSession("chef"), url: origin }]);
  page = await context.newPage();
  page.on("request", (r) => browserLog.push(`REQUEST ${r.method()} ${r.url()}`));
  page.on("requestfailed", (r) => browserLog.push(`FAILED ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => browserLog.push(`RESPONSE ${r.status()} ${r.url()}`));
  page.on("response", async (r) => {
    if (r.url().includes("/mannschaft/jana?_rsc=")) {
      try {
        const body = await r.text();
        browserLog.push(`BODY ${body.length} ${r.url()}`);
        await writeFile(new URL("person-rsc.txt", output), body);
      } catch (error) { browserLog.push(`BODY FAILED ${error.message}`); }
    }
  });
  page.on("console", (m) => { if (m.type() === "error") browserLog.push(`CONSOLE ${m.text()}`); });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/mannschaft?bereich=ueberblick`);
  const knoten = page.locator('a[draggable="false"][href="/mannschaft/jana"]');
  if (process.env.STRUKTUR_TEST_DRAG !== "0") {
  await knoten.scrollIntoViewIfNeeded();
  const box = await knoten.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.ok(page.url().includes("bereich=ueberblick"), "Ziehen darf keine Person öffnen");
  await knoten.focus();
  await knoten.press("Enter");
  await page.getByRole("heading", { name: "Jana Beispiel", exact: true }).waitFor();
  await page.goto(`${origin}/mannschaft?bereich=ueberblick`);
  }
  await knoten.tap();
  await page.getByRole("heading", { name: "Jana Beispiel", exact: true }).waitFor();
  const chart = page.getByRole("region", { name: "Leistungsverlauf", exact: true });
  await chart.getByRole("img", { name: /Verlauf Einheiten/ }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL("person-mobile.png", output)), fullPage: true });
  await page.screenshot({ path: fileURLToPath(new URL("person-vorschau.png", output)) });
  await chart.getByRole("button", { name: "Anrufe", exact: true }).click();
  await chart.getByRole("img", { name: /Verlauf Anrufe.*18 Anrufe/ }).waitFor();
  await chart.getByRole("button", { name: "Team (1)", exact: true }).click();
  await page.getByRole("heading", { name: "Verlauf des Teams", exact: true }).waitFor();
  for (const name of ["Woche", "6 Monate", "Jahr", "Gesamt", "Monat"]) await chart.getByRole("button", { name, exact: true }).click();
  await chart.getByRole("button", { name: "Termine vereinbart", exact: true }).click();
  await chart.getByRole("img", { name: /4 Termine vereinbart/ }).waitFor();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Person bearbeiten" });
  await dialog.getByLabel("Name", { exact: true }).fill("Jana Neu");
  await dialog.getByLabel("Telefonnummer", { exact: true }).fill("+49 123 4567");
  await dialog.getByLabel("Karrierestufe", { exact: true }).selectOption("4");
  await dialog.getByLabel("Eintrittsdatum", { exact: true }).fill("2026-05-10");
  await page.screenshot({ path: fileURLToPath(new URL("bearbeiten-mobile.png", output)), fullPage: true });
  await page.screenshot({ path: fileURLToPath(new URL("bearbeiten-vorschau.png", output)) });
  await dialog.getByRole("button", { name: "Änderungen speichern", exact: true }).click();
  await page.getByRole("heading", { name: "Jana Neu", exact: true }).waitFor();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  dialog = page.getByRole("dialog");
  assert.equal(await dialog.getByLabel("Telefonnummer", { exact: true }).inputValue(), "+49 123 4567");
  assert.equal(await dialog.getByLabel("Karrierestufe", { exact: true }).inputValue(), "4");
  assert.equal(await dialog.getByLabel("Eintrittsdatum", { exact: true }).inputValue(), "2026-05-10");
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  const janaContext = await browser.newContext({ serviceWorkers: "block" });
  await janaContext.addCookies([{ name: authCookieName, value: await createSession("jana"), url: origin }]);
  const janaPage = await janaContext.newPage();
  await janaPage.goto(`${origin}/profil`);
  assert.ok(janaPage.url().endsWith("/profil"));
  await page.getByRole("button", { name: "Austragen", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Austragen", exact: true }).click();
  await page.getByRole("button", { name: "Zurückholen", exact: true }).waitFor();
  await janaPage.goto(`${origin}/profil`);
  await janaPage.waitForURL("**/login");
  await page.goto(`${origin}/mannschaft/verwalten?status=ausgetragen`);
  await page.getByRole("link", { name: /Jana Neu/ }).click();
  await page.getByRole("button", { name: "Zurückholen", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Zurückholen", exact: true }).click();
  await chart.getByRole("img", { name: /Verlauf Einheiten/ }).waitFor();
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Kein horizontaler Seitenüberlauf bei 320 Pixeln");
  await page.screenshot({ path: fileURLToPath(new URL("person-small.png", output)), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: fileURLToPath(new URL("person-desktop.png", output)), fullPage: true });
  await page.evaluate(() => { localStorage.setItem("ergo-thema", "hell"); document.documentElement.classList.remove("dark"); });
  await page.screenshot({ path: fileURLToPath(new URL("person-light.png", output)), fullPage: true });
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  dialog = page.getByRole("dialog");
  assert.equal(await dialog.getByRole("button", { name: "Endgültig löschen", exact: true }).isDisabled(), true);
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByRole("heading", { name: "Jana Neu", exact: true }).waitFor();
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Zur Bestätigung/).fill("Jana Neu");
  await dialog.getByRole("button", { name: "Endgültig löschen", exact: true }).click();
  await page.waitForURL("**/mannschaft/verwalten?geloescht=1");
  await page.getByRole("link", { name: /Leo Beispiel/ }).waitFor();
  assert.equal(await page.getByRole("link", { name: /Jana Neu/ }).count(), 0);
  await page.getByRole("link", { name: /Leo Beispiel/ }).click();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getByLabel("Führungskraft", { exact: true }).inputValue(), "chef");
  await page.goto(`${origin}/mannschaft/fremd`);
  assert.equal(await page.getByRole("button", { name: "Bearbeiten", exact: true }).count(), 0);
  assert.equal(await page.getByRole("region", { name: "Leistungsverlauf", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS: Struktur anklicken, Kurven, Bearbeiten, Austragen, Sitzungssperre, Zurückholen, Löschen, Team erhalten, fremder Ast; ${production ? "Produktionsbuild" : "Entwicklungsserver"}.`);
} catch (error) {
  console.error(error);
  if (page) await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)), fullPage: true }).catch(() => {});
  failed = true;
} finally {
  await writeFile(new URL("browser.log", output), browserLog.join("\n"));
  await writeFile(new URL("server.log", output), serverLog);
  await browser?.close();
  server.kill();
  await fixture.close();
}
process.exitCode = failed ? 1 : 0;
