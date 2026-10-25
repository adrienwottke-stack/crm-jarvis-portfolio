// Nullmessung vor dem Aufbau-Start (docs/recruiting-plan.md §7, Abschnitt 0)
// und zugleich die Wochenmessung der Multiplikations-Messlatte: "10 Berater
// ausser dem Admin loggen in einer normalen Woche an mindestens 3 Tagen".
//
// Ohne Vorher-Wert ist jedes Nachher eine Meinung. Das Skript liest nur - es
// schreibt nichts und darf jederzeit erneut laufen.
//
//   node scripts/nullmessung-aufbau.mjs
//
// Bewusst ueber "pg" und nicht ueber den Prisma-Client: der wird als
// TypeScript erzeugt und laesst sich nicht direkt mit node starten.

import "dotenv/config";
import pg from "pg";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL fehlt.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const zahl = (v) => Number(v ?? 0);

// Existiert eine Tabelle schon? Vor der Ausbau-Migration gibt es "Kandidatur"
// nicht - die Messung soll davor UND danach laufen koennen.
async function tabelle(name) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

const koepfe = await client.query(
  `SELECT
     (SELECT count(*) FROM "User" WHERE "deactivatedAt" IS NULL) AS konten,
     (SELECT count(*) FROM "User" WHERE "deactivatedAt" IS NULL AND "passwordHash" IS NOT NULL) AS mit_zugang,
     (SELECT count(*) FROM "User" WHERE "deactivatedAt" IS NULL AND "installedAt" IS NOT NULL) AS installiert`
);

const namen = await client.query(
  `SELECT
     count(*) FILTER (WHERE 'RECRUITING' = ANY("listKinds")) AS recruiting,
     count(*) FILTER (WHERE 'VERKAUF'    = ANY("listKinds")) AS verkauf
   FROM "Contact"`
);

const einladungen = await client.query(
  `SELECT
     count(*) AS gesamt,
     count(*) FILTER (WHERE "usedAt" IS NOT NULL) AS eingeloest,
     count(*) FILTER (WHERE "usedAt" IS NULL AND "expiresAt" > now()) AS offen,
     count(*) FILTER (WHERE "createdAt" > now() - interval '90 days') AS letzte_90_tage
   FROM "Invite"`
);

// Die Messlatte: je Woche die Koepfe mit Eintraegen an >= 3 verschiedenen
// Tagen (ohne den Admin). "Aktiv" heisst Nutzung, nicht Konto.
const aktive = await client.query(
  `WITH tage AS (
     SELECT date_trunc('week', d."date")::date AS woche,
            d."personId",
            count(DISTINCT d."date"::date) AS logtage
       FROM "DailyLog" d
       JOIN "Person" p ON p."id" = d."personId"
  LEFT JOIN "User" u ON u."id" = p."userId"
      WHERE u."role" IS DISTINCT FROM 'ADMIN'
      GROUP BY 1, 2
   )
   SELECT woche,
          count(*) FILTER (WHERE logtage >= 3) AS aktive,
          count(*) AS logger
     FROM tage
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 6`
);

let kandidaturen = null;
if (await tabelle("Kandidatur")) {
  const { rows } = await client.query(
    `SELECT "phase", count(*) AS anzahl
       FROM "Kandidatur"
      GROUP BY 1
      ORDER BY 1`
  );
  kandidaturen = rows;
}

let anfragen = null;
if (await tabelle("Anfrage")) {
  const { rows } = await client.query(
    `SELECT count(*) AS gesamt,
            count(*) FILTER (WHERE "erledigtAt" IS NULL) AS offen
       FROM "Anfrage"`
  );
  anfragen = rows[0];
}

await client.end();

console.log("\n=== AUFBAU-NULLMESSUNG " + new Date().toISOString().slice(0, 10) + " ===\n");

const k = koepfe.rows[0];
console.log(
  `Konten aktiv: ${zahl(k.konten)}   mit Zugang: ${zahl(k.mit_zugang)}   App installiert: ${zahl(k.installiert)}`
);
const n = namen.rows[0];
console.log(`Namensliste: ${zahl(n.recruiting)} Recruiting, ${zahl(n.verkauf)} Verkauf`);
const e = einladungen.rows[0];
console.log(
  `Einladungen: ${zahl(e.gesamt)} gesamt, ${zahl(e.eingeloest)} eingeloest, ${zahl(e.offen)} offen, ${zahl(e.letzte_90_tage)} in den letzten 90 Tagen\n`
);

console.log("Messlatte (>= 3 Logtage je Woche, ohne Admin) - Ziel: 10");
if (aktive.rows.length === 0) {
  console.log("  Noch keine Eintraege in DailyLog.");
} else {
  for (const r of aktive.rows) {
    // pg liefert ::date als JS-Date - fuer die Ausgabe reicht der Kalendertag.
    const woche = r.woche instanceof Date ? r.woche.toISOString().slice(0, 10) : String(r.woche);
    console.log(
      `  Woche ab ${woche.padEnd(12)} aktive: ${String(zahl(r.aktive)).padStart(3)}   (Logger gesamt: ${zahl(r.logger)})`
    );
  }
}

if (kandidaturen === null) {
  console.log("\nKandidatur-Tabelle: noch nicht migriert (Stand VOR dem Aufbau).");
} else if (kandidaturen.length === 0) {
  console.log("\nKandidaturen: noch keine.");
} else {
  console.log("\nKandidaturen je Phase:");
  for (const r of kandidaturen) {
    console.log(`  ${String(r.phase).padEnd(16)} ${zahl(r.anzahl)}`);
  }
}

if (anfragen !== null) {
  console.log(`Anfragen von aussen: ${zahl(anfragen.gesamt)} gesamt, ${zahl(anfragen.offen)} offen`);
}
console.log("");
