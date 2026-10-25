// Lesende Probe: wie viele Lebenszeit-Punkte hat jeder Kopf wirklich?
//
// Grundlage fuer die Schwellen in lib/stufen.ts. Schwellen, die niemand
// erreicht, schalten nichts frei - und eine Kachel, die fuer alle zu bleibt,
// ist schlimmer als keine Kachel.
//
//   node scripts/stufen-probe.mjs
//
// Schreibt nichts, darf jederzeit erneut laufen.

import "dotenv/config";
import pg from "pg";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL fehlt.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query(`
  SELECT p."name",
         COALESCE(SUM(l."count" * CASE l."type"
           WHEN 'CALL' THEN 1
           WHEN 'NUMBERS_PULLED' THEN 1
           WHEN 'APPOINTMENT_SET' THEN 3
           WHEN 'APPOINTMENT_HELD' THEN 5
           WHEN 'DEAL_WON' THEN 10 END), 0)::int AS punkte,
         COUNT(l."id")::int AS zeilen
    FROM "Person" p
    LEFT JOIN "DailyLog" l ON l."personId" = p."id"
   GROUP BY p."id", p."name"
   ORDER BY punkte DESC
`);

console.log("Lebenszeit-Punkte je Kopf\n");
for (const r of rows) {
  console.log(`  ${String(r.punkte).padStart(6)}  ${r.name}  (${r.zeilen} Eintraege)`);
}

const werte = rows.map((r) => r.punkte).sort((a, b) => a - b);
const median = werte.length ? werte[Math.floor(werte.length / 2)] : 0;
console.log(`\n  Koepfe: ${werte.length}`);
console.log(`  Hoechster: ${werte[werte.length - 1] ?? 0}`);
console.log(`  Median:    ${median}`);

await client.end();
