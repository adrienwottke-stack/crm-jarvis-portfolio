import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./test-db.mjs";
import { tagesmeldungenBuendeln } from "../lib/vereinbarungen-meldungen.ts";

test("units reminders respect owner, completion, due date, activation and feature switch", async () => {
  const fixture = await testDatabase();
  globalThis.prisma = fixture.client;
  const { ladeFaelligeEinheitenMeldungen } = await import("../lib/einheiten-meldungen.ts");
  const db = fixture.client;
  try {
    const active = await db.user.create({ data: { name: "Active", passwordHash: "test" } });
    const other = await db.user.create({ data: { name: "Other", passwordHash: "test" } });
    const inactive = await db.user.create({ data: { name: "Inactive", passwordHash: "test", deactivatedAt: new Date() } });
    const placeholder = await db.user.create({ data: { name: "Placeholder" } });
    const add = async (user, options = {}) => {
      const contact = await db.contact.create({ data: { name: "Test Contact", ownerId: options.ownerId ?? user.id, stage: "ABSCHLUSS", outcome: options.outcome ?? "GEWONNEN" } });
      const event = await db.stageEvent.create({ data: { userId: options.eventOwnerId ?? user.id, contactId: options.eventContactId ?? contact.id, toStage: options.toStage ?? "ABSCHLUSS" } });
      const booking = options.booked ? await db.einheitenbuchung.create({ data: { userId: user.id, hundertstel: 1200, tag: new Date("2026-09-08") } }) : null;
      return db.einheitenErinnerung.create({ data: { userId: user.id, contactId: contact.id, abschlussId: event.id, faelligAm: options.due === null ? null : new Date(options.due ?? "2026-09-08"), buchungId: booking?.id } });
    };
    await add(active);
    await add(active, { due: "2026-09-07" });
    await add(active, { due: "2026-09-09" });
    await add(active, { due: null });
    await add(active, { booked: true });
    await add(active, { ownerId: other.id });
    await add(active, { eventOwnerId: other.id });
    await add(active, { outcome: "VERLOREN" });
    await add(active, { toStage: "TERMIN_GEHALTEN" });
    const unrelated = await db.contact.create({ data: { name: "Wrong completion contact", ownerId: active.id } });
    await add(active, { eventContactId: unrelated.id });
    await add(inactive);
    await add(placeholder);
    assert.deepEqual([...await ladeFaelligeEinheitenMeldungen("2026-09-08")], [[active.id, 2]]);
    await db.feature.upsert({ where: { key: "einheiten" }, create: { key: "einheiten", titel: "Einheiten", state: "AUS" }, update: { state: "AUS" } });
    assert.equal((await ladeFaelligeEinheitenMeldungen("2026-09-08")).size, 0);
    await db.feature.update({ where: { key: "einheiten" }, data: { state: "LAEUFT" } });
    assert.equal((await ladeFaelligeEinheitenMeldungen("2026-09-08")).get(active.id), 2);
  } finally { delete globalThis.prisma; await fixture.close(); }
});

test("mixed own-work, leadership, agreement and units messages form one daily push", () => {
  const messages = ["Eigene Aufgaben", "Team", "Absprachen", "Einheiten ergänzen"].map((titel) => ({ titel, text: "Heute offen.", url: "/heute", kennung: titel }));
  const result = tagesmeldungenBuendeln(messages);
  assert.equal(result.kennung, "tagesueberblick");
  assert.equal(result.url, "/heute");
  for (const message of messages) assert.ok(result.text.includes(message.titel));
});
