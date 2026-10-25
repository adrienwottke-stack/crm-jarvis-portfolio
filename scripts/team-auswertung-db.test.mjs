// Echte Prisma-Abfragen in einer frischen In-Memory-Postgres-Instanz.
// Keine .env-Datei und keine bestehende Datenbank wird verwendet.
// node --import ./scripts/alias-hook.mjs --test scripts/team-auswertung-db.test.mjs
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { testDatabase } from "./test-db.mjs";

let fixture;
let ladeTeamauswertung;
let umhaengen;
const betrachter = { id: "bericht-a", role: "MEMBER" };
const filter = { zeit: "monat", tag: "2026-06-15", umfang: "struktur" };
const datum = (tag) => new Date(`${tag}T00:00:00.000Z`);

before(async () => {
  fixture = await testDatabase();
  globalThis.prisma = fixture.client;
  ({ ladeTeamauswertung } = await import("../lib/team-auswertung.ts"));
  ({ umhaengen } = await import("../lib/struktur.ts"));
  const konten = [
    { id: "bericht-a", path: "/bericht-a/", leaderId: null, einheitenStart: 10000 },
    { id: "bericht-b", path: "/bericht-a/bericht-b/", leaderId: "bericht-a", einheitenStart: 20000, visibility: "ZAHLEN" },
    { id: "bericht-c", path: "/bericht-a/bericht-b/bericht-c/", leaderId: "bericht-b", einheitenStart: 30000, visibility: "NAMEN" },
    { id: "bericht-d", path: "/bericht-a/bericht-b/bericht-c/bericht-d/", leaderId: "bericht-c", einheitenStart: 40000 },
    { id: "bericht-platzhalter", path: "/bericht-a/bericht-platzhalter/", leaderId: "bericht-a", einheitenStart: 900000, passwordHash: null },
    { id: "bericht-inaktiv", path: "/bericht-a/bericht-inaktiv/", leaderId: "bericht-a", einheitenStart: 800000, deactivatedAt: datum("2026-05-01") },
    { id: "bericht-j", path: "/bericht-a/bericht-inaktiv/bericht-j/", leaderId: "bericht-inaktiv", einheitenStart: 50000 },
    { id: "bericht-ohne-profil", path: "/bericht-a/bericht-ohne-profil/", leaderId: "bericht-a", einheitenStart: 0 },
    { id: "bericht-fremd", path: "/bericht-fremd/", leaderId: null, einheitenStart: 9000000 },
    { id: "bericht-a2", path: "/bericht-a2/", leaderId: null, einheitenStart: 9000000 },
    { id: "bericht-leer", path: "/bericht-leer/", leaderId: null, einheitenStart: 0, role: "ADMIN" },
  ];
  for (const konto of konten) {
    await fixture.client.user.create({ data: {
      name: konto.id, passwordHash: "nur-test-kein-echtes-passwort", phone: "PRIVATE-TELEFONNUMMER",
      whyLetter: "PRIVATE-MOTIVATION", visibility: "PIPELINE", karrierestufe: 1, ...konto,
    } });
    if (konto.id !== "bericht-ohne-profil") await fixture.client.person.create({ data: { id: `person-${konto.id}`, name: konto.id, userId: konto.id } });
  }
  await fixture.client.contact.create({ data: {
    name: "PRIVATER-KUNDENNAME", phone: "PRIVATE-KUNDENNUMMER", note: "PRIVATE-GESPRAECHSNOTIZ",
    ownerId: "bericht-b", listKinds: ["VERKAUF"],
  } });
  await fixture.client.einheitenbuchung.createMany({ data: [
    ["bericht-a", "2026-05-02", 10000], ["bericht-a", "2026-06-01", 1000],
    ["bericht-b", "2026-05-31", 2000], ["bericht-b", "2026-06-01", 3000], ["bericht-b", "2026-06-03", -500],
    ["bericht-c", "2026-06-02", 2000], ["bericht-c", "2026-06-30", 1000], ["bericht-d", "2026-06-07", -500],
    ["bericht-j", "2026-06-12", 800], ["bericht-ohne-profil", "2026-06-20", 700],
    ["bericht-platzhalter", "2026-06-10", 900000], ["bericht-inaktiv", "2026-06-10", 800000],
    ["bericht-fremd", "2026-06-10", 700000], ["bericht-a2", "2026-06-10", 600000],
  ].map(([userId, tag, hundertstel]) => ({ userId, tag: datum(tag), hundertstel, notiz: "PRIVATE-BUCHUNGSNOTIZ" })) });
  await fixture.client.dailyLog.createMany({ data: [
    ["bericht-a", "CALL", 11], ["bericht-b", "CALL", 4], ["bericht-b", "APPOINTMENT_SET", 2],
    ["bericht-b", "APPOINTMENT_HELD", 1], ["bericht-b", "DEAL_WON", 1], ["bericht-c", "CALL", 3],
    ["bericht-c", "APPOINTMENT_SET", 1], ["bericht-d", "CALL", 2], ["bericht-d", "APPOINTMENT_HELD", 1],
    ["bericht-j", "CALL", 5], ["bericht-platzhalter", "CALL", 1000], ["bericht-inaktiv", "CALL", 2000],
    ["bericht-fremd", "CALL", 4000], ["bericht-a2", "CALL", 8000],
  ].map(([userId, type, count]) => ({ personId: `person-${userId}`, type, count, date: datum("2026-06-10") })) });
}, { timeout: 60000 });

