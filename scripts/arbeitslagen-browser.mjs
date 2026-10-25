// Browser acceptance against disposable PostgreSQL and synthetic accounts only.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";
import {
  berlinDayOf,
  berlinToday,
  dayToUtcDate,
  shiftDay,
} from "../lib/dates.ts";

const fixture = await testDatabase(0, 50);
const db = fixture.client;
const port = Number(process.env.CRM_TEST_PORT || 3118);
const origin = `http://127.0.0.1:${port}`;
const production = process.env.CRM_TEST_PRODUCTION === "1";
const output = new URL("../test-results/arbeitslagen/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL("result.json", output),
  JSON.stringify(
    {
      passed: false,
      status: "running",
      mode: production ? "production" : "development",
    },
    null,
    2,
  ),
);
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const today = berlinToday();
const day = dayToUtcDate(today);
const now = new Date();
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    production ? "start" : "dev",
    "-p",
    String(port),
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: fixture.url,
      DIRECT_URL: fixture.url,
      DATABASE_POOL_MAX: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (c) => {
  serverLog += c;
  appendFileSync(new URL("server.log", output), c);
});
server.stderr.on("data", (c) => {
  serverLog += c;
  appendFileSync(new URL("server.log", output), c);
});
let browser;
try {
  const users = [];
  for (const [id, name, leaderId, path, fokus] of [
    ["lead", "Lena Schneider", null, "/lead/", "FUEHRUNG"],
    ["build", "Jonas Weber", "lead", "/lead/build/", "AUTO"],
    ["start", "Mila Neumann", "build", "/lead/build/start/", "AUTO"],
  ])
    users.push(
      await db.user.create({
        data: {
          id,
          name,
          leaderId,
          path,
          arbeitsfokus: fokus,
          passwordHash: "synthetic-test-account",
          onboardingDoneAt: now,
          installedAt: now,
          startTrack: "VERKAUF",
          createdAt: new Date("2026-01-01"),
          person: { create: { name } },
        },
        include: { person: true },
      }),
    );
  const anna = await db.contact.create({
    data: {
      name: "Anna Beispiel",
      phone: "0301234567",
      ownerId: "build",
      listKinds: ["VERKAUF"],
      stage: "TERMIN_VEREINBART",
      appointmentAt: now,
      nextStepType: "TERMIN",
      nextStepAt: now,
    },
  });
  await db.contact.create({
    data: {
      name: "Ben Beispiel",
      phone: "0307654321",
      ownerId: "build",
      listKinds: ["VERKAUF"],
      nextStepType: "ANRUF",
      nextStepAt: day,
    },
  });
  await db.partnerVereinbarung.create({
    data: {
      initiatorId: "lead",
      empfaengerId: "build",
      verantwortlicherId: "build",
      vorgeschlagenVonId: "lead",
      titel: "Gespräch gemeinsam vorbereiten",
      art: "TERMIN",
      faelligAm: now,
      endetAm: new Date(now.getTime() + 3600000),
      status: "BESTAETIGT",
      bestaetigtVonId: "build",
      bestaetigtAm: now,
      verlauf: {
        create: {
          version: 1,
          akteurId: "lead",
          aktion: "Bestätigt",
          stand: { titel: "Gespräch gemeinsam vorbereiten" },
        },
      },
    },
  });
  await db.einheitenbuchung.createMany({
    data: [
      { userId: "build", hundertstel: 14500, tag: day },
      {
        userId: "build",
        hundertstel: -1500,
        tag: dayToUtcDate(shiftDay(today, -1)),
      },
    ],
  });
  await db.dailyLog.createMany({
    data: [
      { personId: users[1].person.id, type: "CALL", count: 12, date: day },
      {
        personId: users[1].person.id,
        type: "APPOINTMENT_SET",
        count: 4,
        date: day,
      },
    ],
  });
  await db.ziel.create({
    data: {
      inhaberId: "build",
      erstelltVonId: "build",
      titel: "Meine Anrufwoche",
      kennzahl: "CALL",
      zeitraum: "MONAT",
      start: dayToUtcDate(today.slice(0, 8) + "01"),
      ende: dayToUtcDate(shiftDay(today, 31)),
      zielwert: 20,
      wunsch: "Ein freies Wochenende mit der Familie",
      beteiligte: {
        create: { userId: "build", zusage: "BESTAETIGT", bestaetigtAt: now },
      },
    },
  });
  for (let i = 0; i < 90; i++) {
    try {
      if (
        (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(10000) }))
          .ok
      )
        break;
    } catch {}
    if (i === 89)
      throw new Error("Next did not start: " + serverLog.slice(-3000));
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ headless: true });
  let context;
  let page;
  const errors = [];
  let sessionNumber = 0;
  const trace = process.env.CRM_TEST_TRACE === "1";
  await writeFile(new URL("requests.log", output), "");
  await writeFile(new URL("browser-console.log", output), "");
  const openPage = async (url) => {
    await page.waitForLoadState("networkidle");
    await page.goto(url);
    await page.waitForLoadState("networkidle");
  };
  const login = async (id) => {
    // Each identity gets its own browser session, including its router cache.
    if (context) {
      if (trace)
        await context.tracing.stop({
          path: fileURLToPath(new URL(`trace-${sessionNumber}.zip`, output)),
        });
      await context.close();
    }
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    sessionNumber++;
    if (trace)
      await context.tracing.start({ screenshots: true, snapshots: true });
    await context.addCookies([
      { name: authCookieName, value: await createSession(id), url: origin },
    ]);
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) =>
      appendFileSync(
        new URL("requests.log", output),
        `FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText}\n`,
      ),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        appendFileSync(
          new URL("browser-console.log", output),
          `${message.text()}\n`,
        );
    });
  };
  let screenshots = 0;
  const capture = async (name) => {
    await page.screenshot({
      path: fileURLToPath(new URL(`${name}.png`, output)),
      fullPage: true,
      caret: "initial",
    });
    screenshots++;
  };
  const noOverflow = async () =>
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      "No horizontal page overflow",
    );
  assert.equal(await db.contact.count({ where: { ownerId: "start" } }), 0);
  assert.equal(
    await db.einheitenbuchung.count({ where: { userId: "start" } }),
    0,
  );
  assert.equal(await db.ziel.count({ where: { inhaberId: "start" } }), 0);
  assert.equal(await db.user.count({ where: { leaderId: "start" } }), 0);
  await login("start");
  await openPage(`${origin}/heute`);
  await page.getByRole("heading", { name: "Wen kennst du?" }).waitFor();
  assert.equal(
    await page
      .getByRole("navigation", { name: "Hauptnavigation" })
      .getByRole("link")
      .count(),
    5,
  );
  assert.ok(
    (
      await page.locator("a.crm-primary-action").getAttribute("href")
    ).startsWith("/namen/sammeln"),
  );
  await noOverflow();
  await capture("01-start");
  await page.setViewportSize({ width: 320, height: 568 });
  await noOverflow();
  await capture("02-start-klein");
  const nav = await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .boundingBox();
  assert.ok(
    nav.y + nav.height <= 569 && nav.width <= 321,
    "All tabs fit small iPhone viewport",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  // Real zero start: first name and number, first-call guide and an honest no-interest result.
  await page.locator("a.crm-primary-action").click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Nora Nullstart");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await page
    .getByRole("list", { name: "In diesem Bereich gespeichert" })
    .getByText("Nora Nullstart")
    .waitFor();
  await page
    .getByRole("button", { name: "Für heute fertig", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Nummern ergänzen", exact: true })
    .click();
  await page.getByLabel("Telefonnummer", { exact: true }).fill("030998877");
  await page
    .getByRole("button", { name: "Nummer speichern", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "1 Name ist anrufbar.", exact: true })
    .waitFor();
  const nora = await db.contact.findFirstOrThrow({
    where: { ownerId: "start", name: "Nora Nullstart" },
  });
  await openPage(origin + "/namen/anrufen?kontakt=" + nora.id);
  await page.locator("#gespraechshilfe").waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: "Kein Interesse", exact: true })
    .click();
  await page.getByText(/1 Anrufversuch eingetragen/).waitFor();
  assert.equal(
    (await db.contact.findUniqueOrThrow({ where: { id: nora.id } })).lostReason,
    "KEIN_INTERESSE",
  );
  await capture("02a-erster-anruf");
  // Personal goal, failed save and first units: every visible goal uses the committed stand.
  await openPage(origin + "/fortschritt/neu");
  await page.getByLabel("Was möchtest du erreichen?").selectOption("UNITS");
  await page.getByLabel("Dein Zielwert").fill("12,50");
  await page.getByLabel("Name für dein Ziel").fill("Meine ersten Einheiten");
  await page
    .getByLabel("Welcher Wunsch steckt dahinter?")
    .fill("Für meinen Urlaub");
  await page
    .getByRole("button", { name: "Ziel speichern", exact: true })
    .click();
  await page.getByRole("status").waitFor();
  await openPage(origin + "/heute");
  await page
    .getByRole("textbox", { name: "Einheiten eintragen", exact: true })
    .fill("12,5");
  await page.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.getByText(/Einheiten haben immer zwei Nachkommastellen/).waitFor();
  assert.equal(
    await db.einheitenbuchung.count({ where: { userId: "start" } }),
    0,
  );
  assert.equal(
    await page
      .getByText("Deine ersten Einheiten – geschafft!", { exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("textbox", { name: "Einheiten eintragen", exact: true })
    .fill("12,50");
  await page.getByRole("button", { name: "Buchen", exact: true }).click();
  await page
    .getByText("Deine ersten Einheiten – geschafft!", { exact: true })
    .waitFor();
  await page
    .getByRole("region", { name: "Dein Fortschritt" })
    .getByRole("progressbar", { name: "12,5 von 12,5 Einheiten", exact: true })
    .waitFor();
  assert.equal(
    await db.feedEintrag.count({
      where: { person: { userId: "start" }, schluessel: "erste_einheiten" },
    }),
    0,
  );
  await page
    .getByRole("button", { name: "Erfolg im Netzwerk teilen", exact: true })
    .click();
  await page.getByText("Dein Erfolg ist geteilt.", { exact: true }).waitFor();
  assert.equal(
    await db.feedEintrag.count({
      where: { person: { userId: "start" }, schluessel: "erste_einheiten" },
    }),
    1,
  );
  assert.equal(
    await db.nachricht.count(),
    0,
    "No personal message is sent automatically",
  );
  await capture("02b-erste-einheiten");
  await login("build");
  await openPage(`${origin}/heute`);
  await page
    .getByRole("heading", {
      name: "Gespräch gemeinsam vorbereiten",
      exact: true,
    })
    .first()
    .waitFor();
  await page
    .getByRole("region", { name: "Partner begleiten" })
    .getByText("Zuletzt passiert", { exact: true })
    .waitFor();
  assert.ok(
    await page.getByRole("region", { name: "Dein Fortschritt" }).isVisible(),
  );
  await capture("03-aufbau");
  await openPage(`${origin}/namen`);
  await page.getByRole("heading", { name: "Kontakte", exact: true }).waitFor();
  await noOverflow();
  await capture("04-kontakte");
  // Full own-work loop: phone return, appointment, calendar result and linked units.
  await openPage(`${origin}/namen/anrufen?liste=VERKAUF`);
  assert.equal(
    await page.locator("#gespraechshilfe").count(),
    0,
    "Experienced caller can open the guide on demand",
  );
  await page
    .locator('a[href^="tel:"]')
    .evaluate((el) =>
      el.addEventListener("click", (event) => event.preventDefault()),
    );
  await page.locator('a[href^="tel:"]').click();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await page
    .getByText("Wie lief's mit Ben Beispiel?", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Termin", exact: true }).click();
  await page.getByLabel("Oder genau eintragen").fill(`${today}T10:00`);
  await page
    .getByRole("button", { name: "Termin speichern", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const ben = await db.contact.findFirstOrThrow({
    where: { ownerId: "build", name: "Ben Beispiel" },
  });
  assert.equal(ben.stage, "TERMIN_VEREINBART");
  await openPage(`${origin}/kalender?ansicht=liste`);
  await page.locator(`a[href="/contacts/${ben.id}"]`).first().click();
  await page.getByRole("button", { name: "Gehalten", exact: true }).click();
  await page
    .getByPlaceholder("Name 1", { exact: true })
    .first()
    .fill("Clara Empfehlung");
  await page.getByRole("button", { name: "Abschluss", exact: true }).click();
  await page
    .getByRole("heading", { name: "Abschluss steht", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Später", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const erinnerung = await db.einheitenErinnerung.findFirstOrThrow({
    where: { contactId: ben.id },
  });
  assert.equal(erinnerung.buchungId, null);
  assert.ok(erinnerung.faelligAm);
  await openPage(`${origin}/fortschritt/einheiten-offen`);
  await page.getByRole("button", { name: "Eintragen", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Einheiten", exact: true })
    .fill("12,50");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Eintragen", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Einheiten eingetragen", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  assert.ok(
    (
      await db.einheitenErinnerung.findUniqueOrThrow({
        where: { id: erinnerung.id },
      })
    ).buchungId,
  );
  assert.equal(
    await db.contact.count({
      where: { referredById: ben.id, name: "Clara Empfehlung" },
    }),
    1,
  );
  await page.reload();
  await page
    .getByText("Keine offenen Einheiten-Erinnerungen.", { exact: true })
    .waitFor();
  await openPage(`${origin}/fortschritt`);
  await page
    .getByRole("heading", { name: "Fortschritt", exact: true })
    .waitFor();
  await noOverflow();
  await capture("05-fortschritt");
  await openPage(`${origin}/fortschritt/neu`);
  await page.getByLabel("Dein Zielwert").fill("8");
  await page
    .getByRole("button", { name: "Ziel speichern", exact: true })
    .click();
  await page.getByRole("status").waitFor();
  assert.equal(
    await db.ziel.count({ where: { inhaberId: "build", zielwert: 8 } }),
    1,
  );
  await openPage(`${origin}/fortschritt/neu?partner=start`);
  assert.equal(await page.getByLabel("Für wen?").inputValue(), "start");
  await page.getByLabel("Dein Zielwert").fill("5");
  await page
    .getByRole("button", { name: "Ziel speichern", exact: true })
    .click();
  await page.getByRole("status").waitFor();
  const vorschlag = await db.ziel.findFirstOrThrow({
    where: { inhaberId: "start", erstelltVonId: "build", zielwert: 5 },
    include: { beteiligte: true },
  });
  assert.equal(
    vorschlag.beteiligte.find((x) => x.userId === "start").zusage,
    "OFFEN",
  );
  await login("start");
  await openPage(`${origin}/heute`);
  await page.getByRole("link", { name: /Ein Zielvorschlag wartet/ }).click();
  await page
    .getByRole("button", { name: "Ziel bestätigen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ziel bestätigen", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    (
      await db.zielBeteiligung.findUniqueOrThrow({
        where: { zielId_userId: { zielId: vorschlag.id, userId: "start" } },
      })
    ).zusage,
    "BESTAETIGT",
  );
  await login("build");
  await openPage(`${origin}/kalender?ansicht=liste`);
  await page
    .getByRole("link", { name: "Betreuung · Gespräch gemeinsam vorbereiten" })
    .waitFor();
  await noOverflow();
  await capture("06-kalender");
  await openPage(`${origin}/suche?q=Anna`);
  await page.getByRole("link", { name: /Anna Beispiel/ }).waitFor();
  await login("start");
  await openPage(`${origin}/suche?q=Anna`);
  assert.equal(
    await page.getByRole("link", { name: /Anna Beispiel/ }).count(),
    0,
    "Contact search remains private",
  );
  await login("lead");
  await openPage(`${origin}/heute`);
  await page
    .getByRole("heading", {
      name: "Gespräch gemeinsam vorbereiten",
      exact: true,
    })
    .first()
    .waitFor();
  await noOverflow();
  await capture("07-fuehrung");
  // Full shared-work loop: leadership proposes, the partner confirms, a participant completes.
  const abspracheTitel = "Die nächsten Gespräche gemeinsam vorbereiten";
  const abspracheKarte = () =>
    page.getByRole("article").filter({
      has: page.getByRole("heading", { name: abspracheTitel, exact: true }),
    });
  await openPage(`${origin}/mannschaft/vereinbarungen?partner=build`);
  await page
    .getByRole("button", { name: "Absprache vorschlagen", exact: true })
    .click();
  await page.getByLabel("Was möchtet ihr vereinbaren?").fill(abspracheTitel);
  await page.locator("select[name=art]").selectOption("AUFGABE");
  await page.getByLabel("Wer kümmert sich darum?").selectOption("build");
  await page.getByLabel("Bis wann?").fill(today);
  await page
    .getByRole("button", { name: "Zur Bestätigung senden", exact: true })
    .click();
  await abspracheKarte()
    .getByText("Bestätigung offen", { exact: true })
    .waitFor();
  assert.equal(
    await abspracheKarte()
      .getByRole("button", { name: "Bestätigen", exact: true })
      .count(),
    0,
    "The proposer cannot confirm their own proposal",
  );
  const abspracheVorschlag = await db.partnerVereinbarung.findFirstOrThrow({
    where: {
      initiatorId: "lead",
      empfaengerId: "build",
      titel: abspracheTitel,
    },
    include: { verlauf: { orderBy: { version: "asc" } } },
  });
  assert.equal(abspracheVorschlag.status, "VORGESCHLAGEN");
  assert.equal(abspracheVorschlag.verantwortlicherId, "build");
  assert.equal(abspracheVorschlag.art, "AUFGABE");
  assert.equal(berlinDayOf(abspracheVorschlag.faelligAm), today);
  assert.equal(abspracheVorschlag.endetAm, null);
  assert.equal(abspracheVorschlag.bestaetigtAm, null);
  assert.equal(abspracheVorschlag.bestaetigtVonId, null);
  assert.equal(abspracheVorschlag.version, 1);
  assert.deepEqual(
    abspracheVorschlag.verlauf.map((x) => [
      x.version,
      x.aktion,
      x.akteurId,
      x.stand.status,
    ]),
    [[1, "Vorgeschlagen", "lead", "VORGESCHLAGEN"]],
  );
  await noOverflow();
  await capture("07a-absprache-vorschlag");
  await openPage(`${origin}/kalender?ansicht=liste`);
  await page
    .getByRole("link", { name: "Betreuung · Gespräch gemeinsam vorbereiten" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: `Betreuung · ${abspracheTitel}`, exact: true })
      .count(),
    0,
    "An unconfirmed task is not a calendar appointment",
  );
  await login("start");
  await openPage(`${origin}/mannschaft/vereinbarungen?partner=lead`);
  assert.equal(
    await page
      .getByRole("heading", { name: abspracheTitel, exact: true })
      .count(),
    0,
    "Another team member cannot read an agreement they did not join",
  );
  await login("build");
  await openPage(`${origin}/mannschaft/vereinbarungen?partner=lead`);
  await abspracheKarte()
    .getByRole("button", { name: "Bestätigen", exact: true })
    .click();
  await abspracheKarte()
    .getByText("Gemeinsam bestätigt", { exact: true })
    .waitFor();
  const abspracheBestaetigt = await db.partnerVereinbarung.findUniqueOrThrow({
    where: { id: abspracheVorschlag.id },
  });
  assert.equal(abspracheBestaetigt.status, "BESTAETIGT");
  assert.equal(abspracheBestaetigt.bestaetigtVonId, "build");
  assert.ok(abspracheBestaetigt.bestaetigtAm);
  assert.equal(abspracheBestaetigt.version, 2);
  await noOverflow();
  await capture("07b-absprache-bestaetigt");
  await openPage(`${origin}/kalender?ansicht=liste`);
  await page
    .getByRole("link", { name: "Betreuung · Gespräch gemeinsam vorbereiten" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: `Betreuung · ${abspracheTitel}`, exact: true })
      .count(),
    0,
    "A confirmed task remains a task rather than a calendar appointment",
  );
  await login("lead");
  await openPage(`${origin}/mannschaft/vereinbarungen?partner=build`);
  await abspracheKarte()
    .getByRole("button", { name: "Als erledigt markieren", exact: true })
    .click();
  await page
    .getByText("Abgeschlossene Absprachen (1)", { exact: true })
    .click();
  await abspracheKarte().getByText("Erledigt", { exact: true }).waitFor();
  await abspracheKarte()
    .getByText("Verlauf der Absprache (3)", { exact: true })
    .click();
  assert.equal(await abspracheKarte().getByRole("listitem").count(), 3);
  await abspracheKarte()
    .getByText("Vorgeschlagen · Lena Schneider", { exact: true })
    .waitFor();
  await abspracheKarte()
    .getByText("Bestätigt · Jonas Weber", { exact: true })
    .waitFor();
  await abspracheKarte()
    .getByText("Erledigt · Lena Schneider", { exact: true })
    .waitFor();
  const abspracheErledigt = await db.partnerVereinbarung.findUniqueOrThrow({
    where: { id: abspracheVorschlag.id },
    include: { verlauf: { orderBy: { version: "asc" } } },
  });
  assert.equal(abspracheErledigt.status, "ERLEDIGT");
  assert.equal(abspracheErledigt.version, 3);
  assert.deepEqual(
    abspracheErledigt.verlauf.map((x) => [
      x.version,
      x.aktion,
      x.akteurId,
      x.stand.status,
    ]),
    [
      [1, "Vorgeschlagen", "lead", "VORGESCHLAGEN"],
      [2, "Bestätigt", "build", "BESTAETIGT"],
      [3, "Erledigt", "lead", "ERLEDIGT"],
    ],
  );
  assert.deepEqual(
    abspracheErledigt.verlauf[0].stand,
    abspracheVorschlag.verlauf[0].stand,
    "The original proposal snapshot remains unchanged",
  );
  await noOverflow();
  await capture("07c-absprache-verlauf");
  // One shared team goal, explicitly excluding the leader's own units.
  await openPage(origin + "/mannschaft/ziele");
  await page
    .getByLabel("Titel", { exact: true })
    .fill("Unser gemeinsamer Teamtag");
  await page.getByLabel("Zielwert", { exact: true }).fill("200");
  await page
    .getByRole("button", { name: "Teamziel setzen", exact: true })
    .click();
  await page.getByRole("status").waitFor();
  await page
    .getByRole("heading", { name: "Unser gemeinsamer Teamtag", exact: true })
    .waitFor();
  assert.equal(await db.teamziel.count({ where: { wurzelId: "lead" } }), 1);
  const teamSum = (
    await db.einheitenbuchung.aggregate({
      where: { userId: { in: ["build", "start"] } },
      _sum: { hundertstel: true },
    })
  )._sum.hundertstel;
  await login("start");
  await openPage(origin + "/fortschritt");
  await page
    .getByRole("heading", { name: "Unser gemeinsamer Teamtag", exact: true })
    .waitFor();
  await page
    .getByText((teamSum / 100).toLocaleString("de-DE") + " von 200 Einheiten", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Teamziel beenden", exact: true })
      .count(),
    0,
  );
  await noOverflow();
  await capture("07d-teamziel-mitglied");
  await login("lead");
  await openPage(
    origin + "/mannschaft/auswertung?umfang=teilteam&teilteam=build&zeit=woche",
  );
  await page
    .getByRole("link", { name: "Teammeeting öffnen", exact: true })
    .click();
  await page.waitForURL((url) => url.searchParams.get("ansicht") === "meeting");
  assert.equal(new URL(page.url()).searchParams.get("teilteam"), "build");
  assert.equal(new URL(page.url()).searchParams.get("zeit"), "woche");
  await page
    .getByRole("heading", { name: "Unser Teamstand", exact: true })
    .waitFor();
  await openPage(`${origin}/profil`);
  await page.getByLabel("Schwerpunkt der Startseite").selectOption("EIGEN");
  await page.waitForFunction(() => {
    const select = document.querySelector("#arbeitsfokus");
    return select?.value === "EIGEN" && !select.disabled;
  });
  await page.reload();
  assert.equal(
    await page.getByLabel("Schwerpunkt der Startseite").inputValue(),
    "EIGEN",
  );
  assert.equal(
    (await db.user.findUnique({ where: { id: "lead" } })).arbeitsfokus,
    "EIGEN",
  );
  await openPage(`${origin}/mannschaft`);
  await noOverflow();
  await capture("08-team");
  await openPage(`${origin}/mannschaft?bereich=ueberblick`);
  await page.getByRole("link", { name: /Netzwerkabend/ }).waitFor();
  await page.locator('a[href="/mannschaft/bericht"]').waitFor();
  await noOverflow();
  await capture("08a-team-ueberblick");
  await openPage(`${origin}/mannschaft/auswertung`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await noOverflow();
  await capture("09-auswertung");
  await openPage(`${origin}/mannschaft/auswertung?ansicht=meeting`);
  assert.equal(
    await page.getByText("Anna Beispiel", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByText("Gespräch gemeinsam vorbereiten", { exact: true })
      .count(),
    0,
  );
  await capture("10-teammeeting");
  await page.setViewportSize({ width: 430, height: 932 });
  await openPage(`${origin}/mannschaft/auswertung`);
  await noOverflow();
  await capture("10a-iphone-gross");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPage(`${origin}/mannschaft/auswertung`);
  await noOverflow();
  await capture("11-desktop");
  await openPage(`${origin}/profil`);
  await capture("12-profil");
  await page.getByRole("link", { name: /Eigene Daten exportieren/ }).click();
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForURL("**/konto/export");
  assert.ok(
    page.url().endsWith("/konto/export"),
    "Data export remains reachable through the profile",
  );
  assert.deepEqual(errors, [], "No client rendering errors");
  await writeFile(
    new URL("result.json", output),
    JSON.stringify(
      {
        passed: true,
        mode: production ? "production" : "development",
        profiles: 3,
        mobileWidths: [320, 390, 430],
        desktopWidth: 1440,
        screenshots,
        contactId: anna.id,
        agreementId: abspracheVorschlag.id,
      },
      null,
      2,
    ),
  );
  console.log(
    "Browser acceptance passed: three work contexts, navigation, goals, shared agreement confirmation and history, privacy, calendar and reporting.",
  );
} catch (error) {
  await writeFile(
    new URL("result.json", output),
    JSON.stringify(
      {
        passed: false,
        status: "failed",
        mode: production ? "production" : "development",
        error: error.message,
      },
      null,
      2,
    ),
  );
  await writeFile(
    new URL("db-stats.json", output),
    JSON.stringify(fixture.stats(), null, 2),
  );
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        await writeFile(
          new URL("failure-page.txt", output),
          page.url() +
            "\n" +
            (await page
              .locator("body")
              .innerText()
              .catch(() => "")),
        );
        await page
          .screenshot({
            path: fileURLToPath(new URL("failure.png", output)),
            fullPage: true,
          })
          .catch(() => {});
      }
  await writeFile(
    new URL("failure.log", output),
    `${error.stack}\n${serverLog.slice(-8000)}`,
  );
  throw error;
} finally {
  if (browser && process.env.CRM_TEST_TRACE === "1")
    for (const context of browser.contexts())
      await context.tracing.stop({
        path: fileURLToPath(new URL("trace.zip", output)),
      });
  await browser?.close();
  server.kill();
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else {
      server.once("exit", resolve);
      setTimeout(resolve, 5000).unref();
    }
  });
  await fixture.close();
}
