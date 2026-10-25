import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { testDatabase } from "./test-db.mjs";
import { berlinToday, dayToUtcDate, shiftDay } from "../lib/dates.ts";
import { signaleFuer } from "../lib/signale.ts";

let fixture, team, begleitung, erfolg;
const today = berlinToday();
const date = dayToUtcDate(today);
before(
  async () => {
    fixture = await testDatabase();
    globalThis.prisma = fixture.client;
    team = await import("../lib/teamziele.ts");
    begleitung = await import("../lib/begleitung.ts");
    erfolg = await import("../lib/einheiten-erfolg.ts");
    for (const [id, path, leaderId, extra] of [
      ["a", "/a/", null, { arbeitsfokus: "FUEHRUNG" }],
      ["b", "/a/b/", "a", {}],
      ["c", "/a/b/c/", "b", {}],
      ["fremd", "/fremd/", null, {}],
      ["nullstart", "/nullstart/", null, {}],
      ["platz", "/a/platz/", "a", { passwordHash: null }],
      ["inaktiv", "/a/inaktiv/", "a", { deactivatedAt: date }],
    ]) {
      await fixture.client.user.create({
        data: {
          id,
          name: id,
          path,
          leaderId,
          passwordHash: "test",
          createdAt: date,
          onboardingDoneAt: date,
          ...extra,
          person: { create: { id: `p-${id}`, name: id } },
        },
      });
    }
    await fixture.client.einheitenbuchung.createMany({
      data: [
        ["a", 50000],
        ["b", 2000],
        ["c", 1000],
        ["c", -250],
        ["fremd", 90000],
        ["platz", 70000],
        ["inaktiv", 80000],
      ].map(([userId, hundertstel]) => ({
        userId,
        hundertstel,
        tag: date,
        notiz: "PRIVATE-NOTIZ",
      })),
    });
  },
  { timeout: 60000 },
);
after(async () => {
  delete globalThis.prisma;
  await fixture?.close();
});

test("Teamziel zählt aktive Nachfahren und Korrekturen, ohne Eigenleistung oder fremde Äste", async () => {
  await team.teamzielSpeichern("a", {
    titel: "Gemeinsam",
    kennzahl: "UNITS",
    zielwert: "30",
    zeitraum: "MONAT",
    tag: today,
  });
  const [ziel] = await team.ladeTeamziele("a");
  assert.equal(ziel.erreicht, 2750);
  assert.equal(ziel.mitglieder, 2);
  assert.equal(ziel.geschafft, false);
  assert.equal(ziel.standText, "27,5 von 30 Einheiten");
  assert.equal(JSON.stringify(ziel).includes("PRIVATE-NOTIZ"), false);
});

test("Mitglieder lesen nur den gemeinsamen Stand; fremde Ziele und Verwaltungsaktionen bleiben gesperrt", async () => {
  const [mitglied] = await team.ladeTeamziele("c");
  assert.equal(mitglied.erreicht, 2750);
  assert.equal(mitglied.eigenes, false);
  assert.equal(Object.hasOwn(mitglied, "teamIds"), false);
  assert.deepEqual(await team.ladeTeamziele("fremd", { wurzelId: "a" }), []);
  assert.deepEqual(await team.ladeTeamziele("a", { wurzelId: "fremd" }), []);
  await assert.rejects(
    team.teamzielArchivieren("c", mitglied.id),
    /nicht beenden/,
  );
  await assert.rejects(
    team.teamzielSpeichern("c", {
      kennzahl: "CALL",
      zielwert: "5",
      zeitraum: "WOCHE",
    }),
    /aktiven eigenen Partner/,
  );
});

