import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { testDatabase } from "./test-db.mjs";

let fixture;
let faelligeAufgaben;
let mannschaftsLage;
let astLage;
let astVergleich;
let umhaengen;

before(async () => {
  fixture = await testDatabase();
  globalThis.prisma = fixture.client;
  ({ faelligeAufgaben, mannschaftsLage, astLage, astVergleich } =
    await import("../lib/fuehrung.ts"));
  ({ umhaengen } = await import("../lib/struktur.ts"));
  for (const [id, path, leaderId, passwordHash, deactivatedAt] of [
    ["alt", "/alt/", null, "test", null],
    ["bleibt", "/alt/bleibt/", "alt", "test", null],
    ["wechselt", "/alt/wechselt/", "alt", "test", null],
    ["neu", "/neu/", null, "test", null],
    ["platzhalter", "/alt/platzhalter/", "alt", null, null],
    ["inaktiv", "/alt/inaktiv/", "alt", "test", new Date()],
    ["unter-inaktiv", "/alt/inaktiv/unter-inaktiv/", "inaktiv", "test", null],
  ]) {
    await fixture.client.user.create({
      data: {
        id,
        name: id,
        path,
        leaderId,
        passwordHash,
        deactivatedAt,
        phone: `PRIVATE-${id}`,
        person: { create: { id: `p-${id}`, name: id } },
      },
    });
  }
  for (const memberId of [
    "bleibt",
    "wechselt",
    "platzhalter",
    "inaktiv",
    "unter-inaktiv",
  ]) {
    await fixture.client.leadershipTask.create({
      data: {
        id: `task-${memberId}`,
        leaderId: "alt",
        memberId,
        dueAt: new Date(Date.now() - 3600000),
        createdAt: new Date(Date.now() - 86400000),
        note: `Private Altabsprache ${memberId}`,
      },
    });
  }
});

after(async () => {
  delete globalThis.prisma;
  if (fixture) await fixture.close();
});

test("Fällige Führungsaufgaben beschränken sich auf aktive Mitglieder der aktuellen Struktur", async () => {
  assert.equal(await umhaengen("wechselt", "neu"), null);
  await fixture.client.dailyLog.create({
    data: { personId: "p-wechselt", type: "CALL", count: 9, date: new Date() },
  });
  const aufgaben = await faelligeAufgaben("alt");
  assert.deepEqual(aufgaben.map((aufgabe) => aufgabe.memberId).sort(), [
    "bleibt",
    "unter-inaktiv",
  ]);
  assert.equal(JSON.stringify(aufgaben).includes("PRIVATE-neu"), false);
  assert.equal(JSON.stringify(aufgaben).includes("wechselt"), false);
  assert.equal(
    aufgaben.find((aufgabe) => aufgabe.memberId === "unter-inaktiv").anrufen
      .name,
    "unter-inaktiv",
  );
  // Die private Altabsprache wird nicht gelöscht oder nach außen geteilt.
  assert.equal(
    (
      await fixture.client.leadershipTask.findUnique({
        where: { id: "task-wechselt" },
      })
    ).note,
    "Private Altabsprache wechselt",
  );
});

test("Die Mannschaftslage hängt alte Aufgaben nicht an deaktivierte oder noch unaktivierte Konten", async () => {
  const lage = await mannschaftsLage({ id: "alt", role: "MEMBER" });
  assert.equal(
    lage.baum.some((person) => person.id === "wechselt"),
    false,
  );
  assert.equal(
    lage.baum.some((person) => person.id === "inaktiv"),
    false,
  );
  assert.equal(
    lage.baum.find((person) => person.id === "platzhalter").betreuung,
    null,
  );
  assert.equal(
    lage.baum.find((person) => person.id === "bleibt").betreuung.notiz,
    "Private Altabsprache bleibt",
  );
});

test("ADR0004: Admins sehen mit und ohne eigene Partner die Instanz, private Altaufgaben bleiben beschränkt", async () => {
  const adminMitTeam = await mannschaftsLage({ id: "alt", role: "ADMIN" });
  assert.equal(adminMitTeam.gesamtstruktur, true);
  assert.equal(adminMitTeam.fuehrtNiemanden, false);
  assert.ok(adminMitTeam.baum.some((person) => person.id === "wechselt"));
  assert.equal(
    adminMitTeam.baum.find((person) => person.id === "wechselt").betreuung,
    null,
  );
  assert.equal(
    adminMitTeam.baum.find((person) => person.id === "bleibt").betreuung.notiz,
    "Private Altabsprache bleibt",
  );
  const adminOhneTeam = await mannschaftsLage({ id: "bleibt", role: "ADMIN" });
  assert.equal(adminOhneTeam.gesamtstruktur, true);
  assert.equal(adminOhneTeam.fuehrtNiemanden, true);
  assert.ok(adminOhneTeam.baum.some((person) => person.id === "neu"));
  assert.equal(await astLage({ id: "alt", role: "MEMBER" }, "wechselt"), null);
  assert.ok(await astLage({ id: "alt", role: "ADMIN" }, "wechselt"));
});

test("NAMEN schließt Pipeline ein und übernommene Werkstatt-Kriterien steuern dieselben neutralen Signale", async () => {
  await fixture.client.user.update({
    where: { id: "bleibt" },
    data: {
      visibility: "NAMEN",
      startedAt: new Date(Date.now() - 100 * 86400000),
      onboardingDoneAt: new Date(Date.now() - 100 * 86400000),
    },
  });
  await fixture.client.contact.create({
    data: { name: "Namenfreigabe", ownerId: "bleibt", listKinds: ["VERKAUF"] },
  });
  let lage = await mannschaftsLage({ id: "alt", role: "MEMBER" });
  let person = lage.baum.find((person) => person.id === "bleibt");
  assert.equal(person.pipelineSichtbar, true);
  assert.equal(person.werte.inAkquise, 1);
  assert.ok(
    person.signale.some((signal) => signal.schluessel === "pipeline_leer"),
  );
  await fixture.client.einstellung.create({
    data: { schluessel: "ampel.pipeline-mindestbestand", wert: "1" },
  });
  lage = await mannschaftsLage({ id: "alt", role: "MEMBER" });
  person = lage.baum.find((person) => person.id === "bleibt");
  assert.equal(
    person.signale.some((signal) => signal.schluessel === "pipeline_leer"),
    false,
  );
  assert.equal(JSON.stringify(person.signale).includes("Disziplin"), false);
  await fixture.client.einstellung.delete({
    where: { schluessel: "ampel.pipeline-mindestbestand" },
  });
});

test("Benannte Geschwister-Äste bleiben auch für Führungskräfte der höchsten Karrierestufe serverseitig verborgen", async () => {
  assert.equal(await astVergleich("unbekannt"), null);
  await fixture.client.user.update({
    where: { id: "alt" },
    data: { role: "MEMBER", karrierestufe: 6 },
  });
  assert.equal(await astVergleich("alt"), null);
  assert.equal(await astVergleich("bleibt"), null);
  await fixture.client.user.update({
    where: { id: "alt" },
    data: { role: "ADMIN" },
  });
  const vergleich = await astVergleich("alt");
  assert.ok(vergleich);
  assert.ok(
    vergleich.aeste.some((ast) => ast.id === "neu" && ast.name === "neu"),
  );
  assert.ok(vergleich.aeste.some((ast) => ast.istMeiner));
  assert.ok(vergleich.aeste.find((ast) => ast.id === "neu").koepfe > 0);
  await fixture.client.user.update({
    where: { id: "alt" },
    data: { role: "MEMBER" },
  });
  assert.equal(await astVergleich("alt"), null);
});
