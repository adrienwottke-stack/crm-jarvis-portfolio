import test from "node:test";
import assert from "node:assert/strict";
import { zielZeitraum, zielFortschritt, darfZielVorschlagen, darfZielBestaetigen, zielIstAktiv, zielPruefzeit } from "./ziele-modell.ts";

test("Eine Berliner Kalenderwoche über den Jahreswechsel beginnt Montag und endet exklusiv Montag", () => {
  const zeitraum = zielZeitraum("WOCHE", "2027-01-01");
  assert.equal(zeitraum.start.toISOString(), "2026-12-28T00:00:00.000Z");
  assert.equal(zeitraum.ende.toISOString(), "2027-01-04T00:00:00.000Z");
});

test("Die Zielwoche endet um Berliner Mitternacht auch wenn UTC noch Sonntag ist", () => {
  const jetzt = new Date("2026-09-13T22:15:00Z");
  assert.equal(zielPruefzeit("WOCHE", jetzt).toISOString(), "2026-09-14T00:00:00.000Z");
  assert.equal(zielPruefzeit("ALT_30_TAGE", jetzt).toISOString(), "2026-09-13T22:15:00.000Z");
});

test("Nur aktuelle Führung darf vorschlagen, ausschließlich der Inhaber bestätigt; ein Vorschlag zählt nicht aktiv", () => {
  const inhaber = { id: "kind", path: "/chef/kind/", deactivatedAt: null };
  assert.equal(darfZielVorschlagen({ id: "chef", path: "/chef/" }, inhaber), true);
  assert.equal(darfZielVorschlagen({ id: "fremd", path: "/fremd/" }, inhaber), false);
  assert.equal(darfZielVorschlagen({ id: "root", path: "/" }, inhaber), false);
  assert.equal(darfZielVorschlagen({ id: "chef", path: "/chef/" }, { ...inhaber, path: "/neu/kind/" }), false);
  assert.equal(darfZielBestaetigen("chef", "kind"), false);
  assert.equal(darfZielBestaetigen("kind", "kind"), true);
  const ziel = { start: new Date("2026-09-01"), ende: new Date("2026-10-01"), archiviertAt: null, zusage: "OFFEN" };
  assert.equal(zielIstAktiv(ziel, new Date("2026-09-08")), false);
  assert.equal(zielIstAktiv({ ...ziel, zusage: "BESTAETIGT" }, new Date("2026-09-08")), true);
  assert.equal(zielIstAktiv({ ...ziel, zusage: "BESTAETIGT" }, new Date("2026-10-01")), false);
});

test("Stornos nehmen erreichten Fortschritt zurück und Einträge am Endtag zählen nicht", () => {
  const zeitraum = zielZeitraum("MONAT", "2028-02-14");
  assert.equal(zeitraum.ende.toISOString(), "2028-03-01T00:00:00.000Z");
  const buchungen = [
    { tag: new Date("2028-02-01T00:00:00Z"), wert: 10000 },
    { tag: new Date("2028-02-29T00:00:00Z"), wert: -2500 },
    { tag: new Date("2028-03-01T00:00:00Z"), wert: 5000 },
    { tag: new Date("2028-01-31T00:00:00Z"), wert: 8000 },
  ];
  const stand = zielFortschritt(10000, buchungen, zeitraum);
  assert.deepEqual(stand, { erreicht: 7500, anteil: 0.75, fehlend: 2500, geschafft: false });
});
