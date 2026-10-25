// Probe des Schreibwegs der Anwesenheit - ohne die Datenbank zu aendern.
//
// merkeAnwesenheit() laeuft nur hinter der Anmeldung. Damit der Weg nicht
// voellig ungeprueft bleibt, spielt dieses Skript ihn auf SQL-Ebene durch:
// zweimal einfuegen (die Tageskappe muss greifen), lesen, ROLLBACK.
//
//   node scripts/anwesenheit-probe.mjs

import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
await client.connect();

let fehler = null;
try {
  await client.query("BEGIN");

  const { rows: personen } = await client.query(
    `SELECT "id", "name" FROM "Person" ORDER BY "name" LIMIT 1`
  );
  if (personen.length === 0) throw new Error("Keine Person in der Datenbank.");
  const person = personen[0];

  // Wie lib/anwesenheit.ts: UTC-Mitternacht des Berliner Kalendertags.
  const heute = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const tag = `${heute}T00:00:00.000Z`;

  const einfuegen = `
    INSERT INTO "Anwesenheit" ("personId", "day")
    VALUES ($1, $2)
    ON CONFLICT ("personId", "day") DO NOTHING`;

  const erste = await client.query(einfuegen, [person.id, tag]);
  const zweite = await client.query(einfuegen, [person.id, tag]);

  const { rows: gezaehlt } = await client.query(
    `SELECT COUNT(*)::int AS n FROM "Anwesenheit" WHERE "personId" = $1 AND "day" = $2`,
    [person.id, tag]
  );

  console.log(`Person:            ${person.name}`);
  console.log(`Tag:               ${heute}`);
  console.log(`Erster Aufruf:     ${erste.rowCount} Zeile(n) geschrieben`);
  console.log(`Zweiter Aufruf:    ${zweite.rowCount} Zeile(n) geschrieben (muss 0 sein)`);
  console.log(`Zeilen fuer heute: ${gezaehlt[0].n} (muss 1 sein)`);

  if (zweite.rowCount !== 0 || gezaehlt[0].n !== 1) {
    throw new Error("Die Tageskappe greift nicht.");
  }
} catch (e) {
  fehler = e;
} finally {
  await client.query("ROLLBACK");
  console.log("\nROLLBACK - die Datenbank ist unveraendert.");
  await client.end();
}

if (fehler) {
  console.error("FEHLGESCHLAGEN:", fehler.message);
  process.exit(1);
}
console.log("Schreibweg sauber, Tageskappe greift.");
