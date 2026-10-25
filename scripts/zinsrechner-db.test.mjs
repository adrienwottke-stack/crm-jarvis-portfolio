import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./test-db.mjs";
import { standardWerte } from "../lib/zinsrechner.ts";
import {
  ladeZinsSzenarien,
  speichereZinsSzenario,
  loescheZinsSzenario,
} from "../lib/zinsrechner-service.ts";

const fixture = await testDatabase();
const db = fixture.client;
const owner = await db.user.create({ data: { name: "Rechner Test" } });
const stranger = await db.user.create({ data: { name: "Andere Person" } });
const payload = (patch = {}) => ({
  id: randomUUID(),
  version: 0,
  title: "Testplan",
  contactId: null,
  values: standardWerte(),
  ...patch,
});
test.after(() => fixture.close());

test("migration applies; anonymous and contact scenarios round-trip without local storage", async () => {
  const contact = await db.contact.create({
    data: { name: "Beispielkunde", ownerId: owner.id },
  });
  const sent = payload({ contactId: contact.id });
  const saved = await speichereZinsSzenario(db, owner.id, sent);
  assert.equal(saved.contactName, contact.name);
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.values, standardWerte());
  assert.equal(
    (await ladeZinsSzenarien(db, owner.id, contact.id))[0].id,
    sent.id,
  );
  const free = await speichereZinsSzenario(db, owner.id, payload());
  assert.equal(free.contactId, null);
});
test("identical retries are idempotent and do not create duplicate versions", async () => {
  const sent = payload();
  const first = await speichereZinsSzenario(db, owner.id, sent);
  const again = await speichereZinsSzenario(db, owner.id, sent);
  assert.equal(again.id, first.id);
  assert.equal(again.version, 1);
  assert.equal(await db.zinsSzenario.count({ where: { id: sent.id } }), 1);
});
test("foreign list, foreign contact association, overwrites and deletes are rejected", async () => {
  const foreign = await speichereZinsSzenario(db, stranger.id, payload());
  const contact = await db.contact.create({
    data: { name: "Fremder Kontakt", ownerId: stranger.id },
  });
  assert.ok(
    !(await ladeZinsSzenarien(db, owner.id)).some((s) => s.id === foreign.id),
  );
  await assert.rejects(
    speichereZinsSzenario(db, owner.id, payload({ contactId: contact.id })),
    /Kontakt/,
  );
  await assert.rejects(
    speichereZinsSzenario(db, owner.id, { ...foreign, title: "Override" }),
    /nicht verfügbar/,
  );
  await assert.rejects(
    loescheZinsSzenario(db, owner.id, foreign.id, foreign.version),
  );
  assert.equal(
    (await db.zinsSzenario.findUnique({ where: { id: foreign.id } })).title,
    "Testplan",
  );
});
test("stale devices cannot overwrite or delete a newer version", async () => {
  const first = await speichereZinsSzenario(db, owner.id, payload());
  const second = await speichereZinsSzenario(db, owner.id, {
    ...first,
    values: { ...first.values, monthly: 500 },
  });
  assert.equal(second.version, 2);
  await assert.rejects(
    speichereZinsSzenario(db, owner.id, {
      ...first,
      values: { ...first.values, monthly: 700 },
    }),
    /anderen Gerät/,
  );
  await assert.rejects(
    loescheZinsSzenario(db, owner.id, first.id, first.version),
  );
  assert.equal(
    (await ladeZinsSzenarien(db, owner.id)).find((s) => s.id === first.id)
      .values.monthly,
    500,
  );
});
test("transferring a contact removes the previous owner's access to its calculation", async () => {
  const contact = await db.contact.create({
    data: { name: "Umgehängt", ownerId: owner.id },
  });
  const first = await speichereZinsSzenario(
    db,
    owner.id,
    payload({ contactId: contact.id }),
  );
  await db.contact.update({
    where: { id: contact.id },
    data: { ownerId: stranger.id },
  });
  assert.ok(
    !(await ladeZinsSzenarien(db, owner.id)).some((s) => s.id === first.id),
  );
  await assert.rejects(
    speichereZinsSzenario(db, owner.id, { ...first, contactId: null }),
    /nicht verfügbar/,
  );
  assert.ok(
    !(await ladeZinsSzenarien(db, stranger.id)).some((s) => s.id === first.id),
  );
});
test("deletion cascades with contacts and users; deleted snapshots are not silently recreated", async () => {
  const contact = await db.contact.create({
    data: { name: "Löschprobe", ownerId: owner.id },
  });
  const first = await speichereZinsSzenario(
    db,
    owner.id,
    payload({ contactId: contact.id }),
  );
  await db.contact.delete({ where: { id: contact.id } });
  assert.equal(
    await db.zinsSzenario.findUnique({ where: { id: first.id } }),
    null,
  );
  await assert.rejects(
    speichereZinsSzenario(db, owner.id, { ...first, contactId: null }),
    /gelöscht/,
  );
  const temp = await db.user.create({ data: { name: "Temporär" } });
  const own = await speichereZinsSzenario(db, temp.id, payload());
  await db.user.delete({ where: { id: temp.id } });
  assert.equal(
    await db.zinsSzenario.findUnique({ where: { id: own.id } }),
    null,
  );
});
test("invalid snapshots never reach persistence", async () => {
  const sent = payload({ values: { ...standardWerte(), years: -1 } });
  await assert.rejects(speichereZinsSzenario(db, owner.id, sent));
  assert.equal(
    await db.zinsSzenario.findUnique({ where: { id: sent.id } }),
    null,
  );
});
