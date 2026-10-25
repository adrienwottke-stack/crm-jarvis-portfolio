// Startprobe fuer die Arena: steht in der Produktion, was dort stehen muss?
//
//   node scripts/arena-check.mjs
//
// Liest nur. Gedacht fuer den Abend des Starts und fuer jeden Morgen danach,
// an dem sich etwas komisch anfuehlt.

import "dotenv/config";
import pg from "pg";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL fehlt.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

async function eine(sql) {
  const { rows } = await client.query(sql);
  return rows;
}

const tabellen = await eine(
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('Feature','FeatureVote','FeatureUse','Sprint','SprintTeilnahme')
    ORDER BY table_name`
);
const features = await eine(`SELECT "key", "titel", "state" FROM "Feature" ORDER BY "key"`);
const personen = await eine(
  `SELECT p."name", (p."userId" IS NOT NULL) AS mit_konto,
          u."onboardingDoneAt" IS NOT NULL AS onboarding_fertig,
          u."installedAt" IS NOT NULL AS installiert
     FROM "Person" p LEFT JOIN "User" u ON u."id" = p."userId"
    ORDER BY p."name"`
);
const stimmen = await eine(
  `SELECT f."titel", count(v.*)::int AS n
     FROM "Feature" f LEFT JOIN "FeatureVote" v ON v."featureKey" = f."key"
    GROUP BY f."titel" ORDER BY f."titel"`
);

await client.end();

const haken = (ok) => (ok ? "ok  " : "FEHLT");

console.log("\n=== ARENA-STARTPROBE ===\n");
console.log(`${haken(tabellen.length === 5)} Tabellen: ${tabellen.length} von 5`);
console.log(`${haken(features.length >= 4)} Bausteine: ${features.length}`);
for (const f of features) console.log(`       ${f.key.padEnd(13)} ${f.state}`);
console.log(`${haken(personen.length >= 2)} Koepfe im Wettbewerb: ${personen.length}`);
for (const p of personen) {
  console.log(
    `       ${p.name.padEnd(20)} Konto ${p.mit_konto ? "ja " : "nein"}  Willkommen ${p.onboarding_fertig ? "fertig" : "offen "}  App ${p.installiert ? "ja" : "nein"}`
  );
}
console.log(`     Stimmen: ${stimmen.map((s) => `${s.titel} ${s.n}`).join(", ") || "noch keine"}`);
if (personen.length < 2) {
  console.log("\n     Hinweis: Puls und Sprint brauchen mehr als einen Kopf.");
}
console.log("");