test("Aktivitätsziel beachtet Berliner Kalendergrenzen und fehlende Profile", async () => {
  const { zielZeitraum } = await import("../lib/ziele-modell.ts");
  const { start, ende } = zielZeitraum("WOCHE", today);
  await fixture.client.dailyLog.createMany({
    data: [
      { personId: "p-b", type: "CALL", count: 4, date: start },
      { personId: "p-c", type: "CALL", count: 3, date: start },
      { personId: "p-a", type: "CALL", count: 50, date: start },
      { personId: "p-c", type: "CALL", count: 100, date: ende },
    ],
  });
  await fixture.client.person.delete({ where: { id: "p-b" } });
  await team.teamzielSpeichern("a", {
    kennzahl: "CALL",
    zielwert: "5",
    zeitraum: "WOCHE",
    tag: today,
  });
  const ziel = (await team.ladeTeamziele("a")).find(
    (z) => z.kennzahl === "CALL",
  );
  assert.equal(ziel.erreicht, 3);
  assert.equal(ziel.datenluecken, 1);
});

test("Begleitung kennt Nullstart und zählt gehaltene Termine ohne Abschluss auch nach Tag sieben", async () => {
  const leer = await begleitung.ladeBegleitung("nullstart");
  assert.equal(leer.filter((s) => s.fertig).length, 0);
  assert.equal(leer[0].href, "/namen/sammeln");
  const schritte = begleitung.begleitungsSchritte({
    namen: 1,
    nummern: 1,
    anrufe: 1,
    vereinbart: 1,
    gehalten: 1,
    abschluesse: 0,
    einheiten: 0,
    empfehlungGefragt: true,
  });
  assert.ok(schritte.every((s) => s.fertig));
  assert.equal(
    schritte.some((s) => s.titel.includes("Einheiten")),
    false,
  );
  await fixture.client.dailyLog.create({
    data: {
      personId: "p-nullstart",
      type: "APPOINTMENT_HELD",
      count: 1,
      date: dayToUtcDate(shiftDay(today, -20)),
    },
  });
  assert.equal(
    (await begleitung.ladeBegleitung("nullstart")).find((s) =>
      s.titel.startsWith("Ersten Termin halten"),
    ).fertig,
    true,
  );
});

test("Führungsfokus erzeugt ohne eigene Anrufe keine Stillstands- oder Pipelinewarnung", () => {
  const basis = {
    platzhalter: false,
    tageSeitAktivitaet: null,
    termineVereinbart14: 0,
    termineGehalten14: 0,
    termineGehaltenMonat: 0,
    abschluesseMonat: 0,
    abschluesseGesamt: 0,
    tageDabei: 100,
    angekommen: true,
    pipelineSichtbar: true,
    kontakteInAkquise: 0,
    ueberfaelligeSchritte: 0,
    termineOhneEmpfehlung: 0,
  };
  assert.deepEqual(signaleFuer({ ...basis, fuehrungsfokus: true }), []);
  assert.ok(signaleFuer(basis).some((s) => s.schluessel === "stille"));
  const mitTermin = signaleFuer({
    ...basis,
    fuehrungsfokus: true,
    ueberfaelligeSchritte: 1,
  });
  assert.equal(mitTermin.length, 1);
  assert.equal(mitTermin[0].schluessel, "eigene_verpflichtungen");
});

test("Einheiten-Erfolg nutzt gespeicherte Zahlen, Teilen bleibt freiwillig und wiederholbar ohne Duplikat", async () => {
  await assert.rejects(
    erfolg.teileErsteEinheiten("nullstart"),
    /keine positiven/,
  );
  await fixture.client.einheitenbuchung.create({
    data: { userId: "nullstart", hundertstel: 1250, tag: date },
  });
  const stand = await erfolg.einheitenBestaetigung("nullstart", 0, 1250);
  assert.equal(stand.ersteEinheiten, true);
  assert.equal(stand.betrag, "12,50");
  assert.equal(
    await fixture.client.feedEintrag.count({
      where: { personId: "p-nullstart" },
    }),
    0,
  );
  const a = await erfolg.teileErsteEinheiten("nullstart");
  const b = await erfolg.teileErsteEinheiten("nullstart");
  assert.equal(a.id, b.id);
  assert.equal(
    await fixture.client.feedEintrag.count({
      where: { personId: "p-nullstart" },
    }),
    1,
  );
  await fixture.client.einheitenbuchung.create({
    data: { userId: "nullstart", hundertstel: -1250, tag: date },
  });
  assert.equal(
    (await erfolg.einheitenBestaetigung("nullstart", 0, -1250)).ersteEinheiten,
    false,
  );
  await assert.rejects(
    erfolg.teileErsteEinheiten("nullstart"),
    /keine positiven/,
  );
});