after(async () => {
  delete globalThis.prisma;
  if (fixture) await fixture.close();
});

test("Echte Abfragen aggregieren vier Ebenen einmal und trennen Startbestand sowie Eigenleistung", async () => {
  const bericht = await ladeTeamauswertung(betrachter, filter);
  assert.ok(bericht);
  assert.equal(bericht.team.konten, 5);
  assert.equal(bericht.team.einheitenZeitraum, 6500);
  assert.equal(bericht.team.startbestand, 140000);
  assert.equal(bericht.team.einheitenGesamt, 148500);
  assert.equal(bericht.eigen.einheitenZeitraum, 1000);
  assert.equal(bericht.eigen.einheitenGesamt, 21000);
  assert.equal(bericht.team.kurve.length, 30);
  assert.equal(bericht.team.kurve[0].kumuliert, 3000);
  assert.equal(bericht.team.kurve[1].kumuliert, 5000);
  assert.equal(bericht.team.kurve[2].kumuliert, 4500);
  assert.equal(bericht.team.kurve[3].kumuliert, 4500);
  assert.equal(bericht.team.kurve.at(-1).kumuliert, 6500);
});

test("Einheitenseite, Strukturverlauf und Faltung zählen aktive Nachfahren unter fehlenden Führungsknoten gleich", async () => {
  const db = fixture.client;
  const { teamEinheiten, einheitenFuerStruktur, strukturVerlauf, monatsDeltaJe, produktionsmonat, teamVerlauf, teamSockel } = await import("../lib/einheiten.ts");
  const { berlinToday, dayToUtcDate, addMonths, startOfMonth } = await import("../lib/dates.ts");
  const heute = berlinToday();
  const tag = dayToUtcDate(heute);
  const vormonat = addMonths(startOfMonth(heute), -1);
  for (const data of [
    { id: "einheiten-lead", path: "/einheiten-lead/", passwordHash: "nur-test" },
    { id: "einheiten-platzhalter", path: "/einheiten-lead/einheiten-platzhalter/", leaderId: "einheiten-lead", einheitenStart: 50000 },
    { id: "einheiten-inaktiv", path: "/einheiten-lead/einheiten-inaktiv/", leaderId: "einheiten-lead", passwordHash: "nur-test", deactivatedAt: tag, einheitenStart: 80000 },
    { id: "einheiten-aktiv", path: "/einheiten-lead/einheiten-inaktiv/einheiten-aktiv/", leaderId: "einheiten-inaktiv", passwordHash: "nur-test" },
    { id: "einheiten-unter-platzhalter", path: "/einheiten-lead/einheiten-platzhalter/einheiten-unter-platzhalter/", leaderId: "einheiten-platzhalter", passwordHash: "nur-test" },
  ]) await db.user.create({ data: { name: data.id, ...data } });
  await db.einheitenbuchung.createMany({ data: [
    { userId: "einheiten-aktiv", hundertstel: 2500, tag },
    { userId: "einheiten-aktiv", hundertstel: -500, tag },
    { userId: "einheiten-aktiv", hundertstel: 700, tag: vormonat },
    { userId: "einheiten-unter-platzhalter", hundertstel: 400, tag },
    { userId: "einheiten-inaktiv", hundertstel: 80000, tag },
    { userId: "einheiten-platzhalter", hundertstel: 50000, tag },
  ] });
  const personen = await db.user.findMany({ where: { path: { startsWith: "/einheiten-lead/" } }, select: { id: true, path: true } });
  // Ein versehentlich doppelt gelieferter Kopf darf den Ast nicht verdoppeln.
  personen.push(personen.find(person => person.id === "einheiten-aktiv"));
  const [seite, faltung, verlauf, delta, bericht] = await Promise.all([
    teamEinheiten("einheiten-lead", produktionsmonat(heute)),
    einheitenFuerStruktur(personen, produktionsmonat(heute)),
    strukturVerlauf("einheiten-lead"),
    monatsDeltaJe(personen, heute),
    ladeTeamauswertung({ id: "einheiten-lead", role: "MEMBER" }, { umfang: "struktur", zeit: "monat", tag: heute }),
  ]);
  assert.deepEqual(seite, { gesamt: 3100, monat: 2400 });
  assert.equal(bericht.team.einheitenGesamt, seite.gesamt);
  assert.equal(bericht.team.einheitenZeitraum, seite.monat);
  assert.equal(faltung.get("einheiten-lead").astGesamt, seite.gesamt);
  assert.equal(faltung.get("einheiten-lead").astMonat, seite.monat);
  assert.equal(faltung.has("einheiten-platzhalter"), false);
  assert.equal(faltung.has("einheiten-inaktiv"), false);
  assert.equal(verlauf.sockel, 0, "Undatierter Platzhalter-Startbestand zählt nicht");
  assert.equal(verlauf.tage.reduce((summe, zeile) => summe + zeile.hundertstel, verlauf.sockel), seite.gesamt);
  assert.deepEqual(delta.get("einheiten-lead"), { astMonat: 2400, astVormonat: 700 });
  // Auch ein Aufrufer, der inaktive IDs mitgibt, erweitert die Zählquelle nicht.
  assert.equal(await teamSockel(personen.map(person => person.id)), 0);
  assert.equal((await teamVerlauf(personen.map(person => person.id))).reduce((summe, zeile) => summe + zeile.hundertstel, 0), 3100);
  assert.equal(await teamEinheiten("einheiten-aktiv", produktionsmonat(heute)), null);
});

