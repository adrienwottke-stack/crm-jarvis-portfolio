// Lesende Probe fuer den Liegenbleiber-Alarm.
//
//   node scripts/liegenbleiber-probe.mjs
//
// Schreibt nichts, darf jederzeit erneut laufen.
//
// Prueft drei Dinge:
//   1. Steht das Feld in der Datenbank, und hat der Backfill etwas Sinnvolles
//      hinterlassen? (Stuende ueberall createdAt, waere die Historie nicht
//      gelesen worden; stuende ueberall "jetzt", ginge der Alarm in drei Tagen
//      bei allen gleichzeitig los.)
//   2. Verhaelt sich lib/liegenbleiber.ts an den Grenzfaellen richtig -
//      besonders bei "bewusst vertagt", dem einzigen Fall, in dem Schweigen
//      die richtige Antwort ist.
//   3. Welche Meldung der Morgen-Cron heute tatsaechlich verschicken wuerde.
//
// Importiert die echten Funktionen statt SQL nachzubauen: eine nachgebaute
// Kopie geht irgendwann auseinander, und dann prueft die Probe das Falsche.

import "dotenv/config";
import pg from "pg";
import {
  LIEGT_TAGE,
  anker,
  liegtLabel,
  liegtSeit,
} from "../lib/liegenbleiber.ts";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL fehlt.");
  process.exit(1);
}

const TAG = 86_400_000;

// --- 1. Steht das Feld? -----------------------------------------------------

const client = new pg.Client({ connectionString: url });
await client.connect();

const spalte = await client.query(`
  SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'Contact'
     AND column_name = 'lastProgressAt'
`);
console.log("Spalte lastProgressAt:", spalte.rowCount ? "da" : "FEHLT");
if (!spalte.rowCount) {
  await client.end();
  process.exit(1);
}

const index = await client.query(`
  SELECT to_regclass('public."Contact_ownerId_lastProgressAt_idx"') IS NOT NULL AS da
`);
console.log("Index:", index.rows[0].da ? "da" : "FEHLT");

const backfill = await client.query(`
  SELECT
    COUNT(*)::int AS gesamt,
    COUNT(*) FILTER (WHERE "lastProgressAt" = "createdAt")::int AS wie_angelegt,
    COUNT(*) FILTER (WHERE "lastProgressAt" > "createdAt")::int AS aus_historie,
    COUNT(*) FILTER (WHERE "lastProgressAt" > now() - interval '1 hour')::int AS frisch
  FROM "Contact"
`);
const b = backfill.rows[0];
console.log(
  `Backfill: ${b.gesamt} Kontakte — ${b.wie_angelegt} unberuehrt seit Anlage, ` +
    `${b.aus_historie} aus Activity/StageEvent, ${b.frisch} auf "gerade eben"`
);

// --- 2. Grenzfaelle ---------------------------------------------------------

const jetzt = new Date();
const vor = (tage) => new Date(jetzt.getTime() - tage * TAG);

const faelle = [
  ["frisch gezogen, 1 Tag alt", { lastProgressAt: vor(1), nextStepAt: null }, "OFFEN", "NEU", false],
  ["gezogen, 3 Tage nie angefasst", { lastProgressAt: vor(3), nextStepAt: null }, "OFFEN", "NEU", true],
  ["gezogen, 10 Tage nie angefasst", { lastProgressAt: vor(10), nextStepAt: null }, "OFFEN", "NEU", true],
  ["vor 10 Tagen auf HEUTE vertagt", { lastProgressAt: vor(10), nextStepAt: vor(0) }, "OFFEN", "KONTAKTIERT", false],
  ["vor 10 Tagen auf +7 vertagt", { lastProgressAt: vor(10), nextStepAt: vor(-7) }, "OFFEN", "KONTAKTIERT", false],
  ["Frist war vor 4 Tagen", { lastProgressAt: vor(9), nextStepAt: vor(4) }, "OFFEN", "KONTAKTIERT", true],
  ["abgeschlossen, 30 Tage still", { lastProgressAt: vor(30), nextStepAt: null }, "GEWONNEN", "ABSCHLUSS", false],
  ["verloren, 30 Tage still", { lastProgressAt: vor(30), nextStepAt: null }, "VERLOREN", "KONTAKTIERT", false],
];

console.log(`\nGrenzfaelle (Schwelle ${LIEGT_TAGE} Tage):`);
let fehler = 0;
for (const [name, kontakt, outcome, stage, erwartetAlarm] of faelle) {
  const tage = liegtSeit({ ...kontakt, outcome, stage }, LIEGT_TAGE, jetzt);
  const alarm = tage !== null;
  const ok = alarm === erwartetAlarm;
  if (!ok) fehler += 1;
  console.log(
    `  ${ok ? "ok  " : "FEHL"} ${alarm ? "ALARM " : "still "} ${name.padEnd(32)} ` +
      `${alarm ? liegtLabel(tage) : "—"}  (Anker ${anker(kontakt).toISOString().slice(0, 10)})`
  );
}
console.log(fehler === 0 ? "  → alle acht wie erwartet" : `  → ${fehler} FEHLER`);

// --- 3. Was der Cron heute verschicken wuerde -------------------------------

const { rows } = await client.query(`
  SELECT c."name", c."stage", c."outcome", c."lastProgressAt", c."nextStepAt",
         u."name" AS berater
    FROM "Contact" c
    LEFT JOIN "User" u ON u."id" = c."ownerId"
`);
await client.end();

const jeBerater = new Map();
for (const zeile of rows) {
  const tage = liegtSeit(zeile, LIEGT_TAGE, jetzt);
  if (tage === null) continue;
  const liste = jeBerater.get(zeile.berater ?? "ohne Berater") ?? [];
  liste.push({ name: zeile.name, tage });
  jeBerater.set(zeile.berater ?? "ohne Berater", liste);
}

console.log("\nMeldung, wie app/api/cron/meldungen/route.ts sie baut:");
if (jeBerater.size === 0) console.log("  (niemand liegt — es ginge keine raus)");
for (const [berater, liste] of jeBerater) {
  liste.sort((a, b) => b.tage - a.tage);
  const aeltester = liste[0];
  const weitere = liste.length - 1;
  console.log(`  an ${berater}:`);
  console.log(
    `    Titel: "${weitere === 0 ? `${aeltester.name} ${liegtLabel(aeltester.tage)}` : `${aeltester.name} und ${weitere} weitere liegen`}"`
  );
  console.log(
    `    Text:  "${weitere === 0 ? "Seit dem letzten Schritt nichts passiert. Anrufen oder von der Liste nehmen." : `Der älteste ${liegtLabel(aeltester.tage)}. Der Reihe nach von oben.`}"`
  );
  console.log(`    (${liste.length} liegen: ${liste.slice(0, 5).map((e) => `${e.name} ${e.tage}d`).join(", ")}${liste.length > 5 ? " …" : ""})`);
}
