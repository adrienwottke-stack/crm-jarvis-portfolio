import assert from "node:assert/strict";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
globalThis.prisma = fixture.client;
const service = await import("../lib/vereinbarungen.ts");
try {
  for (const [id, path, leaderId] of [["root", "/root/", null], ["chef", "/root/chef/", "root"], ["partner", "/root/chef/partner/", "chef"], ["fremd", "/fremd/", null]]) {
    await fixture.client.user.create({ data: { id, name: id, path, leaderId, passwordHash: "test", role: id === "root" ? "ADMIN" : "MEMBER" } });
  }
  const inhalt = { titel: "Vorbereitung für das nächste Gespräch", verantwortlicherId: "partner", art: "TERMIN", faelligAm: new Date(Date.now() - 60000), endetAm: new Date(Date.now() + 3600000) };
  assert.equal((await service.vereinbarungVorschlagen("chef", "partner", inhalt)).ok, true);
  assert.equal((await service.vereinbarungVorschlagen("fremd", "partner", inhalt)).ok, false);
  assert.equal((await service.vereinbarungVorschlagen("chef", "partner", { ...inhalt, verantwortlicherId: "fremd" })).ok, false);
  let [stand] = await service.ladeVereinbarungen("chef", "partner");
  assert.equal(stand.status, "VORGESCHLAGEN");
  assert.equal(stand.verlauf.length, 1);
  assert.equal((await service.ladeVereinbarungen("root")).length, 0, "Auch ein übergeordneter Admin liest keine fremde Absprache");
  assert.equal((await service.vereinbarungReagieren("root", stand.id, 1, "BESTAETIGEN")).ok, false, "Ein Admin bestätigt nicht für die Beteiligten");
  assert.equal((await service.vereinbarungAendern("root", stand.id, 1, inhalt)).ok, false);
  assert.equal(JSON.stringify(stand).includes('"passwordHash"'), false);
  assert.equal(JSON.stringify(stand).includes('"path"'), false);
  assert.equal((await service.ladeVereinbarungsTermine("chef")).length, 0, "Ein Vorschlag ist kein Kalendereintrag");
  assert.equal((await service.ladeHeuteVereinbarungen("chef")).length, 0);
  assert.equal((await service.ladeHeuteVereinbarungen("partner")).length, 1, "Empfänger sieht Bestätigungsanfrage");
  assert.equal((await service.vereinbarungReagieren("chef", stand.id, 1, "BESTAETIGEN")).ok, false);
  assert.equal((await service.vereinbarungReagieren("partner", stand.id, 1, "BESTAETIGEN")).ok, true);
  assert.equal((await service.ladeVereinbarungsTermine("chef")).length, 1);
  assert.equal((await service.ladeVereinbarungsTermine("partner")).length, 1);
  assert.equal((await service.ladeVereinbarungsTermine("root")).length, 0);
  assert.equal((await service.ladeHeuteVereinbarungen("chef")).length, 1, "Bestätigte Fälligkeit erscheint");
  assert.equal((await service.vereinbarungAendern("partner", stand.id, 2, { ...inhalt, titel: "Gemeinsam den Einstieg vorbereiten" })).ok, true);
  assert.equal((await service.ladeVereinbarungsTermine("chef")).length, 0, "Änderung braucht neue Bestätigung");
  assert.equal((await service.vereinbarungReagieren("chef", stand.id, 2, "BESTAETIGEN")).ok, false, "Veraltete Version wird verworfen");
  assert.equal((await service.vereinbarungReagieren("partner", stand.id, 3, "BESTAETIGEN")).ok, false, "Ändernder bestätigt nicht selbst");
  assert.equal((await service.vereinbarungReagieren("chef", stand.id, 3, "BESTAETIGEN")).ok, true);
  assert.equal((await service.vereinbarungReagieren("partner", stand.id, 4, "ERLEDIGEN")).ok, true);
  [stand] = await service.ladeVereinbarungen("chef", "partner");
  assert.equal(stand.version, 5);
  assert.equal(stand.verlauf.length, 5);
  assert.equal(stand.verlauf.at(-1).stand.titel, inhalt.titel, "Alte Version bleibt unverändert");
  assert.equal(stand.verlauf[0].stand.status, "ERLEDIGT");
  assert.equal((await service.vereinbarungAendern("chef", stand.id, 5, inhalt)).ok, false);
  assert.equal((await service.ladeVereinbarungsTermine("chef")).length, 0);
  await fixture.client.leadershipTask.create({ data: { leaderId: "chef", memberId: "partner", dueAt: new Date(), note: "PRIVATE ALTNOTIZ" } });
  assert.equal(JSON.stringify(await service.ladeVereinbarungen("partner")).includes("PRIVATE ALTNOTIZ"), false);
  assert.equal((await service.vereinbarungVorschlagen("chef", "partner", { ...inhalt, art: "AUFGABE", endetAm: null })).ok, true);
  const offen = (await service.ladeVereinbarungen("chef")).find((s) => s.status === "VORGESCHLAGEN");
  assert.equal((await service.vereinbarungReagieren("partner", offen.id, 1, "BESTAETIGEN")).ok, true);
  const erinnerungen = await service.ladeVereinbarungsErinnerungen();
  assert.equal(erinnerungen.get("chef").faellig, 1);
  assert.equal(erinnerungen.get("partner").faellig, 1);
  await fixture.client.user.update({ where: { id: "partner" }, data: { leaderId: "fremd", path: "/fremd/partner/" } });
  assert.equal((await service.ladeVereinbarungen("chef")).length, 0, "Teamwechsel entzieht Lesen");
  assert.equal((await service.ladeVereinbarungen("partner")).length, 0);
  assert.equal((await service.vereinbarungReagieren("chef", offen.id, 2, "ERLEDIGEN")).ok, false, "Teamwechsel entzieht Änderungen");
  assert.equal((await service.ladeVereinbarungsErinnerungen()).size, 0, "Keine Erinnerung außerhalb aktueller Struktur");
  console.log("Vereinbarungs-Service: echter Datenbanklauf für Zugriff, Bestätigen, Fälligkeit, Kalender, Versionshistorie, private Notizen und Teamwechsel bestanden.");
} finally {
  delete globalThis.prisma;
  await fixture.close();
}