test("ZAHLEN und NAMEN geben Aktivitätssummen frei, fehlende Profile bleiben eine Datenlücke", async () => {
  const bericht = await ladeTeamauswertung(betrachter, filter);
  assert.equal(bericht.team.aktivitaetsKonten, 4);
  assert.equal(bericht.team.konten, 5);
  assert.deepEqual(bericht.team.aktivitaeten, { CALL: 14, APPOINTMENT_SET: 3, APPOINTMENT_HELD: 2, DEAL_WON: 1 });
  assert.equal(bericht.eigen.aktivitaeten.CALL, 11);
  const partner = await ladeTeamauswertung(betrachter, { ...filter, umfang: "teilteam", teilteam: "bericht-b" });
  assert.equal(partner.eigen.aktivitaeten.CALL, 4);
  const ohneProfil = await ladeTeamauswertung(betrachter, { ...filter, umfang: "teilteam", teilteam: "bericht-ohne-profil" });
  assert.equal(ohneProfil.eigen.aktivitaeten, null);
  assert.equal(ohneProfil.eigen.einheitenZeitraum, 700);
});

test("Direktpartner und ausgewähltes Teilteam haben eigenständige, begrenzte Umfänge", async () => {
  const direkt = await ladeTeamauswertung(betrachter, { ...filter, umfang: "direkte" });
  assert.equal(direkt.team.konten, 2);
  assert.equal(direkt.team.einheitenZeitraum, 3200);
  assert.equal(direkt.team.aktivitaeten.CALL, 4);
  const teilteam = await ladeTeamauswertung(betrachter, { ...filter, umfang: "teilteam", teilteam: "bericht-c" });
  assert.equal(teilteam.wurzel.id, "bericht-c");
  assert.equal(teilteam.eigen.einheitenZeitraum, 3000);
  assert.equal(teilteam.team.konten, 1);
  assert.equal(teilteam.team.einheitenZeitraum, -500);
  assert.equal(teilteam.team.aktivitaeten.CALL, 2);
});

