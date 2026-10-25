// Reine Auswertungsprobe. Keine Datenbank und keine Schreibzugriffe.
// node --import ./scripts/alias-hook.mjs --experimental-strip-types scripts/team-auswertung-probe.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { auswertungszeitraum, auswertungsUmfang, einheitenVerlauf, berichtsgruppe, gueltigerBerichtstag } from "../lib/team-auswertung-modell.ts";

test("Kalenderzeiträume richten sich am Berliner Tag aus, einschließlich Jahreswechsel", () => {
  const woche = auswertungszeitraum("woche", "2026-01-01");
  assert.equal(woche.von, "2025-12-29");
  assert.equal(woche.bis, "2026-01-04");
  assert.equal(auswertungszeitraum("monat", "2024-02-17").bis, "2024-02-29");
  assert.equal(auswertungszeitraum("quartal", "2026-10-25").von, "2026-10-01");
  assert.equal(auswertungszeitraum("jahr", "2026-09-08").bis, "2026-12-31");
});

const konten = [
  { id: "a", path: "/a/", leaderId: null, einheitenStart: 10000, hatAktivitaetsprofil: true },
  { id: "b", path: "/a/b/", leaderId: "a", einheitenStart: 20000, hatAktivitaetsprofil: true },
  { id: "c", path: "/a/b/c/", leaderId: "b", einheitenStart: 30000, hatAktivitaetsprofil: true },
  { id: "d", path: "/a/d/", leaderId: "a", einheitenStart: 0, hatAktivitaetsprofil: false },
];

test("Drei Ebenen trennen Eigenleistung und Team ohne doppelte Teilteams", () => {
  assert.deepEqual(auswertungsUmfang("a", [...konten, konten[2]], "struktur").teamIds, ["b", "c", "d"]);
  assert.deepEqual(auswertungsUmfang("a", konten, "direkte").teamIds, ["b", "d"]);
  assert.deepEqual(auswertungsUmfang("a", konten, "teilteam", "b"), { art: "teilteam", wurzelId: "b", teamIds: ["c"] });
  assert.deepEqual(auswertungsUmfang("a", konten, "teilteam", "c").teamIds, []);
});

test("Fremde Teilteam-IDs und ein nicht initialisierter Pfad öffnen keine Daten", () => {
  assert.throws(() => auswertungsUmfang("a", konten, "teilteam", "fremd"), RangeError);
  assert.throws(() => auswertungsUmfang("fremd", konten, "struktur"), RangeError);
  assert.deepEqual(auswertungsUmfang("a", [{ ...konten[0], path: "/" }, konten[1]], "struktur").teamIds, []);
});

test("Teamwechsel verwendet die heutige Struktur und keine frühere Zugehörigkeit", () => {
  const verschoben = konten.map((konto) => konto.id === "c" ? { ...konto, path: "/a/d/c/", leaderId: "d" } : konto);
  assert.deepEqual(auswertungsUmfang("a", verschoben, "teilteam", "b").teamIds, []);
  assert.deepEqual(auswertungsUmfang("a", verschoben, "teilteam", "d").teamIds, ["c"]);
});

test("Rückdatierte Korrekturen gelten am Buchungstag; Lücken bleiben unverändert", () => {
  const zeit = { art: "monat", von: "2026-09-01", bis: "2026-09-04", label: "September" };
  const punkte = einheitenVerlauf(zeit, [
    { tag: "2026-08-31", hundertstel: 90000 },
    { tag: "2026-09-01", hundertstel: 5000 },
    { tag: "2026-09-03", hundertstel: -2000 },
    { tag: "2026-09-03", hundertstel: 500 },
    { tag: "2026-09-05", hundertstel: 50000 },
  ]);
  assert.deepEqual(punkte.map((punkt) => punkt.kumuliert), [5000, 5000, 3500, 3500]);
});

test("Berichtsgruppe zählt jeden Kopf einmal und hält Startbestand aus der Kurve", () => {
  const zeit = auswertungszeitraum("monat", "2026-09-08");
  const gruppe = berichtsgruppe({
    zeit,
    konten: [konten[1], konten[2], konten[2]],
    buchungen: [{ userId: "b", tag: "2026-09-02", hundertstel: 3000 }, { userId: "c", tag: "2026-09-02", hundertstel: -500 }, { userId: "a", tag: "2026-09-02", hundertstel: 90000 }],
    gebuchtGesamt: [{ userId: "b", hundertstel: 6000 }, { userId: "c", hundertstel: -500 }, { userId: "a", hundertstel: 90000 }],
    aktivitaeten: [{ userId: "b", type: "CALL", count: 4 }, { userId: "c", type: "CALL", count: 3 }, { userId: "a", type: "CALL", count: 100 }],
  });
  assert.equal(gruppe.konten, 2);
  assert.equal(gruppe.einheitenZeitraum, 2500);
  assert.equal(gruppe.einheitenGesamt, 55500);
  assert.equal(gruppe.startbestand, 50000);
  assert.equal(gruppe.kurve.at(-1).kumuliert, 2500);
  assert.equal(gruppe.aktivitaeten.CALL, 7);
});

test("Fehlendes Aktivitätsprofil wird als fehlender Einblick ausgegeben", () => {
  const gruppe = berichtsgruppe({ zeit: auswertungszeitraum("monat", "2026-09-08"), konten: [konten[3]], buchungen: [], gebuchtGesamt: [], aktivitaeten: [] });
  assert.equal(gruppe.aktivitaetsKonten, 0);
  assert.equal(gruppe.aktivitaeten, null);
  assert.equal(gruppe.einheitenZeitraum, 0);
});

test("Teilweise Daten sind als Teilmenge erkennbar, ein leeres Team bleibt leer", () => {
  const basis = { zeit: auswertungszeitraum("woche", "2026-09-08"), buchungen: [], gebuchtGesamt: [], aktivitaeten: [] };
  const teilweise = berichtsgruppe({ ...basis, konten: [konten[1], konten[3]] });
  assert.equal(teilweise.konten, 2);
  assert.equal(teilweise.aktivitaetsKonten, 1);
  assert.equal(teilweise.aktivitaeten.CALL, 0);
  const leer = berichtsgruppe({ ...basis, konten: [] });
  assert.equal(leer.konten, 0);
  assert.equal(leer.aktivitaeten, null);
  assert.equal(leer.einheitenGesamt, 0);
});

test("Ungültige Kalendertage werden nicht still in den nächsten Monat umgerechnet", () => {
  assert.equal(gueltigerBerichtstag("2026-02-30"), false);
  assert.equal(gueltigerBerichtstag("2026-13-01"), false);
  assert.equal(gueltigerBerichtstag("2024-02-29"), true);
  assert.throws(() => auswertungszeitraum("monat", "2026-02-30"), RangeError);
});
