// Calls the actual cron route against temporary PostgreSQL. Outbound pushes
// are recorded locally; no production database, cron secret or recipient is used.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";

const pushModule = `export function pushEingerichtet(){return true} export async function sendeMeldung(ids, meldung){globalThis.cronReviewPushes.push({ids, meldung})}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/push")
      return {
        url: `data:text/javascript,${encodeURIComponent(pushModule)}`,
        shortCircuit: true,
      };
    return next(
      specifier === "next/server" ? "next/server.js" : specifier,
      context,
    );
  },
});

test("actual cron respects initialized structure, Berlin appointment boundaries and one combined push", async () => {
  const fixture = await testDatabase();
  const db = fixture.client;
  globalThis.prisma = db;
  globalThis.cronReviewPushes = [];
  const oldSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "isolated-cron-test";
  try {
    const { GET } = await import("../app/api/cron/meldungen/route.ts");
    const { NextRequest } = await import("next/server.js");
    const { berlinToday, dayToUtcDate, berlinLocalToUtc, shiftDay } =
      await import("../lib/dates.ts");
    const heute = berlinToday();
    const datum = dayToUtcDate(heute);
    for (const data of [
      {
        id: "cron-uninitialisiert",
        path: "/",
        name: "Uninitialisierter Berater",
      },
      {
        id: "cron-fremd",
        path: "/cron-fremd/",
        name: "FREMDER-PARTNER-VERTRAULICH",
        onboardingDoneAt: datum,
      },
      {
        id: "cron-platz-kind",
        path: "/cron-platz-kind/",
        leaderId: "cron-uninitialisiert",
        name: "Kind ohne gestartetes Onboarding",
      },
      {
        id: "cron-fk",
        path: "/cron-fk/",
        name: "Kalender Führung",
        onboardingDoneAt: datum,
      },
      {
        id: "cron-kind",
        path: "/cron-fk/cron-kind/",
        leaderId: "cron-fk",
        name: "Partner zum Begleiten",
        onboardingDoneAt: datum,
      },
      { id: "cron-aufgaben", path: "/cron-aufgaben/", name: "Wiedervorlagen" },
    ])
      await db.user.create({ data: { passwordHash: "nur-test", ...data } });
    for (const [name, local] of [
      ["Heute früh", `${heute}T00:30`],
      ["Heute spät", `${heute}T23:30`],
      ["Morgen früh", `${shiftDay(heute, 1)}T00:30`],
      ["Gestern spät", `${shiftDay(heute, -1)}T23:30`],
    ])
      await db.contact.create({
        data: {
          ownerId: "cron-fk",
          name,
          stage: "TERMIN_VEREINBART",
          appointmentAt: berlinLocalToUtc(local),
        },
      });
    for (const [name, local] of [
      ["Heutiger Anruf", `${heute}T23:30`],
      ["Morgiger Anruf", `${shiftDay(heute, 1)}T00:30`],
    ])
      await db.contact.create({
        data: {
          ownerId: "cron-aufgaben",
          name,
          stage: "KONTAKTIERT",
          nextStepType: "ANRUF",
          nextStepAt: berlinLocalToUtc(local),
        },
      });
    const gewonnen = await db.contact.create({
      data: {
        ownerId: "cron-fk",
        name: "Einheiten offen",
        stage: "ABSCHLUSS",
        outcome: "GEWONNEN",
      },
    });
    const abschluss = await db.stageEvent.create({
      data: { userId: "cron-fk", contactId: gewonnen.id, toStage: "ABSCHLUSS" },
    });
    await db.einheitenErinnerung.create({
      data: {
        userId: "cron-fk",
        contactId: gewonnen.id,
        abschlussId: abschluss.id,
        faelligAm: datum,
      },
    });
    await db.feature.upsert({
      where: { key: "einheiten" },
      create: { key: "einheiten", titel: "Einheiten", state: "LAEUFT" },
      update: { state: "LAEUFT" },
    });

    const unauthorized = await GET(
      new NextRequest("http://localhost/api/cron/meldungen"),
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(globalThis.cronReviewPushes.length, 0);
    const response = await GET(
      new NextRequest("http://localhost/api/cron/meldungen", {
        headers: { authorization: "Bearer isolated-cron-test" },
      }),
    );
    assert.equal(response.status, 200);
    const pushes = globalThis.cronReviewPushes;
    const uninitialisiert = pushes.filter((push) =>
      push.ids.includes("cron-uninitialisiert"),
    );
    assert.equal(uninitialisiert.length, 1);
    assert.doesNotMatch(
      JSON.stringify(uninitialisiert),
      /FREMDER-PARTNER-VERTRAULICH|Partner zum Begleiten|brauchen dich/,
    );
    const leader = pushes.filter((push) => push.ids.includes("cron-fk"));
    assert.equal(
      leader.length,
      1,
      "Own appointment, leadership and units share one push",
    );
    assert.equal(leader[0].meldung.kennung, "tagesueberblick");
    assert.match(
      leader[0].meldung.text,
      /Heute 2 Termine: 00:30 Uhr mit Heute früh, danach 1 weiterer/,
    );
    assert.match(leader[0].meldung.text, /Partner zum Begleiten/);
    assert.match(leader[0].meldung.text, /Einheiten ergänzen/);
    assert.doesNotMatch(
      leader[0].meldung.text,
      /Morgen früh|Gestern spät|FREMDER-PARTNER-VERTRAULICH/,
    );
    const aufgaben = pushes.filter((push) =>
      push.ids.includes("cron-aufgaben"),
    );
    assert.equal(aufgaben.length, 1);
    assert.equal(
      aufgaben[0].meldung.titel,
      "1 Schritt heute",
      "A call just after Berlin midnight belongs to tomorrow",
    );
    assert.equal(
      new Set(pushes.flatMap((push) => push.ids)).size,
      pushes.length,
    );
    // Pure leadership: no refill/stillness nudge, even with no own calls or contacts.
    await db.user.create({
      data: {
        id: "cron-rein",
        name: "Reine Führung",
        path: "/cron-fk/cron-rein/",
        leaderId: "cron-fk",
        passwordHash: "test",
        onboardingDoneAt: datum,
        arbeitsfokus: "FUEHRUNG",
      },
    });
    await db.user.create({
      data: {
        id: "cron-aktiv",
        name: "Aktiver Partner",
        visibility: "ZAHLEN",
        path: "/cron-fk/cron-rein/cron-aktiv/",
        leaderId: "cron-rein",
        passwordHash: "test",
        onboardingDoneAt: datum,
        person: { create: { id: "p-cron-aktiv", name: "Aktiver Partner" } },
      },
    });
    await db.dailyLog.create({
      data: { personId: "p-cron-aktiv", type: "CALL", count: 10, date: datum },
    });
    globalThis.cronReviewPushes = [];
    await GET(
      new NextRequest("http://localhost/api/cron/meldungen", {
        headers: { authorization: "Bearer isolated-cron-test" },
      }),
    );
    assert.equal(
      globalThis.cronReviewPushes.filter((p) => p.ids.includes("cron-rein"))
        .length,
      0,
    );
    assert.doesNotMatch(
      JSON.stringify(
        globalThis.cronReviewPushes.filter((p) => p.ids.includes("cron-fk")),
      ),
      /Reine Führung/,
    );
    // An actual own commitment still gets through.
    await db.contact.create({
      data: {
        ownerId: "cron-rein",
        name: "Fällige Verpflichtung",
        nextStepType: "ANRUF",
        nextStepAt: datum,
      },
    });
    globalThis.cronReviewPushes = [];
    await GET(
      new NextRequest("http://localhost/api/cron/meldungen", {
        headers: { authorization: "Bearer isolated-cron-test" },
      }),
    );
    assert.equal(
      globalThis.cronReviewPushes.find((p) => p.ids.includes("cron-rein"))
        .meldung.titel,
      "1 Schritt heute",
    );
    // A deeper issue is assigned to the viewer's direct partner, not bypassed.
    await db.dailyLog.deleteMany({ where: { personId: "p-cron-aktiv" } });
    globalThis.cronReviewPushes = [];
    await GET(
      new NextRequest("http://localhost/api/cron/meldungen", {
        headers: { authorization: "Bearer isolated-cron-test" },
      }),
    );
    const deep = globalThis.cronReviewPushes.find((p) =>
      p.ids.includes("cron-rein"),
    );
    assert.match(deep.meldung.text, /Aktiver Partner/);
  } finally {
    if (oldSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = oldSecret;
    delete globalThis.cronReviewPushes;
    delete globalThis.prisma;
    await fixture.close();
  }
});
