// Lesende Probe: steht das Einheiten-Feature in der Datenbank, und was
// liefert die Abfrage, aus der die Stufenrunde entsteht?
//
//   node scripts/einheiten-probe.mjs
//
// Schreibt nichts, darf jederzeit erneut laufen.
//
// Die Lektion vom 25.08. gilt auch hier: Schwellen gegen die echten Zahlen
// setzen, nie gegen Bauchgefuehl. Solange niemand seine Kernstufe eingetragen
// hat, ist jede Runde leer - das ist der Normalzustand am ersten Abend und
// kein Fehler.

import "dotenv/config";
import pg from "pg";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL fehlt.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const spalten = await client.query(`
  SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'User'
     AND column_name IN ('kernstufe', 'einheitenStart')
   ORDER BY column_name
`);
console.log(
  "Spalten am User:",
  spalten.rows.map((r) => r.column_name).join(", ") || "KEINE"
);

const tabelle = await client.query(`
  SELECT to_regclass('public."Einheitenbuchung"') IS NOT NULL AS da
`);
console.log("Tabelle Einheitenbuchung:", tabelle.rows[0].da ? "da" : "FEHLT");

const stufen = await client.query(`
  SELECT COALESCE("kernstufe"::text, 'nicht eingetragen') AS stufe,
         COUNT(*)::int AS koepfe
    FROM "User"
   WHERE "deactivatedAt" IS NULL AND "passwordHash" IS NOT NULL
   GROUP BY 1 ORDER BY 1
`);
console.log("\nKoepfe je Kernstufe:");
for (const zeile of stufen.rows) {
  console.log(`  ${zeile.stufe.padEnd(18)} ${zeile.koepfe}`);
}

// Genau die Abfrage, aus der die zwei Zahlen der Seite entstehen: Gesamt ueber
// alles, Monat ueber den laufenden Kalendermonat (Voreinstellung des
// Produktionsmonats, siehe PRODUKTIONSMONAT_ERSTER_TAG).
const summen = await client.query(`
  SELECT u."name",
         u."kernstufe",
         (u."einheitenStart" + COALESCE(SUM(b."hundertstel"), 0))::int AS gesamt,
         COALESCE(SUM(b."hundertstel") FILTER (
           WHERE b."tag" >= date_trunc('month', CURRENT_DATE)
         ), 0)::int AS monat
    FROM "User" u
    LEFT JOIN "Einheitenbuchung" b ON b."userId" = u."id"
   WHERE u."deactivatedAt" IS NULL AND u."passwordHash" IS NOT NULL
   GROUP BY u."id", u."name", u."kernstufe", u."einheitenStart"
   HAVING u."einheitenStart" > 0 OR COUNT(b."id") > 0
   ORDER BY monat DESC
`);
console.log("\nKoepfe mit Einheiten:", summen.rows.length);
for (const zeile of summen.rows) {
  console.log(
    `  ${zeile.name.padEnd(20)} Stufe ${zeile.kernstufe ?? "-"}  Monat ${(zeile.monat / 100).toFixed(2).padStart(9)}  Gesamt ${(zeile.gesamt / 100).toFixed(2).padStart(9)}`
  );
}

await client.end();
