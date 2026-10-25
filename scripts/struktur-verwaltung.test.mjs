import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { testDatabase } from "./test-db.mjs";

let fixture;
let service;
before(async () => {
  fixture = await testDatabase();
  globalThis.prisma = fixture.client;
  service = await import("../lib/struktur-verwaltung.ts");
  for (const [id, path, leaderId, role] of [
    ["admin", "/admin/", null, "ADMIN"],
    ["chef", "/chef/", null, "MEMBER"],
    ["partner", "/chef/partner/", "chef", "MEMBER"],
    ["kind", "/chef/partner/kind/", "partner", "MEMBER"],
    ["fremd", "/fremd/", null, "MEMBER"],
  ]) await fixture.client.user.create({ data: {
    id, path, leaderId, role, name: id, passwordHash: "test",
    person: { create: { name: id } },
  } });
});
after(async () => {
  delete globalThis.prisma;
  if (fixture) await fixture.close();
});

test("Teamleiter bearbeitet auch tiefe Nachfahren mit allen vereinbarten Angaben", async () => {
  await service.speichereStrukturperson("chef", "kind", {
    name: "Mara Beispiel", phone: "+49 123 456", karrierestufe: "3",
    startedAt: "2026-07-15", leaderId: "chef",
  });
  const person = await service.ladeStrukturperson("chef", "kind");
  assert.equal(person.name, "Mara Beispiel");
  assert.equal(person.phone, "+49 123 456");
  assert.equal(person.karrierestufe, 3);
  assert.equal(person.startedAt, "2026-07-15");
  assert.equal(person.leaderId, "chef");
});

test("Austragen hält die Person zum Zurückholen erreichbar und sperrt ihre Verwaltungsrechte", async () => {
  await service.speichereStrukturperson("chef", "kind", { leaderId: "partner" });
  await service.strukturpersonAustragen("chef", "partner", false);
  assert.equal((await service.ladeStrukturperson("chef", "partner")).ausgetragen, true);
  assert.ok((await service.ladeStrukturverwaltung("chef")).some((p) => p.id === "partner"));
  assert.equal(await service.ladeStrukturperson("partner", "kind"), null);
  await service.strukturpersonAustragen("chef", "partner", true);
  assert.equal((await service.ladeStrukturperson("chef", "partner")).ausgetragen, false);
});

test("Löschen verlangt Bestätigung und erhält die untergeordneten Teams", async () => {
  await service.speichereStrukturperson("chef", "kind", { leaderId: "partner" });
  await assert.rejects(service.loescheStrukturperson("chef", "partner", ""), /Bestätigung/);
  assert.ok(await service.ladeStrukturperson("chef", "partner"));
  await service.loescheStrukturperson("chef", "partner", "partner");
  assert.equal(await service.ladeStrukturperson("chef", "partner"), null);
  assert.equal((await service.ladeStrukturperson("chef", "kind")).leaderId, "chef");
});

test("Personenverlauf trennt eigene Aktivitäten und Einheiten vom Team und sperrt fremde Äste", async () => {
  const { ladePersonenverlauf } = await import("../lib/personen-verlauf.ts");
  const db = fixture.client;
  await db.user.update({ where: { id: "chef" }, data: { einheitenStart: 10000 } });
  await db.user.update({ where: { id: "kind" }, data: { einheitenStart: 2000 } });
  for (const [id, count, hundertstel] of [["chef", 4, 1000], ["kind", 7, -500], ["fremd", 99, 99999]]) {
    const profil = await db.person.findUnique({ where: { userId: id } });
    await db.dailyLog.create({ data: { personId: profil.id, type: "CALL", count, date: new Date("2026-07-15") } });
    await db.einheitenbuchung.create({ data: { userId: id, hundertstel, tag: new Date("2026-07-15") } });
  }
  const verlauf = await ladePersonenverlauf("admin", "chef");
  assert.equal(verlauf.eigen.einheiten.sockel, 10000);
  assert.deepEqual(verlauf.eigen.anrufe.tage, [{ tag: "2026-07-15", hundertstel: 4 }]);
  assert.deepEqual(verlauf.team.anrufe.tage, [{ tag: "2026-07-15", hundertstel: 7 }]);
  assert.deepEqual(verlauf.team.einheiten.tage, [{ tag: "2026-07-15", hundertstel: -500 }]);
  assert.equal(await ladePersonenverlauf("chef", "fremd"), null);
});

test("Fremde Äste, eigene Konten und Admins sind gegen manipulierte Verwaltungsanfragen geschützt", async () => {
  for (const id of ["fremd", "admin", "chef", "unbekannt"]) {
    assert.equal(await service.ladeStrukturperson("chef", id), null);
    await assert.rejects(service.speichereStrukturperson("chef", id, { name: "Verboten" }), /nicht verwalten/);
    await assert.rejects(service.strukturpersonAustragen("chef", id, false), /nicht verwalten/);
    await assert.rejects(service.loescheStrukturperson("chef", id, id), /nicht verwalten/);
  }
  for (const leaderId of ["fremd", "", "kind"]) {
    await assert.rejects(service.speichereStrukturperson("chef", "kind", { leaderId }), /Führungskraft/);
  }
  assert.equal((await service.ladeStrukturperson("chef", "kind")).leaderId, "chef");
});