test("Teamwechsel aktualisiert Zielstand und entzieht ehemaligen Mitgliedern den Einblick", async () => {
  const { umhaengen } = await import("../lib/struktur.ts");
  await umhaengen("c", "fremd");
  const ziel = (await team.ladeTeamziele("a")).find(
    (z) => z.kennzahl === "UNITS",
  );
  assert.equal(ziel.erreicht, 2000);
  assert.equal(ziel.mitglieder, 1);
  assert.deepEqual(await team.ladeTeamziele("c", { wurzelId: "a" }), []);
  await team.teamzielArchivieren("a", ziel.id);
  assert.equal(
    (await team.ladeTeamziele("a")).some((z) => z.id === ziel.id),
    false,
  );
});

test("Führungshinweise verwenden den gespeicherten Fokus und ordnen tiefere Fälle dem direkten Partner zu", async () => {
  const { mannschaftsLage } = await import("../lib/fuehrung.ts");
  for (const [id, path, leaderId] of [
    ["boss", "/boss/", null],
    ["coach", "/boss/coach/", "boss"],
    ["neuling", "/boss/coach/neuling/", "coach"],
  ]) {
    await fixture.client.user.create({
      data: {
        id,
        path,
        leaderId,
        name: id,
        passwordHash: "test",
        startedAt: dayToUtcDate(shiftDay(today, -60)),
        createdAt: dayToUtcDate(shiftDay(today, -60)),
        onboardingDoneAt: date,
        arbeitsfokus: id === "neuling" ? "EIGEN" : "FUEHRUNG",
        visibility: "ZAHLEN",
        person: { create: { id: "p-" + id, name: id } },
      },
    });
  }
  await fixture.client.dailyLog.create({
    data: { personId: "p-neuling", type: "CALL", count: 5, date },
  });
  let lage = await mannschaftsLage({ id: "boss", role: "MEMBER" });
  assert.equal(lage.leute.find((p) => p.id === "coach").signale.length, 0);
  assert.equal(lage.ich.signale.length, 0);
  await fixture.client.dailyLog.deleteMany({
    where: { personId: "p-neuling" },
  });
  lage = await mannschaftsLage({ id: "boss", role: "MEMBER" });
  const coach = lage.leute.find((p) => p.id === "coach");
  assert.ok(coach.signale.some((s) => s.schluessel === "team_begleiten"));
  assert.equal(
    coach.signale.some((s) => ["stille", "pipeline"].includes(s.schluessel)),
    false,
  );
  assert.match(
    coach.signale.find((s) => s.schluessel === "team_begleiten").schritt,
    /neuling/,
  );
  assert.equal(
    await fixture.client.leadershipTask.count({ where: { leaderId: "boss" } }),
    0,
    "Signals do not silently create tasks",
  );
});

test("Geplante Teamziele bleiben in der Verwaltung sichtbar, ohne heutigen Fortschritt zu behaupten", async () => {
  const future = shiftDay(today, 40);
  const ziel = await team.teamzielSpeichern("boss", {
    titel: "Nächster Monat",
    kennzahl: "UNITS",
    zielwert: "25",
    zeitraum: "MONAT",
    tag: future,
  });
  assert.equal(
    (await team.ladeTeamziele("boss")).some((z) => z.id === ziel.id),
    false,
  );
  const verwaltung = await team.ladeTeamziele("coach", {
    alleZeitraeume: true,
  });
  assert.equal(verwaltung.find((z) => z.id === ziel.id).erreicht, 0);
  await team.teamzielArchivieren("boss", ziel.id);
});
