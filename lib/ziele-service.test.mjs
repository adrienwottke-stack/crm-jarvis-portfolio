import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "../scripts/test-db.mjs";

test("Ziele und Erinnerungen behalten Zustimmung, Zeitraum, Korrekturen und Abschlusszuordnung in einer echten Testdatenbank", async () => {
  const fixture = await testDatabase();
  const db = fixture.client;
  globalThis.prisma = db;
  try {
    const service = await import("./ziele-service.ts");
    const lesen = await import("./ziele.ts");
    const erinnerungen = await import("./einheiten-erinnerung.ts");
    const dates = await import("./dates.ts");
    const heute = dates.berlinToday();
    const tag = dates.dayToUtcDate(heute);
    for (const [id, path, leaderId] of [["chef", "/chef/", null], ["partner", "/chef/partner/", "chef"], ["fremd", "/fremd/", null]]) {
      await db.user.create({ data: { id, name: id, path, leaderId, person: { create: { id: `p-${id}`, name: id } } } });
    }
    const eingabe = { kennzahl: "CALL", zielwert: "10", zeitraum: "WOCHE", tag: heute, titel: "Meine Woche" };
    const eigenes = await service.speichereZiel("partner", { ...eingabe, hauptziel: true });
    assert.equal((await lesen.ladeHauptziel("partner")).id, eigenes.id);
    assert.equal((await lesen.ladeZiele("partner"))[0].zusage, "BESTAETIGT");
    await assert.rejects(service.speichereZiel("fremd", { ...eingabe, inhaberId: "partner" }));
    const vorschlag = await service.speichereZiel("chef", { ...eingabe, inhaberId: "partner", kennzahl: "APPOINTMENT_HELD", zielwert: "2" });
    assert.equal((await lesen.ladeZiele("partner")).find(z => z.id === vorschlag.id).aktiv, false);
    await assert.rejects(service.bestaetigeZiel("chef", vorschlag.id, true));
    await assert.rejects(service.setzeHauptziel("partner", vorschlag.id));
    await service.bestaetigeZiel("partner", vorschlag.id, true);
    await service.setzeHauptziel("partner", vorschlag.id);
    assert.equal((await lesen.ladeHauptziel("partner")).id, vorschlag.id);
    const log = await db.dailyLog.create({ data: { personId: "p-partner", type: "APPOINTMENT_HELD", count: 3, date: tag } });
    await db.dailyLog.create({ data: { personId: "p-chef", type: "APPOINTMENT_HELD", count: 100, date: tag } });
    let stand = (await lesen.ladeZiele("partner")).find(z => z.id === vorschlag.id);
    await db.dailyLog.create({ data: { personId: "p-partner", type: "APPOINTMENT_HELD", count: 50, date: stand.ende } });
    stand = (await lesen.ladeZiele("partner")).find(z => z.id === vorschlag.id);
    assert.equal(stand.erreicht, 3, "Nur der Inhaber, nur Einträge vor dem exklusiven Ende");
    assert.equal(stand.geschafft, true);
    await db.dailyLog.update({ where: { id: log.id }, data: { count: 1 } });
    stand = (await lesen.ladeZiele("partner")).find(z => z.id === vorschlag.id);
    assert.equal(stand.erreicht, 1);
    assert.equal(stand.geschafft, false, "Korrekturen nehmen den Erfolg zurück");
    const units = await service.speichereZiel("partner", { ...eingabe, kennzahl: "UNITS", zielwert: "100", zeitraum: "MONAT" });
    await db.einheitenbuchung.createMany({ data: [
      { userId: "partner", hundertstel: 12000, tag }, { userId: "partner", hundertstel: -3000, tag },
      { userId: "fremd", hundertstel: 99900, tag },
    ] });
    assert.equal((await lesen.ladeZiele("partner")).find(z => z.id === units.id).erreicht, 9000);
    await db.user.update({ where: { id: "partner" }, data: { pledgeTarget: 4, pledgeSetAt: new Date("2020-01-01T10:00:00Z") } });
    await db.dailyLog.createMany({ data: [
      { personId: "p-partner", type: "APPOINTMENT_SET", count: 2, date: new Date("2020-01-02") },
      { personId: "p-partner", type: "APPOINTMENT_SET", count: 20, date: new Date("2020-02-01") },
    ] });
    await lesen.uebernehmeAltesVersprechen("partner");
    await lesen.uebernehmeAltesVersprechen("partner");
    const alt = (await lesen.ladeZiele("partner")).filter(z => z.zeitraum === "ALT_30_TAGE");
    assert.equal(alt.length, 1);
    assert.equal(alt[0].ende.toISOString(), "2020-01-31T10:00:00.000Z");
    assert.equal(alt[0].erreicht, 2);
    assert.equal(alt[0].aktiv, false);
    await db.user.update({ where: { id: "partner" }, data: { leaderId: "fremd", path: "/fremd/partner/" } });
    assert.equal((await lesen.ladeZiele("chef")).length, 0, "Teamwechsel entzieht dem bisherigen Vorschlagenden den Zugriff");
    await assert.rejects(service.speichereZiel("chef", { ...eingabe, inhaberId: "partner" }));
    await assert.rejects(lesen.ladeZielZumBearbeiten(vorschlag.id, { id: "chef", path: "/chef/" }));

    const kontakt = await db.contact.create({ data: { name: "Testabschluss", ownerId: "partner", stage: "ABSCHLUSS", outcome: "GEWONNEN", listKinds: [] } });
    const abschluss = await db.stageEvent.create({ data: { userId: "partner", contactId: kontakt.id, toStage: "ABSCHLUSS" } });
    const erste = await db.$transaction(tx => erinnerungen.registriereEinheitenAbschluss(tx, "partner", kontakt.id, abschluss.id));
    const zweite = await db.$transaction(tx => erinnerungen.registriereEinheitenAbschluss(tx, "partner", kontakt.id, abschluss.id));
    assert.equal(erste.anzeigen, true);
    assert.deepEqual(zweite, { id: erste.id, anzeigen: false });
    assert.equal((await erinnerungen.ladeEinheitenErinnerungen("partner", true)).length, 1, "Schon beim Abschluss abgesichert, auch wenn der Browser schließt");
    assert.equal((await db.einheitenErinnerung.findUnique({ where: { id: erste.id } })).faelligAm.toISOString().slice(0, 10), dates.shiftDay(heute, 1));
    await assert.rejects(db.$transaction(tx => erinnerungen.registriereEinheitenAbschluss(tx, "fremd", kontakt.id, abschluss.id)));
    await db.einheitenbuchung.create({ data: { userId: "partner", hundertstel: 500, tag } });
    assert.equal((await erinnerungen.ladeEinheitenErinnerungen("partner", true)).length, 1, "Eine unzugeordnete Buchung erledigt keine Erinnerung");
    const zuordnung = { userId: "partner", erinnerungId: erste.id, hundertstel: 2500, tag, notiz: "Test" };
    await assert.rejects(db.$transaction(tx => erinnerungen.bucheZugeordneteEinheiten(tx, { ...zuordnung, userId: "chef" })));
    const vorher = await db.einheitenbuchung.count({ where: { userId: "partner" } });
    await db.$transaction(tx => erinnerungen.bucheZugeordneteEinheiten(tx, zuordnung));
    await db.$transaction(tx => erinnerungen.bucheZugeordneteEinheiten(tx, zuordnung));
    assert.equal(await db.einheitenbuchung.count({ where: { userId: "partner" } }), vorher + 1);
    assert.equal((await erinnerungen.ladeEinheitenErinnerungen("partner", true)).length, 0);
    const erledigt = await db.einheitenErinnerung.findUnique({ where: { id: erste.id } });
    await db.einheitenbuchung.delete({ where: { id: erledigt.buchungId } });
    assert.equal((await erinnerungen.ladeEinheitenErinnerungen("partner", true)).length, 1, "Eine gelöschte Zuordnung öffnet die Erinnerung wieder");
    await db.stageEvent.delete({ where: { id: abschluss.id } });
    assert.equal(await db.einheitenErinnerung.count(), 0, "Rücknahme des Abschlusses entfernt dessen Erinnerung");
  } finally {
    delete globalThis.prisma;
    await fixture.close();
  }
});