test("Ungültige Angaben werden abgewiesen; optionale Felder lassen sich leeren", async () => {
  for (const eingabe of [{ name: " " }, { name: "x".repeat(61) }, { phone: "1".repeat(31) }, { karrierestufe: "7" }, { karrierestufe: "2.5" }, { startedAt: "2026-02-30" }]) {
    await assert.rejects(service.speichereStrukturperson("chef", "kind", eingabe), service.StrukturEingabeFehler);
  }
  await service.speichereStrukturperson("chef", "kind", { phone: "", karrierestufe: "", startedAt: "" });
  const person = await service.ladeStrukturperson("chef", "kind");
  assert.equal(person.phone, null);
  assert.equal(person.karrierestufe, null);
  assert.equal(person.startedAt, null);
});

test("Ein Namenskonflikt rollt auch die gleichzeitig gewählte Zuordnung zurück", async () => {
  await assert.rejects(service.speichereStrukturperson("admin", "kind", { name: "fremd", leaderId: "fremd" }), /Rangliste/);
  const person = await service.ladeStrukturperson("chef", "kind");
  assert.equal(person.name, "Mara Beispiel");
  assert.equal(person.leaderId, "chef");
});

test("Fehler beim Löschen erhalten Konto, Kontakte und den gesamten ursprünglichen Ast", async () => {
  const db = fixture.client;
  for (const [id, leaderId, path] of [["fail", "chef", "/chef/fail/"], ["unter", "fail", "/chef/fail/unter/"], ["tief", "unter", "/chef/fail/unter/tief/"]])
    await db.user.create({ data: { id, name: id, leaderId, path, passwordHash: "test" } });
  await db.contact.create({ data: { name: "Privater Kontakt", ownerId: "fail" } });
  await db.avvAcceptance.create({ data: { userId: "fail", avvVersion: "test" } });
  await db.$executeRawUnsafe(`CREATE FUNCTION test_loeschfehler() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = 'fail' THEN RAISE EXCEPTION 'Testfehler'; END IF; RETURN OLD; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER test_loeschfehler BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION test_loeschfehler()`);
  await assert.rejects(service.loescheStrukturperson("chef", "fail", "fail"));
  assert.equal((await service.ladeStrukturperson("chef", "fail")).kontakte, 1);
  assert.equal((await service.ladeStrukturperson("chef", "unter")).leaderId, "fail");
  assert.equal((await service.ladeStrukturperson("fail", "tief")).leaderId, "unter");
  await db.$executeRawUnsafe(`DROP TRIGGER test_loeschfehler ON "User"`);
  await db.$executeRawUnsafe(`DROP FUNCTION test_loeschfehler()`);
  await service.loescheStrukturperson("chef", "fail", "fail");
  assert.equal((await service.ladeStrukturperson("chef", "unter")).leaderId, "chef");
  assert.equal((await service.ladeStrukturperson("chef", "tief")).leaderId, "unter");
});

test("Nach Strukturwechsel verlieren frühere Teamleiter sofort Verwaltung und Verlauf", async () => {
  const { ladePersonenverlauf } = await import("../lib/personen-verlauf.ts");
  await service.speichereStrukturperson("admin", "kind", { leaderId: "fremd" });
  assert.equal(await service.ladeStrukturperson("chef", "kind"), null);
  assert.equal(await ladePersonenverlauf("chef", "kind"), null);
  await assert.rejects(service.loescheStrukturperson("chef", "kind", "Mara Beispiel"), /nicht verwalten/);
  assert.ok(await service.ladeStrukturperson("fremd", "kind"));
  await service.speichereStrukturperson("admin", "kind", { leaderId: "chef" });
});

test("Platzhalter und ausschließlich ausgetragene Teams bleiben verwaltbar", async () => {
  const db = fixture.client;
  await db.user.create({ data: { id: "nur-chef", name: "Nur Chef", path: "/nur-chef/", passwordHash: "test" } });
  await db.user.create({ data: { id: "wartend", name: "Wartend", path: "/nur-chef/wartend/", leaderId: "nur-chef" } });
  await service.speichereStrukturperson("nur-chef", "wartend", { name: "Geplante Person", phone: "123" });
  await service.strukturpersonAustragen("nur-chef", "wartend", false);
  assert.deepEqual((await service.ladeStrukturverwaltung("nur-chef")).map((p) => [p.id, p.ausgetragen]), [["wartend", true]]);
  await service.strukturpersonAustragen("nur-chef", "wartend", true);
  assert.equal((await service.ladeStrukturperson("nur-chef", "wartend")).name, "Geplante Person");
});

test("Admins können einen Nachfahren hochrücken, alle betroffenen Pfade bleiben erreichbar", async () => {
  const db = fixture.client;
  await db.user.create({ data: { id: "oben", name: "Oben", path: "/chef/oben/", leaderId: "chef", passwordHash: "test" } });
  await db.user.create({ data: { id: "unten", name: "Unten", path: "/chef/oben/unten/", leaderId: "oben", passwordHash: "test" } });
  await service.speichereStrukturperson("admin", "oben", { leaderId: "unten" });
  assert.equal((await service.ladeStrukturperson("chef", "unten")).leaderId, "chef");
  assert.equal((await service.ladeStrukturperson("unten", "oben")).leaderId, "unten");
});