test("Fremde IDs, gleiche Karrierestufe und ähnliche Pfade erweitern die Zugriffsgrenze nicht", async () => {
  for (const teilteam of ["bericht-fremd", "bericht-a2", "unbekannt"]) {
    assert.equal(await ladeTeamauswertung(betrachter, { ...filter, umfang: "teilteam", teilteam }), null);
  }
  const untergeordneter = await ladeTeamauswertung({ id: "bericht-c", role: "MEMBER" }, { ...filter, umfang: "teilteam", teilteam: "bericht-b" });
  assert.equal(untergeordneter, null);
  const admin = await ladeTeamauswertung({ id: "bericht-leer", role: "ADMIN" }, filter);
  assert.equal(admin.team.konten, 0);
  assert.deepEqual(admin.teilteams, []);
});

test("Aktive Nachfahren unter deaktivierter Führung bleiben sichtbar; deren inaktives Konto und Platzhalter fehlen", async () => {
  const bericht = await ladeTeamauswertung(betrachter, filter);
  assert.ok(bericht.teilteams.some((team) => team.id === "bericht-j"));
  assert.equal(bericht.teilteams.some((team) => team.id === "bericht-inaktiv"), false);
  assert.equal(bericht.teilteams.some((team) => team.id === "bericht-platzhalter"), false);
  for (const teilteam of ["bericht-inaktiv", "bericht-platzhalter"]) {
    assert.equal(await ladeTeamauswertung(betrachter, { ...filter, umfang: "teilteam", teilteam }), null);
  }
});

test("Ausgabedaten enthalten keine Kunden-, Telefon-, Motivations- oder Buchungsnotizen", async () => {
  const bericht = await ladeTeamauswertung(betrachter, filter);
  const ausgabe = JSON.stringify(bericht);
  for (const privat of ["PRIVATE-", "PRIVATER-", "nur-test-kein-echtes-passwort", "passwordHash", "phone", "notiz"]) {
    assert.equal(ausgabe.includes(privat), false, `${privat} darf nicht in den Bericht gelangen`);
  }
  assert.deepEqual(Object.keys(bericht.wurzel).sort(), ["id", "istDu", "name"]);
});

test("Strukturwechsel zieht bestehende Buchungen auf Basis der heutigen Zuordnung mit", async () => {
  assert.equal(await umhaengen("bericht-c", "bericht-j"), null);
  const alterAst = await ladeTeamauswertung(betrachter, { ...filter, umfang: "teilteam", teilteam: "bericht-b" });
  const neuerAst = await ladeTeamauswertung(betrachter, { ...filter, umfang: "teilteam", teilteam: "bericht-j" });
  assert.equal(alterAst.team.konten, 0);
  assert.equal(alterAst.team.einheitenZeitraum, 0);
  assert.equal(neuerAst.team.konten, 2);
  assert.equal(neuerAst.team.einheitenZeitraum, 2500);
  const gesamt = await ladeTeamauswertung(betrachter, filter);
  assert.equal(gesamt.team.einheitenZeitraum, 6500);
  assert.equal(gesamt.team.einheitenGesamt, 148500);
});
